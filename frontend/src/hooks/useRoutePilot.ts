import { useState, useCallback } from "react";
import type { ChatMessage, TravelPlan, AgentResponse } from "../types/api";

const generateId = () => crypto.randomUUID();
const sessionId = generateId(); // Unique per browser session

export const useRoutePilot = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [currentPlan, setCurrentPlan] = useState<TravelPlan | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim()) return;

    const userMessage: ChatMessage = { id: generateId(), role: "user", text };
    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, message: text }),
      });

      if (!response.ok) {
        throw new Error("Route planning is temporarily unavailable.");
      }

      const data: AgentResponse = await response.json();
      
      const assistantMessage: ChatMessage = {
        id: generateId(),
        role: "assistant",
        text: data.message,
      };

      setMessages((prev) => [...prev, assistantMessage]);
      
      if (data.travelPlan) {
        setCurrentPlan(data.travelPlan);
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || "An error occurred");
    } finally {
      setIsLoading(false);
    }
  }, []);

  return {
    messages,
    currentPlan,
    isLoading,
    error,
    sendMessage,
  };
};
