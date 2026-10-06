/**
 * Decodes a Valhalla Polyline 6 string into an array of [longitude, latitude] coordinates.
 * @param str The encoded polyline string.
 * @param precision The coordinate precision (default 6 for Valhalla).
 * @returns Array of [lon, lat] pairs suitable for GeoJSON LineString.
 */
export function decodePolyline(str: string, precision: number = 6): [number, number][] {
    let index = 0, lat = 0, lng = 0;
    const coordinates: [number, number][] = [];
    let shift = 0, result = 0, byte = null, latitude_change, longitude_change;
    const factor = Math.pow(10, precision);

    while (index < str.length) {
        byte = null; shift = 0; result = 0;
        do {
            byte = str.charCodeAt(index++) - 63;
            result |= (byte & 0x1f) << shift;
            shift += 5;
        } while (byte >= 0x20);
        latitude_change = ((result & 1) ? ~(result >> 1) : (result >> 1));
        shift = result = 0;
        
        do {
            byte = str.charCodeAt(index++) - 63;
            result |= (byte & 0x1f) << shift;
            shift += 5;
        } while (byte >= 0x20);
        longitude_change = ((result & 1) ? ~(result >> 1) : (result >> 1));
        
        lat += latitude_change; 
        lng += longitude_change;
        
        coordinates.push([lng / factor, lat / factor]);
    }
    
    return coordinates;
}
