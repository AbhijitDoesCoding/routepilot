import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { TravelPlan } from "../types/api";

interface RouteMapProps {
  plan: TravelPlan | null;
}

export const RouteMap = ({ plan }: RouteMapProps) => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);

  // Initialize Map
  useEffect(() => {
    if (!mapContainer.current) return;
    if (map.current) return;

    const styleUrl = import.meta.env.VITE_MAP_STYLE_URL || "https://tiles.openfreemap.org/styles/liberty";

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: styleUrl,
      center: [73.8567, 18.5204], // Pune default
      zoom: 10,
    });

    map.current.addControl(new maplibregl.NavigationControl(), "top-right");

    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // Update Map with Route
  useEffect(() => {
    if (!map.current || !plan?.routeGeometry) return;

    const currentMap = map.current;
    
    // Ensure map is loaded before adding sources
    const updateMap = () => {
      // Remove old layers/sources
      if (currentMap.getLayer("route")) currentMap.removeLayer("route");
      if (currentMap.getSource("route")) currentMap.removeSource("route");

      // Add new route
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
          "line-color": "#3b82f6", // blue-500
          "line-width": 5,
        },
      });

      // Fit bounds
      const coordinates = plan.routeGeometry.coordinates;
      if (coordinates && coordinates.length > 0) {
        const bounds = coordinates.reduce((b: maplibregl.LngLatBounds, coord: [number, number]) => {
          return b.extend(coord);
        }, new maplibregl.LngLatBounds(coordinates[0], coordinates[0]));

        currentMap.fitBounds(bounds, {
          padding: 50,
        });
      }
    };

    if (currentMap.isStyleLoaded()) {
      updateMap();
    } else {
      currentMap.once("styledata", updateMap);
    }
  }, [plan]);

  return (
    <div ref={mapContainer} className="w-full h-full rounded-lg shadow-sm border border-gray-200" />
  );
};
