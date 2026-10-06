import { AgentContext } from "./types.js";
import { Message } from "@aws-sdk/client-bedrock-runtime";
import { randomUUID } from "node:crypto";

export class SessionStore {
  private sessions = new Map<string, AgentContext>();

  public getSession(sessionId: string): AgentContext {
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = {
        sessionId,
        travelPlan: {
          id: randomUUID(),
          warnings: []
        },
        messages: []
      };
      this.sessions.set(sessionId, session);
    }
    return session;
  }

  public updateSession(sessionId: string, context: AgentContext) {
    this.sessions.set(sessionId, context);
  }
}
