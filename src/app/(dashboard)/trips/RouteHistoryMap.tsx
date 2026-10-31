"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import MapShell from "@/components/maps/MapShell";
import {
  DivMarker,
  FitBounds,
  MapPopup,
  Polyline,
  RouteArrows,
  type LatLng,
  type LineClickEvent,
} from "@/components/maps/overlays";
import {
  type RoutePoint,
  type IdleEvent,
  type ViolationSegment,
  type MaxSpeed,
  type PointStatus,
  speedSegments,
  headingAt,
  speedKmh,
  batteryAt,
  idleEventAt,
  statusAt,
  distanceUpToKm,
  formatDuration,
  formatDurationPrecise,
  VIOLATION_COLOR,
  IDLE_COLOR,
} from "@/lib/routeAnalytics";

export type LocationPoint = RoutePoint;

export type FocusTarget =
  | { type: "point"; idx: number }
  | { type: "idle"; id: string }
  | { type: "violation"; id: string }
  | { type: "max"; idx: number }
  | { type: "bounds" }
  | null;

/** What's currently opened on the map — mirrored back to the sidebar so a
 * marker click highlights the matching Idle Stop / Event row, the same way a
 * sidebar click already pans/opens the marker (see FocusTarget). */
export type MapSelection =
  | { kind: "start" | "end" | "max" }
  | { kind: "idle"; id: string }
  | { kind: "violation"; id: string }
  | null;

interface Props {
  points: LocationPoint[];
  playbackIndex?: number | null;
  emptyCenter?: [number, number];
  deviceColor?: string;
  idleEvents?: IdleEvent[];
  violations?: ViolationSegment[];
  maxSpeed?: MaxSpeed | null;
  speedLimitKmh?: number;
  showIdle?: boolean;
  showViolations?: boolean;
  showMaxSpeed?: boolean;
  focus?: FocusTarget;
  onFocusConsumed?: () => void;
  onSelect?: (sel: MapSelection) => void;
}

const toLatLng = (p: [number, number]): LatLng => ({ lat: p[0], lng: p[1] });

function FocusController({
  focus,
  points,
  idleEvents,
  violations,
  onConsumed,
}: {
  focus: FocusTarget;
  points: LocationPoint[];
  idleEvents: IdleEvent[];
  violations: ViolationSegment[];
  onConsumed?: () => void;
}) {
  const map = useMap();
  useEffect(() => {
    if (!map || !focus) return;
    let target: LatLng | null = null;

    if (focus.type === "point" || focus.type === "max") {
      const p = points[focus.idx];
      if (p) target = { lat: p.latitude, lng: p.longitude };
    } else if (focus.type === "idle") {
      const e = idleEvents.find((x) => x.id === focus.id);
      if (e) target = { lat: e.latitude, lng: e.longitude };
    } else if (focus.type === "violation") {
      const v = violations.find((x) => x.id === focus.id);
      if (v) {
        const p = points[v.peakIdx] || points[v.startIdx];
        if (p) target = { lat: p.latitude, lng: p.longitude };
      }
    } else if (focus.type === "bounds" && points.length > 0) {
      const bounds = L.latLngBounds(
        points.map((p) => [p.latitude, p.longitude] as [number, number])
      );
      map.fitBounds(bounds, { padding: [100, 100], maxZoom: 16 });
      onConsumed?.();
      return;
    }

    if (target) {
      const zoom = Math.max(map.getZoom(), 16);
      map.setView([target.lat, target.lng], zoom, { animate: true });
    }
    onConsumed?.();
  }, [focus, map, points, idleEvents, violations, onConsumed]);
  return null;
}

function idleElapsedAt(point: LocationPoint, idle: IdleEvent | null): number {
  if (!idle) return 0;
  return Math.max(0, new Date(point.recordedAt).getTime() - new Date(idle.startTime).getTime());
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    day: "2-digit",
    month: "short",
  });
}

/**
 * Direction-of-travel arrow, rotated to the heading.
 *
 * The path is drawn so its bounding box is centred in the viewBox: the glyph is
 * anchored on the route point itself, and `rotate` pivots about the box centre,
 * so the arrow stays on the line at every heading instead of swinging off it.
 */
function ArrowGlyph({
  color,
  heading,
  size = 28,
}: {
  color: string;
  heading: number;
  size?: number;
}) {
  return (
    <div
      style={{
        width: size,
        height: size,
        transform: `rotate(${heading}deg)`,
        filter: "drop-shadow(0 1px 2px rgba(0,0,0,.45))",
      }}
    >
      <svg width={size} height={size} viewBox="0 0 24 24">
        <path
          d="M12 3 L20 21 L12 17 L4 21 Z"
          fill={color}
          stroke="#fff"
          strokeWidth={1.5}
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

function PinGlyph({
  color,
  glyph,
  size = 26,
}: {
  color: string;
  glyph: string;
  size?: number;
}) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: color,
        border: "2px solid #fff",
        boxShadow: "0 1px 4px rgba(0,0,0,.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#fff",
        fontSize: 11,
        fontWeight: 700,
        fontFamily: "system-ui, sans-serif",
      }}
    >
      {glyph}
    </div>
  );
}

/** Paused glyph shown in place of the arrow while the cursor sits inside a stop. */
function IdleGlyph({ size = 32 }: { size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: IDLE_COLOR,
        border: "3px solid #fff",
        boxShadow: "0 1px 6px rgba(0,0,0,.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#fff",
        fontSize: size * 0.45,
        fontWeight: 700,
      }}
    >
      ⏸
    </div>
  );
}

/** Marks the fix nearest a click anywhere on the drawn route. */
function InspectedPointGlyph({ size = 16 }: { size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: "#f59e0b",
        border: "2.5px solid #fff",
        boxShadow: "0 1px 4px rgba(0,0,0,.45)",
      }}
    />
  );
}

function batteryTone(pct: number): string {
  if (pct <= 15) return "text-rose-600";
  if (pct <= 35) return "text-amber-600";
  return "text-emerald-600";
}

export const STATUS_LABEL: Record<PointStatus, string> = {
  start: "Start",
  end: "End",
  idle: "Idle",
  moving: "Moving",
};

/** Tone for a light popup background. */
const STATUS_TONE_LIGHT: Record<PointStatus, string> = {
  start: "text-emerald-600",
  end: "text-rose-600",
  idle: "text-purple-600",
  moving: "text-sky-600",
};

/** Tone for a dark (CursorHoverCard) background. */
const STATUS_TONE: Record<PointStatus, string> = {
  start: "text-emerald-400",
  end: "text-rose-400",
  idle: "text-purple-300",
  moving: "text-sky-300",
};

/**
 * Readout that follows the route cursor. Rendered inside the marker so hovering
 * cannot flicker: the card is a child of the element being hovered, so it never
 * steals the pointer from it.
 */
function CursorHoverCard({
  point,
  battery,
  idle,
  idleElapsedMs,
  status,
  distanceKm,
}: {
  point: LocationPoint;
  battery: number | null;
  idle: IdleEvent | null;
  idleElapsedMs: number;
  status: PointStatus;
  distanceKm: number;
}) {
  return (
    <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 hidden -translate-x-1/2 group-hover:block">
      <div className="w-max min-w-[168px] rounded-lg bg-slate-900/95 px-2.5 py-2 font-sans text-[11px] leading-tight text-white shadow-lg">
        <DarkRow k="Status" v={STATUS_LABEL[status]} tone={STATUS_TONE[status]} />
        <DarkRow k="Time" v={fmtTime(point.recordedAt)} />
        <DarkRow k="Speed" v={`${speedKmh(point).toFixed(1)} km/h`} />
        <DarkRow k="Distance" v={`${distanceKm.toFixed(2)} km`} />
        <DarkRow
          k="Battery"
          v={battery != null ? `${battery}%` : "—"}
          tone={battery != null ? batteryTone(battery) : undefined}
        />
        {idle && (
          <DarkRow
            k="Idle"
            v={`${formatDurationPrecise(idleElapsedMs)} of ${formatDurationPrecise(idle.durationMs)}`}
          />
        )}
        {point.accuracyMeters != null && (
          <DarkRow k="Accuracy" v={`±${point.accuracyMeters.toFixed(0)} m`} />
        )}
      </div>
      <div className="mx-auto h-0 w-0 border-x-[5px] border-t-[5px] border-x-transparent border-t-slate-900/95" />
    </div>
  );
}

function DarkRow({ k, v, tone }: { k: string; v: string; tone?: string }) {
  return (
    <div className="flex justify-between gap-3 py-[1px]">
      <span className="text-slate-400">{k}</span>
      <span className={`font-semibold ${tone ?? "text-white"}`}>{v}</span>
    </div>
  );
}

export default function RouteHistoryMap({
  points,
  playbackIndex = null,
  emptyCenter = [20.5937, 78.9629],
  deviceColor = "#6366f1",
  idleEvents = [],
  violations = [],
  maxSpeed = null,
  speedLimitKmh = 0,
  showIdle = true,
  showViolations = true,
  showMaxSpeed = true,
  focus = null,
  onFocusConsumed,
  onSelect,
}: Props) {
  const [openInfo, setOpenInfo] = useState<string | null>(null);
  /** Index of the fix nearest the last click anywhere on the route. */
  const [inspectedIdx, setInspectedIdx] = useState<number | null>(null);

  // Mirror which marker is open back out to the parent, so clicking a marker
  // on the map highlights the matching Idle Stop / Event row in the sidebar —
  // the reverse of the sidebar-click-pans-the-map flow below.
  useEffect(() => {
    if (!onSelect) return;
    if (openInfo === "start") onSelect({ kind: "start" });
    else if (openInfo === "end") onSelect({ kind: "end" });
    else if (openInfo === "max") onSelect({ kind: "max" });
    else if (openInfo?.startsWith("idle:")) onSelect({ kind: "idle", id: openInfo.slice(5) });
    else if (openInfo?.startsWith("v:")) onSelect({ kind: "violation", id: openInfo.slice(2) });
    else if (openInfo?.startsWith("vp:")) onSelect({ kind: "violation", id: openInfo.slice(3) });
    else onSelect(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onSelect identity isn't part of the sync
  }, [openInfo]);

  // Selecting a row in the sidebar (Idle Stops, Events) should feel the same
  // as clicking the matching marker directly: pan there (FocusController,
  // below) AND open its popup, so the list and the map never disagree
  // about which stop/violation/point is being looked at. Adjusted during
  // render off a change signature — same pattern as routeKey/lastRouteKey
  // below — rather than in an effect, since this is deriving state from a
  // prop change, not synchronizing with an external system.
  const focusKey = focus ? JSON.stringify(focus) : "";
  const [lastFocusKey, setLastFocusKey] = useState(focusKey);
  if (lastFocusKey !== focusKey) {
    setLastFocusKey(focusKey);
    if (focus?.type === "idle") setOpenInfo(`idle:${focus.id}`);
    else if (focus?.type === "violation") setOpenInfo(`v:${focus.id}`);
    else if (focus?.type === "max") setOpenInfo("max");
    else if (focus?.type === "point") {
      if (focus.idx === 0) setOpenInfo("start");
      else if (focus.idx === points.length - 1) setOpenInfo("end");
    }
  }

  const routeKey = useMemo(
    () =>
      points.length
        ? `${points[0].recordedAt}|${points.length}|${points[points.length - 1].recordedAt}`
        : "",
    [points]
  );

  // A new route invalidates any previously inspected point.
  const [lastRouteKey, setLastRouteKey] = useState(routeKey);
  if (lastRouteKey !== routeKey) {
    setLastRouteKey(routeKey);
    setInspectedIdx(null);
  }

  /** Closest recorded fix to a clicked map coordinate. */
  const nearestIdx = (lat: number, lng: number) => {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < points.length; i++) {
      const d = (points[i].latitude - lat) ** 2 + (points[i].longitude - lng) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  };

  const handleRouteClick = (e: LineClickEvent) => {
    setInspectedIdx(nearestIdx(e.latlng.lat, e.latlng.lng));
    setOpenInfo("inspected");
  };

  const latlngs = useMemo<LatLng[]>(
    () => points.map((p) => ({ lat: p.latitude, lng: p.longitude })),
    [points]
  );

  const center = latlngs[0] || { lat: emptyCenter[0], lng: emptyCenter[1] };
  const first = points[0];
  const last = points[points.length - 1];

  const isPlaying = playbackIndex != null;
  const clampedIdx =
    isPlaying && points.length > 0
      ? Math.min(Math.max(playbackIndex!, 0), points.length - 1)
      : null;

  // During playback, only draw segments up to the cursor.
  const visiblePoints = useMemo(
    () => (clampedIdx != null ? points.slice(0, clampedIdx + 1) : points),
    [points, clampedIdx]
  );
  const segments = useMemo(() => speedSegments(visiblePoints), [visiblePoints]);
  const ghostSegments = useMemo(
    () => (isPlaying ? speedSegments(points) : []),
    [isPlaying, points]
  );

  const cursor = clampedIdx != null ? points[clampedIdx] : null;
  const cursorHeading = clampedIdx != null ? headingAt(points, clampedIdx) : 0;
  const staticArrowIdx = points.length > 1 ? points.length - 1 : 0;
  const staticHeading = headingAt(points, staticArrowIdx);

  /** The marker index the hover readout describes — playback cursor or route end. */
  const readoutIdx = clampedIdx ?? staticArrowIdx;
  const readoutPoint = points[readoutIdx] ?? null;
  const readoutBattery = useMemo(
    () => (points.length ? batteryAt(points, readoutIdx) : null),
    [points, readoutIdx]
  );
  const cursorIdle = useMemo(
    () => (clampedIdx != null ? idleEventAt(idleEvents, clampedIdx) : null),
    [idleEvents, clampedIdx]
  );
  const cursorIdleElapsedMs =
    cursorIdle && cursor
      ? Math.max(
          0,
          new Date(cursor.recordedAt).getTime() - new Date(cursorIdle.startTime).getTime()
        )
      : 0;

  // Arrows ride the drawn path itself, so their direction comes from the route
  // geometry and stays correct through and after every stop.
  const arrowPath = useMemo(
    () => visiblePoints.map((p) => ({ lat: p.latitude, lng: p.longitude })),
    [visiblePoints]
  );

  const inspected = inspectedIdx != null ? points[inspectedIdx] : null;
  const inspectedBattery = inspectedIdx != null ? batteryAt(points, inspectedIdx) : null;
  const inspectedIdle = inspectedIdx != null ? idleEventAt(idleEvents, inspectedIdx) : null;

  const violationPolylines = showViolations ? violations : [];

  return (
    <MapShell defaultCenter={center} defaultZoom={points.length ? 14 : 5}>
      {latlngs.length > 0 && (
        <FitBounds
          points={latlngs}
          enabled
          fitOnceKey={routeKey}
          padding={100}
          maxZoom={16}
        />
      )}
      <FocusController
        focus={focus}
        points={points}
        idleEvents={idleEvents}
        violations={violations}
        onConsumed={onFocusConsumed}
      />

      {points.length > 0 && (
        <>
          {/* Ghost full route while playing */}
          {isPlaying &&
            ghostSegments.map((seg, i) => (
              <Polyline
                key={`g-${i}`}
                path={seg.positions.map(toLatLng)}
                strokeColor={seg.color}
                strokeWeight={3}
                strokeOpacity={0.2}
              />
            ))}

          {/* Wide invisible hit-area so any point on the route is an easy click
              target — the visible line beneath it is often only a few px wide. */}
          <Polyline
            path={latlngs}
            strokeColor="#000"
            strokeOpacity={0}
            strokeWeight={18}
            onClick={handleRouteClick}
          />

          {/* Device-color underlay — one unbroken line so the route always reads
              as continuous even where the speed bands change or a stop sits. */}
          <Polyline
            path={latlngs.slice(0, (clampedIdx ?? latlngs.length - 1) + 1)}
            strokeColor={deviceColor}
            strokeWeight={7}
            strokeOpacity={0.35}
            onClick={handleRouteClick}
          />

          {/* Speed-colored route */}
          {segments.map((seg, i) =>
            seg.isGap ? (
              // Logging gap: the vehicle travelled untracked, so show the join
              // dashed rather than implying a surveyed leg.
              <Polyline
                key={`s-${i}`}
                path={seg.positions.map(toLatLng)}
                strokeColor={seg.color}
                strokeWeight={4}
                strokeOpacity={0.75}
                dashArray="2 12"
                onClick={handleRouteClick}
              />
            ) : (
              <Polyline
                key={`s-${i}`}
                path={seg.positions.map(toLatLng)}
                strokeColor={seg.color}
                strokeWeight={5}
                strokeOpacity={0.92}
                onClick={handleRouteClick}
              />
            )
          )}

          {arrowPath.length > 1 && <RouteArrows path={arrowPath} color={deviceColor} />}

          {/* Speeding segments highlight */}
          {violationPolylines.map((v) => (
            <Polyline
              key={v.id}
              path={v.positions.map(toLatLng)}
              strokeColor={VIOLATION_COLOR}
              strokeWeight={7}
              strokeOpacity={0.55}
              onClick={() => setOpenInfo(`v:${v.id}`)}
            />
          ))}

          {violationPolylines.map((v) => {
            const raw = v.positions[Math.floor(v.positions.length / 2)] ?? v.positions[0];
            if (!raw) return null;
            const mid = toLatLng(raw);
            return (
              <MapPopup
                key={`vi-${v.id}`}
                position={mid}
                open={openInfo === `v:${v.id}`}
                onClose={() => setOpenInfo(null)}
                offsetY={-12}
              >
                <div className="min-w-[180px] font-sans text-xs">
                  <p className="mb-1 font-bold text-rose-700">Speed violation</p>
                  <Row k="Peak" v={`${v.peakKmh.toFixed(1)} km/h`} />
                  {speedLimitKmh > 0 && <Row k="Limit" v={`${speedLimitKmh} km/h`} />}
                  <Row k="Start" v={fmtTime(v.startTime)} />
                  <Row k="End" v={fmtTime(v.endTime)} />
                  <Row k="Duration" v={formatDuration(v.durationMs)} />
                </div>
              </MapPopup>
            );
          })}

          {/* Start */}
          {first && (
            <>
              <DivMarker
                position={{ lat: first.latitude, lng: first.longitude }}
                width={28}
                height={28}
                anchorX={14}
                anchorY={14}
                title={`Trip start · ${fmtTime(first.recordedAt)}`}
                onClick={() => setOpenInfo("start")}
              >
                <PinGlyph color="#10b981" glyph="S" size={28} />
              </DivMarker>
              <MapPopup
                position={{ lat: first.latitude, lng: first.longitude }}
                open={openInfo === "start"}
                onClose={() => setOpenInfo(null)}
                offsetY={-22}
              >
                <div className="font-sans text-xs">
                  <p className="mb-1 font-bold text-emerald-700">Trip start</p>
                  <Row k="Time" v={fmtTime(first.recordedAt)} />
                  <Row
                    k="Coords"
                    v={`${first.latitude.toFixed(5)}, ${first.longitude.toFixed(5)}`}
                  />
                </div>
              </MapPopup>
            </>
          )}

          {/* End */}
          {points.length > 1 && last && (
            <>
              <DivMarker
                position={{ lat: last.latitude, lng: last.longitude }}
                width={28}
                height={28}
                anchorX={14}
                anchorY={14}
                title={`Trip end · ${fmtTime(last.recordedAt)}`}
                onClick={() => setOpenInfo("end")}
              >
                <PinGlyph color="#ef4444" glyph="E" size={28} />
              </DivMarker>
              <MapPopup
                position={{ lat: last.latitude, lng: last.longitude }}
                open={openInfo === "end"}
                onClose={() => setOpenInfo(null)}
                offsetY={-22}
              >
                <div className="font-sans text-xs">
                  <p className="mb-1 font-bold text-rose-700">Trip end</p>
                  <Row k="Time" v={fmtTime(last.recordedAt)} />
                  <Row
                    k="Coords"
                    v={`${last.latitude.toFixed(5)}, ${last.longitude.toFixed(5)}`}
                  />
                </div>
              </MapPopup>
            </>
          )}

          {/* Idle markers */}
          {showIdle &&
            idleEvents.map((e) => (
              <Fragment key={e.id}>
                <DivMarker
                  position={{ lat: e.latitude, lng: e.longitude }}
                  width={26}
                  height={26}
                  anchorX={13}
                  anchorY={13}
                  title={`Idle ${formatDuration(e.durationMs)}`}
                  onClick={() => setOpenInfo(`idle:${e.id}`)}
                >
                  <PinGlyph color={IDLE_COLOR} glyph="⏸" size={26} />
                </DivMarker>
                <MapPopup
                  position={{ lat: e.latitude, lng: e.longitude }}
                  open={openInfo === `idle:${e.id}`}
                  onClose={() => setOpenInfo(null)}
                  offsetY={-20}
                >
                  <div className="min-w-[180px] font-sans text-xs">
                    <p className="mb-1 font-bold text-purple-700">Idle / Stopped</p>
                    <Row k="Duration" v={`Idle for ${formatDurationPrecise(e.durationMs)}`} />
                    {batteryAt(points, e.startIdx) != null && (
                      <Row k="Battery" v={`${batteryAt(points, e.startIdx)}%`} />
                    )}
                    <Row k="Start" v={fmtTime(e.startTime)} />
                    <Row k="End" v={fmtTime(e.endTime)} />
                    <Row
                      k="Location"
                      v={`${e.latitude.toFixed(5)}, ${e.longitude.toFixed(5)}`}
                    />
                  </div>
                </MapPopup>
              </Fragment>
            ))}

          {/* Max speed */}
          {showMaxSpeed && maxSpeed && maxSpeed.kmh > 0 && (
            <>
              <DivMarker
                position={{ lat: maxSpeed.latitude, lng: maxSpeed.longitude }}
                width={26}
                height={26}
                anchorX={13}
                anchorY={13}
                title={`Max ${maxSpeed.kmh.toFixed(0)} km/h`}
                onClick={() => setOpenInfo("max")}
              >
                <PinGlyph color="#f59e0b" glyph="⚡" size={26} />
              </DivMarker>
              <MapPopup
                position={{ lat: maxSpeed.latitude, lng: maxSpeed.longitude }}
                open={openInfo === "max"}
                onClose={() => setOpenInfo(null)}
                offsetY={-20}
              >
                <div className="min-w-[180px] font-sans text-xs">
                  <p className="mb-1 font-bold text-amber-700">Maximum speed</p>
                  <Row k="Speed" v={`${maxSpeed.kmh.toFixed(1)} km/h`} />
                  <Row k="Time" v={fmtTime(maxSpeed.time)} />
                  <Row
                    k="Location"
                    v={`${maxSpeed.latitude.toFixed(5)}, ${maxSpeed.longitude.toFixed(5)}`}
                  />
                </div>
              </MapPopup>
            </>
          )}

          {/* Violation peak markers */}
          {showViolations &&
            violations.map((v) => {
              const p = points[v.peakIdx];
              if (!p) return null;
              return (
                <Fragment key={`vm-${v.id}`}>
                  <DivMarker
                    position={{ lat: p.latitude, lng: p.longitude }}
                    width={24}
                    height={24}
                    anchorX={12}
                    anchorY={12}
                    title={`${v.peakKmh.toFixed(0)} km/h over limit`}
                    onClick={() => setOpenInfo(`vp:${v.id}`)}
                  >
                    <PinGlyph color={VIOLATION_COLOR} glyph="!" size={24} />
                  </DivMarker>
                  <MapPopup
                    position={{ lat: p.latitude, lng: p.longitude }}
                    open={openInfo === `vp:${v.id}`}
                    onClose={() => setOpenInfo(null)}
                    offsetY={-18}
                  >
                    <div className="min-w-[180px] font-sans text-xs">
                      <p className="mb-1 font-bold text-rose-700">Speed violation</p>
                      <Row k="Actual" v={`${v.peakKmh.toFixed(1)} km/h`} />
                      {speedLimitKmh > 0 && <Row k="Expected" v={`${speedLimitKmh} km/h`} />}
                      <Row k="Time" v={fmtTime(v.startTime)} />
                      <Row k="Duration" v={formatDuration(v.durationMs)} />
                    </div>
                  </MapPopup>
                </Fragment>
              );
            })}

          {/* Inspected point — click anywhere on the route to find the nearest
              recorded fix and see its speed, battery, timestamp and more. */}
          {inspected && (
            <>
              <DivMarker
                position={{ lat: inspected.latitude, lng: inspected.longitude }}
                width={16}
                height={16}
                anchorX={8}
                anchorY={8}
                zIndex={900}
                onClick={() => setOpenInfo("inspected")}
              >
                <InspectedPointGlyph />
              </DivMarker>
              <MapPopup
                position={{ lat: inspected.latitude, lng: inspected.longitude }}
                open={openInfo === "inspected"}
                onClose={() => setOpenInfo(null)}
                offsetY={-16}
              >
                <PointDetails
                  p={inspected}
                  battery={inspectedBattery}
                  idle={inspectedIdle}
                  idleElapsedMs={idleElapsedAt(inspected, inspectedIdle)}
                  status={statusAt(points, idleEvents, inspectedIdx!)}
                  distanceKm={distanceUpToKm(points, inspectedIdx!)}
                />
              </MapPopup>
            </>
          )}

          {/* Playback / live cursor — speed, time and battery on hover */}
          {readoutPoint && (
            <>
              <DivMarker
                position={{ lat: readoutPoint.latitude, lng: readoutPoint.longitude }}
                width={cursor ? 32 : 30}
                height={cursor ? 32 : 30}
                anchorX={cursor ? 16 : 15}
                anchorY={cursor ? 16 : 15}
                title={[
                  `${speedKmh(readoutPoint).toFixed(0)} km/h`,
                  fmtTime(readoutPoint.recordedAt),
                  readoutBattery != null ? `${readoutBattery}% battery` : null,
                  cursorIdle ? `idle ${formatDurationPrecise(cursorIdleElapsedMs)}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                zIndex={cursor ? 1000 : 500}
                onClick={() => setOpenInfo("cursor")}
              >
                <div className="group relative flex h-full w-full items-center justify-center">
                  <CursorHoverCard
                    point={readoutPoint}
                    battery={readoutBattery}
                    idle={cursorIdle}
                    idleElapsedMs={cursorIdleElapsedMs}
                    status={statusAt(points, idleEvents, readoutIdx)}
                    distanceKm={distanceUpToKm(points, readoutIdx)}
                  />
                  {cursorIdle ? (
                    <IdleGlyph size={30} />
                  ) : (
                    <ArrowGlyph
                      color={deviceColor}
                      heading={cursor ? cursorHeading : staticHeading}
                      size={cursor ? 32 : 30}
                    />
                  )}
                </div>
              </DivMarker>
              <MapPopup
                position={{ lat: readoutPoint.latitude, lng: readoutPoint.longitude }}
                open={openInfo === "cursor"}
                onClose={() => setOpenInfo(null)}
                offsetY={-24}
              >
                <PointDetails
                  p={readoutPoint}
                  battery={readoutBattery}
                  idle={cursorIdle}
                  idleElapsedMs={cursorIdleElapsedMs}
                  status={statusAt(points, idleEvents, readoutIdx)}
                  distanceKm={distanceUpToKm(points, readoutIdx)}
                />
              </MapPopup>
            </>
          )}
        </>
      )}
    </MapShell>
  );
}

function Row({ k, v, tone }: { k: string; v: string; tone?: string }) {
  return (
    <div className="flex justify-between gap-3 py-0.5">
      <span className="text-slate-500">{k}</span>
      <span className={`font-medium ${tone ?? "text-slate-800"}`}>{v}</span>
    </div>
  );
}

function PointDetails({
  p,
  battery = null,
  idle = null,
  idleElapsedMs = 0,
  status,
  distanceKm,
}: {
  p: LocationPoint;
  battery?: number | null;
  idle?: IdleEvent | null;
  idleElapsedMs?: number;
  status: PointStatus;
  distanceKm: number;
}) {
  const level = p.batteryPercent ?? battery;
  return (
    <div className="min-w-[190px] font-sans text-xs">
      <p className="mb-1.5 font-bold text-slate-900">
        GPS point
        {p.isMockLocation && (
          <span className="ml-1 text-[10px] font-semibold uppercase text-rose-600">mock</span>
        )}
      </p>
      <Row k="Status" v={STATUS_LABEL[status]} tone={STATUS_TONE_LIGHT[status]} />
      <Row k="Time" v={fmtTime(p.recordedAt)} />
      <Row k="Speed" v={`${speedKmh(p).toFixed(1)} km/h`} />
      <Row k="Distance" v={`${distanceKm.toFixed(2)} km`} />
      {level != null && <Row k="Battery" v={`${level}%`} />}
      {idle && (
        <Row
          k="Idle"
          v={`${formatDurationPrecise(idleElapsedMs)} of ${formatDurationPrecise(idle.durationMs)}`}
        />
      )}
      {p.accuracyMeters != null && <Row k="Accuracy" v={`±${p.accuracyMeters.toFixed(0)} m`} />}
      {p.bearingDegrees != null && <Row k="Bearing" v={`${p.bearingDegrees.toFixed(0)}°`} />}
      <Row k="Location" v={`${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)}`} />
    </div>
  );
}
