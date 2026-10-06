import { McpServer } from "@modelcontextprotocol/server";
import { healthCheckDefinition, healthCheckHandler } from "./tools/health.js";
import { geocodeDefinition, geocodeHandler } from "./tools/geocode.js";

export const createServer = () => {
  const server = new McpServer({
    name: "RoutePilot",
    version: "0.1.0"
  });

  server.registerTool(
    healthCheckDefinition.name,
    {
      description: healthCheckDefinition.description,
      inputSchema: healthCheckDefinition.parameters,
    },
    healthCheckHandler
  );

  server.registerTool(
    geocodeDefinition.name,
    {
      description: geocodeDefinition.description,
      inputSchema: geocodeDefinition.parameters,
    },
    geocodeHandler
  );

  return server;
};
