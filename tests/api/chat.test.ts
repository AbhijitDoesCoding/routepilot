import { test, describe, mock, afterEach } from "node:test";
import * as assert from "node:assert";
import { IncomingMessage, ServerResponse } from "node:http";
import { createChatHandler } from "../../src/api/chat.js";
import { BedrockAgent } from "../../src/agent/client.js";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";

const createMockReq = (method: string, url: string, body?: any): IncomingMessage => {
  const req = Readable.from(body ? [JSON.stringify(body)] : []) as any;
  req.method = method;
  req.url = url;
  req.headers = { "content-type": "application/json" };
  return req;
};

const createMockRes = () => {
  const res: any = {
    statusCode: 200,
    headers: {},
    body: "",
    setHeader: (k: string, v: string) => { res.headers[k] = v; },
    writeHead: (s: number, h?: any) => { res.statusCode = s; if (h) Object.assign(res.headers, h); },
    end: (b: string) => { res.body = b; },
  };
  return res;
};

describe("Chat API", () => {
  afterEach(() => {
    mock.restoreAll();
  });

  test("should handle valid request and return AgentResponse", async () => {
    const mockAgent = {
      converse: async (sessionId: string, message: string) => {
        return { message: "Mock response", travelPlan: null };
      }
    } as unknown as BedrockAgent;
    
    const handler = createChatHandler(mockAgent);
    const req = createMockReq("POST", "/api/chat", {
      sessionId: randomUUID(),
      message: "Hello"
    });
    const res = createMockRes();

    await handler(req as any, res as any);
    
    assert.strictEqual(res.statusCode, 200);
    const data = JSON.parse(res.body);
    assert.strictEqual(data.message, "Mock response");
  });

  test("should reject missing sessionId", async () => {
    const handler = createChatHandler({} as any);
    const req = createMockReq("POST", "/api/chat", {
      message: "Hello"
    });
    const res = createMockRes();

    await handler(req as any, res as any);
    
    assert.strictEqual(res.statusCode, 400);
    const data = JSON.parse(res.body);
    assert.ok(data.error);
  });

  test("should handle OPTIONS for CORS", async () => {
    const handler = createChatHandler({} as any);
    const req = createMockReq("OPTIONS", "/api/chat");
    const res = createMockRes();

    await handler(req as any, res as any);
    
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.headers["Access-Control-Allow-Methods"], "POST, OPTIONS");
  });

  test("should propagate BedrockAgent errors cleanly", async () => {
    const mockAgent = {
      converse: async () => {
        throw new Error("Bedrock failure");
      }
    } as unknown as BedrockAgent;
    
    const handler = createChatHandler(mockAgent);
    const req = createMockReq("POST", "/api/chat", {
      sessionId: randomUUID(),
      message: "Hello"
    });
    const res = createMockRes();

    await handler(req as any, res as any);
    
    assert.strictEqual(res.statusCode, 500);
    const data = JSON.parse(res.body);
    assert.strictEqual(data.error, "Bedrock failure");
  });
});
