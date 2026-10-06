import { ValhallaProvider } from "../src/providers/routing/valhalla.js";

async function main() {
  console.log("Testing Valhalla Routing Provider with API...");
  
  const provider = new ValhallaProvider();
  
  try {
    const result = await provider.calculateRoute({
      locations: [
        { lat: 18.5793, lon: 73.9089, name: "Pune Airport" },
        { lat: 18.5204, lon: 73.8567, name: "Pune City Center" }
      ],
      mode: "auto",
      avoidTolls: false,
      avoidHighways: false
    });
    console.log(`Success! Distance: ${result.distanceKm} km, Duration: ${result.durationMinutes} min`);
    console.log(`Geometry contains ${result.geometry.coordinates.length} coordinates.`);
  } catch (err) {
    console.error("Error during real Valhalla API test:", err);
    console.log("If Valhalla is not running locally, please start it or update VALHALLA_BASE_URL.");
  }
}

main();
