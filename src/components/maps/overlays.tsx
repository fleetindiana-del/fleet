"use client";

import { useEffect, useMemo, useRef } from "react";
import { useMap, useMapsLibrary } from "@vis.gl/react-google-maps";

export type LatLng = google.maps.LatLngLiteral;

/**
 * Google Maps has no declarative Polyline/Circle components, so these wrap the
 * imperative overlay objects with React lifecycles. Options are re-applied on
 * change; the overlay is created once and removed on unmount.
 */
export function Polyline({
  path,
  onClick,
  ...options
}: {
  path: LatLng[];
  onClick?: (e: google.maps.PolyMouseEvent) => void;
} & google.maps.PolylineOptions) {
  const map = useMap();
  const mapsLib = useMapsLibrary("maps");
  const lineRef = useRef<google.maps.Polyline | null>(null);
  const clickRef = useRef(onClick);
  clickRef.current = onClick;

  // Serialize so a new array identity on every poll does not rebuild the path.
  const pathKey = useMemo(
    () => path.map((p) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`).join("|"),
    [path]
  );
  const optionsKey = JSON.stringify(options);

  useEffect(() => {
    if (!map || !mapsLib) return;
    const line = new mapsLib.Polyline();
    line.setMap(map);
    lineRef.current = line;
    const listener = line.addListener("click", (e: google.maps.PolyMouseEvent) =>
      clickRef.current?.(e)
    );
    return () => {
      listener.remove();
      line.setMap(null);
      lineRef.current = null;
    };
  }, [map, mapsLib]);

  useEffect(() => {
    const line = lineRef.current;
    if (!line) return;
    line.setOptions({ ...options, path, clickable: !!clickRef.current });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by serialized path/options
  }, [pathKey, optionsKey, mapsLib, map]);

  return null;
}

export function Circle({
  center,
  radius,
  ...options
}: {
  center: LatLng;
  radius: number;
} & google.maps.CircleOptions) {
  const map = useMap();
  const mapsLib = useMapsLibrary("maps");
  const circleRef = useRef<google.maps.Circle | null>(null);
  const optionsKey = JSON.stringify(options);

  useEffect(() => {
    if (!map || !mapsLib) return;
    const circle = new mapsLib.Circle({ clickable: false });
    circle.setMap(map);
    circleRef.current = circle;
    return () => {
      circle.setMap(null);
      circleRef.current = null;
    };
  }, [map, mapsLib]);

  useEffect(() => {
    circleRef.current?.setOptions({ ...options, center, radius });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by serialized options
  }, [center.lat, center.lng, radius, optionsKey, mapsLib, map]);

  return null;
}

/**
 * Fit the viewport to [points] whenever they meaningfully change.
 * Keyed on serialized coordinates so polling with fresh array identities does
 * not continuously re-fit the camera under the user.
 */
export function FitBounds({
  points,
  enabled,
  padding = 72,
  maxZoom = 16,
  fitOnceKey,
}: {
  points: LatLng[];
  enabled: boolean;
  padding?: number;
  maxZoom?: number;
  /**
   * When set, the camera fits only once per distinct value. Lets a trip view
   * frame a route on load without stealing the camera back on every refresh.
   */
  fitOnceKey?: string;
}) {
  const map = useMap();
  const lastFitKey = useRef<string | null>(null);
  const key = points.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join("|");

  useEffect(() => {
    if (!map || !enabled || points.length === 0) return;
    if (fitOnceKey !== undefined) {
      if (fitOnceKey === lastFitKey.current) return;
      lastFitKey.current = fitOnceKey;
    }

    if (points.length === 1) {
      map.setCenter(points[0]);
      map.setZoom(Math.max(map.getZoom() ?? 0, 15));
      return;
    }

    const bounds = new google.maps.LatLngBounds();
    points.forEach((p) => bounds.extend(p));
    map.fitBounds(bounds, padding);

    // fitBounds has no maxZoom argument — clamp once the camera settles.
    const listener = google.maps.event.addListenerOnce(map, "idle", () => {
      if ((map.getZoom() ?? 0) > maxZoom) map.setZoom(maxZoom);
    });
    return () => listener.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by serialized positions
  }, [map, enabled, key, padding, maxZoom, fitOnceKey]);

  return null;
}

/** Pan to a point when it changes, keeping at least [minZoom]. */
export function PanTo({
  point,
  minZoom = 15,
}: {
  point: LatLng | null | undefined;
  minZoom?: number;
}) {
  const map = useMap();
  useEffect(() => {
    if (!map || !point) return;
    map.panTo(point);
    if ((map.getZoom() ?? 0) < minZoom) map.setZoom(minZoom);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by coordinates, not object identity
  }, [map, point?.lat, point?.lng, minZoom]);
  return null;
}
