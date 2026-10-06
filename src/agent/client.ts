import { BedrockRuntimeClient, ConverseCommand, Message, Tool, SystemContentBlock } from "@aws-sdk/client-bedrock-runtime";
import { MCPClientService, MCPToolResult } from "../mcp/client/index.js";
import { getSystemPrompt } from "./prompts/routepilot.js";
import { Clock } from "./clock.js";
import { SessionStore } from "./session.js";
import { AgentResponse, AgentContext } from "./types.js";
import { TimeUtils } from "../domain/constraints.js";
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
    const modelId = process.env.BEDROCK_MODEL_ID;
    if (!modelId) {
      throw new Error("BEDROCK_MODEL_ID environment variable is required.");
    }
    this.modelId = modelId;
    
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
              const result = await this.mcpService.executeTool(toolUse.name!, toolUse.input as Record<string, any>);
              const toolLatency = Date.now() - toolStart;
              
              logger.info({ sessionId, toolName: toolUse.name, latencyMs: toolLatency, isError: result.isError }, "MCP tool execution completed");

              // If compare_routes is called successfully, update TravelPlan in session
              if (toolUse.name === "compare_routes" && !result.isError) {
                this.updateTravelPlanFromCompareRoutes(context, toolUse.input, result.data);
              }

              toolResults.push({
                toolResult: {
                  toolUseId: toolUse.toolUseId,
                  content: [{ json: result.data }],
                  status: result.isError ? "error" : "success"
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
        content: [{ text: "I apologize, but I'm having trouble completing this request right now due to too many tool calls." }]
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
      if (input.locations && input.locations.length >= 2) {
        context.travelPlan.origin = input.locations[0];
        context.travelPlan.destination = input.locations[input.locations.length - 1];
      }
      if (input.mode) {
        context.travelPlan.transportMode = input.mode;
      }
      
      if (input.stops && Array.isArray(input.stops)) {
        context.travelPlan.stops = input.stops;
      } else {
        context.travelPlan.stops = undefined;
      }
      
      if (result.feasible && result.recommended && result.recommended.route) {
        const route = result.recommended.route;
        context.travelPlan.durationMinutes = route.durationMinutes;
        context.travelPlan.drivingDurationMinutes = route.drivingDurationMinutes;
        context.travelPlan.stopDurationMinutes = route.stopDurationMinutes;
        context.travelPlan.distanceKm = route.distanceKm;
        context.travelPlan.routeGeometry = route.geometry;
        
        if (result.recommended.constraintEvaluations) {
          context.travelPlan.constraintEvaluations = result.recommended.constraintEvaluations;
        }
        
        const arrivalConstraint = input.constraints?.find((c: any) => c.type === "arrival_deadline");
        
        if (input.departure_time) {
          // Departure-first planning
          context.travelPlan.departureTime = input.departure_time;
          context.travelPlan.actualEta = TimeUtils.calculateArrivalTime(input.departure_time, route.durationMinutes);
          
          if (arrivalConstraint?.value) {
            context.travelPlan.arrivalDeadline = arrivalConstraint.value;
            context.travelPlan.bufferMinutes = TimeUtils.calculateBuffer(context.travelPlan.actualEta, arrivalConstraint.value);
          } else {
            context.travelPlan.arrivalDeadline = undefined;
            context.travelPlan.bufferMinutes = undefined;
          }
        } else if (arrivalConstraint?.value) {
          // Deadline-first planning
          context.travelPlan.arrivalDeadline = arrivalConstraint.value;
          const requiredBuffer = 0; // Default buffer for now
          
          context.travelPlan.departureTime = TimeUtils.calculateLatestDeparture(arrivalConstraint.value, route.durationMinutes, requiredBuffer);
          context.travelPlan.actualEta = TimeUtils.calculateArrivalTime(context.travelPlan.departureTime, route.durationMinutes);
          context.travelPlan.bufferMinutes = requiredBuffer;
        }
      }
    } catch (err) {
      logger.error({ error: err }, "Failed to parse compare_routes result for TravelPlan update");
    }
  }
}
