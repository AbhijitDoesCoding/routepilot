import { IncomingMessage, ServerResponse } from "node:http";
import Groq from "groq-sdk";

const MAX_CHARS = 4000;

/**
 * Neural TTS via Groq (Orpheus). Falls back to the browser voice on the client
 * when this endpoint returns an error (e.g. missing key or terms not accepted).
 */
export const createTtsHandler = () => {
  const apiKey = process.env.GROQ_API_KEY;
  const model = process.env.GROQ_TTS_MODEL || "canopylabs/orpheus-v1-english";
  const voice = process.env.GROQ_TTS_VOICE || "hannah";
  const client = apiKey ? new Groq({ apiKey }) : null;

  return async (req: IncomingMessage, res: ServerResponse) => {
    if (!client) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "TTS not configured" }));
      return;
    }
    if (req.method !== "POST") {
      res.writeHead(405);
      res.end("Method Not Allowed");
      return;
    }

    let body = "";
    for await (const chunk of req) body += chunk;

    let text = "";
    try {
      text = String(JSON.parse(body).text ?? "").trim();
    } catch {
      // fall through to the empty-text check
    }
    if (!text) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing text" }));
      return;
    }

    try {
      const speech = await client.audio.speech.create({
        model,
        voice,
        input: text.slice(0, MAX_CHARS),
        response_format: "wav",
      });
      const audio = Buffer.from(await speech.arrayBuffer());
      res.writeHead(200, {
        "Content-Type": "audio/wav",
        "Content-Length": audio.length,
        "Cache-Control": "no-store",
      });
      res.end(audio);
    } catch (err: any) {
      console.error("TTS failed:", err?.message || err);
      const isTerms = err?.message?.includes("terms acceptance") || err?.error?.error?.code === "model_terms_required";
      const errorMsg = isTerms
        ? "Groq TTS requires one-time terms acceptance: https://console.groq.com/playground?model=canopylabs%2Forpheus-v1-english"
        : (err?.message || "TTS unavailable");
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: errorMsg, isTermsRequired: isTerms }));
    }
  };
};
