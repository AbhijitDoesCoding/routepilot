import { test, describe, mock, afterEach, beforeEach } from "node:test";
import * as assert from "node:assert";
import { GroqAgent } from "../../src/agent/groq.js";
import { MCPClientService } from "../../src/mcp/client/index.js";
import { SessionStore } from "../../src/agent/session.js";
import { Clock } from "../../src/agent/clock.js";

const ORIGIN = { lat: 18.528, lon: 73.874, name: "Pune Railway Station" };
const CAFE = { lat: 18.55, lon: 73.89, name: "Corner Cafe" };
const AIRPORT = { lat: 18.579, lon: 73.908, name: "Pune Airport" };
const DEADLINE = "2026-10-23T07:00:00.000Z";
const GEOMETRY = {
  type: "LineString",
  coordinates: [[73.874, 18.528], [73.89, 18.55], [73.908, 18.579]]
};

const toolCall = (id: string, name: string, args: any) => ({
  choices: [{
    message: {
      role: "assistant",
      content: null,
      tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }]
    },
    finish_reason: "tool_calls"
  }]
});

const textResponse = (content: string) => ({
  choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }]
});

const compareResult = (durationMinutes: number, stopMinutes: number, constraints: any[]) => ({
  feasible: true,
  recommended: {
    valid: true,
    route: {
      distanceKm: 21.4,
      durationMinutes,
      drivingDurationMinutes: durationMinutes - stopMinutes,
      stopDurationMinutes: stopMinutes,
      hasToll: false,
      hasHighway: false,
      geometry: GEOMETRY
    },
    constraintEvaluations: constraints.map(c => ({ type: c.type, severity: c.severity, status: "satisfied" }))
  },
  alternatives: []
});

describe("Scripted three-turn continuity regression", () => {
  beforeEach(() => {
    process.env.GROQ_API_KEY = "mock-groq-key";
    process.env.GROQ_MODEL_ID = "openai/gpt-oss-120b";
  });

  afterEach(() => {
    mock.restoreAll();
  });

  test("turn 3 incomplete compare_routes cannot drop deadline, avoid_tolls, or the cafe stop", async () => {
    const mcpService = new MCPClientService();
    mock.method(mcpService, "getGroqTools", async () => [
      { type: "function", function: { name: "find_places_along_route", parameters: {} } },
      { type: "function", function: { name: "compare_routes", parameters: {} } }
    ]);

    const compareCalls: any[] = [];
    const findCalls: any[] = [];

    mock.method(mcpService, "executeTool", async (name: string, args: any) => {
      if (name === "find_places_along_route") {
        findCalls.push(args);
        return {
          isError: false,
          data: {
            places: [{ id: "cafe_1", name: CAFE.name, category: "cafe", lat: CAFE.lat, lon: CAFE.lon, distanceToRouteMeters: 45 }]
          }
        };
      }

      compareCalls.push(args);
      const callNumber = compareCalls.length;
      const stopMinutes = Array.isArray(args.stops) && args.stops.length > 0 ? 15 : 0;
      const duration = callNumber === 1 ? 52 : callNumber === 2 ? 67 : 75;
      return { isError: false, data: compareResult(duration, stopMinutes, args.constraints ?? []) };
    });

    const sessionStore = new SessionStore();
    const clock = new Clock();
    mock.method(clock, "now", () => new Date("2026-10-22T02:18:00+05:30"));
    const agent = new GroqAgent(mcpService, sessionStore, clock);

    let createCall = 0;
    mock.method((agent as any).groqClient.chat.completions, "create", async () => {
      createCall++;
      switch (createCall) {
        case 1:
          return toolCall("t1-route", "compare_routes", {
            locations: [ORIGIN, AIRPORT],
            mode: "auto",
            constraints: [
              { type: "avoid_tolls", severity: "hard" },
              { type: "arrival_deadline", severity: "hard", value: DEADLINE }
            ]
          });
        case 2:
          return textResponse("I planned the toll-free route to Pune Airport for your 7 AM deadline.");
        case 3:
          // Deliberately omit avoid_tolls and the deadline: the backend must inherit them.
          return toolCall("t2-find", "find_places_along_route", {
            locations: [ORIGIN, AIRPORT],
            mode: "auto",
            category: "cafe"
          });
        case 4:
          // Deliberately omit constraints: the backend must inherit the deadline and avoid_tolls.
          return toolCall("t2-route", "compare_routes", {
            locations: [ORIGIN, CAFE, AIRPORT],
            mode: "auto",
            stops: [{ locationIndex: 1, placeId: "cafe_1", name: CAFE.name, lat: CAFE.lat, lon: CAFE.lon, durationMinutes: 15 }]
          });
        case 5:
          return textResponse("I added Corner Cafe with a 15-minute stop; your 7 AM deadline is still met.");
        case 6:
          // Deliberately omit deadline, stops, and the stop waypoint; only add highways.
          return toolCall("t3-route", "compare_routes", {
            locations: [ORIGIN, AIRPORT],
            mode: "auto",
            constraints: [{ type: "avoid_highways", severity: "hard" }]
          });
        case 7:
          return textResponse("Highway avoidance added. Your 15-minute Corner Cafe stop and 7 AM arrival deadline are preserved.");
        default:
          throw new Error("Unexpected Groq call");
      }
    });

    const sessionId = "three-turn-continuity-session";
    const turn1 = await agent.converse(sessionId, "Reach Pune Airport by 7 AM tomorrow and avoid tolls.");
    assert.strictEqual(turn1.travelPlan?.arrivalDeadline, DEADLINE);
    assert.deepStrictEqual(new Set(turn1.travelPlan?.constraints?.map(c => c.type)), new Set(["avoid_tolls", "arrival_deadline"]));
    assert.strictEqual(turn1.travelPlan?.durationMinutes, 52);

    const turn2 = await agent.converse(sessionId, "Also find a coffee shop on the way, with a 15-minute stop.");
    assert.strictEqual(findCalls.length, 1);
    assert.strictEqual(findCalls[0].avoid_tolls, true, "active avoid_tolls must constrain the POI corridor");
    assert.strictEqual(turn2.travelPlan?.stops?.length, 1);
    assert.strictEqual(turn2.travelPlan?.stops?.[0].name, "Corner Cafe");
    assert.strictEqual(turn2.travelPlan?.stopDurationMinutes, 15);
    assert.strictEqual(turn2.travelPlan?.durationMinutes, 67);
    assert.strictEqual(turn2.travelPlan?.departureTime, "2026-10-23T05:53:00.000Z");

    const turn3 = await agent.converse(sessionId, "Avoid highways too.");

    // The executed third route request must contain the carried stop waypoint and all constraints.
    assert.strictEqual(compareCalls.length, 3);
    const third = compareCalls[2];
    assert.strictEqual(third.locations.length, 3);
    assert.strictEqual(third.locations[1].name, "Corner Cafe");
    assert.strictEqual(third.stops.length, 1);
    assert.strictEqual(third.stops[0].durationMinutes, 15);
    assert.deepStrictEqual(
      new Set(third.constraints.map((c: any) => c.type)),
      new Set(["avoid_tolls", "arrival_deadline", "avoid_highways"])
    );

    const finalPlan = turn3.travelPlan!;
    assert.strictEqual(finalPlan.arrivalDeadline, DEADLINE);
    assert.strictEqual(finalPlan.departureTime, "2026-10-23T05:45:00.000Z"); // 75 minutes before 07:00
    assert.strictEqual(finalPlan.actualEta, DEADLINE);
    assert.strictEqual(finalPlan.durationMinutes, 75);
    assert.strictEqual(finalPlan.drivingDurationMinutes, 60);
    assert.strictEqual(finalPlan.stopDurationMinutes, 15);
    assert.strictEqual(finalPlan.stops?.length, 1);
    assert.strictEqual(finalPlan.stops?.[0].durationMinutes, 15);
    assert.deepStrictEqual(
      new Set(finalPlan.constraints?.map(c => c.type)),
      new Set(["avoid_tolls", "arrival_deadline", "avoid_highways"])
    );
    assert.strictEqual(finalPlan.constraintEvaluations?.length, 3);
    assert.strictEqual(finalPlan.stale, undefined);
    assert.ok(turn3.message.includes("15-minute"));
    assert.ok(turn3.message.includes("7 AM"));
  });

  test("failed reroute marks the previous route stale, and a later success clears it", async () => {
    const mcpService = new MCPClientService();
    mock.method(mcpService, "getGroqTools", async () => [
      { type: "function", function: { name: "compare_routes", parameters: {} } }
    ]);

    let compareCount = 0;
    mock.method(mcpService, "executeTool", async (_name: string, args: any) => {
      compareCount++;
      if (compareCount === 2) {
        return {
          isError: true,
          data: {
            feasible: false,
            error: "Routing provider unavailable",
            category: "provider_error",
            retryable: false
          }
        };
      }
      return { isError: false, data: compareResult(52, 0, args.constraints ?? []) };
    });

    const sessionStore = new SessionStore();
    const clock = new Clock();
    mock.method(clock, "now", () => new Date("2026-10-22T02:18:00+05:30"));
    const agent = new GroqAgent(mcpService, sessionStore, clock);

    let createCall = 0;
    mock.method((agent as any).groqClient.chat.completions, "create", async () => {
      createCall++;
      switch (createCall) {
        case 1:
          return toolCall("f1-route", "compare_routes", {
            locations: [ORIGIN, AIRPORT],
            mode: "auto",
            constraints: [{ type: "arrival_deadline", severity: "hard", value: DEADLINE }]
          });
        case 2:
          return textResponse("Route planned.");
        case 3:
          return toolCall("f2-route", "compare_routes", { locations: [ORIGIN, AIRPORT], mode: "auto" });
        case 4:
          return textResponse("I could not recalculate the route. The previous route is shown as stale.");
        case 5:
          return toolCall("f3-route", "compare_routes", { locations: [ORIGIN, AIRPORT], mode: "auto" });
        case 6:
          return textResponse("Route recalculated successfully.");
        default:
          throw new Error("Unexpected Groq call");
      }
    });

    const sessionId = "failed-reroute-session";
    await agent.converse(sessionId, "Reach Pune Airport by 7 AM tomorrow.");
    const failed = await agent.converse(sessionId, "Try that again.");
    assert.strictEqual(failed.travelPlan?.stale, true);
    assert.strictEqual(failed.travelPlan?.distanceKm, 21.4, "last successful metrics remain visible");
    assert.ok(failed.travelPlan?.warnings?.some(w => w.includes("stale")));

    const recovered = await agent.converse(sessionId, "Try once more.");
    assert.strictEqual(recovered.travelPlan?.stale, undefined);
    assert.strictEqual(recovered.travelPlan?.distanceKm, 21.4);
    assert.strictEqual(recovered.travelPlan?.warnings, undefined);
  });
});
