import type { TravelPlan } from "../types/api";
import { MapPin, Navigation } from "lucide-react";

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

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
          <MapPin className="w-5 h-5 text-blue-500" />
          Plan Details
        </h2>
        {plan.origin?.name && plan.destination?.name && (
          <p className="text-sm text-gray-600 mt-1">
            {plan.origin.name} → {plan.destination.name}
          </p>
        )}
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
            <span className="text-xs text-gray-500 font-medium uppercase tracking-wide">Duration</span>
            <span className="text-lg text-gray-800">{Math.round(plan.durationMinutes)} min</span>
          </div>
        )}

        {plan.distanceKm !== undefined && (
          <div className="flex flex-col">
            <span className="text-xs text-gray-500 font-medium uppercase tracking-wide">Distance</span>
            <span className="text-lg text-gray-800">{Math.round(plan.distanceKm)} km</span>
          </div>
        )}

        {plan.bufferMinutes !== undefined && plan.bufferMinutes > 0 && (
          <div className="flex flex-col">
            <span className="text-xs text-gray-500 font-medium uppercase tracking-wide">Buffer</span>
            <span className="text-lg text-green-600 font-medium">{plan.bufferMinutes} min</span>
          </div>
        )}
      </div>

      {plan.constraints && plan.constraints.length > 0 && (
        <div className="border-t border-gray-100 pt-4">
          <span className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-2 block">Constraints</span>
          <div className="flex flex-wrap gap-2">
            {plan.constraints.map((c, i) => (
              <span key={i} className="px-2 py-1 bg-blue-50 text-blue-700 text-xs rounded-full border border-blue-100 flex items-center gap-1">
                ✓ {c.type.replace('_', ' ')}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
