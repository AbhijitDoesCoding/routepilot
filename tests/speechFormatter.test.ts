import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  cleanMarkdownForSpeech,
  expandAbbreviations,
  formatSpokenDuration,
  formatSpokenResponse,
  formatSpokenTime,
  stripConversationalFillers,
} from "../frontend/src/lib/speechFormatter.js";
import type { TravelPlan } from "../frontend/src/types/api.js";

describe("speechFormatter: Spoken Response Formatting", () => {
  describe("formatSpokenTime", () => {
    it("formats ISO timestamps to spoken 12-hour AM/PM format", () => {
      const iso = "2026-10-23T06:18:00.000Z";
      const result = formatSpokenTime(iso);
      assert.ok(result);
      assert.match(result, /\d{1,2}:\d{2}\s*(?:AM|PM)/);
    });

    it("formats 24-hour time strings correctly", () => {
      assert.equal(formatSpokenTime("06:00"), "6:00 AM");
      assert.equal(formatSpokenTime("18:30"), "6:30 PM");
      assert.equal(formatSpokenTime("00:15"), "12:15 AM");
      assert.equal(formatSpokenTime("12:00"), "12:00 PM");
    });

    it("preserves standard 12-hour times", () => {
      assert.equal(formatSpokenTime("7:00 AM"), "7:00 AM");
      assert.equal(formatSpokenTime("6:18 pm"), "6:18 PM");
    });

    it("handles null or undefined gracefully", () => {
      assert.equal(formatSpokenTime(null), null);
      assert.equal(formatSpokenTime(undefined), null);
      assert.equal(formatSpokenTime(""), null);
    });
  });

  describe("formatSpokenDuration", () => {
    it("formats minutes under an hour", () => {
      assert.equal(formatSpokenDuration(15), "15 minutes");
      assert.equal(formatSpokenDuration(1), "1 minute");
    });

    it("formats exact hours", () => {
      assert.equal(formatSpokenDuration(60), "1 hour");
      assert.equal(formatSpokenDuration(120), "2 hours");
    });

    it("formats mixed hours and minutes", () => {
      assert.equal(formatSpokenDuration(75), "1 hour and 15 minutes");
      assert.equal(formatSpokenDuration(121), "2 hours and 1 minute");
    });
  });

  describe("cleanMarkdownForSpeech", () => {
    it("strips markdown links and preserves label", () => {
      const input = "Here is the route to [Pune Airport](https://example.com/map).";
      assert.equal(cleanMarkdownForSpeech(input), "Here is the route to Pune Airport.");
    });

    it("strips headers, bold, italics, backticks, and emojis", () => {
      const input = "### Route Ready! 🚗\n**Departure**: `6:18 AM` *avoiding tolls*";
      const cleaned = cleanMarkdownForSpeech(input);
      assert.ok(!cleaned.includes("#"));
      assert.ok(!cleaned.includes("**"));
      assert.ok(!cleaned.includes("`"));
      assert.ok(!cleaned.includes("🚗"));
    });

    it("strips bullet points and numbered list markers", () => {
      const input = "Stops:\n1. Cafe Peter\n2. Fuel Station\n- End of list";
      const cleaned = cleanMarkdownForSpeech(input);
      assert.ok(!cleaned.includes("1."));
      assert.ok(!cleaned.includes("2."));
      assert.ok(!cleaned.includes("-"));
    });
  });

  describe("expandAbbreviations", () => {
    it("expands navigation and metric abbreviations", () => {
      const input = "Drive 16.2 km for approx. 42 mins on airport rd. to stn.";
      const expanded = expandAbbreviations(input);
      assert.ok(expanded.includes("kilometers"));
      assert.ok(expanded.includes("approximately"));
      assert.ok(expanded.includes("minutes"));
      assert.ok(expanded.includes("road"));
      assert.ok(expanded.includes("station"));
    });
  });

  describe("stripConversationalFillers", () => {
    it("removes robotic assistant preambles", () => {
      const input = "Certainly, here is the route: Departure: 6:00 AM, ETA: 7:00 AM.";
      const stripped = stripConversationalFillers(input);
      assert.ok(!stripped.toLowerCase().startsWith("certainly"));
      assert.ok(!stripped.toLowerCase().startsWith("here is"));
    });
  });

  describe("formatSpokenResponse", () => {
    it("formats stale plans with explicit truthful warning", () => {
      const plan: TravelPlan = {
        id: "plan-stale",
        origin: { name: "Station", lat: 18.5, lon: 73.8 },
        destination: { name: "Airport", lat: 18.6, lon: 73.9 },
        stale: true,
        staleReason: "Provider unavailable",
      };
      const spoken = formatSpokenResponse("Update failed", plan);
      assert.match(spoken, /Unable to update the route/i);
      assert.match(spoken, /Airport/i);
      assert.match(spoken, /remains active/i);
    });

    it("formats infeasible plans with actionable advice", () => {
      const plan: TravelPlan = {
        id: "plan-infeasible",
        origin: { name: "Station", lat: 18.5, lon: 73.8 },
        destination: { name: "Airport", lat: 18.6, lon: 73.9 },
        feasible: false,
      };
      const spoken = formatSpokenResponse("Cannot reach by 7", plan);
      assert.match(spoken, /infeasible/i);
      assert.match(spoken, /deadline/i);
    });

    it("synthesizes concise copilot phrasing from canonical plan facts", () => {
      const plan: TravelPlan = {
        id: "plan-canonical",
        origin: { name: "Pune Station", lat: 18.53, lon: 73.87 },
        destination: { name: "Pune Airport", lat: 18.58, lon: 73.92 },
        departureTime: "2026-10-23T06:18:00.000Z",
        actualEta: "2026-10-23T07:00:00.000Z",
        durationMinutes: 42,
        stops: [{ name: "Cafe Peter", lat: 18.55, lon: 73.89, durationMinutes: 15 }],
        constraints: [{ type: "avoid_tolls", severity: "hard" }],
      };

      const rawLlmText =
        "Here is your route:\n- Origin: Pune Station\n- Destination: Pune Airport\n- Departure: 2026-10-23T06:18:00.000Z\n- ETA: 2026-10-23T07:00:00.000Z\n- Distance: 16.2 km\n- Duration: 42 minutes\n- Stop: 1. Cafe Peter (15 mins)\n- Avoid tolls: satisfied.";

      const spoken = formatSpokenResponse(rawLlmText, plan);
      assert.ok(spoken.includes("Pune Airport"));
      assert.ok(spoken.includes("Cafe Peter"));
      assert.ok(spoken.includes("15-minute stop"));
      assert.ok(spoken.includes("avoiding tolls"));
      assert.ok(!spoken.includes("Origin:"));
      assert.ok(!spoken.includes("2026-10-23T"));
      assert.ok(!spoken.includes("16.2 km"));
    });

    it("handles empty or concise messages gracefully", () => {
      assert.equal(formatSpokenResponse(""), "Your route is updated.");
      assert.equal(
        formatSpokenResponse("I've added the coffee stop."),
        "I've added the coffee stop."
      );
    });
  });
});
