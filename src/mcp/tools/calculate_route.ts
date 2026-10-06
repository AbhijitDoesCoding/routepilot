import { z } from "zod";
import { ValhallaProvider } from "../../providers/routing/valhalla.js";

const provider = new ValhallaProvider();

export const calculateRouteDefinition = {
  name: "calculate_route",
  description: "Calculate a deterministic route between two or more geographic locations.",
  parameters: z.object({
    locations: z.array(
      z.object({
        lat: z.number().min(-90).max(90),
        lon: z.number().min(-180).max(180),
        name: z.string().optional()
      })
    ).min(2).describe("Array of locations. The first is origin, last is destination, intermediate are stops."),
    mode: z.enum(["auto", "pedestrian", "bicycle"]).default("auto").describe("Mode of transport"),
    avoid_tolls: z.boolean().default(false).describe("Whether to avoid toll roads"),
    avoid_highways: z.boolean().default(false).describe("Whether to avoid highways")
  })
};

export const calculateRouteHandler = async (args: any) => {
  try {
    const result = await provider.calculateRoute({
      locations: args.locations,
      mode: args.mode,
      avoidTolls: args.avoid_tolls,
      avoidHighways: args.avoid_highways
    });

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(result, null, 2)
        }
      ]
    };
  } catch (error: any) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ error: error.message || "An error occurred during routing" })
        }
      ],
      isError: true,
    };
  }
};
