import { useState, useCallback, useRef, useEffect } from "react";
import type { ChatMessage, TravelPlan, AgentResponse } from "../types/api";
import { diffTravelPlans } from "../lib/planChanges";
import type { PlanUpdateNotice } from "../lib/planChanges";

const generateId = () => crypto.randomUUID();
const sessionId = generateId(); // Unique per browser session

// The backend always returns a TravelPlan object, even an empty one. Only show
// plans that actually contain a route/plan, so failed turns don't blank the map
// with an empty "Route Selected" card.
const hasPlanContent = (plan?: TravelPlan | null): plan is TravelPlan =>
  !!plan && (plan.destination !== undefined || plan.distanceKm !== undefined ||
    plan.routeGeometry !== undefined || plan.departureTime !== undefined || plan.stale === true);

// Cheap identity for API payloads, used to skip no-op map/plan re-renders.
const planKey = (plan: TravelPlan | null) => (plan ? JSON.stringify(plan) : "");

const sanitizeError = (value: unknown): string => {
  const raw =
    typeof value === "string"
      ? value
      : value instanceof Error
        ? value.message
        : "";
  return raw
    .replace(/\p{Cc}+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
};

// Backend turns routing-provider outages into 5xx/429 responses.
const classifyStatus = (status: number): FailureKind => {
  if (status === 408 || status === 504) return "timeout";
  if (status >= 500 || status === 429) return "provider";
  return "unknown";
};

const isTimeoutError = (err: unknown) =>
  typeof err === "object" &&
  err !== null &&
  (err as { name?: string }).name === "TimeoutError";

const STALE_UPDATE_ERROR =
  "The latest route update failed. Showing the previous plan as stale.";

/** Structured failure cause, alongside the user-facing `error` string. */
export type FailureKind = "provider" | "timeout" | "network" | "server" | "unknown";

export const useRoutePilot = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [currentPlan, setCurrentPlan] = useState<TravelPlan | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failureKind, setFailureKind] = useState<FailureKind | null>(null);
  const [planUpdate, setPlanUpdate] = useState<PlanUpdateNotice | null>(null);

  // Last successful plan. Kept immutable so a failed turn can display a stale
  // clone without corrupting the canonical plan.
  const canonicalPlanRef = useRef<TravelPlan | null>(null);
  // Baseline for the compact change summary. Only final, non-stale responses
  // advance it, so polling and the final response cannot double-count updates.
  const lastSummarizedPlanRef = useRef<TravelPlan | null>(null);
  const planUpdateIdRef = useRef(0);
  // Exact text of the last failed turn, replayed by Retry without a new bubble.
  const lastFailedTextRef = useRef<string | null>(null);
  const inFlightRef = useRef(false);
  const requestSeqRef = useRef(0);
  const activeSeqRef = useRef(0);
  const finalAppliedSeqRef = useRef<number | null>(null);
  const pollSeqRef = useRef(0);
  const lastAppliedPollRef = useRef(0);

  const setDisplayPlan = useCallback((plan: TravelPlan) => {
    setCurrentPlan((prev) => (planKey(prev) === planKey(plan) ? prev : plan));
  }, []);

  const failTurn = useCallback((text: string, message: string, kind: FailureKind) => {
    lastFailedTextRef.current = text;
    setError(message);
    setFailureKind(kind);
    const canonical = canonicalPlanRef.current;
    if (canonical) {
      // Keep the previous plan visible, but never as the result of this turn.
      setCurrentPlan({ ...canonical, stale: true, staleReason: `Latest update failed: ${message}` });
    }
  }, []);

  const runTurn = useCallback(
    async (text: string, appendUserMessage: boolean) => {
      if (!text.trim() || inFlightRef.current) return;

      inFlightRef.current = true;
      const requestId = ++requestSeqRef.current;
      activeSeqRef.current = requestId;
      finalAppliedSeqRef.current = null;
      lastFailedTextRef.current = null;
      setError(null);
      setFailureKind(null);
      setPlanUpdate(null);
      setIsLoading(true);

      if (appendUserMessage) {
        // Initial sends add exactly one bubble; retries replay without one.
        setMessages((prev) => [...prev, { id: generateId(), role: "user", text }]);
      }

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, message: text }),
          signal: AbortSignal.timeout(120_000),
        });

        if (!response.ok) {
          let body: { error?: unknown; failureKind?: unknown } | null = null;
          try {
            body = await response.json();
          } catch {
            // Non-JSON error bodies fall back to the generic message.
          }
          const message =
            sanitizeError(body?.error) || "Route planning is temporarily unavailable.";
          const kind =
            body?.failureKind === "provider" ? "provider" : classifyStatus(response.status);
          failTurn(text, message, kind);
          return;
        }

        const data: AgentResponse = await response.json();
        setMessages((prev) => [
          ...prev,
          { id: generateId(), role: "assistant", text: data.message },
        ]);

        const plan = data.travelPlan;
        if (hasPlanContent(plan)) {
          if (plan.stale) {
            // A stale payload is not a fresh success: keep the canonical plan
            // (or the payload itself) visibly stale and leave Retry available.
            const canonical = canonicalPlanRef.current;
            const display = canonical
              ? {
                  ...canonical,
                  stale: true,
                  staleReason:
                    sanitizeError(plan.staleReason) || "Routing provider is unavailable.",
                }
              : plan;
            setDisplayPlan(display);
            lastFailedTextRef.current = text;
            setError(STALE_UPDATE_ERROR);
            setFailureKind("provider");
          } else {
            canonicalPlanRef.current = plan;
            setDisplayPlan(plan);
            setError(null);
            setFailureKind(null);

            // This is the only place a success summary is created. Polling can
            // paint the map early, but it must not add or duplicate feedback.
            const previous = lastSummarizedPlanRef.current;
            const diff = diffTravelPlans(previous, plan);
            if (diff.status === "changed" || diff.status === "no_change") {
              planUpdateIdRef.current += 1;
              setPlanUpdate({ id: planUpdateIdRef.current, result: diff });
            }
            lastSummarizedPlanRef.current = plan;
          }
        }
      } catch (err: unknown) {
        if (isTimeoutError(err)) {
          failTurn(text, "Route planning timed out. Please try again.", "timeout");
        } else if (err instanceof TypeError) {
          failTurn(
            text,
            "Could not reach RoutePilot. Check your connection and try again.",
            "network"
          );
        } else {
          failTurn(text, sanitizeError(err) || "An error occurred.", "unknown");
        }
      } finally {
        // Any poll still in flight for this turn must not override its outcome.
        finalAppliedSeqRef.current = requestId;
        inFlightRef.current = false;
        setIsLoading(false);
      }
    },
    [failTurn, setDisplayPlan]
  );

  const sendMessage = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      void runTurn(text, true);
    },
    [runTurn]
  );

  const retryLastMessage = useCallback(() => {
    const text = lastFailedTextRef.current;
    if (text) void runTurn(text, false);
  }, [runTurn]);

  const dismissPlanUpdate = useCallback(() => {
    setPlanUpdate(null);
  }, []);

  // Show the route on the map as soon as it is computed, rather than waiting
  // for the whole agent turn (tool rounds) to finish.
  useEffect(() => {
    if (!isLoading) return;

    const poll = async () => {
      const requestId = activeSeqRef.current;
      const pollId = ++pollSeqRef.current;
      try {
        const res = await fetch(`/api/plan?sessionId=${sessionId}`);
        if (!res.ok) return;
        const data = await res.json();
        const plan = data?.travelPlan;
        if (!hasPlanContent(plan) || plan.stale) return;
        // Discard results from a superseded turn or a poll that started before
        // an already-applied final response / newer poll.
        if (requestId !== activeSeqRef.current) return;
        if (finalAppliedSeqRef.current === requestId) return;
        if (pollId < lastAppliedPollRef.current) return;
        lastAppliedPollRef.current = pollId;
        canonicalPlanRef.current = plan;
        setDisplayPlan(plan);
      } catch {
        // Polling is opportunistic; failures must preserve the current plan.
      }
    };

    const id = setInterval(poll, 1500);
    return () => clearInterval(id);
  }, [isLoading, setDisplayPlan]);

  return {
    messages,
    currentPlan,
    isLoading,
    error,
    failureKind,
    planUpdate,
    sendMessage,
    retryLastMessage,
    dismissPlanUpdate,
  };
};
