import { useState, useCallback, useRef, useEffect } from "react";
import type { ChatMessage, TravelPlan, AgentResponse } from "../types/api";

const generateId = () => crypto.randomUUID();
const sessionId = generateId(); // Unique per browser session

// The backend always returns a TravelPlan object, even an empty one. Only show
// plans that actually contain a route/plan, so failed turns don't blank the map
// with an empty "Route Selected" card.
const hasPlanContent = (plan?: TravelPlan | null): plan is TravelPlan =>
  !!plan && (plan.destination !== undefined || plan.distanceKm !== undefined ||
    plan.routeGeometry !== undefined || plan.departureTime !== undefined);

export const useRoutePilot = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [currentPlan, setCurrentPlan] = useState<TravelPlan | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Store the last failed message so Retry can replay the exact text
  const lastFailedMessage = useRef<string | null>(null);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim()) return;

    const userMessage: ChatMessage = { id: generateId(), role: "user", text };
    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);
    setError(null);
    lastFailedMessage.current = null;

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, message: text }),
        signal: AbortSignal.timeout(120_000),
      });

      if (!response.ok) {
        let msg = "Route planning is temporarily unavailable.";
        try {
          const errData = await response.json();
          if (errData.error) msg = errData.error;
        } catch {}
        throw new Error(msg);
      }

      const data: AgentResponse = await response.json();
      
      const assistantMessage: ChatMessage = {
        id: generateId(),
        role: "assistant",
        text: data.message,
      };

      setMessages((prev) => [...prev, assistantMessage]);
      
      if (hasPlanContent(data.travelPlan)) {
        setCurrentPlan(data.travelPlan);
      }
    } catch (err: any) {
      console.error(err);
      lastFailedMessage.current = text;
      // Remove the optimistic user message since it failed
      setMessages((prev) => prev.filter(m => m.text !== text || m.role !== "user" || m.id !== userMessage.id));
      setError(err.name === "TimeoutError"
        ? "Route planning timed out. Please try again."
        : err.message || "An error occurred");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const retryLastMessage = useCallback(() => {
    if (lastFailedMessage.current) {
      sendMessage(lastFailedMessage.current);
    }
  }, [sendMessage]);

  // Show the route on the map as soon as it is computed, rather than waiting
  // for the whole agent turn (tool rounds) to finish.
  useEffect(() => {
    if (!isLoading) return;
    const poll = async () => {
      try {
        const res = await fetch(`/api/plan?sessionId=${sessionId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (hasPlanContent(data.travelPlan)) setCurrentPlan(data.travelPlan);
      } catch {
        // ignore polling errors; the chat request owns final state
      }
    };
    const id = setInterval(poll, 1500);
    return () => clearInterval(id);
  }, [isLoading]);

  return {
    messages,
    currentPlan,
    isLoading,
    error,
    sendMessage,
    retryLastMessage,
  };
};
