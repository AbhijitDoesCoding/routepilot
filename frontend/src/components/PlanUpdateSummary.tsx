import { useState } from "react";
import { Check, ChevronDown, ChevronUp, X } from "lucide-react";
import clsx from "clsx";
import type { PlanUpdateNotice } from "../lib/planChanges";

interface PlanUpdateSummaryProps {
  notice: PlanUpdateNotice;
  onDismiss: () => void;
}

/**
 * Compact, text-only confirmation of a canonical plan update. It deliberately
 * renders structured diff events rather than the assistant's prose.
 */
export const PlanUpdateSummary = ({ notice, onDismiss }: PlanUpdateSummaryProps) => {
  const [expanded, setExpanded] = useState(false);
  const { result } = notice;

  if (result.status !== "changed" && result.status !== "no_change") return null;

  const changed = result.status === "changed";
  const changes = result.changes;
  const visibleChanges = expanded ? changes : changes.slice(0, 3);
  const hiddenCount = changes.length - visibleChanges.length;

  return (
    <div
      role="status"
      aria-live="polite"
      className={clsx(
        "mt-3 rounded-xl border px-3 py-2.5 text-[11px] leading-snug",
        changed
          ? "border-route-500/35 bg-route-500/10 text-paper-100"
          : "border-ink-600 bg-ink-850 text-ink-200"
      )}
    >
      <div className="flex items-start gap-2">
        <span
          className={clsx(
            "mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full",
            changed ? "bg-route-500/25 text-route-200" : "bg-ink-700 text-ink-300"
          )}
          aria-hidden="true"
        >
          <Check className="h-2.5 w-2.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-white">
            {changed ? "Plan updated" : "Plan unchanged"}
          </p>
          {changed ? (
            <ul className="mt-1 space-y-0.5 text-ink-200">
              {visibleChanges.map((change, index) => (
                <li key={`${change.kind}-${index}`}>{change.label}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-0.5 text-ink-300">No route or timing changes.</p>
          )}
          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              aria-label={expanded ? "Show fewer plan changes" : `Show ${hiddenCount} more plan changes`}
              className="mt-1 inline-flex items-center gap-1 font-medium text-route-300 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-route-400"
            >
              {expanded ? "Show less" : `${hiddenCount} more`}
              {expanded ? (
                <ChevronUp className="h-3 w-3" aria-hidden="true" />
              ) : (
                <ChevronDown className="h-3 w-3" aria-hidden="true" />
              )}
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss plan update"
          className="grid h-5 w-5 shrink-0 place-items-center rounded text-ink-400 hover:bg-ink-700 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-route-400"
        >
          <X className="h-3 w-3" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
};
