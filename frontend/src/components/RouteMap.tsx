import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { TravelPlan, Location } from "../types/api";

interface RouteMapProps {
  plan: TravelPlan | null;
}

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
      // 1. Update Route Line
      if (plan.routeGeometry) {
        const source = currentMap.getSource("route") as maplibregl.GeoJSONSource;
        if (source) {
          source.setData(plan.routeGeometry);
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
              "line-color": "#3b82f6",
              "line-width": 5,
            },
          });
        }
      }

      // 2. Clear old markers
      markersRef.current.forEach(m => m.remove());
      markersRef.current = [];

      // Helper to create a marker
      const addMarker = (loc: Location, color: string, label: string) => {
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
      if (plan.routeGeometry?.coordinates?.length > 0) {
        const coordinates = plan.routeGeometry.coordinates;
        const bounds = coordinates.reduce((b: maplibregl.LngLatBounds, coord: [number, number]) => {
          return b.extend(coord);
        }, new maplibregl.LngLatBounds(coordinates[0], coordinates[0]));

        currentMap.fitBounds(bounds, { padding: 50 });
      } else if (plan.origin && plan.destination) {
        const bounds = new maplibregl.LngLatBounds(
          [plan.origin.lon, plan.origin.lat],
          [plan.destination.lon, plan.destination.lat]
        );
        currentMap.fitBounds(bounds, { padding: 50 });
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
