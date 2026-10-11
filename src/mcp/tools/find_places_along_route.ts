import { z } from "zod";
import { ValhallaProvider } from "../../providers/routing/valhalla.js";
import { OverpassProvider, OverpassError } from "../../providers/places/overpass.js";
import pino from "pino";

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: {
    target: "pino-pretty"
  }
});

const routingProvider = new ValhallaProvider();
const placesProvider = new OverpassProvider();

export const findPlacesAlongRouteDefinition = {
  name: "find_places_along_route",
  description: "Find real places of a requested category that are close to the calculated route. Never invent places.",
  parameters: z.object({
    locations: z.array(
      z.object({
        lat: z.number().min(-90).max(90),
        lon: z.number().min(-180).max(180),
        name: z.string().optional()
      })
    ).min(2).describe("Waypoints to route between"),
    mode: z.enum(["auto", "pedestrian", "bicycle"]).default("auto").describe("Transport mode"),
    category: z.enum(["coffee_shop", "cafe"]).describe("Place category to search for"),
    radiusMeters: z.number().min(10).max(10000).default(1000).describe("Maximum distance from the route"),
    limit: z.number().min(1).max(50).default(5).describe("Maximum number of places to return")
  })
};

export const findPlacesAlongRouteHandler = async (args: any) => {
  const handlerStart = Date.now();
  try {
    const { locations, mode = "auto", category, radiusMeters = 1000, limit = 5 } = args;
    
    // Calculate baseline route to get geometry
    const routeResult = await routingProvider.calculateRoute({ locations, mode });
    
    // Find places along that geometry
    const places = await placesProvider.findPlacesAlongRoute({
      routeGeometry: routeResult.geometry,
      category,
      radiusMeters,
      limit
    });

    if (places.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ message: "No places found matching criteria along the route", places: [] })
          }
        ]
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ places }, null, 2)
        }
      ]
    };

  } catch (error: any) {
    const durationMs = Date.now() - handlerStart;
    const category = error.category || (error.message?.includes("timeout") ? "timeout" : "provider_error");
    const status = error.status;
    const attempts = error.attempts || 1;

    logger.error({
      toolName: "find_places_along_route",
      errorCategory: category,
      httpStatus: status,
      attempts,
      durationMs,
      error: error.message
    }, "find_places_along_route tool execution failed");

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            isError: true,
            error: error.message || "Failed to find places along route",
            category,
            status,
            retryable: false,
            message: "Stop discovery is temporarily unavailable due to external provider error. Do NOT call find_places_along_route again with identical arguments. Preserve the feasible baseline route and inform the user that stop discovery along the route is temporarily unavailable."
          }, null, 2)
        }
      ],
      isError: true,
    };
  }
};
