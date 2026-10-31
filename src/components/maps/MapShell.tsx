"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { LeafletContext, createLeafletContext } from "@react-leaflet/core";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./leaflet.css";
import { DEFAULT_CENTER, DEFAULT_ZOOM, type LatLng } from "./config";

interface MapShellProps {
  children?: ReactNode;
  defaultCenter?: LatLng;
  defaultZoom?: number;
  /** Rendered above the map (controls, legends). Not affected by panning. */
  overlay?: ReactNode;
  className?: string;
}

/**
 * Shared map canvas. OpenStreetMap tiles via Leaflet, so the page does not
 * depend on a Google Maps key. The centre and zoom are only the first view;
 * FitBounds and PanTo move the camera after that.
 */
export default function MapShell({
  children,
  defaultCenter = DEFAULT_CENTER,
  defaultZoom = DEFAULT_ZOOM,
  overlay,
  className = "absolute inset-0 z-0 h-full w-full",
}: MapShellProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const initialView = useRef({ center: defaultCenter, zoom: defaultZoom });
  const [context, setContext] = useState<ReturnType<typeof createLeafletContext> | null>(null);

  useEffect(() => {
    const node = hostRef.current;
    if (!node) return;
    const { center, zoom } = initialView.current;
    const map = L.map(node, { zoomControl: false }).setView([center.lat, center.lng], zoom);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);
    L.control.zoom({ position: "bottomright" }).addTo(map);

    const fixSize = () => map.invalidateSize();
    const frame = requestAnimationFrame(fixSize);
    const observer = new ResizeObserver(fixSize);
    observer.observe(node);
    setContext(createLeafletContext(map));

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      map.remove();
      setContext(null);
    };
  }, []);

  return (
    <div className={className}>
      <div ref={hostRef} className="h-full w-full" />
      {context ? <LeafletContext value={context}>{children}</LeafletContext> : null}
      {overlay}
    </div>
  );
}
