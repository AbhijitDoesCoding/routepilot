import { MCPClientService } from "../src/mcp/client/index.js";
import { createAgent } from "../src/agent/factory.js";
import { SessionStore } from "../src/agent/session.js";
import { Clock } from "../src/agent/clock.js";
import { randomUUID } from "node:crypto";
import * as readline from "node:readline";

async function run() {
  console.log("Starting RoutePilot Agent Test...");

  const mcpService = new MCPClientService("http://localhost:3000/mcp");
  
  try {
    console.log("Connecting to local MCP server...");
    await mcpService.connect();
    console.log("Connected.");
  } catch (err: any) {
    console.error("Failed to connect to MCP server. Make sure it is running on port 3000.", err.message);
    process.exit(1);
  }

  const sessionStore = new SessionStore();
  const clock = new Clock();
  const agent = createAgent(mcpService, sessionStore, clock);

  const sessionId = randomUUID();
  console.log(\`\\nSession started: \${sessionId}\\n\`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const prompt = () => {
    rl.question("You: ", async (input) => {
      if (input.toLowerCase() === "exit" || input.toLowerCase() === "quit") {
        await mcpService.disconnect();
        rl.close();
        return;
      }

      try {
        const response = await agent.converse(sessionId, input);
        console.log(\`\\nRoutePilot:\\n\${response.message}\\n\`);
        
        if (response.travelPlan && response.travelPlan.routeGeometry) {
          console.log("[Travel Plan Updated]");
          console.log(\` - Distance: \${Math.round(response.travelPlan.distanceKm!)} km\`);
          console.log(\` - Duration: \${Math.round(response.travelPlan.durationMinutes!)} mins\`);
          console.log(\` - Constraints: \${JSON.stringify(response.travelPlan.constraints)}\`);
        }
      } catch (err: any) {
        console.error("\\n[Error] Failed to converse:", err.message);
      }
      
      console.log();
      prompt();
    });
  };

  prompt();
}

run().catch(console.error);
