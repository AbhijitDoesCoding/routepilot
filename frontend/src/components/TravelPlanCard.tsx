import type { TravelPlan, ConstraintEvaluation } from "../types/api";
import { AlertTriangle, ArrowRight, MapPin, Navigation, X } from "lucide-react";
import clsx from "clsx";

interface TravelPlanCardProps {
  plan: TravelPlan | null;
  selectedStopIndex: number | null;
  onSelectStop: (index: number | null) => void;
}

const formatTime = (isoString?: string) => {
  if (!isoString) return null;
  return new Date(isoString).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
};

const constraintLabel = (type: string) => type.replace(/_/g, " ");

const statusGlyph = (status: ConstraintEvaluation["status"]) => {
  if (status === "satisfied") return "✓";
  if (status === "violated") return "⚠";
  return "○";
};

export const TravelPlanCard = ({
  plan,
  selectedStopIndex,
  onSelectStop,
}: TravelPlanCardProps) => {
  if (!plan) return null;

  const routeTitle = (): string => {
    if (!plan.origin?.name && !plan.destination?.name) return "Route Selected";
    const parts: string[] = [];
    if (plan.origin?.name) parts.push(plan.origin.name);
    plan.stops?.forEach((stop) => parts.push(stop.name));
    if (plan.destination?.name) parts.push(plan.destination.name);
    return parts.join(" → ");
  };

  const hasPreviousRoute =
    plan.distanceKm !== undefined ||
    plan.routeGeometry !== undefined ||
    plan.departureTime !== undefined;

  const heading = plan.stale
    ? hasPreviousRoute
      ? "Last Successful Plan (Stale)"
      : "Route Unavailable (Stale)"
    : "Recommended Plan";

  const departure = formatTime(plan.departureTime);
  const eta = formatTime(plan.actualEta);
  const deadline = formatTime(plan.arrivalDeadline);
  const total = plan.durationMinutes;
  const driving = plan.drivingDurationMinutes;
  const stopTotal = plan.stopDurationMinutes;
  const hasBreakdown =
    total !== undefined &&
    total > 0 &&
    driving !== undefined &&
    stopTotal !== undefined &&
    stopTotal > 0;

  const stopsWithDwell = plan.stops?.filter((stop) => stop.durationMinutes > 0) ?? [];
  const drivingPercent = hasBreakdown ? Math.max(0, Math.min(100, (driving! / total!) * 100)) : 0;
  const selectedStop =
    selectedStopIndex !== null ? plan.stops?.[selectedStopIndex] : undefined;

  const bufferText = (() => {
    if (plan.bufferMinutes === undefined) return null;
    if (plan.bufferMinutes > 0) return `${plan.bufferMinutes} min buffer`;
    if (plan.bufferMinutes === 0) return "0 min buffer";
    return `${Math.abs(plan.bufferMinutes)} min late`;
  })();

  const evaluations = plan.constraintEvaluations ?? [];
  const requestedConstraints = plan.constraints ?? [];
  const visibleWarnings = (plan.warnings ?? []).filter(
    (warning) => !(plan.stale && /stale/i.test(warning))
  );

  const hasTiming =
    departure !== null ||
    eta !== null ||
    deadline !== null ||
    total !== undefined;

  return (
    <div
      className={clsx(
        "flex flex-col overflow-hidden rounded-2xl border bg-paper-50 shadow-panel",
        plan.stale ? "border-stop-400" : "border-paper-200"
      )}
    >
      <div className="flex flex-col gap-3 p-4">
        {plan.stale && (
          <div
            role="status"
            className="rounded-xl border border-stop-400/70 bg-stop-500/10 px-3 py-2.5 text-xs leading-relaxed text-amber-950"
          >
            <strong>
              {hasPreviousRoute ? "Last successful route — stale." : "Route unavailable — stale."}
            </strong>{" "}
            {hasPreviousRoute
              ? "The latest recalculation failed. These times, distance, and route geometry are from the previous successful plan."
              : "The latest recalculation failed and no current route is available."}
            {plan.staleReason && <span> {plan.staleReason}</span>}
          </div>
        )}

        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-400">
              {heading}
            </span>
            {plan.stale && (
              <span className="rounded-md border border-stop-500/40 bg-stop-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-stop-700">
                Stale
              </span>
            )}
          </div>
          <h2 className="mt-1 flex items-start gap-2 text-[17px] font-semibold leading-snug tracking-tight text-ink-900">
            <Navigation
              className={clsx(
                "mt-0.5 h-4 w-4 shrink-0",
                plan.stale ? "text-stop-500" : "text-route-600"
              )}
              aria-hidden="true"
            />
            <span>{routeTitle()}</span>
          </h2>
        </div>

        {hasTiming && (
          <div className="rounded-xl border border-paper-200 bg-white p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-400">
                {plan.planningMode === "deadline_first" ? "Deadline-first plan" : "Journey"}
              </span>
              {deadline && (
                <span className="rounded-md bg-ink-900 px-2 py-1 text-[11px] font-semibold tracking-wide text-route-300 tnum">
                  Arrive by {deadline}
                </span>
              )}
            </div>

            <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-start gap-2">
              <div className="min-w-0">
                <span className="text-[10px] font-medium uppercase tracking-wide text-ink-400">
                  Depart
                </span>
                <div className="text-[22px] font-semibold leading-tight tracking-tight text-ink-900 tnum">
                  {departure ?? "—"}
                </div>
                <div className="truncate text-[11px] text-ink-500">
                  {plan.origin?.name ?? "Origin"}
                </div>
              </div>
              <ArrowRight className="mt-5 h-4 w-4 text-paper-300" aria-hidden="true" />
              <div className="min-w-0 text-right">
                <span className="text-[10px] font-medium uppercase tracking-wide text-ink-400">
                  Arrive
                </span>
                <div className="text-[22px] font-semibold leading-tight tracking-tight text-ink-900 tnum">
                  {eta ?? "—"}
                </div>
                <div className="truncate text-[11px] text-ink-500">
                  {plan.destination?.name ?? "Destination"}
                </div>
              </div>
            </div>
          </div>
        )}

        {total !== undefined && (
          <div className="rounded-xl border border-paper-200 bg-white p-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-400">
                Total journey
              </span>
              <span className="text-lg font-semibold tracking-tight text-ink-900 tnum">
                {Math.round(total)} min
              </span>
            </div>

            {hasBreakdown && (
              <>
                <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-paper-200">
                  <span
                    className="h-full bg-route-600"
                    style={{ width: `${drivingPercent}%` }}
                  />
                  {stopsWithDwell.length > 0 ? (
                    stopsWithDwell.map((stop, index) => (
                      <span
                        key={`${stop.name}-${index}`}
                        className="h-full border-l border-white/70 bg-stop-500"
                        style={{ width: `${(stop.durationMinutes / total) * 100}%` }}
                      />
                    ))
                  ) : (
                    <span
                      className="h-full bg-stop-500"
                      style={{ width: `${(stopTotal! / total) * 100}%` }}
                    />
                  )}
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px] text-ink-500">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-route-600" aria-hidden="true" />
                    Driving{" "}
                    <strong className="font-semibold text-ink-800 tnum">
                      {Math.round(driving!)} min
                    </strong>
                  </span>
                  {stopsWithDwell.length > 0 ? (
                    stopsWithDwell.map((stop, index) => (
                      <span
                        key={`${stop.name}-legend-${index}`}
                        className="inline-flex items-center gap-1.5 text-stop-700"
                      >
                        <span
                          className="h-1.5 w-1.5 rounded-full bg-stop-500"
                          aria-hidden="true"
                        />
                        {stop.name}{" "}
                        <strong className="font-semibold tnum">
                          {stop.durationMinutes} min stop
                        </strong>
                      </span>
                    ))
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-stop-700">
                      <span
                        className="h-1.5 w-1.5 rounded-full bg-stop-500"
                        aria-hidden="true"
                      />
                      Stops{" "}
                      <strong className="font-semibold tnum">{stopTotal} min stop</strong>
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {(plan.distanceKm !== undefined || bufferText) && (
          <div className="flex items-center justify-between gap-3 px-1 text-xs text-ink-500">
            {plan.distanceKm !== undefined ? (
              <span>
                Distance{" "}
                <strong className="font-semibold text-ink-800 tnum">
                  {plan.distanceKm.toFixed(1)} km
                </strong>
              </span>
            ) : (
              <span />
            )}
            {bufferText && (
              <span
                className={clsx(
                  "font-medium",
                  plan.bufferMinutes !== undefined && plan.bufferMinutes < 0
                    ? "text-rose-600"
                    : "text-ink-600"
                )}
              >
                {bufferText}
              </span>
            )}
          </div>
        )}
      </div>

      {(plan.origin || plan.destination || plan.stops?.length) && (
        <section aria-label="Itinerary" className="border-t border-paper-200 p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-400">
              Itinerary
            </h3>
            <span className="text-[10px] font-medium uppercase tracking-wide text-ink-400">
              {plan.stops?.length
                ? `${plan.stops.length} stop${plan.stops.length === 1 ? "" : "s"}`
                : "Direct"}
            </span>
          </div>

          <ol className="relative mt-2">
            <li className="flex items-center gap-2.5 py-1.5">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full border-2 border-emerald-600/30 bg-emerald-500"
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-ink-900">
                  {plan.origin?.name ?? "Origin"}
                </span>
                <span className="block text-[10px] uppercase tracking-wide text-ink-400">
                  Origin
                </span>
              </span>
              {departure && (
                <span className="text-[11px] font-medium text-ink-500 tnum">{departure}</span>
              )}
            </li>

            {plan.stops?.map((stop, index) => {
              const selected = selectedStopIndex === index;
              return (
                <li key={`${stop.name}-${index}`} className="relative pl-5">
                  <span
                    className="absolute left-[3px] top-0 h-full w-px bg-paper-300"
                    aria-hidden="true"
                  />
                  <button
                    type="button"
                    onClick={() => onSelectStop(index)}
                    aria-pressed={selected}
                    aria-label={`Select stop ${index + 1}: ${stop.name}`}
                    className={clsx(
                      "flex w-full items-center gap-2.5 rounded-lg border px-2 py-2 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-route-500",
                      selected
                        ? "border-stop-500/50 bg-stop-500/10"
                        : "border-transparent hover:border-paper-300 hover:bg-white"
                    )}
                  >
                    <span
                      className={clsx(
                        "grid h-6 w-6 shrink-0 place-items-center rounded-full border text-[11px] font-bold text-white",
                        selected
                          ? "border-amber-200 bg-stop-600"
                          : "border-amber-200/80 bg-stop-700"
                      )}
                      aria-hidden="true"
                    >
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink-900">
                        {stop.name}
                      </span>
                      <span className="block text-[10px] font-medium uppercase tracking-wide text-stop-700">
                        Stop {index + 1} · +{stop.durationMinutes} min
                      </span>
                    </span>
                    <span
                      className={clsx(
                        "text-[10px] font-semibold uppercase tracking-wide",
                        selected ? "text-stop-700" : "text-transparent"
                      )}
                      aria-hidden={!selected}
                    >
                      Selected
                    </span>
                  </button>
                </li>
              );
            })}

            <li className="flex items-center gap-2.5 py-1.5">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-[3px] border-2 border-route-300/50 bg-ink-900"
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-ink-900">
                  {plan.destination?.name ?? "Destination"}
                </span>
                <span className="block text-[10px] uppercase tracking-wide text-ink-400">
                  Destination
                </span>
              </span>
              {eta && (
                <span className="text-[11px] font-medium text-ink-500 tnum">{eta}</span>
              )}
            </li>
          </ol>

          {selectedStop && (
            <div
              role="status"
              className="animate-panel-in mt-3 flex items-start gap-2.5 rounded-xl border border-stop-500/40 bg-stop-500/10 p-3"
            >
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-stop-700" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-stop-700">
                  Selected stop
                </p>
                <p className="truncate text-sm font-semibold text-ink-900">
                  {selectedStop.name}
                </p>
                <p className="mt-0.5 text-xs text-ink-500">
                  Stop {(selectedStopIndex ?? 0) + 1} · {selectedStop.durationMinutes} minutes on
                  site
                </p>
              </div>
              <button
                type="button"
                onClick={() => onSelectStop(null)}
                aria-label="Clear stop selection"
                className="rounded-md p-1 text-ink-400 transition-colors hover:bg-white hover:text-ink-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-route-500"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
        </section>
      )}

      {evaluations.length > 0 && (
        <section aria-label="Constraints" className="border-t border-paper-200 p-4">
          <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-400">
            Constraints
          </h3>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {evaluations.map((evaluation, index) => {
              const satisfied = evaluation.status === "satisfied";
              const violated = evaluation.status === "violated";
              return (
                <span
                  key={`${evaluation.type}-${index}`}
                  title={
                    plan.stale
                      ? "From the last successful route"
                      : evaluation.reason ?? undefined
                  }
                  className={clsx(
                    "inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium",
                    plan.stale && "border-stop-500/30 bg-stop-500/5 text-ink-500",
                    !plan.stale && satisfied && "border-emerald-200 bg-emerald-50 text-emerald-800",
                    !plan.stale && violated && "border-rose-200 bg-rose-50 text-rose-700",
                    !plan.stale &&
                      !satisfied &&
                      !violated &&
                      "border-paper-300 bg-paper-100 text-ink-500"
                  )}
                >
                  <span aria-hidden="true" className="font-bold">
                    {statusGlyph(evaluation.status)}
                  </span>{" "}
                  <span>{constraintLabel(evaluation.type)}</span>
                  {violated && <span className="font-semibold">violated</span>}
                  {!satisfied && !violated && <span>not evaluated</span>}
                </span>
              );
            })}
          </div>
          {plan.stale && (
            <p className="mt-2 text-[11px] text-ink-400">
              Constraint checks above belong to the last successful route, not the failed
              recalculation.
            </p>
          )}
        </section>
      )}

      {evaluations.length === 0 && requestedConstraints.length > 0 && (
        <section aria-label="Requested constraints" className="border-t border-paper-200 p-4">
          <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-400">
            Requested constraints
          </h3>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {requestedConstraints.map((constraint, index) => (
              <span
                key={`${constraint.type}-${index}`}
                className="inline-flex items-center gap-1 rounded-lg border border-paper-300 bg-paper-100 px-2 py-1 text-[11px] font-medium text-ink-500"
              >
                <span aria-hidden="true" className="font-bold">
                  ○
                </span>
                <span>{constraintLabel(constraint.type)}</span>
                <span>not evaluated</span>
              </span>
            ))}
          </div>
        </section>
      )}

      {visibleWarnings.length > 0 && (
        <div className="border-t border-stop-500/30 bg-stop-500/10 p-4">
          <div className="flex items-start gap-2 text-xs text-amber-950">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-stop-700" aria-hidden="true" />
            <div>
              <p className="font-semibold">Warnings</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {visibleWarnings.map((warning, index) => (
                  <li key={index}>{warning}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
