import { z } from "zod";
import { NominatimProvider } from "../../providers/geocoding/nominatim.js";

const provider = new NominatimProvider();

export const geocodeDefinition = {
  name: "geocode",
  description: "Convert a human-readable place/address into one or more geographic locations.",
  parameters: {
    query: z.string().min(1).describe("The place name or address to search for (e.g., 'Pune Airport')")
  }
};

export const geocodeHandler = async (args: { query: string }) => {
  const query = args.query.trim();
  if (!query) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ error: "Query must be a non-empty string" })
        }
      ],
      isError: true,
    };
  }

  try {
    const results = await provider.search(query);
    
    if (results.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              results: [],
              message: `I couldn't find a place matching '${query}'.`
            })
          }
        ]
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ results }, null, 2)
        }
      ]
    };
  } catch (error: any) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ error: error.message || "An error occurred during geocoding" })
        }
      ],
      isError: true,
    };
  }
};
