import { Client } from "@modelcontextprotocol/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { Tool } from "@aws-sdk/client-bedrock-runtime";

export interface MCPToolResult {
  isError: boolean;
  data: any;
}

export class MCPClientService {
  private client: Client;
  private transport: StreamableHTTPClientTransport;

  constructor(serverUrl: string = "http://localhost:3000/mcp") {
    this.transport = new StreamableHTTPClientTransport(new URL(serverUrl));
    this.client = new Client(
      { name: "RoutePilotAgent", version: "1.0.0" },
      { capabilities: {} }
    );
  }

  public async connect() {
    await this.client.connect(this.transport);
  }

  public async disconnect() {
    await this.client.close();
  }

  /**
   * Retrieves tools from the MCP server and formats them for Bedrock Converse API.
   */
  public async getBedrockTools(): Promise<Tool[]> {
    const response = await this.client.listTools();
    
    return response.tools.map(tool => {
      // Map MCP JSON Schema to Bedrock JSON Schema (very similar, just needs cast and format)
      return {
        toolSpec: {
          name: tool.name,
          description: tool.description,
          inputSchema: {
            json: tool.inputSchema
          }
        }
      } as Tool;
    });
  }

  /**
   * Retrieves tools from the MCP server and formats them for Groq/OpenAI tool calling.
   */
  public async getGroqTools(): Promise<any[]> {
    const response = await this.client.listTools();
    
    return response.tools.map(tool => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema
      }
    }));
  }

  /**
   * Execute an MCP tool by name with arguments.
   */
  public async executeTool(name: string, args: Record<string, any>): Promise<MCPToolResult> {
    const result = await this.client.callTool({
      name,
      arguments: args
    });
    
    let data: any = result;
    // Attempt to parse JSON content if possible
    if (result.content && result.content.length > 0) {
      const firstContent = result.content[0] as any;
      if (firstContent.type === "text") {
        try {
          data = JSON.parse(firstContent.text);
        } catch {
          data = firstContent.text;
        }
      }
    }
    
    return {
      isError: !!result.isError,
      data
    };
  }
}
