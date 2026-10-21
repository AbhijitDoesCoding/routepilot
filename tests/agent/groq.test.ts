import { test, describe, mock, afterEach, beforeEach } from "node:test";
import * as assert from "node:assert";
import { GroqAgent, compactToolResult, formatTravelPlanSummary } from "../../src/agent/groq.js";
import { MCPClientService } from "../../src/mcp/client/index.js";
import { SessionStore } from "../../src/agent/session.js";
import { Clock } from "../../src/agent/clock.js";

describe("Groq Agent Loop", () => {
  beforeEach(() => {
    process.env.GROQ_API_KEY = "mock-groq-key";
    process.env.GROQ_MODEL_ID = "openai/gpt-oss-120b";
  });

  afterEach(() => {
    mock.restoreAll();
  });

  test("1. ordinary text response without tools", async () => {
    const mcpService = new MCPClientService();
    mock.method(mcpService, "getGroqTools", async () => []);

    const sessionStore = new SessionStore();
    const clock = new Clock();
    const agent = new GroqAgent(mcpService, sessionStore, clock);

    const createMock = mock.method((agent as any).groqClient.chat.completions, "create", async () => {
      return {
        choices: [
          {
            message: { role: "assistant", content: "Hello! I am RoutePilot powered by Groq." },
            finish_reason: "stop"
          }
        ]
      };
    });

    const response = await agent.converse("groq-session-1", "Hi");

    assert.strictEqual(response.message, "Hello! I am RoutePilot powered by Groq.");
    assert.strictEqual(createMock.mock.callCount(), 1);
  });

  test("2. geocode tool call and result return", async () => {
    const mcpService = new MCPClientService();
    mock.method(mcpService, "getGroqTools", async () => [
      { type: "function", function: { name: "geocode", parameters: {} } }
    ]);

    const executeMock = mock.method(mcpService, "executeTool", async (name: string, args: any) => {
      assert.strictEqual(name, "geocode");
      assert.strictEqual(args.query, "Pune Airport");
      return { isError: false, data: { results: [{ lat: 18.58, lon: 73.92, name: "Pune Airport" }] } };
    });

    const sessionStore = new SessionStore();
    const clock = new Clock();
    const agent = new GroqAgent(mcpService, sessionStore, clock);

    let callCount = 0;
    mock.method((agent as any).groqClient.chat.completions, "create", async (params: any) => {
      callCount++;
      if (callCount === 1) {
        return {
          choices: [
            {
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "call_geo_1",
                    type: "function",
                    function: {
                      name: "geocode",
                      arguments: JSON.stringify({ query: "Pune Airport" })
                    }
                  }
                ]
              },
              finish_reason: "tool_calls"
            }
          ]
        };
      } else {
        // Verify tool result was sent in messages
        const msgs = params.messages;
        const toolMsg = msgs.find((m: any) => m.role === "tool");
        assert.ok(toolMsg, "Should have appended tool message");
        assert.strictEqual(toolMsg.tool_call_id, "call_geo_1");
        assert.ok(toolMsg.content.includes("18.58"));

        return {
          choices: [
            {
              message: { role: "assistant", content: "Pune Airport is at latitude 18.58, longitude 73.92." },
              finish_reason: "stop"
            }
          ]
        };
      }
    });

    const response = await agent.converse("groq-session-2", "Where is Pune Airport?");

    assert.strictEqual(response.message, "Pune Airport is at latitude 18.58, longitude 73.92.");
    assert.strictEqual(callCount, 2);
    assert.strictEqual(executeMock.mock.callCount(), 1);
  });

  test("3. compare_routes tool call populates deterministic TravelPlan", async () => {
    const mcpService = new MCPClientService();
    mock.method(mcpService, "getGroqTools", async () => [
      { type: "function", function: { name: "compare_routes", parameters: {} } }
    ]);

    const mockCompareResult = {
      feasible: true,
      recommended: {
        valid: true,
        route: {
          distanceKm: 21.4,
          durationMinutes: 52,
          drivingDurationMinutes: 52,
          stopDurationMinutes: 0,
          geometry: { type: "LineString", coordinates: [[73.8, 18.5], [73.9, 18.58]] }
        },
        constraintEvaluations: [
          { type: "avoid_tolls", severity: "hard", status: "satisfied" }
        ]
      }
    };

    mock.method(mcpService, "executeTool", async (name: string) => {
      assert.strictEqual(name, "compare_routes");
      return { isError: false, data: mockCompareResult };
    });

    const sessionStore = new SessionStore();
    const clock = new Clock();
    const agent = new GroqAgent(mcpService, sessionStore, clock);

    let callCount = 0;
    mock.method((agent as any).groqClient.chat.completions, "create", async () => {
      callCount++;
      if (callCount === 1) {
        return {
          choices: [
            {
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "call_cmp_1",
                    type: "function",
                    function: {
                      name: "compare_routes",
                      arguments: JSON.stringify({
                        locations: [{ lat: 18.5, lon: 73.8, name: "Home" }, { lat: 18.58, lon: 73.92, name: "Pune Airport" }],
                        mode: "auto",
                        constraints: [
                          { type: "avoid_tolls", severity: "hard" },
                          { type: "arrival_deadline", severity: "hard", value: "2026-10-10T07:00:00.000Z" }
                        ]
                      })
                    }
                  }
                ]
              },
              finish_reason: "tool_calls"
            }
          ]
        };
      } else {
        return {
          choices: [
            {
              message: { role: "assistant", content: "I recommend leaving at 6:08 AM to reach by 7:00 AM." },
              finish_reason: "stop"
            }
          ]
        };
      }
    });

    const response = await agent.converse("groq-session-3", "Reach airport by 7 AM avoid tolls");

    assert.ok(response.travelPlan);
    assert.strictEqual(response.travelPlan.durationMinutes, 52);
    assert.strictEqual(response.travelPlan.distanceKm, 21.4);
    assert.strictEqual(response.travelPlan.arrivalDeadline, "2026-10-10T07:00:00.000Z");
    assert.ok(response.travelPlan.departureTime);
    assert.strictEqual(response.travelPlan.bufferMinutes, 0);
  });

  test("4. route-aware coffee-stop workflow with intermediate stop dwell and math", async () => {
    const mcpService = new MCPClientService();
    mock.method(mcpService, "getGroqTools", async () => [
      { type: "function", function: { name: "compare_routes", parameters: {} } }
    ]);

    const mockCompareResultWithStop = {
      feasible: true,
      recommended: {
        valid: true,
        route: {
          distanceKm: 22.1,
          durationMinutes: 67, // 52 driving + 15 stop
          drivingDurationMinutes: 52,
          stopDurationMinutes: 15,
          geometry: { type: "LineString", coordinates: [[73.8, 18.5], [73.85, 18.53], [73.9, 18.58]] }
        },
        constraintEvaluations: [
          { type: "avoid_tolls", severity: "hard", status: "satisfied" }
        ]
      }
    };

    mock.method(mcpService, "executeTool", async () => {
      return { isError: false, data: mockCompareResultWithStop };
    });

    const sessionStore = new SessionStore();
    const clock = new Clock();
    const agent = new GroqAgent(mcpService, sessionStore, clock);

    let callCount = 0;
    mock.method((agent as any).groqClient.chat.completions, "create", async () => {
      callCount++;
      if (callCount === 1) {
        return {
          choices: [
            {
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "call_stop_1",
                    type: "function",
                    function: {
                      name: "compare_routes",
                      arguments: JSON.stringify({
                        locations: [
                          { lat: 18.5, lon: 73.8, name: "Home" },
                          { lat: 18.53, lon: 73.85, name: "Café Corner" },
                          { lat: 18.58, lon: 73.92, name: "Pune Airport" }
                        ],
                        mode: "auto",
                        stops: [{ locationIndex: 1, name: "Café Corner", lat: 18.53, lon: 73.85, durationMinutes: 15 }],
                        constraints: [
                          { type: "arrival_deadline", severity: "hard", value: "2026-10-10T07:00:00.000Z" }
                        ]
                      })
                    }
                  }
                ]
              },
              finish_reason: "tool_calls"
            }
          ]
        };
      } else {
        return {
          choices: [
            {
              message: { role: "assistant", content: "Added Café Corner with a 15-minute coffee stop." },
              finish_reason: "stop"
            }
          ]
        };
      }
    });

    const response = await agent.converse("groq-session-4", "Add a coffee stop on the way");

    assert.ok(response.travelPlan);
    assert.strictEqual(response.travelPlan.durationMinutes, 67);
    assert.strictEqual(response.travelPlan.drivingDurationMinutes, 52);
    assert.strictEqual(response.travelPlan.stopDurationMinutes, 15);
    assert.strictEqual(response.travelPlan.stops?.length, 1);
    assert.strictEqual(response.travelPlan.stops[0].name, "Café Corner");
  });

  test("5. sequential tool execution across multiple rounds", async () => {
    const mcpService = new MCPClientService();
    mock.method(mcpService, "getGroqTools", async () => [
      { type: "function", function: { name: "geocode", parameters: {} } },
      { type: "function", function: { name: "compare_routes", parameters: {} } }
    ]);

    const toolHistory: string[] = [];
    mock.method(mcpService, "executeTool", async (name: string) => {
      toolHistory.push(name);
      if (name === "geocode") return { isError: false, data: { results: [{ lat: 18.58, lon: 73.92 }] } };
      return {
        isError: false,
        data: {
          feasible: true,
          recommended: {
            valid: true,
            route: { distanceKm: 15, durationMinutes: 30, geometry: {} }
          }
        }
      };
    });

    const sessionStore = new SessionStore();
    const clock = new Clock();
    const agent = new GroqAgent(mcpService, sessionStore, clock);

    let round = 0;
    mock.method((agent as any).groqClient.chat.completions, "create", async () => {
      round++;
      if (round === 1) {
        return {
          choices: [
            {
              message: {
                role: "assistant",
                tool_calls: [{ id: "call_1", function: { name: "geocode", arguments: '{"query":"Pune"}' } }]
              },
              finish_reason: "tool_calls"
            }
          ]
        };
      } else if (round === 2) {
        return {
          choices: [
            {
              message: {
                role: "assistant",
                tool_calls: [{ id: "call_2", function: { name: "compare_routes", arguments: '{"locations":[{"lat":1,"lon":2},{"lat":3,"lon":4}]}' } }]
              },
              finish_reason: "tool_calls"
            }
          ]
        };
      } else {
        return {
          choices: [
            {
              message: { role: "assistant", content: "Plan ready after sequential geocode and compare_routes." },
              finish_reason: "stop"
            }
          ]
        };
      }
    });

    const response = await agent.converse("groq-session-5", "Plan my route");

    assert.strictEqual(response.message, "Plan ready after sequential geocode and compare_routes.");
    assert.deepStrictEqual(toolHistory, ["geocode", "compare_routes"]);
  });

  test("6. multi-turn context retention across turns", async () => {
    const mcpService = new MCPClientService();
    mock.method(mcpService, "getGroqTools", async () => []);

    const sessionStore = new SessionStore();
    const clock = new Clock();
    const agent = new GroqAgent(mcpService, sessionStore, clock);

    const receivedMessagesHistory: any[][] = [];
    mock.method((agent as any).groqClient.chat.completions, "create", async (params: any) => {
      receivedMessagesHistory.push(params.messages);
      const lastUserMsg = params.messages[params.messages.length - 1];
      return {
        choices: [
          {
            message: { role: "assistant", content: `Response to ${lastUserMsg.content}` },
            finish_reason: "stop"
          }
        ]
      };
    });

    // Turn 1
    const r1 = await agent.converse("turn-session", "Turn 1 request");
    assert.strictEqual(r1.message, "Response to Turn 1 request");

    // Turn 2
    const r2 = await agent.converse("turn-session", "Turn 2 request");
    assert.strictEqual(r2.message, "Response to Turn 2 request");

    // Check Turn 2 received full history
    const turn2Messages = receivedMessagesHistory[1];
    const userMessages = turn2Messages.filter((m: any) => m.role === "user");
    assert.strictEqual(userMessages.length, 2);
    assert.strictEqual(userMessages[0].content, "Turn 1 request");
    assert.strictEqual(userMessages[1].content, "Turn 2 request");
  });

  test("7. unexpected API error handling propagates cleanly", async () => {
    const mcpService = new MCPClientService();
    mock.method(mcpService, "getGroqTools", async () => []);

    const sessionStore = new SessionStore();
    const clock = new Clock();
    const agent = new GroqAgent(mcpService, sessionStore, clock);

    mock.method((agent as any).groqClient.chat.completions, "create", async () => {
      throw new Error("Groq 500 Internal Server Error");
    });

    await assert.rejects(
      async () => {
        await agent.converse("err-session", "Hello");
      },
      /Groq 500 Internal Server Error/
    );
  });

  test("8. malformed tool arguments are handled without crashing", async () => {
    const mcpService = new MCPClientService();
    mock.method(mcpService, "getGroqTools", async () => [
      { type: "function", function: { name: "geocode", parameters: {} } }
    ]);

    const sessionStore = new SessionStore();
    const clock = new Clock();
    const agent = new GroqAgent(mcpService, sessionStore, clock);

    let callCount = 0;
    mock.method((agent as any).groqClient.chat.completions, "create", async (params: any) => {
      callCount++;
      if (callCount === 1) {
        return {
          choices: [
            {
              message: {
                role: "assistant",
                tool_calls: [
                  {
                    id: "call_malformed",
                    type: "function",
                    function: {
                      name: "geocode",
                      arguments: "{ query: broken json without quotes... }" // Invalid JSON
                    }
                  }
                ]
              },
              finish_reason: "tool_calls"
            }
          ]
        };
      } else {
        // Assert error message was sent back in tool role
        const toolMsg = params.messages.find((m: any) => m.role === "tool");
        assert.ok(toolMsg);
        assert.ok(toolMsg.content.includes("Malformed tool arguments"));

        return {
          choices: [
            {
              message: { role: "assistant", content: "I encountered an error with arguments and recovered." },
              finish_reason: "stop"
            }
          ]
        };
      }
    });

    const response = await agent.converse("malformed-session", "Test malformed");
    assert.strictEqual(response.message, "I encountered an error with arguments and recovered.");
  });

  test("9. maximum tool rounds limit is enforced gracefully", async () => {
    const mcpService = new MCPClientService();
    mock.method(mcpService, "getGroqTools", async () => [
      { type: "function", function: { name: "geocode", parameters: {} } }
    ]);
    mock.method(mcpService, "executeTool", async () => ({ isError: false, data: {} }));

    const sessionStore = new SessionStore();
    const clock = new Clock();
    const agent = new GroqAgent(mcpService, sessionStore, clock);

    let roundCount = 0;
    mock.method((agent as any).groqClient.chat.completions, "create", async () => {
      roundCount++;
      // Loop forever asking for tool calls
      return {
        choices: [
          {
            message: {
              role: "assistant",
              tool_calls: [{ id: `call_${roundCount}`, function: { name: "geocode", arguments: "{}" } }]
            },
            finish_reason: "tool_calls"
          }
        ]
      };
    });

    const response = await agent.converse("max-rounds-session", "Infinite loop prompt");

    assert.strictEqual(roundCount, 6); // Exactly 5 tool rounds + 1 finalization call
    assert.ok(response.message.includes("too many tool calls"));
  });

  test("10. compactToolResult omits coordinates, legs, maneuvers and preserves metrics/evaluations", () => {
    const mockFullCompare = {
      feasible: true,
      reason: "All hard constraints satisfied",
      recommended: {
        valid: true,
        score: 0.95,
        route: {
          candidateId: "rec_1",
          distanceKm: 25.4,
          durationMinutes: 48,
          drivingDurationMinutes: 48,
          stopDurationMinutes: 0,
          hasToll: false,
          hasHighway: false,
          costingProfile: "auto",
          geometry: {
            type: "LineString",
            coordinates: Array.from({ length: 266 }, (_, i) => [73.8 + i * 0.001, 18.5 + i * 0.001])
          },
          legs: [{ distance: 25400, maneuvers: [{ instruction: "Turn right", type: 1 }] }]
        },
        constraintEvaluations: [{ type: "avoid_tolls", severity: "hard", status: "satisfied" }],
        violatedConstraints: [],
        satisfiedConstraints: ["avoid_tolls"],
        explanation: "Feasible toll-free route"
      },
      alternatives: [
        {
          valid: false,
          score: 0.5,
          route: {
            candidateId: "alt_1",
            distanceKm: 20.0,
            durationMinutes: 35,
            hasToll: true,
            hasHighway: true,
            geometry: { type: "LineString", coordinates: [[73.8, 18.5], [73.9, 18.6]] }
          },
          violatedConstraints: ["avoid_tolls"],
          explanation: "Contains toll"
        }
      ]
    };

    const compacted = compactToolResult("compare_routes", mockFullCompare);

    assert.strictEqual(compacted.feasible, true);
    assert.strictEqual(compacted.reason, "All hard constraints satisfied");
    assert.strictEqual(compacted.recommended.route.distanceKm, 25.4);
    assert.strictEqual(compacted.recommended.route.durationMinutes, 48);
    assert.strictEqual(compacted.recommended.route.hasToll, false);
    assert.strictEqual(compacted.recommended.route.hasHighway, false);
    // Crucial: geometry, legs, maneuvers must NOT be present
    assert.strictEqual(compacted.recommended.route.geometry, undefined);
    assert.strictEqual(compacted.recommended.route.legs, undefined);
    assert.strictEqual(compacted.recommended.route.maneuvers, undefined);
    // Preserves evaluations
    assert.strictEqual(compacted.recommended.constraintEvaluations.length, 1);
    // Preserves alternatives without geometry
    assert.strictEqual(compacted.alternatives.length, 1);
    assert.strictEqual(compacted.alternatives[0].route.distanceKm, 20.0);
    assert.strictEqual(compacted.alternatives[0].route.geometry, undefined);
  });

  test("11. compactToolResult bounds geocode and find_places_along_route results with distanceToRouteMeters", () => {
    const rawGeocode = {
      results: Array.from({ length: 10 }, (_, i) => ({
        name: `Place ${i}`,
        lat: 18.5 + i * 0.01,
        lon: 73.8 + i * 0.01,
        extraInfo: "Unneeded metadata"
      }))
    };
    const compactedGeocode = compactToolResult("geocode", rawGeocode);
    assert.strictEqual(compactedGeocode.results.length, 3);
    assert.strictEqual(compactedGeocode.results[0].name, "Place 0");

    const rawPlaces = {
      places: Array.from({ length: 15 }, (_, i) => ({
        id: `place_${i}`,
        name: `Cafe ${i}`,
        category: "coffee",
        lat: 18.5 + i * 0.01,
        lon: 73.8 + i * 0.01,
        distanceToRouteMeters: 50 + i * 10,
        extraBulkyOsmData: { tags: { amenity: "cafe" } }
      }))
    };
    const compactedPlaces = compactToolResult("find_places_along_route", rawPlaces);
    assert.strictEqual(compactedPlaces.places.length, 5);
    assert.strictEqual(compactedPlaces.count, 15);
    assert.strictEqual(compactedPlaces.places[0].distanceToRouteMeters, 50);
  });

  test("12. formatTravelPlanSummary produces concise summary string without geometry and returns null when empty", () => {
    assert.strictEqual(formatTravelPlanSummary(null as any), null);
    assert.strictEqual(formatTravelPlanSummary({} as any), null);

    const plan: any = {
      origin: { name: "Home", lat: 18.5, lon: 73.8 },
      destination: { name: "Pune Airport", lat: 18.58, lon: 73.92 },
      arrivalDeadline: "2026-10-10T07:00:00.000Z",
      departureTime: "2026-10-10T06:08:00.000Z",
      actualEta: "2026-10-10T07:00:00.000Z",
      durationMinutes: 52,
      drivingDurationMinutes: 52,
      distanceKm: 21.4,
      stops: [{ name: "Starbucks", durationMinutes: 15 }],
      constraints: [{ type: "avoid_tolls", severity: "hard" }],
      warnings: ["Stop \"Starbucks\" was missing coordinates; restored them from the active plan."],
      // Bulky geometry
      routeGeometry: { type: "LineString", coordinates: [[73.8, 18.5], [73.9, 18.58]] }
    };

    const summary = formatTravelPlanSummary(plan);
    assert.ok(summary);
    assert.ok(summary.includes("Origin: Home"));
    assert.ok(summary.includes("Destination: Pune Airport"));
    assert.ok(summary.includes("Arrival Deadline: 2026-10-10T07:00:00.000Z"));
    assert.ok(summary.includes("Calculated Latest Departure: 2026-10-10T06:08:00.000Z"));
    assert.ok(summary.includes("Distance: 21.4 km"));
    assert.ok(summary.includes("Starbucks (15 min stop)"));
    assert.ok(summary.includes("avoid_tolls (hard)"));
    assert.ok(summary.includes("Route Status: Feasible"));
    assert.strictEqual(summary.includes("Infeasible"), false);
    // Ensure no coordinates or LineString in summary
    assert.strictEqual(summary.includes("LineString"), false);
    assert.strictEqual(summary.includes("routeGeometry"), false);
  });

  test("13. GroqAgent.converse sends compact tool results to Groq, while travelPlan retains full GeoJSON geometry", async () => {
    const mcpService = new MCPClientService();
    mock.method(mcpService, "getGroqTools", async () => [
      { type: "function", function: { name: "compare_routes", parameters: {} } }
    ]);

    const full266Coords = Array.from({ length: 266 }, (_, i) => [73.8 + i * 0.001, 18.5 + i * 0.001]);
    const mockCompareResult = {
      feasible: true,
      recommended: {
        valid: true,
        route: {
          distanceKm: 21.4,
          durationMinutes: 52,
          drivingDurationMinutes: 52,
          geometry: { type: "LineString", coordinates: full266Coords }
        },
        constraintEvaluations: [{ type: "avoid_tolls", severity: "hard", status: "satisfied" }]
      }
    };

    mock.method(mcpService, "executeTool", async () => {
      return { isError: false, data: mockCompareResult };
    });

    const sessionStore = new SessionStore();
    const clock = new Clock();
    const agent = new GroqAgent(mcpService, sessionStore, clock);

    let round = 0;
    let toolPayloadSentToGroq: any = null;
    mock.method((agent as any).groqClient.chat.completions, "create", async (params: any) => {
      round++;
      if (round === 1) {
        return {
          choices: [
            {
              message: {
                role: "assistant",
                tool_calls: [
                  {
                    id: "call_geo_cmp",
                    type: "function",
                    function: {
                      name: "compare_routes",
                      arguments: JSON.stringify({ locations: [{ lat: 18.5, lon: 73.8 }, { lat: 18.58, lon: 73.92 }] })
                    }
                  }
                ]
              },
              finish_reason: "tool_calls"
            }
          ]
        };
      } else {
        const toolMsg = params.messages.find((m: any) => m.role === "tool");
        toolPayloadSentToGroq = JSON.parse(toolMsg.content);
        return {
          choices: [
            {
              message: { role: "assistant", content: "Route planned successfully." },
              finish_reason: "stop"
            }
          ]
        };
      }
    });

    const response = await agent.converse("compact-test-session", "Plan my route");

    // Check payload sent to Groq
    assert.ok(toolPayloadSentToGroq);
    assert.strictEqual(toolPayloadSentToGroq.recommended.route.geometry, undefined);
    assert.strictEqual(toolPayloadSentToGroq.recommended.route.distanceKm, 21.4);

    // Check full TravelPlan returned to application/frontend
    assert.ok(response.travelPlan);
    assert.strictEqual(response.travelPlan.routeGeometry?.coordinates.length, 266);
  });

  test("14. Turn 2 working messages do not contain Turn 1 tool calls or tool results", async () => {
    const mcpService = new MCPClientService();
    mock.method(mcpService, "getGroqTools", async () => [
      { type: "function", function: { name: "geocode", parameters: {} } }
    ]);
    mock.method(mcpService, "executeTool", async () => ({
      isError: false,
      data: { results: [{ lat: 18.5, lon: 73.8, name: "Home" }] }
    }));

    const sessionStore = new SessionStore();
    const clock = new Clock();
    const agent = new GroqAgent(mcpService, sessionStore, clock);

    let capturedTurn2Messages: any[] = [];
    let turn = 1;
    let roundInTurn = 0;

    mock.method((agent as any).groqClient.chat.completions, "create", async (params: any) => {
      roundInTurn++;
      if (turn === 1) {
        if (roundInTurn === 1) {
          return {
            choices: [
              {
                message: {
                  role: "assistant",
                  tool_calls: [{ id: "t1_call", function: { name: "geocode", arguments: '{"query":"Home"}' } }]
                },
                finish_reason: "tool_calls"
              }
            ]
          };
        } else {
          return {
            choices: [{ message: { role: "assistant", content: "Turn 1 final answer." }, finish_reason: "stop" }]
          };
        }
      } else {
        capturedTurn2Messages = [...params.messages];
        return {
          choices: [{ message: { role: "assistant", content: "Turn 2 final answer." }, finish_reason: "stop" }]
        };
      }
    });

    // Execute Turn 1
    await agent.converse("t1-t2-session", "Find Home");

    // Execute Turn 2
    turn = 2;
    roundInTurn = 0;
    await agent.converse("t1-t2-session", "Add coffee stop");

    // Verify Turn 2's sent messages
    assert.ok(capturedTurn2Messages.length > 0);
    const hasToolRole = capturedTurn2Messages.some((m: any) => m.role === "tool");
    const hasToolCalls = capturedTurn2Messages.some((m: any) => m.tool_calls && m.tool_calls.length > 0);
    assert.strictEqual(hasToolRole, false, "Turn 2 must NOT have role: tool from Turn 1");
    assert.strictEqual(hasToolCalls, false, "Turn 2 must NOT have tool_calls from Turn 1");

    // Verify conversational messages are present
    const userMsgs = capturedTurn2Messages.filter((m: any) => m.role === "user");
    assert.strictEqual(userMsgs.length, 2);
    assert.strictEqual(userMsgs[0].content, "Find Home");
    assert.strictEqual(userMsgs[1].content, "Add coffee stop");

    const assistantMsgs = capturedTurn2Messages.filter((m: any) => m.role === "assistant");
    assert.strictEqual(assistantMsgs.length, 1);
    assert.strictEqual(assistantMsgs[0].content, "Turn 1 final answer.");
  });

  test("15. Turn 2 retains trip context via system prompt travelPlan summary", async () => {
    const mcpService = new MCPClientService();
    mock.method(mcpService, "getGroqTools", async () => [
      { type: "function", function: { name: "compare_routes", parameters: {} } }
    ]);
    mock.method(mcpService, "executeTool", async () => ({
      isError: false,
      data: {
        feasible: true,
        recommended: {
          valid: true,
          route: { distanceKm: 21.4, durationMinutes: 52 },
          constraintEvaluations: [{ type: "avoid_tolls", severity: "hard", status: "satisfied" }]
        }
      }
    }));

    const sessionStore = new SessionStore();
    const clock = new Clock();
    const agent = new GroqAgent(mcpService, sessionStore, clock);

    let systemPromptInTurn2 = "";
    let turn = 1;
    let round = 0;

    mock.method((agent as any).groqClient.chat.completions, "create", async (params: any) => {
      round++;
      if (turn === 1) {
        if (round === 1) {
          return {
            choices: [
              {
                message: {
                  role: "assistant",
                  tool_calls: [{
                    id: "cmp_1",
                    function: {
                      name: "compare_routes",
                      arguments: JSON.stringify({
                        locations: [{ lat: 18.5, lon: 73.8, name: "Home" }, { lat: 18.58, lon: 73.92, name: "Airport" }],
                        constraints: [{ type: "avoid_tolls", severity: "hard" }]
                      })
                    }
                  }]
                },
                finish_reason: "tool_calls"
              }
            ]
          };
        } else {
          return {
            choices: [{ message: { role: "assistant", content: "Turn 1 route planned." }, finish_reason: "stop" }]
          };
        }
      } else {
        const sysMsg = params.messages.find((m: any) => m.role === "system");
        systemPromptInTurn2 = sysMsg.content;
        return {
          choices: [{ message: { role: "assistant", content: "Turn 2 modified route." }, finish_reason: "stop" }]
        };
      }
    });

    await agent.converse("sys-prompt-ctx-session", "Plan route from Home to Airport avoiding tolls");

    turn = 2;
    round = 0;
    await agent.converse("sys-prompt-ctx-session", "Add a 15-minute coffee stop");

    assert.ok(systemPromptInTurn2.includes("ACTIVE TRAVEL PLAN CONTEXT:"));
    assert.ok(systemPromptInTurn2.includes("Origin: Home"));
    assert.ok(systemPromptInTurn2.includes("Destination: Airport"));
    assert.ok(systemPromptInTurn2.includes("Distance: 21.4 km"));
  });

  test("16. Groq 413 / token limit error triggers safe compaction and retry", async () => {
    const mcpService = new MCPClientService();
    mock.method(mcpService, "getGroqTools", async () => []);

    const sessionStore = new SessionStore();
    const clock = new Clock();
    const agent = new GroqAgent(mcpService, sessionStore, clock);

    // Pre-populate session with historical conversation
    sessionStore.updateSession("rate-limit-session", {
      sessionId: "rate-limit-session",
      messages: [
        { role: "user", content: "Historical Turn 1" },
        { role: "assistant", content: "Historical Turn 1 Response" }
      ],
      travelPlan: {} as any
    });

    let calls = 0;
    let retriedMessages: any[] = [];
    mock.method((agent as any).groqClient.chat.completions, "create", async (params: any) => {
      calls++;
      if (calls === 1) {
        const err: any = new Error("413 Request too large ... Limit 8000 tokens per minute");
        err.status = 413;
        throw err;
      }
      retriedMessages = params.messages;
      return {
        choices: [
          { message: { role: "assistant", content: "Recovered after compaction retry." }, finish_reason: "stop" }
        ]
      };
    });

    const response = await agent.converse("rate-limit-session", "Turn 2 question");

    assert.strictEqual(calls, 2);
    assert.strictEqual(response.message, "Recovered after compaction retry.");
    // In retry, historical messages were pruned, only system prompt + current user message remained
    assert.strictEqual(retriedMessages.length, 2);
    assert.strictEqual(retriedMessages[0].role, "system");
    assert.strictEqual(retriedMessages[1].role, "user");
    assert.strictEqual(retriedMessages[1].content, "Turn 2 question");
  });

  test("17. Groq 413 / token limit error returns sanitized response when retry fails", async () => {
    const mcpService = new MCPClientService();
    mock.method(mcpService, "getGroqTools", async () => []);

    const sessionStore = new SessionStore();
    const clock = new Clock();
    const agent = new GroqAgent(mcpService, sessionStore, clock);

    mock.method((agent as any).groqClient.chat.completions, "create", async () => {
      const err: any = new Error("Rate limit 429: TPM exceeded");
      err.status = 429;
      throw err;
    });

    const response = await agent.converse("persistent-rate-limit-session", "Test token limit");

    assert.ok(response.message.includes("Route planning is temporarily experiencing high demand or token limits"));
  });

  test("18. a tool call on the last permitted tool round still gets one final text response", async () => {
    const mcpService = new MCPClientService();
    mock.method(mcpService, "getGroqTools", async () => [
      { type: "function", function: { name: "compare_routes", parameters: {} } }
    ]);

    mock.method(mcpService, "executeTool", async () => ({
      isError: false,
      data: {
        feasible: true,
        recommended: {
          valid: true,
          route: { distanceKm: 18.2, durationMinutes: 35, geometry: { type: "LineString", coordinates: [[73.8, 18.5], [73.9, 18.6]] } }
        }
      }
    }));

    const sessionStore = new SessionStore();
    const clock = new Clock();
    const agent = new GroqAgent(mcpService, sessionStore, clock);

    let callCount = 0;
    mock.method((agent as any).groqClient.chat.completions, "create", async (params: any) => {
      callCount++;
      if (callCount <= 5) {
        // Return tool call for rounds 1-5
        return {
          choices: [
            {
              message: {
                role: "assistant",
                tool_calls: [{ id: `call_${callCount}`, function: { name: "compare_routes", arguments: '{"locations":[{"lat":18.5,"lon":73.8},{"lat":18.6,"lon":73.9}]}' } }]
              },
              finish_reason: "tool_calls"
            }
          ]
        };
      } else {
        // Finalization call (call 6): tool calling must be disabled
        assert.strictEqual(params.tools, undefined);
        return {
          choices: [
            {
              message: { role: "assistant", content: "Final summarized route after 5 tool rounds." },
              finish_reason: "stop"
            }
          ]
        };
      }
    });

    const response = await agent.converse("final-text-session", "Plan my route");

    assert.strictEqual(callCount, 6);
    assert.strictEqual(response.message, "Final summarized route after 5 tool rounds.");
    assert.ok(response.travelPlan);
    assert.strictEqual(response.travelPlan.distanceKm, 18.2);
  });

  test("19. the finalization call cannot execute more tools and falls back to TravelPlan summary", async () => {
    const mcpService = new MCPClientService();
    mock.method(mcpService, "getGroqTools", async () => [
      { type: "function", function: { name: "compare_routes", parameters: {} } }
    ]);

    let toolExecutionCount = 0;
    mock.method(mcpService, "executeTool", async () => {
      toolExecutionCount++;
      return {
        isError: false,
        data: {
          feasible: true,
          recommended: {
            valid: true,
            route: { distanceKm: 15.0, durationMinutes: 30 }
          }
        }
      };
    });

    const sessionStore = new SessionStore();
    const clock = new Clock();
    const agent = new GroqAgent(mcpService, sessionStore, clock);

    let callCount = 0;
    mock.method((agent as any).groqClient.chat.completions, "create", async () => {
      callCount++;
      if (callCount <= 5) {
        return {
          choices: [
            {
              message: {
                role: "assistant",
                tool_calls: [{ id: `call_${callCount}`, function: { name: "compare_routes", arguments: '{"locations":[{"lat":18.5,"lon":73.8},{"lat":18.6,"lon":73.9}]}' } }]
              },
              finish_reason: "tool_calls"
            }
          ]
        };
      } else {
        // Call 6 attempts to return tool calls instead of content
        return {
          choices: [
            {
              message: {
                role: "assistant",
                content: null,
                tool_calls: [{ id: "unwanted_tool", function: { name: "compare_routes", arguments: "{}" } }]
              },
              finish_reason: "tool_calls"
            }
          ]
        };
      }
    });

    const response = await agent.converse("no-unwanted-tools-session", "Route please");

    assert.strictEqual(callCount, 6);
    assert.strictEqual(toolExecutionCount, 5); // Unwanted tool call in finalization was NOT executed!
    assert.ok(response.message.includes("I have planned your route"));
    assert.ok(response.message.includes("15.0 km"));
  });

  test("20. repeated identical failed find_places_along_route requests cannot loop indefinitely", async () => {
    const mcpService = new MCPClientService();
    mock.method(mcpService, "getGroqTools", async () => [
      { type: "function", function: { name: "find_places_along_route", parameters: {} } }
    ]);

    let executeCallCount = 0;
    mock.method(mcpService, "executeTool", async (name: string) => {
      executeCallCount++;
      return {
        isError: true,
        data: { isError: true, error: "Overpass API 500 error", retryable: false }
      };
    });

    const sessionStore = new SessionStore();
    const clock = new Clock();
    const agent = new GroqAgent(mcpService, sessionStore, clock);

    let groqRound = 0;
    mock.method((agent as any).groqClient.chat.completions, "create", async (params: any) => {
      groqRound++;
      if (groqRound === 1) {
        return {
          choices: [
            {
              message: {
                role: "assistant",
                tool_calls: [{ id: "call_fp_1", function: { name: "find_places_along_route", arguments: '{"category":"cafe"}' } }]
              },
              finish_reason: "tool_calls"
            }
          ]
        };
      } else if (groqRound === 2) {
        // Model attempts to call the EXACT SAME failing tool again
        return {
          choices: [
            {
              message: {
                role: "assistant",
                tool_calls: [{ id: "call_fp_2", function: { name: "find_places_along_route", arguments: '{"category":"cafe"}' } }]
              },
              finish_reason: "tool_calls"
            }
          ]
        };
      } else {
        // Model stops and generates response
        const toolMsg = params.messages[params.messages.length - 1];
        assert.ok(toolMsg.content.includes("Repeated requests are prohibited"));
        return {
          choices: [
            {
              message: { role: "assistant", content: "Stop discovery is temporarily unavailable. Proceeding with baseline route." },
              finish_reason: "stop"
            }
          ]
        };
      }
    });

    const response = await agent.converse("dedup-failing-tool-session", "Find coffee on the way");

    assert.strictEqual(executeCallCount, 1); // Only executed ONCE; 2nd identical call was intercepted!
    assert.strictEqual(response.message, "Stop discovery is temporarily unavailable. Proceeding with baseline route.");
  });

  test("21. failed stop discovery preserves baseline route and full geometry", async () => {
    const mcpService = new MCPClientService();
    mock.method(mcpService, "getGroqTools", async () => [
      { type: "function", function: { name: "find_places_along_route", parameters: {} } }
    ]);
    mock.method(mcpService, "executeTool", async () => ({
      isError: true,
      data: { isError: true, error: "Overpass API error: 503", retryable: false }
    }));

    const sessionStore = new SessionStore();
    const clock = new Clock();
    const agent = new GroqAgent(mcpService, sessionStore, clock);

    // Pre-populate session with feasible baseline route from Turn 1 (266 coordinates)
    const baselineCoords = Array.from({ length: 266 }, (_, i) => [73.8 + i * 0.001, 18.5 + i * 0.001]);
    sessionStore.updateSession("preserve-baseline-session", {
      sessionId: "preserve-baseline-session",
      messages: [{ role: "user", content: "Go to airport" }, { role: "assistant", content: "Baseline route planned." }],
      travelPlan: {
        id: "plan-1",
        origin: { name: "Home", lat: 18.5, lon: 73.8 },
        destination: { name: "Airport", lat: 18.6, lon: 73.9 },
        distanceKm: 12.5,
        durationMinutes: 25,
        routeGeometry: { type: "LineString", coordinates: baselineCoords }
      }
    });

    let round = 0;
    mock.method((agent as any).groqClient.chat.completions, "create", async () => {
      round++;
      if (round === 1) {
        return {
          choices: [
            {
              message: {
                role: "assistant",
                tool_calls: [{ id: "call_fp_err", function: { name: "find_places_along_route", arguments: '{"category":"cafe"}' } }]
              },
              finish_reason: "tool_calls"
            }
          ]
        };
      } else {
        return {
          choices: [
            {
              message: { role: "assistant", content: "Café discovery is temporarily unavailable; your direct baseline route to Airport is preserved." },
              finish_reason: "stop"
            }
          ]
        };
      }
    });

    const response = await agent.converse("preserve-baseline-session", "Add a coffee stop");

    // Baseline route & 266 coordinates must remain intact!
    assert.ok(response.travelPlan);
    assert.strictEqual(response.travelPlan.distanceKm, 12.5);
    assert.strictEqual(response.travelPlan.durationMinutes, 25);
    assert.strictEqual(response.travelPlan.routeGeometry?.coordinates.length, 266);
    assert.ok(response.message.includes("Café discovery is temporarily unavailable"));
  });

  test("22. successful stop selection and route recalculation preserve full geometry and stop duration", async () => {
    const mcpService = new MCPClientService();
    mock.method(mcpService, "getGroqTools", async () => [
      { type: "function", function: { name: "find_places_along_route", parameters: {} } },
      { type: "function", function: { name: "compare_routes", parameters: {} } }
    ]);

    const routeWithStopCoords = Array.from({ length: 271 }, (_, i) => [73.8 + i * 0.001, 18.5 + i * 0.001]);
    mock.method(mcpService, "executeTool", async (name: string) => {
      if (name === "find_places_along_route") {
        return {
          isError: false,
          data: {
            places: [{ id: "cafe_1", name: "Corner Cafe", category: "cafe", lat: 18.53, lon: 73.85, distanceToRouteMeters: 45 }]
          }
        };
      }
      return {
        isError: false,
        data: {
          feasible: true,
          recommended: {
            valid: true,
            route: {
              distanceKm: 13.2,
              durationMinutes: 47, // 32 drive + 15 stop
              drivingDurationMinutes: 32,
              stopDurationMinutes: 15,
              geometry: { type: "LineString", coordinates: routeWithStopCoords }
            },
            constraintEvaluations: [{ type: "arrival_deadline", severity: "hard", status: "satisfied" }]
          }
        }
      };
    });

    const sessionStore = new SessionStore();
    const clock = new Clock();
    const agent = new GroqAgent(mcpService, sessionStore, clock);

    let round = 0;
    mock.method((agent as any).groqClient.chat.completions, "create", async () => {
      round++;
      if (round === 1) {
        return {
          choices: [
            {
              message: {
                role: "assistant",
                tool_calls: [{ id: "c1", function: { name: "find_places_along_route", arguments: '{"category":"cafe"}' } }]
              },
              finish_reason: "tool_calls"
            }
          ]
        };
      } else if (round === 2) {
        return {
          choices: [
            {
              message: {
                role: "assistant",
                tool_calls: [{
                  id: "c2",
                  function: {
                    name: "compare_routes",
                    arguments: JSON.stringify({
                      locations: [{ lat: 18.5, lon: 73.8 }, { lat: 18.53, lon: 73.85, name: "Corner Cafe" }, { lat: 18.6, lon: 73.9 }],
                      stops: [{ locationIndex: 1, placeId: "cafe_1", name: "Corner Cafe", lat: 18.53, lon: 73.85, durationMinutes: 15 }],
                      constraints: [{ type: "arrival_deadline", severity: "hard", value: "2026-10-12T07:00:00Z" }]
                    })
                  }
                }]
              },
              finish_reason: "tool_calls"
            }
          ]
        };
      } else {
        return {
          choices: [
            {
              message: { role: "assistant", content: "Added Corner Cafe with a 15-minute stop. Total time: 47 mins." },
              finish_reason: "stop"
            }
          ]
        };
      }
    });

    const response = await agent.converse("stop-success-session", "Add a 15 min coffee stop");

    assert.ok(response.travelPlan);
    assert.strictEqual(response.travelPlan.stops?.length, 1);
    assert.strictEqual(response.travelPlan.stops?.[0].name, "Corner Cafe");
    assert.strictEqual(response.travelPlan.stopDurationMinutes, 15);
    assert.strictEqual(response.travelPlan.durationMinutes, 47);
    assert.strictEqual(response.travelPlan.routeGeometry?.coordinates.length, 271);
    assert.strictEqual(response.message, "Added Corner Cafe with a 15-minute stop. Total time: 47 mins.");
  });
});

describe("Agent Factory (createAgent)", () => {
  afterEach(() => {
    mock.restoreAll();
  });

  test("should instantiate GroqAgent when LLM_PROVIDER=groq", async () => {
    process.env.LLM_PROVIDER = "groq";
    process.env.GROQ_API_KEY = "test-groq-key";
    
    const { createAgent } = await import("../../src/agent/factory.js");
    const agent = createAgent(new MCPClientService(), new SessionStore(), new Clock());
    
    assert.strictEqual(agent instanceof GroqAgent, true);
  });

  test("should instantiate BedrockAgent when LLM_PROVIDER=bedrock", async () => {
    process.env.LLM_PROVIDER = "bedrock";
    process.env.BEDROCK_MODEL_ID = "mock-bedrock-model";

    const { createAgent } = await import("../../src/agent/factory.js");
    const { BedrockAgent } = await import("../../src/agent/client.js");
    const agent = createAgent(new MCPClientService(), new SessionStore(), new Clock());

    assert.strictEqual(agent instanceof BedrockAgent, true);
  });

  test("should throw descriptive error for unsupported provider", async () => {
    process.env.LLM_PROVIDER = "unknown-provider";

    const { createAgent } = await import("../../src/agent/factory.js");
    assert.throws(
      () => createAgent(new MCPClientService(), new SessionStore(), new Clock()),
      /Unsupported LLM_PROVIDER: "unknown-provider"/
    );
  });
});

