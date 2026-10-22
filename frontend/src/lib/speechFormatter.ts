import type { TravelPlan } from "../types/api.js";

/**
 * Natural Spoken Response Formatter for RoutePilot.
 *
 * Transforms raw markdown LLM assistant text and canonical TravelPlan metadata
 * into a calm, concise, human-like spoken navigation instruction.
 *
 * Guarantees:
 * 1. Leaves chat message text completely untouched (used only for TTS).
 * 2. Uses canonical TravelPlan facts (departure, ETA, stops, dwell, constraints).
 * 3. Never invents stops, ETAs, or feasibility that the plan does not support.
 * 4. Strips markdown syntax, technical jargon, URLs, and robotic preambles.
 * 5. Expands abbreviations and formats ISO timestamps into natural spoken time.
 */

/** Formats an ISO string or time string into clean spoken time, e.g. "6:18 AM" or "7:00 AM". */
export function formatSpokenTime(isoOrTime: string | null | undefined): string | null {
  if (!isoOrTime) return null;
  const trimmed = isoOrTime.trim();

  // Handle ISO date-time string: e.g. "2026-10-23T06:18:00.000Z"
  if (trimmed.includes("T")) {
    const date = new Date(trimmed);
    if (!Number.isNaN(date.getTime())) {
      let hours = date.getHours();
      const minutes = date.getMinutes();
      const ampm = hours >= 12 ? "PM" : "AM";
      hours = hours % 12;
      hours = hours ? hours : 12; // 0 should be 12
      const minuteStr = minutes < 10 ? `0${minutes}` : `${minutes}`;
      return `${hours}:${minuteStr} ${ampm}`;
    }
  }

  // Handle 24-hour time "HH:MM" or "HH:MM:SS"
  const match24 = trimmed.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (match24) {
    let hours = parseInt(match24[1], 10);
    const minutes = match24[2];
    const ampm = hours >= 12 ? "PM" : "AM";
    hours = hours % 12;
    hours = hours ? hours : 12;
    return `${hours}:${minutes} ${ampm}`;
  }

  // Handle standard "H:MM AM/PM" or "HH:MM AM/PM"
  const match12 = trimmed.match(/^(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)$/i);
  if (match12) {
    const hours = parseInt(match12[1], 10);
    const minutes = match12[2];
    const ampm = match12[3].toUpperCase();
    return `${hours}:${minutes} ${ampm}`;
  }

  return trimmed;
}

/** Converts duration in minutes to natural spoken wording, e.g. "42 minutes" or "1 hour and 15 minutes". */
export function formatSpokenDuration(minutes: number | null | undefined): string | null {
  if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes <= 0) return null;
  const mins = Math.round(minutes);
  if (mins < 60) {
    return `${mins} minute${mins === 1 ? "" : "s"}`;
  }
  const hours = Math.floor(mins / 60);
  const remainingMins = mins % 60;
  if (remainingMins === 0) {
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  return `${hours} hour${hours === 1 ? "" : "s"} and ${remainingMins} minute${remainingMins === 1 ? "" : "s"}`;
}

/** Strips markdown syntax, URLs, symbols, and formatting artifacts. */
export function cleanMarkdownForSpeech(text: string): string {
  if (!text) return "";

  return text
    // Replace markdown links [label](url) with just label
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    // Remove raw URLs
    .replace(/https?:\/\/\S+/g, "")
    // Remove headers (# Header)
    .replace(/^#{1,6}\s+/gm, "")
    // Replace arrows with natural words
    .replace(/->|→/g, " to ")
    // Remove bold, italics, backticks, strikethroughs
    .replace(/[*_`~]/g, "")
    // Remove blockquote markers
    .replace(/^\s*>\s*/gm, "")
    // Remove emojis and special decorative unicode symbols
    .replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, "")
    // Remove bullets and numbered list markers at line starts: e.g. "1. ", "* ", "- "
    .replace(/^\s*(?:[-*•]|\d+\.)\s+/gm, "")
    // Clean up parenthesis enclosing technical jargon
    .replace(/\s*\((?:GeoJSON|Valhalla|Nominatim|Overpass|OSM)[^)]*\)/gi, "")
    // Normalize whitespace
    .replace(/\s+/g, " ")
    .trim();
}

/** Expands navigation abbreviations into natural spoken English. */
export function expandAbbreviations(text: string): string {
  if (!text) return "";

  return text
    .replace(/\bkm\b/gi, "kilometers")
    .replace(/\b(?:min|mins)\b/gi, "minutes")
    .replace(/\b(?:hr|hrs)\b/gi, "hours")
    .replace(/\bapprox\.?\b/gi, "approximately")
    .replace(/\be\.g\.?,?\s*/gi, "for example, ")
    .replace(/\bi\.e\.?,?\s*/gi, "that is, ")
    .replace(/\betc\.?\b/gi, "etcetera")
    .replace(/\brte\.?\b/gi, "route")
    .replace(/\brd\.?\b/gi, "road")
    .replace(/\bstn\.?\b/gi, "station")
    .replace(/\bapt\.?\b/gi, "airport")
    .replace(/\bdept\.?\b/gi, "departure")
    .replace(/\barr\.?\b/gi, "arrival")
    .replace(/\bw\/\s*/gi, "with ")
    .replace(/\bw\/o\s*/gi, "without ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Cleans robotic preambles, canned intros, and bureaucratic framing. */
export function stripConversationalFillers(text: string): string {
  if (!text) return "";

  let cleaned = text;

  // Remove common robotic conversational openers
  const roboticOpeners = [
    /^(?:certainly|sure|absolutely|of course)[,!.\s]+/i,
    /^(?:here is|here's) (?:your|the) (?:route|itinerary|travel plan|plan)[^:.!]*[:.!]\s*/i,
    /^(?:i have|i've) (?:calculated|computed|found|retrieved|created) (?:the|your) (?:route|plan)[^:.!]*[:.!]\s*/i,
    /^(?:based on your (?:request|preferences|constraints)[,.]?\s*)/i,
    /^(?:according to your (?:request|preferences|constraints)[,.]?\s*)/i,
  ];

  for (const pattern of roboticOpeners) {
    cleaned = cleaned.replace(pattern, "");
  }

  // Remove robotic bullet-like prefixes inside sentences
  cleaned = cleaned
    .replace(/\b(?:departure time|departing at|departure)\s*:\s*/gi, "departing at ")
    .replace(/\b(?:estimated arrival|estimated time of arrival|eta|arrival)\s*:\s*/gi, "arriving at ")
    .replace(/\b(?:total duration|duration|travel time)\s*:\s*/gi, "taking ")
    .replace(/\b(?:total distance|distance)\s*:\s*/gi, "over ")
    .replace(/\b(?:constraints?|preferences?)\s*:\s*/gi, "")
    .replace(/\b(?:notes?|warning)\s*:\s*/gi, "Note, ");

  return cleaned.trim();
}

/** Extracts a clean human name from a string or Location object. */
export function locationName(loc: unknown): string {
  if (!loc) return "";
  if (typeof loc === "string") return loc.trim();
  if (typeof loc === "object" && loc !== null && "name" in loc) {
    const name = (loc as { name?: unknown }).name;
    if (typeof name === "string") return name.trim();
  }
  return "";
}

/**
 * Main Spoken Response Formatter.
 *
 * Produces a clear, calm, natural speech transcript tailored for Kokoro TTS.
 */
export function formatSpokenResponse(rawText: string, plan?: TravelPlan | null): string {
  // 1. If plan exists and is explicitly marked stale:
  if (plan?.stale) {
    const destName = locationName(plan.destination);
    const destination = destName ? ` to ${destName}` : "";
    return `Unable to update the route. Your previous route${destination} remains active on the map.`;
  }

  // 2. If plan exists and is explicitly marked infeasible:
  if (plan && plan.feasible === false) {
    const destName = locationName(plan.destination);
    const destination = destName ? ` to ${destName}` : "";
    return `This route${destination} is infeasible for your deadline. Please leave earlier or adjust your stops.`;
  }

  // 3. Clean and normalize the raw message text:
  let cleaned = cleanMarkdownForSpeech(rawText);

  // Convert raw ISO timestamps found inside the text to spoken time:
  cleaned = cleaned.replace(
    /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?\b/g,
    (iso) => formatSpokenTime(iso) ?? iso
  );

  cleaned = expandAbbreviations(cleaned);
  cleaned = stripConversationalFillers(cleaned);

  // 4. If we have a rich canonical plan with route facts, construct a cohesive copilot sentence
  // if the cleaned prose is overly technical, fragmented, or redundant:
  const isFragmentedOrTechnical =
    /\b(?:origin|destination|distance|duration|meters|kilometers|satisfied|lat|lng|coordinates)\b/i.test(
      cleaned
    ) ||
    cleaned.split(".").length > 4 ||
    cleaned.length > 280;

  const destName = locationName(plan?.destination);
  if (plan && destName && plan.departureTime && isFragmentedOrTechnical) {
    const departure = formatSpokenTime(plan.departureTime);
    const eta = formatSpokenTime(plan.actualEta || plan.arrivalDeadline);
    const duration = formatSpokenDuration(plan.durationMinutes);

    const parts: string[] = [];
    parts.push(`I've set your route to ${destName}.`);

    if (departure && eta) {
      parts.push(`Depart at ${departure} to arrive by ${eta}`);
    } else if (departure) {
      parts.push(`Depart at ${departure}`);
    } else if (eta) {
      parts.push(`Arrive by ${eta}`);
    }

    if (duration) {
      parts[parts.length - 1] += `, taking about ${duration}.`;
    } else {
      parts[parts.length - 1] += `.`;
    }

    // Add intermediate stops if any:
    if (plan.stops && plan.stops.length > 0) {
      const stopDescriptions = plan.stops.map((s) => {
        const dwell = s.durationMinutes ? `a ${s.durationMinutes}-minute stop at ` : "";
        return `${dwell}${s.name}`;
      });
      if (stopDescriptions.length === 1) {
        parts.push(`This includes ${stopDescriptions[0]}.`);
      } else {
        parts.push(`This includes stops at ${stopDescriptions.join(" and ")}.`);
      }
    }

    // Add active constraints if relevant:
    const constraints: string[] = [];
    for (const c of plan.constraints || []) {
      if (c.type === "avoid_tolls") constraints.push("avoiding tolls");
      if (c.type === "avoid_highways") constraints.push("avoiding highways");
    }
    if (constraints.length > 0) {
      parts.push(`The route is set ${constraints.join(" and ")}.`);
    }

    return parts.join(" ");
  }

  // 5. If the cleaned text is already a natural conversational sentence, ensure smooth punctuation:
  if (!cleaned) {
    if (plan?.destination) {
      return `Route to ${plan.destination} is ready on the map.`;
    }
    return "Your route is updated.";
  }

  // Ensure sentence ends with a period for proper Kokoro pitch contour
  if (!/[.!?]$/.test(cleaned)) {
    cleaned += ".";
  }

  return cleaned;
}
