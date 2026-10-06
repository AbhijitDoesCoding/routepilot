import type { TravelPlan, ConstraintEvaluation } from "../types/api";
import { MapPin, Navigation } from "lucide-react";
import clsx from "clsx";

export const TravelPlanCard = ({ plan }: { plan: TravelPlan | null }) => {
  if (!plan) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-6 flex flex-col items-center justify-center text-gray-500 min-h-64 shadow-sm">
        <Navigation className="w-12 h-12 mb-4 text-gray-300" />
        <p>No active travel plan.</p>
      </div>
    );
  }

  const formatTime = (isoString?: string) => {
    if (!isoString) return null;
    return new Date(isoString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const renderBuffer = (buffer?: number) => {
    if (buffer === undefined) return null;
    if (buffer > 0) return <span className="text-lg text-green-600 font-medium">{buffer} min buffer</span>;
    if (buffer === 0) return <span className="text-lg text-gray-800 font-medium">0 min buffer</span>;
    return <span className="text-lg text-red-600 font-medium">{Math.abs(buffer)} min late</span>;
  };

  const renderConstraintIcon = (status: string) => {
    if (status === "satisfied") return <span className="text-green-600 font-bold mr-1">✓</span>;
    if (status === "violated") return <span className="text-red-600 font-bold mr-1">⚠</span>;
    return <span className="text-gray-400 font-bold mr-1">○</span>; // not evaluable
  };

  const renderConstraint = (evalData: ConstraintEvaluation, idx: number) => {
    const label = evalData.type.replace(/_/g, ' ');
    const isViolated = evalData.status === "violated";
    const isSatisfied = evalData.status === "satisfied";

    return (
      <div key={idx} className={clsx(
        "px-2 py-1 text-xs rounded-full border flex items-center gap-1 capitalize",
        isSatisfied && "bg-green-50 text-green-700 border-green-200",
        isViolated && "bg-red-50 text-red-700 border-red-200",
        !isSatisfied && !isViolated && "bg-gray-50 text-gray-700 border-gray-200"
      )}>
        {renderConstraintIcon(evalData.status)} {label} {isViolated && "unavailable"}
      </div>
    );
  };

  const routeTitle = (): string => {
    if (!plan.origin?.name && !plan.destination?.name) return "Route Selected";
    const parts: string[] = [];
    if (plan.origin?.name) parts.push(plan.origin.name);
    if (plan.stops?.length) {
      plan.stops.forEach(s => parts.push(s.name));
    }
    if (plan.destination?.name) parts.push(plan.destination.name);
    return parts.join(" → ");
  };

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm flex flex-col gap-6">
      <div>
        <h2 className="text-xs text-gray-500 font-bold tracking-wide uppercase mb-1">
          Recommended Plan
        </h2>
        <p className="text-lg font-bold text-gray-900 flex items-center gap-2">
          <MapPin className="w-5 h-5 text-blue-500 shrink-0" />
          <span>{routeTitle()}</span>
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {plan.departureTime && (
          <div className="flex flex-col">
            <span className="text-xs text-gray-500 font-medium uppercase tracking-wide">Leave</span>
            <span className="text-xl font-semibold text-gray-900">{formatTime(plan.departureTime)}</span>
          </div>
        )}
        
        {plan.actualEta && (
          <div className="flex flex-col">
            <span className="text-xs text-gray-500 font-medium uppercase tracking-wide">Arrive</span>
            <span className="text-xl font-semibold text-gray-900">{formatTime(plan.actualEta)}</span>
          </div>
        )}

        {plan.durationMinutes !== undefined && (
          <div className="flex flex-col">
            <span className="text-xs text-gray-500 font-medium uppercase tracking-wide">Travel Time</span>
            <span className="text-lg text-gray-800">{Math.round(plan.durationMinutes)} min</span>
          </div>
        )}

        {plan.distanceKm !== undefined && (
          <div className="flex flex-col">
            <span className="text-xs text-gray-500 font-medium uppercase tracking-wide">Distance</span>
            <span className="text-lg text-gray-800">{plan.distanceKm.toFixed(1)} km</span>
          </div>
        )}

        {plan.drivingDurationMinutes !== undefined && plan.stopDurationMinutes !== undefined && plan.stopDurationMinutes > 0 && (
          <>
            <div className="flex flex-col">
              <span className="text-xs text-gray-500 font-medium uppercase tracking-wide">Driving</span>
              <span className="text-lg text-gray-800">{Math.round(plan.drivingDurationMinutes)} min</span>
            </div>
            {plan.stops?.map((stop, i) => (
              <div key={i} className="flex flex-col">
                <span className="text-xs text-amber-600 font-medium uppercase tracking-wide">{stop.name}</span>
                <span className="text-lg text-amber-700">{stop.durationMinutes} min stop</span>
              </div>
            ))}
          </>
        )}

        {plan.bufferMinutes !== undefined && (
          <div className="flex flex-col col-span-2">
            <span className="text-xs text-gray-500 font-medium uppercase tracking-wide">Buffer</span>
            {renderBuffer(plan.bufferMinutes)}
          </div>
        )}
      </div>

      {plan.constraintEvaluations && plan.constraintEvaluations.length > 0 && (
        <div className="border-t border-gray-100 pt-4">
          <span className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-2 block">Constraints</span>
          <div className="flex flex-wrap gap-2">
            {plan.constraintEvaluations.map((c, i) => renderConstraint(c, i))}
          </div>
        </div>
      )}
      
      {(!plan.constraintEvaluations || plan.constraintEvaluations.length === 0) && plan.constraints && plan.constraints.length > 0 && (
        <div className="border-t border-gray-100 pt-4">
          <span className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-2 block">Constraints (Requested)</span>
          <div className="flex flex-wrap gap-2">
            {plan.constraints.map((c, i) => (
              <span key={i} className="px-2 py-1 bg-gray-50 text-gray-700 text-xs rounded-full border border-gray-200 capitalize flex items-center gap-1">
                {c.type.replace(/_/g, ' ')}
              </span>
            ))}
          </div>
        </div>
      )}

      {plan.warnings && plan.warnings.length > 0 && (
        <div className="bg-yellow-50 text-yellow-800 p-3 rounded-lg text-sm border border-yellow-200">
          <strong>Warnings:</strong>
          <ul className="list-disc pl-4 mt-1">
            {plan.warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
};
