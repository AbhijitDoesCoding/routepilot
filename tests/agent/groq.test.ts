import { test, describe, mock, afterEach, beforeEach } from "node:test";
import * as assert from "node:assert";
import { GroqAgent } from "../../src/agent/groq.js";
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

  test("7. API error handling propagates cleanly", async () => {
    const mcpService = new MCPClientService();
    mock.method(mcpService, "getGroqTools", async () => []);

    const sessionStore = new SessionStore();
    const clock = new Clock();
    const agent = new GroqAgent(mcpService, sessionStore, clock);

    mock.method((agent as any).groqClient.chat.completions, "create", async () => {
      throw new Error("Groq 429 Rate Limit Exceeded");
    });

    await assert.rejects(
      async () => {
        await agent.converse("err-session", "Hello");
      },
      /Groq 429 Rate Limit Exceeded/
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

    assert.strictEqual(roundCount, 5); // Exactly 5 rounds max
    assert.ok(response.message.includes("too many tool calls"));
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

