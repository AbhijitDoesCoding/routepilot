import { IncomingMessage, ServerResponse } from "node:http";
import { RoutePilotAgent } from "../agent/types.js";
import { z } from "zod";

const chatRequestSchema = z.object({
  sessionId: z.string().uuid(),
  message: z.string().min(1)
});

export const createChatHandler = (agent: RoutePilotAgent) => {
  return async (req: IncomingMessage, res: ServerResponse) => {
    // Add CORS headers
    const allowedOrigin = process.env.CORS_ORIGIN || "http://localhost:5173";
    res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(200);
      res.end();
      return;
    }

    if (req.method !== "POST") {
      res.writeHead(405);
      res.end("Method Not Allowed");
      return;
    }

    try {
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 1024 * 100) { // 100kb limit
          res.writeHead(413);
          res.end("Payload Too Large");
          return;
        }
      }

      const rawJson = JSON.parse(body);
      const parsed = chatRequestSchema.safeParse(rawJson);

      if (!parsed.success) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid request payload", details: parsed.error.issues }));
        return;
      }

      const response = await agent.converse(parsed.data.sessionId, parsed.data.message);
      
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(response));

    } catch (err: any) {
      console.error("Chat API Error:", err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Route planning is temporarily unavailable." }));
    }
  };
};
