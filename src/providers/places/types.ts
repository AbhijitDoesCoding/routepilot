export interface Place {
  id: string;
  name: string;
  lat: number;
  lon: number;
  category: string;
  distanceToRouteMeters?: number;
}

export interface FindPlacesRequest {
  routeGeometry: any; // GeoJSON LineString
  category: string; // e.g., "coffee_shop" or "cafe"
  radiusMeters: number;
  limit?: number;
}

export interface PlacesProvider {
  findPlacesAlongRoute(request: FindPlacesRequest): Promise<Place[]>;
}
