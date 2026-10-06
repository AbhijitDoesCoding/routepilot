import { z } from "zod";
import { ValhallaProvider } from "../../providers/routing/valhalla.js";
import { OverpassProvider } from "../../providers/places/overpass.js";

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
  try {
    const { locations, mode, category, radiusMeters, limit } = args;
    
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
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ error: error.message || "Failed to find places along route" })
        }
      ],
      isError: true,
    };
  }
};
