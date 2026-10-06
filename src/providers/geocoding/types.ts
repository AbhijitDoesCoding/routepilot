export interface Location {
  name: string;
  lat: number;
  lon: number;
  address?: string;
}

export interface GeocodeProvider {
  search(query: string): Promise<Location[]>;
}
