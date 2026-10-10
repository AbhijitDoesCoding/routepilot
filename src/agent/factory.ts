import { MCPClientService } from "../mcp/client/index.js";
import { SessionStore } from "./session.js";
import { Clock } from "./clock.js";
import { BedrockAgent } from "./client.js";
import { GroqAgent } from "./groq.js";
import { RoutePilotAgent } from "./types.js";

/**
 * Creates the RoutePilot agent instance based on LLM_PROVIDER.
 * Supported:
 * - "groq": Uses Groq API with GROQ_API_KEY and GROQ_MODEL_ID
 * - "bedrock": Uses Amazon Bedrock Converse API with AWS credentials and BEDROCK_MODEL_ID (default)
 */
export function createAgent(
  mcpService: MCPClientService,
  sessionStore: SessionStore,
  clock: Clock
): RoutePilotAgent {
  const provider = (process.env.LLM_PROVIDER || "bedrock").toLowerCase();

  if (provider === "groq") {
    return new GroqAgent(mcpService, sessionStore, clock);
  } else if (provider === "bedrock") {
    return new BedrockAgent(mcpService, sessionStore, clock);
  } else {
    throw new Error(`Unsupported LLM_PROVIDER: "${provider}". Supported values: "bedrock", "groq"`);
  }
}
