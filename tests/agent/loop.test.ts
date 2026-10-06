import { test, describe, mock, afterEach, beforeEach } from "node:test";
import * as assert from "node:assert";
import { BedrockAgent } from "../../src/agent/client.js";
import { MCPClientService } from "../../src/mcp/client/index.js";
import { SessionStore } from "../../src/agent/session.js";
import { Clock } from "../../src/agent/clock.js";
import { ConverseCommand } from "@aws-sdk/client-bedrock-runtime";

describe("Agent Loop", () => {
  beforeEach(() => {
    process.env.BEDROCK_MODEL_ID = "mock-model";
  });

  afterEach(() => {
    mock.restoreAll();
  });

  test("should handle single text response without tools", async () => {
    const mcpService = new MCPClientService();
    mock.method(mcpService, "getBedrockTools", async () => []);
    
    const sessionStore = new SessionStore();
    const clock = new Clock();
    const agent = new BedrockAgent(mcpService, sessionStore, clock);

    // Mock Bedrock client send
    const sendMock = mock.method((agent as any).bedrockClient, "send", async (command: any) => {
      return {
        output: {
          message: {
            role: "assistant",
            content: [{ text: "Hello from mock Bedrock!" }]
          }
        },
        stopReason: "end_turn"
      };
    });

    const response = await agent.converse("test-session", "Hi");
    
    assert.strictEqual(response.message, "Hello from mock Bedrock!");
    assert.strictEqual(sendMock.mock.callCount(), 1);
  });

  test("should execute tool and return result to Bedrock", async () => {
    const mcpService = new MCPClientService();
    mock.method(mcpService, "getBedrockTools", async () => [
      { toolSpec: { name: "geocode", inputSchema: { json: {} } } }
    ]);
    
    const executeMock = mock.method(mcpService, "executeTool", async (name: string, input: any) => {
      if (name === "geocode") return { lat: 10, lon: 20 };
      return null;
    });

    const sessionStore = new SessionStore();
    const clock = new Clock();
    const agent = new BedrockAgent(mcpService, sessionStore, clock);

    let callCount = 0;
    mock.method((agent as any).bedrockClient, "send", async (command: any) => {
      callCount++;
      if (callCount === 1) {
        return {
          output: {
            message: {
              role: "assistant",
              content: [{
                toolUse: {
                  toolUseId: "tool-1",
                  name: "geocode",
                  input: { query: "Pune Airport" }
                }
              }]
            }
          },
          stopReason: "tool_use"
        };
      } else {
        // Assert the tool result was passed in
        const msgs = command.input.messages;
        const lastUser = msgs[msgs.length - 1];
        assert.strictEqual(lastUser.role, "user");
        assert.ok(lastUser.content[0].toolResult);
        assert.strictEqual(lastUser.content[0].toolResult.toolUseId, "tool-1");
        
        return {
          output: {
            message: {
              role: "assistant",
              content: [{ text: "Found Pune Airport." }]
            }
          },
          stopReason: "end_turn"
        };
      }
    });

    const response = await agent.converse("test-session-2", "Find Pune Airport");
    
    assert.strictEqual(response.message, "Found Pune Airport.");
    assert.strictEqual(callCount, 2);
    assert.strictEqual(executeMock.mock.callCount(), 1);
  });
});
