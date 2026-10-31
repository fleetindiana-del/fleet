/** Shared map defaults. Tiles come from OpenStreetMap through Leaflet. */

export type LatLng = { lat: number; lng: number };

/** Geographic centre of India — the fallback view when there is nothing to show. */
export const DEFAULT_CENTER: LatLng = { lat: 20.5937, lng: 78.9629 };
export const DEFAULT_ZOOM = 5;
