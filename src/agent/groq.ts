import Groq from "groq-sdk";
import { MCPClientService } from "../mcp/client/index.js";
import { getSystemPrompt } from "./prompts/routepilot.js";
import { Clock } from "./clock.js";
import { SessionStore } from "./session.js";
import { AgentResponse, RoutePilotAgent, TravelPlan } from "./types.js";
import { updateTravelPlanFromCompareRoutes } from "./planner.js";
import pino from "pino";

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: {
    target: "pino-pretty"
  }
});

/**
 * Deterministically creates a compact, text summary of the current TravelPlan.
 * Excludes bulky route geometry coordinates to respect token budgets.
 */
export function formatTravelPlanSummary(plan: TravelPlan): string | null {
  if (!plan) return null;
  const parts: string[] = [];

  if (plan.origin?.name || (typeof plan.origin?.lat === "number" && typeof plan.origin?.lon === "number")) {
    const origStr = plan.origin.name || `${plan.origin.lat}, ${plan.origin.lon}`;
    parts.push(`Origin: ${origStr}`);
  }
  if (plan.destination?.name || (typeof plan.destination?.lat === "number" && typeof plan.destination?.lon === "number")) {
    const destStr = plan.destination.name || `${plan.destination.lat}, ${plan.destination.lon}`;
    parts.push(`Destination: ${destStr}`);
  }
  if (plan.arrivalDeadline) {
    parts.push(`Arrival Deadline: ${plan.arrivalDeadline}`);
  }
  if (plan.departureTime) {
    parts.push(`Calculated Latest Departure: ${plan.departureTime}`);
  }
  if (plan.actualEta) {
    parts.push(`Calculated ETA: ${plan.actualEta}`);
  }
  if (typeof plan.durationMinutes === "number") {
    const driving = Math.round(plan.drivingDurationMinutes ?? plan.durationMinutes);
    const stops = plan.stopDurationMinutes ? `, stops: ${Math.round(plan.stopDurationMinutes)} mins` : "";
    parts.push(`Total Duration: ${Math.round(plan.durationMinutes)} mins (driving: ${driving} mins${stops})`);
  }
  if (typeof plan.distanceKm === "number") {
    parts.push(`Distance: ${plan.distanceKm.toFixed(1)} km`);
  }
  if (plan.stops && plan.stops.length > 0) {
    const stopStrs = plan.stops.map(s => `${s.name} (${s.durationMinutes} min stop)`);
    parts.push(`Selected Stops: ${stopStrs.join(", ")}`);
  }
  if (plan.constraints && plan.constraints.length > 0) {
    const cStrs = plan.constraints.map(c => `${c.type} (${c.severity})`);
    parts.push(`Active Constraints: ${cStrs.join(", ")}`);
  }
  if (plan.warnings && plan.warnings.length > 0) {
    parts.push(`Route Status: Infeasible - ${plan.warnings.join("; ")}`);
  } else if (plan.distanceKm !== undefined) {
    parts.push(`Route Status: Feasible`);
  }

  if (parts.length === 0) return null;
  return `ACTIVE TRAVEL PLAN CONTEXT:\n${parts.map(p => `- ${p}`).join("\n")}\nUse this context for follow-up modifications (e.g. adding/removing stops, changing constraints).`;
}

/**
 * Creates a model-facing compact representation of tool results.
 * Strips bulky geometry coordinates, encoded polylines, legs, and maneuvers
 * while retaining feasibility, metrics, constraint evaluations, and candidate IDs.
 */
export function compactToolResult(toolName: string, data: any): any {
  if (!data || typeof data !== "object") {
    return data;
  }

  if (toolName === "compare_routes") {
    const compact: any = {
      feasible: data.feasible,
      reason: data.reason
    };

    if (data.recommended) {
      const rec = data.recommended;
      compact.recommended = {
        valid: rec.valid,
        score: rec.score,
        route: rec.route ? {
          candidateId: rec.route.candidateId,
          distanceKm: rec.route.distanceKm,
          durationMinutes: rec.route.durationMinutes,
          drivingDurationMinutes: rec.route.drivingDurationMinutes,
          stopDurationMinutes: rec.route.stopDurationMinutes,
          hasToll: rec.route.hasToll,
          hasHighway: rec.route.hasHighway,
          costingProfile: rec.route.costingProfile
          // OMIT coordinates, legs, maneuvers
        } : undefined,
        constraintEvaluations: rec.constraintEvaluations,
        violatedConstraints: rec.violatedConstraints,
        satisfiedConstraints: rec.satisfiedConstraints,
        explanation: rec.explanation
      };
    }

    if (Array.isArray(data.alternatives)) {
      compact.alternatives = data.alternatives.map((alt: any) => ({
        valid: alt.valid,
        score: alt.score,
        route: alt.route ? {
          candidateId: alt.route.candidateId,
          distanceKm: alt.route.distanceKm,
          durationMinutes: alt.route.durationMinutes,
          hasToll: alt.route.hasToll,
          hasHighway: alt.route.hasHighway
        } : undefined,
        violatedConstraints: alt.violatedConstraints,
        explanation: alt.explanation
      }));
    }

    return compact;
  }

  if (toolName === "geocode") {
    if (Array.isArray(data)) {
      return data.slice(0, 3).map((item: any) => ({
        name: item.name || item.display_name,
        lat: item.lat,
        lon: item.lon
      }));
    }
    if (data && Array.isArray(data.results)) {
      return {
        results: data.results.slice(0, 3).map((item: any) => ({
          name: item.name || item.display_name,
          lat: item.lat,
          lon: item.lon
        }))
      };
    }
    return data;
  }

  if (toolName === "find_places_along_route") {
    if (data && Array.isArray(data.places)) {
      return {
        count: data.places.length,
        places: data.places.slice(0, 5).map((p: any) => ({
          id: p.id,
          name: p.name,
          category: p.category,
          lat: p.lat,
          lon: p.lon,
          distanceToRouteMeters: p.distanceToRouteMeters ?? p.distanceMeters
        }))
      };
    }
    return data;
  }

  return data;
}

/**
 * Generates an accurate, deterministic textual summary of the TravelPlan
 * when the model fails to provide a final text response.
 */
export function buildTravelPlanFallback(plan?: TravelPlan): string {
  if (!plan || plan.distanceKm === undefined) {
    return "I apologize, but I'm having trouble completing this request right now due to too many tool calls.";
  }
  const orig = plan.origin?.name || (plan.origin ? `${plan.origin.lat}, ${plan.origin.lon}` : "your origin");
  const dest = plan.destination?.name || (plan.destination ? `${plan.destination.lat}, ${plan.destination.lon}` : "your destination");
  const dist = plan.distanceKm.toFixed(1);
  const dur = Math.round(plan.durationMinutes ?? 0);
  let msg = `I have planned your route from ${orig} to ${dest}. The total distance is ${dist} km with an estimated travel time of ${dur} minutes.`;
  if (plan.departureTime) {
    msg += ` Recommended departure is by ${plan.departureTime}.`;
  }
  if (plan.stops && plan.stops.length > 0) {
    const stopStrs = plan.stops.map(s => `${s.name} (${s.durationMinutes} min stop)`);
    msg += ` Scheduled stops: ${stopStrs.join(", ")}.`;
  }
  if (plan.warnings && plan.warnings.length > 0) {
    msg += ` Note: ${plan.warnings.join("; ")}.`;
  }
  return msg;
}

export class GroqAgent implements RoutePilotAgent {
  private groqClient: Groq;
  private mcpService: MCPClientService;
  private sessionStore: SessionStore;
  private clock: Clock;
  private modelId: string;
  private maxCompletionTokens: number;

  constructor(
    mcpService: MCPClientService,
    sessionStore: SessionStore,
    clock: Clock
  ) {
    this.mcpService = mcpService;
    this.sessionStore = sessionStore;
    this.clock = clock;

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      throw new Error("GROQ_API_KEY environment variable is required.");
    }

    this.modelId = process.env.GROQ_MODEL_ID || "openai/gpt-oss-120b";
    this.maxCompletionTokens = parseInt(process.env.GROQ_MAX_COMPLETION_TOKENS || "1200", 10);
    this.groqClient = new Groq({ apiKey });
  }

  public async converse(sessionId: string, userMessage: string): Promise<AgentResponse> {
    const context = this.sessionStore.getSession(sessionId);

    // Filter persistent session history to ONLY pure conversational messages (no tool_calls or role: "tool")
    const conversationalHistory = (context.messages || []).filter(
      (m: any) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && !m.tool_calls
    );

    // Bound conversational history to the most recent 4 messages (2 prior turns)
    let boundedHistory = conversationalHistory.slice(-4);

    const defaultOrigin = process.env.DEFAULT_ORIGIN_QUERY;
    let systemPromptText = getSystemPrompt(this.clock.nowIso(), this.clock.getTimezone(), defaultOrigin);

    // Inject concise deterministic TravelPlan summary if one exists
    const planSummary = formatTravelPlanSummary(context.travelPlan);
    if (planSummary) {
      systemPromptText += `\n\n${planSummary}`;
    }

    // Initialize current-turn working messages
    const workingMessages: any[] = [
      { role: "system", content: systemPromptText },
      ...boundedHistory,
      { role: "user", content: userMessage }
    ];

    const tools = await this.mcpService.getGroqTools();

    const maxToolRounds = parseInt(process.env.MAX_TOOL_ROUNDS || "5", 10);
    let toolRounds = 0;
    let modelRounds = 0;
    const failedToolSignatures = new Set<string>();
    let finishReason: string | undefined;
    let finalMessageText = "";

    while (toolRounds < maxToolRounds) {
      modelRounds++;
      logger.info({ sessionId, toolRound: toolRounds, modelRound: modelRounds, modelId: this.modelId }, "Sending request to Groq");

      const startTime = Date.now();
      let response: any;
      try {
        response = await this.groqClient.chat.completions.create({
          model: this.modelId,
          messages: workingMessages as any,
          tools: tools.length > 0 ? (tools as any) : undefined,
          tool_choice: tools.length > 0 ? "auto" : undefined,
          max_completion_tokens: this.maxCompletionTokens
        }, { timeout: 60_000, maxRetries: 2 });
      } catch (err: any) {
        const statusCode = err.status || err.statusCode;
        const isRateOrTokenLimit = statusCode === 413 || statusCode === 429 ||
          (typeof err.message === "string" && (
            err.message.includes("413") ||
            err.message.includes("429") ||
            err.message.toLowerCase().includes("tokens per minute") ||
            err.message.toLowerCase().includes("request too large") ||
            err.message.toLowerCase().includes("rate limit")
          ));

        logger.error({
          sessionId,
          modelRound: modelRounds,
          modelId: this.modelId,
          statusCode,
          isRateOrTokenLimit,
          error: err.message
        }, "Groq API completion error");

        // If rate/token limit error and we have historical conversational messages that can be pruned:
        if (isRateOrTokenLimit && boundedHistory.length > 0) {
          logger.warn({ sessionId }, "Attempting safe context compaction and retry after token limit error");
          // Remove previous conversational history, keeping system prompt, current user message and current tool messages
          const systemMsg = workingMessages[0];
          const currentTurnMsgs = workingMessages.slice(1 + boundedHistory.length);
          const compactedWorking = [systemMsg, ...currentTurnMsgs];
          boundedHistory = [];

          try {
            response = await this.groqClient.chat.completions.create({
              model: this.modelId,
              messages: compactedWorking as any,
              tools: tools.length > 0 ? (tools as any) : undefined,
              tool_choice: tools.length > 0 ? "auto" : undefined,
              max_completion_tokens: this.maxCompletionTokens
            }, { timeout: 60_000, maxRetries: 0 });
            workingMessages.length = 0;
            workingMessages.push(...compactedWorking);
          } catch (retryErr: any) {
            logger.error({ sessionId, error: retryErr.message }, "Compacted retry also failed");
            return {
              message: "Route planning is temporarily experiencing high demand or token limits with Groq. Please try again in a few moments.",
              travelPlan: context.travelPlan
            };
          }
        } else if (isRateOrTokenLimit) {
          return {
            message: "Route planning is temporarily experiencing high demand or token limits with Groq. Please try again in a few moments.",
            travelPlan: context.travelPlan
          };
        } else {
          throw err;
        }
      }

      const latency = Date.now() - startTime;
      const choice = response.choices && response.choices[0];
      if (!choice || !choice.message) {
        throw new Error("Invalid response from Groq: No choice returned");
      }

      const assistantMsg = choice.message;
      finishReason = choice.finish_reason;
      logger.info({ sessionId, latencyMs: latency, finishReason }, "Received response from Groq");

      if (assistantMsg.content) {
        finalMessageText = assistantMsg.content;
      }

      // Add assistant response to working messages
      workingMessages.push({
        role: "assistant",
        content: assistantMsg.content || null,
        tool_calls: assistantMsg.tool_calls || undefined
      });

      if (assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0) {
        toolRounds++;
        for (const toolCall of assistantMsg.tool_calls) {
          const callId = toolCall.id;
          const fnName = toolCall.function?.name;
          const rawArgs = toolCall.function?.arguments;

          logger.info({ sessionId, toolName: fnName, toolCallId: callId }, "Executing MCP tool from Groq");

          let parsedArgs: Record<string, any>;
          try {
            parsedArgs = typeof rawArgs === "string" ? JSON.parse(rawArgs) : (rawArgs || {});
          } catch (parseErr: any) {
            logger.error({ sessionId, toolName: fnName, rawArgs, error: parseErr.message }, "Malformed tool arguments from Groq");
            workingMessages.push({
              role: "tool",
              tool_call_id: callId,
              content: JSON.stringify({ error: `Malformed tool arguments: ${parseErr.message}` })
            });
            continue;
          }

          const toolSig = `${fnName}:${JSON.stringify(parsedArgs)}`;
          if (failedToolSignatures.has(toolSig)) {
            logger.warn({ sessionId, toolName: fnName, toolSig }, "Blocking repeated identical tool call that previously failed");
            workingMessages.push({
              role: "tool",
              tool_call_id: callId,
              content: JSON.stringify({
                isError: true,
                error: `Tool "${fnName}" previously failed with identical arguments in this turn. Repeated requests are prohibited.`,
                category: "repeated_failure",
                retryable: false,
                instruction: "Do not call this tool again with identical arguments. Preserve the baseline route and explain that stop discovery is temporarily unavailable."
              })
            });
            continue;
          }

          try {
            const toolStart = Date.now();
            const result = await this.mcpService.executeTool(fnName, parsedArgs);
            const toolLatency = Date.now() - toolStart;

            logger.info({ sessionId, toolName: fnName, latencyMs: toolLatency, isError: result.isError }, "MCP tool execution completed");

            if (result.isError) {
              failedToolSignatures.add(toolSig);
              logger.warn({
                sessionId,
                toolName: fnName,
                toolCallId: callId,
                latencyMs: toolLatency,
                errorCategory: result.data?.category || "tool_error",
                errorStatus: result.data?.status,
                errorMessage: result.data?.error || result.data?.message
              }, "MCP tool execution returned error");
            }

            // Update TravelPlan with the FULL, uncompacted MCP result data
            if (fnName === "compare_routes" && !result.isError) {
              updateTravelPlanFromCompareRoutes(context.travelPlan, parsedArgs, result.data);
            }

            // Generate compact model-facing tool payload
            const modelData = compactToolResult(fnName, result.data);

            workingMessages.push({
              role: "tool",
              tool_call_id: callId,
              content: typeof modelData === "string" ? modelData : JSON.stringify(modelData)
            });
          } catch (execErr: any) {
            failedToolSignatures.add(toolSig);
            logger.error({ sessionId, toolName: fnName, error: execErr.message }, "MCP tool execution failed");
            workingMessages.push({
              role: "tool",
              tool_call_id: callId,
              content: JSON.stringify({ error: `Error executing tool: ${execErr.message}` })
            });
          }
        }
      } else {
        // Plain text response / terminal completion
        break;
      }
    }

    // If the last message in workingMessages is a tool result, execute one finalization request with tools disabled
    const lastMsg = workingMessages[workingMessages.length - 1];
    if (lastMsg?.role === "tool") {
      logger.info({ sessionId, toolRounds }, "Executing final response generation with tool calling disabled");
      try {
        const finalResponse = await this.groqClient.chat.completions.create({
          model: this.modelId,
          messages: workingMessages as any,
          tools: undefined,
          tool_choice: "none" as any,
          max_completion_tokens: this.maxCompletionTokens
        }, { timeout: 30_000, maxRetries: 0 });

        const finalChoice = finalResponse.choices && finalResponse.choices[0];
        const finalAssistantMsg = finalChoice?.message;

        if (finalAssistantMsg?.content && finalAssistantMsg.content.trim()) {
          finalMessageText = finalAssistantMsg.content;
          workingMessages.push({
            role: "assistant",
            content: finalMessageText
          });
        } else {
          finalMessageText = buildTravelPlanFallback(context.travelPlan);
        }
      } catch (finalErr: any) {
        logger.error({ sessionId, error: finalErr.message }, "Finalization response failed, using TravelPlan fallback");
        finalMessageText = buildTravelPlanFallback(context.travelPlan);
      }
    }

    if (!finalMessageText) {
      finalMessageText = buildTravelPlanFallback(context.travelPlan);
    }

    // Persist ONLY clean conversational history (user message + final assistant text response)
    context.messages = [
      ...boundedHistory,
      { role: "user", content: userMessage },
      { role: "assistant", content: finalMessageText || "Request processed." }
    ].slice(-6); // Bound persistent conversational history to at most 6 messages (3 turns)

    this.sessionStore.updateSession(sessionId, context);

    return {
      message: finalMessageText || "Request processed.",
      travelPlan: context.travelPlan
    };
  }
}
