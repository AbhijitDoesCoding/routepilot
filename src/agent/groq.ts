import Groq from "groq-sdk";
import { MCPClientService } from "../mcp/client/index.js";
import { getSystemPrompt } from "./prompts/routepilot.js";
import { Clock } from "./clock.js";
import { SessionStore } from "./session.js";
import { AgentResponse, AgentContext, RoutePilotAgent } from "./types.js";
import { updateTravelPlanFromCompareRoutes } from "./planner.js";
import pino from "pino";

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: {
    target: "pino-pretty"
  }
});

export class GroqAgent implements RoutePilotAgent {
  private groqClient: Groq;
  private mcpService: MCPClientService;
  private sessionStore: SessionStore;
  private clock: Clock;
  private modelId: string;

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
    this.groqClient = new Groq({ apiKey });
  }

  /**
   * Converse with the agent given a user prompt using Groq's tool-calling API.
   */
  public async converse(sessionId: string, userMessage: string): Promise<AgentResponse> {
    const context = this.sessionStore.getSession(sessionId);

    // Append user message
    context.messages.push({
      role: "user",
      content: userMessage
    });

    const tools = await this.mcpService.getGroqTools();

    const maxRounds = 5;
    let rounds = 0;
    let finishReason: string | undefined;

    const defaultOrigin = process.env.DEFAULT_ORIGIN_QUERY;
    const systemPromptText = getSystemPrompt(this.clock.nowIso(), this.clock.getTimezone(), defaultOrigin);

    while (rounds < maxRounds) {
      rounds++;
      logger.info({ sessionId, round: rounds, modelId: this.modelId }, "Sending request to Groq");

      const apiMessages = [
        { role: "system", content: systemPromptText },
        ...context.messages
      ];

      const startTime = Date.now();
      let response: any;
      try {
        response = await this.groqClient.chat.completions.create({
          model: this.modelId,
          messages: apiMessages as any,
          tools: tools.length > 0 ? (tools as any) : undefined,
          tool_choice: tools.length > 0 ? "auto" : undefined
        });
      } catch (err: any) {
        logger.error({ sessionId, round: rounds, error: err.message }, "Groq API completion error");
        throw err;
      }

      const latency = Date.now() - startTime;
      const choice = response.choices && response.choices[0];
      if (!choice || !choice.message) {
        throw new Error("Invalid response from Groq: No choice returned");
      }

      const assistantMsg = choice.message;
      finishReason = choice.finish_reason;
      logger.info({ sessionId, latencyMs: latency, finishReason }, "Received response from Groq");

      // Normalize assistant message into session context
      context.messages.push({
        role: "assistant",
        content: assistantMsg.content || null,
        tool_calls: assistantMsg.tool_calls || undefined
      });

      if (assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0) {
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
            context.messages.push({
              role: "tool",
              tool_call_id: callId,
              content: JSON.stringify({ error: `Malformed tool arguments: ${parseErr.message}` })
            });
            continue;
          }

          try {
            const toolStart = Date.now();
            const result = await this.mcpService.executeTool(fnName, parsedArgs);
            const toolLatency = Date.now() - toolStart;

            logger.info({ sessionId, toolName: fnName, latencyMs: toolLatency, isError: result.isError }, "MCP tool execution completed");

            // If compare_routes is called successfully, update TravelPlan in session
            if (fnName === "compare_routes" && !result.isError) {
              updateTravelPlanFromCompareRoutes(context.travelPlan, parsedArgs, result.data);
            }

            context.messages.push({
              role: "tool",
              tool_call_id: callId,
              content: typeof result.data === "string" ? result.data : JSON.stringify(result.data)
            });
          } catch (execErr: any) {
            logger.error({ sessionId, toolName: fnName, error: execErr.message }, "MCP tool execution failed");
            context.messages.push({
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

    if (rounds >= maxRounds && (finishReason === "tool_calls" || context.messages[context.messages.length - 1]?.role === "tool")) {
      logger.warn({ sessionId }, "Maximum tool rounds exceeded in Groq agent");
      context.messages.push({
        role: "assistant",
        content: "I apologize, but I'm having trouble completing this request right now due to too many tool calls."
      });
    }

    this.sessionStore.updateSession(sessionId, context);

    // Extract the final text message
    let finalMessageText = "";
    for (let i = context.messages.length - 1; i >= 0; i--) {
      const msg = context.messages[i];
      if (msg.role === "assistant" && typeof msg.content === "string" && msg.content.trim()) {
        finalMessageText = msg.content;
        break;
      }
    }

    return {
      message: finalMessageText || "Request processed.",
      travelPlan: context.travelPlan
    };
  }
}
