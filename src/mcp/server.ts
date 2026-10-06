import { McpServer } from "@modelcontextprotocol/server";
import { healthCheckDefinition, healthCheckHandler } from "./tools/health.js";
import { geocodeDefinition, geocodeHandler } from "./tools/geocode.js";
import { calculateRouteDefinition, calculateRouteHandler } from "./tools/calculate_route.js";
import { compareRoutesDefinition, compareRoutesHandler } from "./tools/compare_routes.js";
import { findPlacesAlongRouteDefinition, findPlacesAlongRouteHandler } from "./tools/find_places_along_route.js";

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

  server.registerTool(
    calculateRouteDefinition.name,
    {
      description: calculateRouteDefinition.description,
      inputSchema: calculateRouteDefinition.parameters,
    },
    calculateRouteHandler
  );

  server.registerTool(
    compareRoutesDefinition.name,
    {
      description: compareRoutesDefinition.description,
      inputSchema: compareRoutesDefinition.parameters,
    },
    compareRoutesHandler
  );

  server.registerTool(
    findPlacesAlongRouteDefinition.name,
    {
      description: findPlacesAlongRouteDefinition.description,
      inputSchema: findPlacesAlongRouteDefinition.parameters,
    },
    findPlacesAlongRouteHandler
  );

  return server;
};
