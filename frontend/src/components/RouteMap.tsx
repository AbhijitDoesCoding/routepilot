import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { TravelPlan, Location } from "../types/api";

interface RouteMapProps {
  plan: TravelPlan | null;
  selectedStopIndex: number | null;
  onSelectStop: (index: number | null) => void;
  fitSignal: number;
}

interface MarkerEntry {
  marker: maplibregl.Marker;
  el: HTMLButtonElement;
  stopIndex: number | null;
}

const isValidLineString = (geom: any): boolean => {
  if (!geom || geom.type !== "LineString" || !Array.isArray(geom.coordinates)) {
    return false;
  }
  if (geom.coordinates.length < 2) {
    return false;
  }
  return geom.coordinates.every((coord: any) =>
    Array.isArray(coord) &&
    coord.length >= 2 &&
    typeof coord[0] === "number" &&
    typeof coord[1] === "number" &&
    Number.isFinite(coord[0]) &&
    Number.isFinite(coord[1]) &&
    coord[0] >= -180 &&
    coord[0] <= 180 &&
    coord[1] >= -90 &&
    coord[1] <= 90
  );
};

const hasValidLocation = (loc?: Location | null): loc is Location =>
  !!loc &&
  typeof loc.lat === "number" &&
  typeof loc.lon === "number" &&
  Number.isFinite(loc.lat) &&
  Number.isFinite(loc.lon) &&
  loc.lat >= -90 &&
  loc.lat <= 90 &&
  loc.lon >= -180 &&
  loc.lon <= 180;

const planBounds = (plan: TravelPlan): maplibregl.LngLatBounds | null => {
  if (isValidLineString(plan.routeGeometry)) {
    const coordinates = plan.routeGeometry.coordinates as [number, number][];
    return coordinates.reduce(
      (bounds, coord) => bounds.extend(coord),
      new maplibregl.LngLatBounds(coordinates[0], coordinates[0])
    );
  }

  const points: [number, number][] = [];
  if (hasValidLocation(plan.origin)) points.push([plan.origin.lon, plan.origin.lat]);
  if (hasValidLocation(plan.destination)) points.push([plan.destination.lon, plan.destination.lat]);
  plan.stops?.forEach((stop) => {
    if (hasValidLocation(stop)) points.push([stop.lon, stop.lat]);
  });
  if (!points.length) return null;

  return points.reduce(
    (bounds, coord) => bounds.extend(coord),
    new maplibregl.LngLatBounds(points[0], points[0])
  );
};

const fitKeyForPlan = (plan: TravelPlan): string => {
  if (isValidLineString(plan.routeGeometry)) {
    const coords = plan.routeGeometry.coordinates as [number, number][];
    const first = coords[0];
    const last = coords[coords.length - 1];
    return `line:${coords.length}:${first[0]},${first[1]}:${last[0]},${last[1]}`;
  }
  return [
    plan.origin?.lon,
    plan.origin?.lat,
    plan.destination?.lon,
    plan.destination?.lat,
    ...(plan.stops ?? []).flatMap((stop) => [stop.lon, stop.lat]),
  ].join(":");
};

/** Leave room for the floating trip panel on wide layouts and map controls. */
const fitMapToPlan = (
  currentMap: maplibregl.Map,
  plan: TravelPlan,
  animate: boolean
) => {
  const bounds = planBounds(plan);
  if (!bounds) return;

  const width = currentMap.getContainer().clientWidth;
  const wide = width >= 700;

  currentMap.fitBounds(bounds, {
    padding: {
      top: 64,
      bottom: wide ? 72 : 96,
      left: wide ? Math.min(430, Math.round(width * 0.48)) : 40,
      right: 64,
    },
    maxZoom: 15,
    duration: animate ? 650 : 0,
  });
};

export const RouteMap = ({
  plan,
  selectedStopIndex,
  onSelectStop,
  fitSignal,
}: RouteMapProps) => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<MarkerEntry[]>([]);
  const latestPlan = useRef(plan);
  const selectedRef = useRef(selectedStopIndex);
  const onSelectRef = useRef(onSelectStop);
  const userAdjusted = useRef(false);
  const lastFitKey = useRef<string | null>(null);

  // Keep callbacks and the newest plan available to queued style-load callbacks.
  useEffect(() => {
    latestPlan.current = plan;
    selectedRef.current = selectedStopIndex;
    onSelectRef.current = onSelectStop;
  });

  // Initialize Map once. Panning or zooming records that the user owns the view.
  useEffect(() => {
    if (!mapContainer.current) return;
    if (map.current) return;

    const styleUrl = import.meta.env.VITE_MAP_STYLE_URL || "https://tiles.openfreemap.org/styles/liberty";

    const currentMap = new maplibregl.Map({
      container: mapContainer.current,
      style: styleUrl,
      center: [73.8567, 18.5204],
      zoom: 10,
    });
    map.current = currentMap;

    currentMap.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      "top-right"
    );

    const markUserAdjusted = () => {
      userAdjusted.current = true;
    };
    currentMap.on("dragstart", markUserAdjusted);
    currentMap.on("wheel", markUserAdjusted);
    currentMap.on("touchmove", markUserAdjusted);

    // The chat panel and mobile tabs resize the map without a window resize.
    let resizeFrame = 0;
    const resizeObserver = new ResizeObserver(() => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        const currentMap = map.current;
        if (!currentMap) return;
        currentMap.resize();

        // Chat collapse and mobile tab switches change the usable map area.
        const currentPlan = latestPlan.current;
        if (currentPlan && !userAdjusted.current) {
          fitMapToPlan(currentMap, currentPlan, false);
        }
      });
    });
    resizeObserver.observe(mapContainer.current);

    return () => {
      resizeObserver.disconnect();
      cancelAnimationFrame(resizeFrame);
      currentMap.off("dragstart", markUserAdjusted);
      currentMap.off("wheel", markUserAdjusted);
      currentMap.off("touchmove", markUserAdjusted);
      markersRef.current.forEach(({ marker }) => marker.remove());
      markersRef.current = [];
      map.current?.remove();
      map.current = null;
      lastFitKey.current = null;
    };
  }, []);

  // Update route geometry, markers, and (when appropriate) the viewport.
  useEffect(() => {
    if (!map.current || !plan) return;

    const currentMap = map.current;
    let cancelled = false;

    const updateMap = () => {
      if (cancelled) return;

      // Style-load callbacks can outlive the render that queued them. Always
      // apply the newest plan so a later turn cannot restore stale markers.
      const nextPlan = latestPlan.current;
      if (!nextPlan) return;

      if (!currentMap.isStyleLoaded()) {
        currentMap.once("load", updateMap);
        return;
      }

      const hasRoute = isValidLineString(nextPlan.routeGeometry);
      const routeSource = currentMap.getSource("route") as maplibregl.GeoJSONSource | undefined;

      if (hasRoute) {
        if (routeSource) {
          routeSource.setData(nextPlan.routeGeometry);
        } else {
          currentMap.addSource("route", {
            type: "geojson",
            data: nextPlan.routeGeometry,
          });
        }

        // A soft casing keeps the cyan route legible over the light basemap.
        if (!currentMap.getLayer("route-casing")) {
          const before = currentMap.getLayer("route") ? "route" : undefined;
          currentMap.addLayer(
            {
              id: "route-casing",
              type: "line",
              source: "route",
              layout: { "line-join": "round", "line-cap": "round" },
              paint: {
                "line-color": nextPlan.stale ? "#78350f" : "#0e7490",
                "line-width": 9,
                "line-opacity": nextPlan.stale ? 0.16 : 0.26,
              },
            },
            before
          );
        }

        if (!currentMap.getLayer("route")) {
          currentMap.addLayer({
            id: "route",
            type: "line",
            source: "route",
            layout: { "line-join": "round", "line-cap": "round" },
            paint: {
              "line-color": nextPlan.stale ? "#f59e0b" : "#06b6d4",
              "line-width": 5,
              "line-opacity": nextPlan.stale ? 0.65 : 0.95,
            },
          });
        }

        currentMap.setPaintProperty(
          "route-casing",
          "line-color",
          nextPlan.stale ? "#78350f" : "#0e7490"
        );
        currentMap.setPaintProperty(
          "route-casing",
          "line-opacity",
          nextPlan.stale ? 0.16 : 0.26
        );
        currentMap.setPaintProperty(
          "route",
          "line-color",
          nextPlan.stale ? "#f59e0b" : "#06b6d4"
        );
        currentMap.setPaintProperty(
          "route",
          "line-opacity",
          nextPlan.stale ? 0.65 : 0.95
        );
      } else if (routeSource) {
        routeSource.setData({ type: "FeatureCollection", features: [] });
      }

      markersRef.current.forEach(({ marker }) => marker.remove());
      markersRef.current = [];

      const createMarkerElement = (
        kind: "origin" | "stop" | "destination",
        label: string,
        name: string | undefined,
        stopIndex: number | null
      ) => {
        const el = document.createElement("button");
        el.type = "button";
        el.className = `map-marker map-marker--${kind}`;
        const accessibleName = name ? `${label}: ${name}` : label;
        el.setAttribute(
          "aria-label",
          kind === "stop" ? `Map marker — ${accessibleName}` : accessibleName
        );
        el.title = accessibleName;

        if (kind === "stop" && stopIndex !== null) {
          el.textContent = String(stopIndex + 1);
          const selected = selectedRef.current === stopIndex;
          el.classList.toggle("is-selected", selected);
          el.setAttribute("aria-pressed", String(selected));
          el.addEventListener("click", () => onSelectRef.current(stopIndex));
        }

        return el;
      };

      const addMarker = (
        location: Location,
        kind: "origin" | "stop" | "destination",
        label: string,
        stopIndex: number | null = null
      ) => {
        if (!hasValidLocation(location)) return;

        const el = createMarkerElement(kind, label, location.name, stopIndex);
        const popup = new maplibregl.Popup({ offset: 22, closeButton: false });
        popup.setText(location.name ? `${label}: ${location.name}` : label);

        const marker = new maplibregl.Marker({ element: el })
          .setLngLat([location.lon, location.lat])
          .setPopup(popup)
          .addTo(currentMap);

        markersRef.current.push({ marker, el, stopIndex });
      };

      // Preserve DOM order the existing browser suite relies on: origin,
      // destination, then numbered stops.
      if (nextPlan.origin) addMarker(nextPlan.origin, "origin", "Origin");
      if (nextPlan.destination) addMarker(nextPlan.destination, "destination", "Destination");
      nextPlan.stops?.forEach((stop, index) => {
        addMarker(
          { name: stop.name, lat: stop.lat, lon: stop.lon },
          "stop",
          `Stop ${index + 1}`,
          index
        );
      });

      const fitKey = fitKeyForPlan(nextPlan);
      const firstRouteFit = lastFitKey.current === null;
      if (fitKey !== lastFitKey.current) {
        if (firstRouteFit || !userAdjusted.current) {
          fitMapToPlan(currentMap, nextPlan, !firstRouteFit);
        }
        lastFitKey.current = fitKey;
      }
    };

    updateMap();

    return () => {
      cancelled = true;
    };
  }, [plan]);

  // Highlight the selected stop and bring it into view.
  useEffect(() => {
    markersRef.current.forEach(({ el, stopIndex }) => {
      if (stopIndex === null) return;
      const selected = stopIndex === selectedStopIndex;
      el.classList.toggle("is-selected", selected);
      el.setAttribute("aria-pressed", String(selected));
    });

    const selectedStop =
      selectedStopIndex === null ? null : latestPlan.current?.stops?.[selectedStopIndex];
    if (!map.current || !selectedStop) return;

    const currentMap = map.current;
    const width = currentMap.getContainer().clientWidth;
    const height = currentMap.getContainer().clientHeight;
    const wide = width >= 700;

    currentMap.easeTo({
      center: [selectedStop.lon, selectedStop.lat],
      zoom: Math.max(currentMap.getZoom(), 13),
      padding: {
        top: 48,
        bottom: wide ? 48 : Math.min(320, Math.round(height * 0.42)),
        left: wide ? Math.min(380, Math.round(width * 0.46)) : 24,
        right: 48,
      },
      duration: 650,
    });
  }, [selectedStopIndex]);

  // "Fit full route" from the map or a contextual action.
  useEffect(() => {
    if (fitSignal === 0 || !map.current) return;
    const currentPlan = latestPlan.current;
    if (!currentPlan) return;

    fitMapToPlan(map.current, currentPlan, true);
    userAdjusted.current = false;
    lastFitKey.current = fitKeyForPlan(currentPlan);
  }, [fitSignal]);

  return <div ref={mapContainer} className="h-full w-full" aria-label="Route map" />;
};
