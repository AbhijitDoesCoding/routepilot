import { createServer as createHttpServer, IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { createServer } from "./mcp/server.js";
import { MCPClientService } from "./mcp/client/index.js";
import { BedrockAgent } from "./agent/client.js";
import { SessionStore } from "./agent/session.js";
import { Clock } from "./agent/clock.js";
import { createChatHandler } from "./api/chat.js";

const PORT = parseInt(process.env.PORT || "3000", 10);

const mcpServer = createServer();
const mcpHandler = createMcpHandler(() => mcpServer);

// Delay agent instantiation until the server starts listening
let chatHandler: ((req: IncomingMessage, res: ServerResponse) => Promise<void>) | null = null;

const requestHandler = async (req: IncomingMessage, res: ServerResponse) => {
  if (req.url === "/mcp") {
    try {
      const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
      const init: RequestInit = {
        method: req.method,
        headers: req.headers as Record<string, string>,
      };
      
      if (req.method !== "GET" && req.method !== "HEAD") {
        init.body = Readable.toWeb(req) as any;
        (init as any).duplex = "half";
      }

      const webReq = new Request(url, init);
      const webRes = await mcpHandler.fetch(webReq);

      res.writeHead(webRes.status, webRes.statusText, Object.fromEntries(webRes.headers.entries()));
      if (webRes.body) {
        Readable.fromWeb(webRes.body as any).pipe(res);
      } else {
        res.end();
      }
    } catch (error) {
      console.error("Error handling MCP request:", error);
      res.writeHead(500);
      res.end("Internal Server Error");
    }
  } else if (req.url === "/api/chat") {
    if (!chatHandler) {
      res.writeHead(503);
      res.end("Agent Service Not Ready");
      return;
    }
    await chatHandler(req, res);
  } else {
    res.writeHead(404);
    res.end("Not Found");
  }
};

const server = createHttpServer(requestHandler);

server.listen(PORT, async () => {
  console.log(`RoutePilot MCP Server running at http://localhost:${PORT}/mcp`);
  
  try {
    // Initialize MCP Client connecting to our own server
    const mcpClient = new MCPClientService(`http://localhost:${PORT}/mcp`);
    await mcpClient.connect();
    console.log("Internal MCP Client connected");
    
    const agent = new BedrockAgent(mcpClient, new SessionStore(), new Clock());
    chatHandler = createChatHandler(agent);
    console.log(`Chat API available at http://localhost:${PORT}/api/chat`);
  } catch (err) {
    console.error("Failed to initialize Bedrock Agent:", err);
  }
});
