import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { TravelPlan, Location } from "../types/api";

interface RouteMapProps {
  plan: TravelPlan | null;
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

export const RouteMap = ({ plan }: RouteMapProps) => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);

  // Initialize Map
  useEffect(() => {
    if (!mapContainer.current) return;
    if (map.current) return;

    const styleUrl = import.meta.env.VITE_MAP_STYLE_URL || "https://tiles.openfreemap.org/styles/liberty";

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: styleUrl,
      center: [73.8567, 18.5204],
      zoom: 10,
    });

    map.current.addControl(new maplibregl.NavigationControl(), "top-right");

    return () => {
      markersRef.current.forEach(m => m.remove());
      markersRef.current = [];
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // Update Map with Route
  useEffect(() => {
    if (!map.current || !plan) return;

    const currentMap = map.current;
    
    const updateMap = () => {
      // Ensure the map style is fully loaded before manipulating layers/sources
      if (!currentMap.isStyleLoaded()) {
        currentMap.once("load", updateMap);
        return;
      }

      // 1. Update Route Line
      if (isValidLineString(plan.routeGeometry)) {
        const source = currentMap.getSource("route") as maplibregl.GeoJSONSource;
        if (source) {
          source.setData(plan.routeGeometry);
          if (!currentMap.getLayer("route")) {
            currentMap.addLayer({
              id: "route",
              type: "line",
              source: "route",
              layout: {
                "line-join": "round",
                "line-cap": "round",
              },
              paint: {
                "line-color": "#2563eb",
                "line-width": 5,
                "line-opacity": 0.85,
              },
            });
          }
        } else {
          currentMap.addSource("route", {
            type: "geojson",
            data: plan.routeGeometry,
          });

          currentMap.addLayer({
            id: "route",
            type: "line",
            source: "route",
            layout: {
              "line-join": "round",
              "line-cap": "round",
            },
            paint: {
              "line-color": "#2563eb",
              "line-width": 5,
              "line-opacity": 0.85,
            },
          });
        }
      } else {
        // Clear route line if route geometry is absent or invalid
        const source = currentMap.getSource("route") as maplibregl.GeoJSONSource;
        if (source) {
          source.setData({
            type: "FeatureCollection",
            features: []
          });
        }
      }

      // 2. Clear old markers
      markersRef.current.forEach(m => m.remove());
      markersRef.current = [];

      // Helper to create a marker
      const addMarker = (loc: Location, color: string, label: string) => {
        if (
          typeof loc.lat !== "number" ||
          typeof loc.lon !== "number" ||
          !Number.isFinite(loc.lat) ||
          !Number.isFinite(loc.lon)
        ) {
          return;
        }
        const popup = new maplibregl.Popup({ offset: 25 });
        const displayName = loc.name ? `${label}: ${loc.name}` : label;
        popup.setText(displayName);
        const marker = new maplibregl.Marker({ color })
          .setLngLat([loc.lon, loc.lat])
          .setPopup(popup)
          .addTo(currentMap);
        markersRef.current.push(marker);
      };

      // 3. Add origin, destination, stops
      if (plan.origin) {
        addMarker(plan.origin, "#10b981", "Origin"); // green
      }
      if (plan.destination) {
        addMarker(plan.destination, "#ef4444", "Destination"); // red
      }
      if (plan.stops) {
        plan.stops.forEach((stop, idx) => {
          addMarker({ lat: stop.lat, lon: stop.lon, name: stop.name }, "#f59e0b", `Stop ${idx + 1}`); // amber
        });
      }

      // 4. Fit bounds
      if (isValidLineString(plan.routeGeometry)) {
        const coordinates = plan.routeGeometry.coordinates;
        const bounds = coordinates.reduce((b: maplibregl.LngLatBounds, coord: [number, number]) => {
          return b.extend(coord);
        }, new maplibregl.LngLatBounds(coordinates[0], coordinates[0]));

        currentMap.fitBounds(bounds, { padding: 50, maxZoom: 15 });
      } else if (plan.origin && plan.destination) {
        const bounds = new maplibregl.LngLatBounds(
          [plan.origin.lon, plan.origin.lat],
          [plan.destination.lon, plan.destination.lat]
        );
        currentMap.fitBounds(bounds, { padding: 50, maxZoom: 15 });
      }
    };

    updateMap();
  }, [plan]);

  return (
    <div ref={mapContainer} className="w-full h-full rounded-lg shadow-sm border border-gray-200" />
  );
};
