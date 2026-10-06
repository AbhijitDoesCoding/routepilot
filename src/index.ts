import { createServer as createHttpServer, IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { createServer } from "./mcp/server.js";

const PORT = parseInt(process.env.PORT || "3000", 10);

const mcpServer = createServer();
const mcpHandler = createMcpHandler(() => mcpServer);

const requestHandler = async (req: IncomingMessage, res: ServerResponse) => {
  if (req.url !== "/mcp") {
    res.writeHead(404);
    res.end("Not Found");
    return;
  }

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
    console.error("Error handling request:", error);
    res.writeHead(500);
    res.end("Internal Server Error");
  }
};

const server = createHttpServer(requestHandler);

server.listen(PORT, () => {
  console.log(`RoutePilot MCP Server running at http://localhost:${PORT}/mcp`);
});
