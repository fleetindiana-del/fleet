"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Circle as LeafletCircle, Marker, Polyline as LeafletPolyline, useMap } from "react-leaflet";
import L from "leaflet";
import type { LatLng } from "./config";

export type { LatLng };

export type LineClickEvent = { latlng: { lat: number; lng: number } };

function pathKey(path: LatLng[]) {
  return path.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join("|");
}

export function Polyline({
  path,
  onClick,
  strokeColor = "#3388ff",
  strokeWeight = 3,
  strokeOpacity = 1,
  dashArray,
}: {
  path: LatLng[];
  onClick?: (event: LineClickEvent) => void;
  strokeColor?: string;
  strokeWeight?: number;
  strokeOpacity?: number;
  dashArray?: string;
}) {
  const positions = useMemo(
    () => path.map((p) => [p.lat, p.lng] as [number, number]),
    // The serialized key is the real dependency; `path` is a fresh array most renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pathKey(path)]
  );
  const pathOptions = useMemo(
    () => ({
      color: strokeColor,
      weight: strokeWeight,
      opacity: strokeOpacity,
      dashArray,
      lineCap: "round" as const,
      lineJoin: "round" as const,
    }),
    [strokeColor, strokeWeight, strokeOpacity, dashArray]
  );
  const eventHandlers = useMemo(
    () =>
      onClick
        ? {
            click: (event: L.LeafletMouseEvent) =>
              onClick({ latlng: { lat: event.latlng.lat, lng: event.latlng.lng } }),
          }
        : undefined,
    [onClick]
  );

  if (positions.length < 2) return null;
  return (
    <LeafletPolyline positions={positions} pathOptions={pathOptions} eventHandlers={eventHandlers} />
  );
}

export function Circle({
  center,
  radius,
  strokeColor = "#3388ff",
  strokeWeight = 2,
  strokeOpacity = 0.8,
  fillColor = strokeColor,
  fillOpacity = 0.1,
}: {
  center: LatLng;
  radius: number;
  strokeColor?: string;
  strokeWeight?: number;
  strokeOpacity?: number;
  fillColor?: string;
  fillOpacity?: number;
}) {
  const pathOptions = useMemo(
    () => ({
      color: strokeColor,
      weight: strokeWeight,
      opacity: strokeOpacity,
      fillColor,
      fillOpacity,
    }),
    [strokeColor, strokeWeight, strokeOpacity, fillColor, fillOpacity]
  );
  if (!(radius > 0) || !Number.isFinite(center.lat) || !Number.isFinite(center.lng)) return null;
  return (
    <LeafletCircle
      center={[center.lat, center.lng]}
      radius={radius}
      pathOptions={pathOptions}
      interactive={false}
    />
  );
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
  const pointsRef = useRef(points);
  pointsRef.current = points;
  const lastFitKey = useRef<string | null>(null);
  /** Pixel area the last fit was computed for. A later growth means that fit was premature. */
  const fittedArea = useRef(0);
  const key = pathKey(points);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let tries = 0;

    const fit = () => {
      const pts = pointsRef.current.filter(
        (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)
      );
      if (pts.length === 0) return false;
      map.invalidateSize();
      const size = map.getSize();
      // A tiny box makes fitBounds zoom all the way out, then the real layout
      // arrives and the world view sticks. Wait until the canvas has size.
      if (size.x < 80 || size.y < 80) return false;
      if (fitOnceKey !== undefined && fitOnceKey === lastFitKey.current && size.x * size.y <= fittedArea.current * 1.25) {
        return true;
      }
      if (fitOnceKey !== undefined) lastFitKey.current = fitOnceKey;
      fittedArea.current = size.x * size.y;
      // Padding is applied on every side. If it eats the whole canvas, Leaflet
      // collapses the zoom to 0 and the map shows the world.
      const pad = Math.min(padding, Math.max(8, Math.floor(Math.min(size.x, size.y) / 4)));
      const animate = false;
      if (pts.length === 1) {
        map.setView([pts[0].lat, pts[0].lng], Math.min(Math.max(map.getZoom(), 15), maxZoom), {
          animate,
        });
        return true;
      }
      const bounds = L.latLngBounds(pts.map((p) => [p.lat, p.lng] as [number, number]));
      map.fitBounds(bounds, { padding: [pad, pad], maxZoom, animate });
      return true;
    };

    const run = () => {
      if (cancelled) return;
      if (!fit() && tries < 40) {
        tries += 1;
        requestAnimationFrame(run);
      }
    };

    const onResize = () => {
      const size = map.getSize();
      const area = size.x * size.y;
      // Only recover a fit that ran before the canvas had its real size.
      // A normal window resize should leave a route the user has panned alone.
      const premature = fittedArea.current > 0 && fittedArea.current < 200 * 200 && area > fittedArea.current * 1.25;
      if (fittedArea.current === 0 || premature) {
        if (fitOnceKey !== undefined) lastFitKey.current = null;
        fit();
      }
    };

    run();
    map.on("resize", onResize);
    return () => {
      cancelled = true;
      map.off("resize", onResize);
    };
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
    if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return;
    const zoom = Math.max(map.getZoom(), minZoom);
    map.setView([point.lat, point.lng], zoom, { animate: true });
  }, [map, point?.lat, point?.lng, minZoom]);
  return null;
}

/**
 * React content drawn as the marker icon. Leaflet only accepts DOM for a
 * divIcon, so the children are portaled into an element the icon owns.
 */
export function DivMarker({
  position,
  width,
  height,
  anchorX,
  anchorY,
  zIndex = 0,
  title,
  onClick,
  children,
}: {
  position: LatLng;
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
  zIndex?: number;
  title?: string;
  onClick?: () => void;
  children: ReactNode;
}) {
  const [host] = useState<HTMLDivElement | null>(() => {
    if (typeof document === "undefined") return null;
    const el = document.createElement("div");
    el.className = "group relative h-full w-full";
    return el;
  });
  const icon = useMemo(() => {
    if (!host) return null;
    return L.divIcon({
      className: "fleet-marker",
      html: host,
      iconSize: [width, height],
      iconAnchor: [anchorX, anchorY],
    });
  }, [host, width, height, anchorX, anchorY]);

  if (!host || !icon || !Number.isFinite(position.lat) || !Number.isFinite(position.lng)) return null;

  return (
    <>
      <Marker
        position={[position.lat, position.lng]}
        icon={icon}
        zIndexOffset={zIndex}
        title={title}
        eventHandlers={onClick ? { click: () => onClick() } : undefined}
      />
      {createPortal(children, host)}
    </>
  );
}

/** Popup anchored at a coordinate. Closing it (the ×, or a click on the map) calls onClose. */
export function MapPopup({
  position,
  open,
  onClose,
  offsetX = 0,
  offsetY = -16,
  children,
}: {
  position: LatLng;
  open: boolean;
  onClose: () => void;
  offsetX?: number;
  offsetY?: number;
  children: ReactNode;
}) {
  const map = useMap();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [host] = useState<HTMLDivElement | null>(() =>
    typeof document === "undefined" ? null : document.createElement("div")
  );
  const popupRef = useRef<L.Popup | null>(null);

  useEffect(() => {
    if (!open || !host) return;
    const popup = L.popup({
      autoPan: true,
      closeButton: true,
      maxWidth: 340,
      minWidth: 180,
      className: "fleet-popup",
      offset: L.point(offsetX, offsetY),
    })
      .setLatLng([position.lat, position.lng])
      .setContent(host)
      .openOn(map);
    popupRef.current = popup;

    const handleClose = (event: L.LeafletEvent) => {
      if ((event as L.PopupEvent).popup !== popup) return;
      onCloseRef.current();
    };
    map.on("popupclose", handleClose);
    return () => {
      map.off("popupclose", handleClose);
      popupRef.current = null;
      if (popup.isOpen()) popup.remove();
    };
    // Position and offset are applied by the effect below so a moving marker
    // does not tear the popup down and fire a false close.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, map, host]);

  useEffect(() => {
    const popup = popupRef.current;
    if (!popup || !open) return;
    popup.options.offset = L.point(offsetX, offsetY);
    popup.setLatLng([position.lat, position.lng]);
  }, [open, position.lat, position.lng, offsetX, offsetY]);

  if (!open || !host) return null;
  return createPortal(children, host);
}

function arrowMarkup(color: string, heading: number) {
  const safe = /^#[0-9a-fA-F]{3,8}$/.test(color) ? color : "#6366f1";
  return `<div style="width:14px;height:14px;transform:rotate(${heading.toFixed(1)}deg);filter:drop-shadow(0 1px 1px rgba(0,0,0,.35))"><svg width="14" height="14" viewBox="0 0 24 24"><path d="M12 3 L20 21 L12 17 L4 21 Z" fill="${safe}" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg></div>`;
}

function sampleArrows(map: L.Map, path: LatLng[], everyPx: number) {
  if (path.length < 2 || map.getSize().y === 0) return [];
  const projected = path.map((p) => map.latLngToLayerPoint([p.lat, p.lng]));
  let total = 0;
  for (let i = 1; i < projected.length; i++) total += projected[i].distanceTo(projected[i - 1]);
  if (total < 24) return [];
  const step = Math.max(everyPx, total / 64);
  const arrows: { lat: number; lng: number; heading: number }[] = [];
  let carry = step * 0.5;
  for (let i = 1; i < projected.length; i++) {
    const a = projected[i - 1];
    const b = projected[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) continue;
    const heading = (Math.atan2(dx, -dy) * 180) / Math.PI;
    let dist = carry;
    while (dist <= len && arrows.length < 64) {
      const t = dist / len;
      const latlng = map.layerPointToLatLng(L.point(a.x + dx * t, a.y + dy * t));
      arrows.push({ lat: latlng.lat, lng: latlng.lng, heading });
      dist += step;
    }
    carry = dist - len;
    if (arrows.length >= 64) break;
  }
  return arrows;
}

/** Small direction chevrons spaced along a route, in screen pixels so zoom stays readable. */
export function RouteArrows({
  path,
  color,
  everyPx = 110,
}: {
  path: LatLng[];
  color: string;
  everyPx?: number;
}) {
  const map = useMap();
  const pathRef = useRef(path);
  pathRef.current = path;
  const key = pathKey(path);

  useEffect(() => {
    const group = L.layerGroup().addTo(map);
    let frame = 0;
    const draw = () => {
      group.clearLayers();
      for (const arrow of sampleArrows(map, pathRef.current, everyPx)) {
        const icon = L.divIcon({
          className: "fleet-arrow",
          html: arrowMarkup(color, arrow.heading),
          iconSize: [14, 14],
          iconAnchor: [7, 7],
        });
        group.addLayer(
          L.marker([arrow.lat, arrow.lng], { icon, interactive: false, keyboard: false })
        );
      }
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(draw);
    };
    schedule();
    map.on("zoomend", schedule);
    return () => {
      cancelAnimationFrame(frame);
      map.off("zoomend", schedule);
      map.removeLayer(group);
    };
  }, [map, key, color, everyPx]);

  return null;
}
