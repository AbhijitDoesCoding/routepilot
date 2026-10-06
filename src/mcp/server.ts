import { McpServer } from "@modelcontextprotocol/server";
import { healthCheckDefinition, healthCheckHandler } from "./tools/health.js";

export const createServer = () => {
  const server = new McpServer({
    name: "RoutePilot",
    version: "0.1.0"
  });

  server.registerTool(
    "health_check",
    {
      description: "Check the health of the RoutePilot MCP server"
    },
    async () => {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              status: "ok",
              service: "RoutePilot MCP",
              version: "0.1.0",
              timestamp: new Date().toISOString()
            })
          }
        ]
      };
    }
  );

  return server;
};
