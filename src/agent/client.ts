import { BedrockRuntimeClient, ConverseCommand, Message, Tool, SystemContentBlock } from "@aws-sdk/client-bedrock-runtime";
import { MCPClientService } from "../mcp/client/index.js";
import { getSystemPrompt } from "./prompts/routepilot.js";
import { Clock } from "./clock.js";
import { SessionStore } from "./session.js";
import { AgentResponse, AgentContext } from "./types.js";
import { RouteConstraint } from "../domain/constraints.js";
import { randomUUID } from "node:crypto";
import pino from "pino";

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: {
    target: "pino-pretty"
  }
});

export class BedrockAgent {
  private bedrockClient: BedrockRuntimeClient;
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
    
    const region = process.env.BEDROCK_REGION || process.env.AWS_REGION || "us-east-1";
    this.modelId = process.env.BEDROCK_MODEL_ID || "anthropic.claude-3-5-sonnet-20241022-v2:0";
    
    this.bedrockClient = new BedrockRuntimeClient({ region });
  }

  /**
   * Converse with the agent given a user prompt.
   */
  public async converse(sessionId: string, userMessage: string): Promise<AgentResponse> {
    const context = this.sessionStore.getSession(sessionId);
    
    // Append user message
    context.messages.push({
      role: "user",
      content: [{ text: userMessage }]
    });

    const tools = await this.mcpService.getBedrockTools();
    
    let maxRounds = 5;
    let rounds = 0;
    let stopReason: string | undefined;
    
    const defaultOrigin = process.env.DEFAULT_ORIGIN_QUERY;
    const systemPromptText = getSystemPrompt(this.clock.nowIso(), this.clock.getTimezone(), defaultOrigin);

    while (rounds < maxRounds) {
      rounds++;
      logger.info({ sessionId, round: rounds }, "Sending request to Bedrock");
      
      const command = new ConverseCommand({
        modelId: this.modelId,
        messages: context.messages,
        system: [{ text: systemPromptText }],
        toolConfig: {
          tools: tools
        }
      });

      const startTime = Date.now();
      const response = await this.bedrockClient.send(command);
      const latency = Date.now() - startTime;
      
      logger.info({ sessionId, latencyMs: latency, stopReason: response.stopReason }, "Received response from Bedrock");

      if (!response.output || !response.output.message) {
        throw new Error("Invalid response from Bedrock: No output message");
      }

      const responseMessage = response.output.message;
      context.messages.push(responseMessage);
      stopReason = response.stopReason;

      if (stopReason === "tool_use") {
        // Handle tool calls
        const toolResults: any[] = [];
        
        for (const block of responseMessage.content!) {
          if (block.toolUse) {
            const toolUse = block.toolUse;
            logger.info({ sessionId, toolName: toolUse.name, toolUseId: toolUse.toolUseId }, "Executing MCP tool");
            
            try {
              const toolStart = Date.now();
              const result = await this.mcpService.executeTool(toolUse.name!, toolUse.input);
              const toolLatency = Date.now() - toolStart;
              
              logger.info({ sessionId, toolName: toolUse.name, latencyMs: toolLatency }, "MCP tool execution completed");

              // If compare_routes is called, intercept constraints/results to update TravelPlan in session
              if (toolUse.name === "compare_routes") {
                this.updateTravelPlanFromCompareRoutes(context, toolUse.input, result);
              }

              toolResults.push({
                toolResult: {
                  toolUseId: toolUse.toolUseId,
                  content: [{ json: result }],
                  status: "success"
                }
              });
            } catch (err: any) {
              logger.error({ sessionId, toolName: toolUse.name, error: err.message }, "MCP tool execution failed");
              toolResults.push({
                toolResult: {
                  toolUseId: toolUse.toolUseId,
                  content: [{ text: `Error executing tool: ${err.message}` }],
                  status: "error"
                }
              });
            }
          }
        }

        // Send tool results back to Bedrock
        context.messages.push({
          role: "user",
          content: toolResults
        });
      } else {
        // Text response / stop
        break;
      }
    }

    if (rounds >= maxRounds && stopReason === "tool_use") {
      logger.warn({ sessionId }, "Maximum tool rounds exceeded");
      context.messages.push({
        role: "assistant",
        content: [{ text: "I apologize, but I'm having trouble completing this request right now." }]
      });
    }

    this.sessionStore.updateSession(sessionId, context);

    // Extract the final text message
    const lastMessage = context.messages[context.messages.length - 1];
    let messageText = "";
    if (lastMessage.role === "assistant" && lastMessage.content) {
      for (const block of lastMessage.content) {
        if (block.text) {
          messageText += block.text;
        }
      }
    }

    return {
      message: messageText || "Request processed.",
      travelPlan: context.travelPlan
    };
  }

  /**
   * Sniff the compare_routes input and output to update our structured TravelPlan
   */
  private updateTravelPlanFromCompareRoutes(context: AgentContext, input: any, result: any) {
    try {
      if (input.constraints) {
        context.travelPlan.constraints = input.constraints;
      }
      if (input.departure_time) {
        context.travelPlan.departureTime = input.departure_time;
      }
      
      if (result.feasible && result.recommended && result.recommended.route) {
        const route = result.recommended.route;
        context.travelPlan.durationMinutes = route.durationMinutes;
        context.travelPlan.distanceKm = route.distanceKm;
        context.travelPlan.routeGeometry = route.geometry;
        
        // Also capture arrival deadlines dynamically if evaluated
        const arrivalConstraint = result.recommended.constraintEvaluations?.find((e: any) => e.type === "arrival_deadline");
        if (arrivalConstraint && arrivalConstraint.status === "satisfied" && input.departure_time) {
          // TravelPlan ETA / Buffers logic can be augmented here
          context.travelPlan.actualEta = "Calculated from constraints"; // Can parse from Reason text or rebuild TimeUtils logic
        }
      }
    } catch (err) {
      logger.error({ error: err }, "Failed to parse compare_routes result for TravelPlan update");
    }
  }
}
