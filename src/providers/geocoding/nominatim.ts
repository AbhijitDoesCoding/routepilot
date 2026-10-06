import { GeocodeProvider, Location } from "./types.js";

export class NominatimProvider implements GeocodeProvider {
  private baseUrl: string;
  private userAgent: string;

  constructor() {
    this.baseUrl = process.env.NOMINATIM_BASE_URL || "https://nominatim.openstreetmap.org";
    this.userAgent = process.env.NOMINATIM_USER_AGENT || "RoutePilot/0.1.0";
  }

  async search(query: string): Promise<Location[]> {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      throw new Error("Query must be a non-empty string");
    }

    const url = new URL(`${this.baseUrl}/search`);
    url.searchParams.append("q", trimmedQuery);
    url.searchParams.append("format", "json");
    url.searchParams.append("addressdetails", "1");
    url.searchParams.append("limit", "5");

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(url.toString(), {
        headers: {
          "User-Agent": this.userAgent,
          "Accept": "application/json",
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Nominatim API HTTP error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      if (!Array.isArray(data)) {
        throw new Error("Malformed response from Nominatim API");
      }

      return data.map((item: any) => {
        const lat = parseFloat(item.lat);
        const lon = parseFloat(item.lon);

        if (isNaN(lat) || isNaN(lon)) {
          throw new Error("Malformed coordinate data in Nominatim response");
        }

        return {
          name: item.display_name || "Unknown Location",
          lat,
          lon,
          address: item.display_name,
        };
      });
    } catch (error: any) {
      if (error.name === "AbortError") {
        throw new Error("Nominatim API request timed out");
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
