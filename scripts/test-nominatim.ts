import { NominatimProvider } from "../src/providers/geocoding/nominatim.js";

async function main() {
  console.log("Testing Nominatim Geocoding Provider with real API...");
  
  const provider = new NominatimProvider();
  
  try {
    const results = await provider.search("Pune Airport");
    console.log("Success! Found", results.length, "results.");
    console.log(JSON.stringify(results, null, 2));
  } catch (err) {
    console.error("Error during real Nominatim API test:", err);
  }
}

main();
