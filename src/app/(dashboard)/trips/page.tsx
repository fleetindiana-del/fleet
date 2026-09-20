"use client";

import { useState, useEffect, useCallback, useMemo, type ReactNode } from "react";
import {
  Loader2,
  Route,
  MapPin,
  Play,
  Pause,
  Download,
  Printer,
  Gauge,
  Clock,
  Ruler,
  Flag,
  Menu,
  ChevronDown,
  AlertTriangle,
  Zap,
  PauseCircle,
  Filter,
  BatteryMedium,
} from "lucide-react";
import { format } from "date-fns";
import dynamic from "next/dynamic";
import { useSidebar } from "@/components/layout/SidebarContext";
import {
  SPEED_BANDS,
  detectIdleEvents,
  detectViolations,
  maxSpeedPoint,
  tripStats,
  formatDuration,
  formatDurationPrecise,
  deviceColor,
  batteryAt,
  batteryStats,
  idleEventAt,
  idleMsUpTo,
  IDLE_COLOR,
  VIOLATION_COLOR,
  type MaxSpeed,
  type TripStats,
  type IdleEvent,
} from "@/lib/routeAnalytics";
import type { FocusTarget, MapSelection } from "./RouteHistoryMap";
import { type FleetDevice, deviceDisplayName } from "./deviceUtils";
import { EmployeeCombobox } from "./EmployeeCombobox";
import { DateRangeSelector, type RouteDateSelection } from "./DateRangeSelector";

const RouteHistoryMap = dynamic(() => import("./RouteHistoryMap"), { ssr: false });

interface LocationSession {
  _id: string;
  sessionId: string;
  deviceId: string;
  status: "ACTIVE" | "COMPLETED" | "INTERRUPTED";
  startedAt: string;
  stoppedAt?: string;
  totalPoints: number;
  firstPointAt?: string;
  lastPointAt?: string;
}

interface LocationPoint {
  pointId: string;
  sessionId: string;
  sequenceNumber: number;
  latitude: number;
  longitude: number;
  recordedAt: string;
  speedMetersPerSecond?: number;
  accuracyMeters?: number;
  bearingDegrees?: number;
  altitudeMeters?: number;
  batteryPercent?: number;
  provider?: string;
  isMockLocation?: boolean;
  /** Road geometry filled in between two fixes, not a surveyed sample. */
  isInterpolated?: boolean;
  isRoadSnapped?: boolean;
  /** Recorded at a standstill and held at the position it was recorded at. */
  isStationary?: boolean;
}

type EventFilter = "all" | "violations" | "trips" | "max";

const STATUS_CHIP: Record<string, string> = {
  ACTIVE: "bg-emerald-500 text-white",
  COMPLETED: "bg-indigo-500 text-white",
  INTERRUPTED: "bg-amber-500 text-white",
};

const SPEED_LIMIT_KEY = "fleet.route.speedLimit.";

const PLAYBACK_SPEEDS = [0.05, 0.1, 0.5, 1, 2, 4] as const;
/** Half speed by default — 1× stepped through a day's route too fast to follow. */
const DEFAULT_PLAYBACK_SPEED = 0.5;
/** Frame interval at 1×; slower rates stretch it instead of taking part-steps. */
const PLAYBACK_TICK_MS = 60;
/**
 * Most samples 1× may cross in one frame.
 *
 * The step is otherwise scaled to finish any route in about the same wall time,
 * which on a long route means leaping tens of fixes per frame — the cursor
 * teleports past whole stretches instead of travelling them, and does it worst
 * straight after a stop, where the samples are densest. Capping it keeps
 * playback continuous and lets a long route simply take longer; 2× and 4× are
 * still there for covering ground quickly.
 */
const MAX_PLAYBACK_STEP = 4;

async function reverseGeocode(lat: number, lng: number): Promise<string> {
  const fallback = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!key) return fallback;
  try {
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}` +
        `&result_type=street_address|premise|route|neighborhood&key=${key}`,
      { headers: { Accept: "application/json" } }
    );
    if (!res.ok) return fallback;
    const data = await res.json();
    return data.results?.[0]?.formatted_address || fallback;
  } catch {
    return fallback;
  }
}

function loadSpeedLimit(deviceId: string | null): number {
  if (!deviceId || typeof window === "undefined") return 60;
  const raw = localStorage.getItem(SPEED_LIMIT_KEY + deviceId);
  const n = raw != null ? Number(raw) : 60;
  return Number.isFinite(n) && n > 0 ? n : 60;
}

export default function RouteHistoryPage() {
  const { open } = useSidebar();
  const [devices, setDevices] = useState<FleetDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);

  const today = new Date().toISOString().slice(0, 10);
  const [dateSelection, setDateSelection] = useState<RouteDateSelection>({
    mode: "single",
    date: today,
    startTime: "00:00",
    endTime: "23:59",
  });
  const [formError, setFormError] = useState("");
  const [speedLimitKmh, setSpeedLimitKmh] = useState(60);

  const [isLoading, setIsLoading] = useState(false);
  const [hasQueried, setHasQueried] = useState(false);
  const [points, setPoints] = useState<LocationPoint[]>([]);
  const [sessions, setSessions] = useState<LocationSession[]>([]);
  const [selectedSubTrip, setSelectedSubTrip] = useState<string | null>(null);

  // What's actually on screen right now, so the UI can flag it when the
  // employee/date/time filters have moved on without a "View route" yet —
  // otherwise the map keeps showing a route for a selection that no longer
  // matches the filters above it.
  const [queriedParams, setQueriedParams] = useState<{
    deviceId: string;
    dateSelection: RouteDateSelection;
  } | null>(null);

  const [startPlace, setStartPlace] = useState("");
  const [endPlace, setEndPlace] = useState("");

  const [playbackIndex, setPlaybackIndex] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(DEFAULT_PLAYBACK_SPEED);

  // Collapsible panels
  const [filtersMinimized, setFiltersMinimized] = useState(false);
  const [statsMinimized, setStatsMinimized] = useState(false);
  const [idleMinimized, setIdleMinimized] = useState(false);
  const [timelineMinimized, setTimelineMinimized] = useState(false);
  const [tripsMinimized, setTripsMinimized] = useState(false);
  const [legendOpen, setLegendOpen] = useState(true);

  const [eventFilter, setEventFilter] = useState<EventFilter>("all");
  const [focus, setFocus] = useState<FocusTarget>(null);
  // Mirrors whichever marker is currently open on the map, so clicking it
  // highlights the matching Idle Stop / Event row below — the reverse of
  // clicking a row panning the map (via `focus`, above).
  const [mapSelection, setMapSelection] = useState<MapSelection>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/fleet-map");
        if (res.ok && !cancelled) setDevices(await res.json());
      } catch {
        /* ignore */
      }
    };
    load();
    const id = setInterval(load, 8000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    setSpeedLimitKmh(loadSpeedLimit(selectedDeviceId));
  }, [selectedDeviceId]);

  const persistSpeedLimit = (v: number) => {
    setSpeedLimitKmh(v);
    if (selectedDeviceId && typeof window !== "undefined") {
      localStorage.setItem(SPEED_LIMIT_KEY + selectedDeviceId, String(v));
    }
  };

  const selectedDevice = devices.find((d) => d.deviceId === selectedDeviceId) || null;
  const selectedLabel = selectedDevice ? deviceDisplayName(selectedDevice) : "";
  const accent = selectedDeviceId ? deviceColor(selectedDeviceId) : "#6366f1";

  const displayedPoints = useMemo(
    () => (selectedSubTrip ? points.filter((p) => p.sessionId === selectedSubTrip) : points),
    [points, selectedSubTrip]
  );

  /**
   * Share of the drawn route that sits on a matched road. Anything under 1
   * means part of the line is raw GPS — which is what a route cutting across
   * buildings looks like — so the gap is reported rather than left to guess at.
   */
  const roadMatch = useMemo(() => {
    // Standstill fixes are deliberately left where they were recorded, so they
    // are not road-matched and must not count against the coverage.
    const onRoute = displayedPoints.filter((p) => !p.isStationary);
    if (onRoute.length === 0) return null;
    const snapped = onRoute.filter((p) => p.isRoadSnapped).length;
    return { snapped, total: onRoute.length, pct: snapped / onRoute.length };
  }, [displayedPoints]);

  const idleEvents = useMemo(
    () => detectIdleEvents(displayedPoints),
    [displayedPoints]
  );
  const violations = useMemo(
    () => detectViolations(displayedPoints, speedLimitKmh),
    [displayedPoints, speedLimitKmh]
  );
  const maxSpd: MaxSpeed | null = useMemo(
    () => maxSpeedPoint(displayedPoints),
    [displayedPoints]
  );
  const stats: TripStats | null = useMemo(
    () => tripStats(displayedPoints, idleEvents),
    [displayedPoints, idleEvents]
  );

  // Idle stops now have their own dedicated panel (below Stats), always
  // visible on the map rather than gated behind the Events filter.
  const showIdle = true;
  const showViolations = eventFilter === "all" || eventFilter === "violations";
  const showMaxSpeed = eventFilter === "all" || eventFilter === "max";

  type TimelineItem = {
    id: string;
    kind: "start" | "end" | "violation" | "max" | "trip";
    time: string;
    title: string;
    subtitle: string;
    focus: FocusTarget;
  };

  const timeline: TimelineItem[] = useMemo(() => {
    if (displayedPoints.length === 0) return [];
    const items: TimelineItem[] = [];
    const first = displayedPoints[0];
    const last = displayedPoints[displayedPoints.length - 1];

    items.push({
      id: "start",
      kind: "start",
      time: first.recordedAt,
      title: "Trip start",
      subtitle: format(new Date(first.recordedAt), "HH:mm:ss"),
      focus: { type: "point", idx: 0 },
    });

    for (const v of violations) {
      items.push({
        id: v.id,
        kind: "violation",
        time: v.startTime,
        title: `Speeding · ${v.peakKmh.toFixed(0)} km/h`,
        subtitle: `Limit ${speedLimitKmh} · ${formatDuration(v.durationMs)}`,
        focus: { type: "violation", id: v.id },
      });
    }

    if (maxSpd && maxSpd.kmh > 0) {
      items.push({
        id: "max",
        kind: "max",
        time: maxSpd.time,
        title: `Max speed · ${maxSpd.kmh.toFixed(0)} km/h`,
        subtitle: format(new Date(maxSpd.time), "HH:mm:ss"),
        focus: { type: "max", idx: maxSpd.idx },
      });
    }

    if (displayedPoints.length > 1) {
      items.push({
        id: "end",
        kind: "end",
        time: last.recordedAt,
        title: "Trip end",
        subtitle: format(new Date(last.recordedAt), "HH:mm:ss"),
        focus: { type: "point", idx: displayedPoints.length - 1 },
      });
    }

    for (const s of sessions) {
      items.push({
        id: `trip-${s.sessionId}`,
        kind: "trip",
        time: s.startedAt,
        title: `Trip · ${s.status}`,
        subtitle: format(new Date(s.startedAt), "MMM dd, HH:mm"),
        focus: { type: "bounds" },
      });
    }

    items.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

    return items.filter((it) => {
      if (eventFilter === "all") return true;
      if (eventFilter === "violations") return it.kind === "violation";
      if (eventFilter === "max") return it.kind === "max";
      if (eventFilter === "trips") return it.kind === "trip" || it.kind === "start" || it.kind === "end";
      return true;
    });
  }, [displayedPoints, violations, maxSpd, sessions, speedLimitKmh, eventFilter]);

  const resetPlayback = () => {
    setIsPlaying(false);
    setPlaybackIndex(null);
    setSpeed(DEFAULT_PLAYBACK_SPEED);
  };

  const viewRoute = useCallback(async () => {
    if (!selectedDeviceId) {
      setFormError("Select a device first.");
      return;
    }

    let from: Date;
    let to: Date;
    if (dateSelection.mode === "single") {
      from = new Date(`${dateSelection.date}T${dateSelection.startTime}:00`);
      to = new Date(`${dateSelection.date}T${dateSelection.endTime}:59`);
      if (from.getTime() >= to.getTime()) {
        setFormError("Start time must be before end time.");
        return;
      }
    } else {
      from = new Date(`${dateSelection.fromDate}T00:00:00`);
      to = new Date(`${dateSelection.toDate}T23:59:59`);
      if (from.getTime() > to.getTime()) {
        setFormError("From date must be before the To date.");
        return;
      }
    }
    setFormError("");
    setIsLoading(true);
    setHasQueried(true);
    setSelectedSubTrip(null);
    resetPlayback();
    setStartPlace("");
    setEndPlace("");
    setPoints([]);
    setSessions([]);
    setStatsMinimized(false);
    setTimelineMinimized(false);

    try {
      const params = new URLSearchParams({
        deviceId: selectedDeviceId,
        from: from.toISOString(),
        to: to.toISOString(),
      });
      const [ptsRes, sesRes] = await Promise.all([
        fetch(`/api/location/history?${params}`),
        fetch(
          `/api/location/sessions?deviceId=${encodeURIComponent(selectedDeviceId)}&from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}&limit=200`
        ),
      ]);

      const pts: LocationPoint[] = ptsRes.ok ? await ptsRes.json() : [];
      setPoints(pts);

      if (sesRes.ok) {
        const all: LocationSession[] = await sesRes.json();
        const overlap = all.filter((s) => {
          const sStart = new Date(s.startedAt).getTime();
          const sEnd = s.stoppedAt ? new Date(s.stoppedAt).getTime() : Date.now();
          return sStart <= to.getTime() && sEnd >= from.getTime();
        });
        setSessions(overlap);
      }

      if (pts.length > 0) {
        const first = pts[0];
        const last = pts[pts.length - 1];
        reverseGeocode(first.latitude, first.longitude).then(setStartPlace);
        reverseGeocode(last.latitude, last.longitude).then(setEndPlace);
      }

      setQueriedParams({ deviceId: selectedDeviceId, dateSelection });
    } catch {
      setPoints([]);
    } finally {
      setIsLoading(false);
    }
  }, [selectedDeviceId, dateSelection]);

  // True once the employee/date/time filters have changed since the route on
  // screen was fetched — the displayed data is now stale relative to them.
  const filtersStale =
    !!queriedParams &&
    (queriedParams.deviceId !== selectedDeviceId ||
      JSON.stringify(queriedParams.dateSelection) !== JSON.stringify(dateSelection));

  useEffect(() => {
    resetPlayback();
  }, [selectedSubTrip]);

  // Clicking a marker on the map (Start/End/Max/Idle/Violation) scrolls the
  // matching sidebar row into view — the map-click half of the two-way sync
  // (sidebar-click-pans-the-map is the `focus` state above).
  useEffect(() => {
    if (!mapSelection) return;
    const selector =
      mapSelection.kind === "idle"
        ? `[data-idle-id="${mapSelection.id}"]`
        : mapSelection.kind === "violation"
          ? `[data-timeline-id="${mapSelection.id}"]`
          : `[data-timeline-id="${mapSelection.kind}"]`;
    document.querySelector(selector)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [mapSelection]);

  useEffect(() => {
    if (!isPlaying || displayedPoints.length < 2) return;
    // Sub-1× rates walk one sample per tick and stretch the interval instead of
    // taking a fractional step: a fractional step would land the cursor between
    // samples, and every consumer indexes `displayedPoints` directly. Moving a
    // point at a time is also what makes 0.1× useful — the cursor visits every
    // reading rather than skipping in `baseStep` jumps.
    const baseStep = Math.min(
      MAX_PLAYBACK_STEP,
      Math.max(1, Math.ceil(displayedPoints.length / 300))
    );
    const step = speed >= 1 ? baseStep * speed : 1;
    const tickMs =
      speed >= 1
        ? PLAYBACK_TICK_MS
        : Math.min(2000, Math.max(30, Math.round(PLAYBACK_TICK_MS / (speed * baseStep))));
    const id = setInterval(() => {
      setPlaybackIndex((idx) => {
        const next = (idx ?? 0) + step;
        if (next >= displayedPoints.length - 1) return displayedPoints.length - 1;
        return next;
      });
    }, tickMs);
    return () => clearInterval(id);
  }, [isPlaying, speed, displayedPoints.length]);

  useEffect(() => {
    if (playbackIndex != null && playbackIndex >= displayedPoints.length - 1) {
      setIsPlaying(false);
    }
  }, [playbackIndex, displayedPoints.length]);

  const togglePlay = () => {
    if (displayedPoints.length < 2) return;
    if (isPlaying) {
      setIsPlaying(false);
      return;
    }
    if (playbackIndex == null || playbackIndex >= displayedPoints.length - 1) {
      setPlaybackIndex(0);
    }
    setIsPlaying(true);
  };

  const exportCsv = () => {
    if (displayedPoints.length === 0) return;
    const header = "sequence,recordedAt,latitude,longitude,speed_kmh,battery_percent,accuracy_m";
    // Road-geometry fillers exist to draw the route, not to be reported as
    // readings, so the export stays a list of what the device actually logged.
    const rows = displayedPoints
      .filter((p) => !p.isInterpolated)
      .map((p) =>
        [
          p.sequenceNumber,
          new Date(p.recordedAt).toISOString(),
          p.latitude,
          p.longitude,
          p.speedMetersPerSecond != null ? (p.speedMetersPerSecond * 3.6).toFixed(1) : "",
          p.batteryPercent ?? "",
          p.accuracyMeters ?? "",
        ].join(",")
      );
    const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const fileDate = dateSelection.mode === "single" ? dateSelection.date : `${dateSelection.fromDate}_to_${dateSelection.toDate}`;
    a.download = `route-${selectedDeviceId?.slice(0, 8)}-${fileDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const playbackTime =
    playbackIndex != null && displayedPoints[playbackIndex]
      ? format(new Date(displayedPoints[playbackIndex].recordedAt), "HH:mm:ss")
      : displayedPoints[0]
        ? format(new Date(displayedPoints[0].recordedAt), "HH:mm:ss")
        : "--:--:--";

  // Readouts that track the scrubber, so idle and battery stay truthful at
  // every position rather than only in the whole-trip totals.
  const cursorIdx = playbackIndex ?? 0;
  const cursorBattery = useMemo(
    () => (displayedPoints.length ? batteryAt(displayedPoints, cursorIdx) : null),
    [displayedPoints, cursorIdx]
  );
  const activeIdle = useMemo(
    () => idleEventAt(idleEvents, cursorIdx),
    [idleEvents, cursorIdx]
  );
  const activeIdleElapsedMs =
    activeIdle && displayedPoints[cursorIdx]
      ? Math.max(
          0,
          new Date(displayedPoints[cursorIdx].recordedAt).getTime() -
            new Date(activeIdle.startTime).getTime()
        )
      : 0;
  const idleSoFarMs = useMemo(
    () => idleMsUpTo(idleEvents, displayedPoints, cursorIdx),
    [idleEvents, displayedPoints, cursorIdx]
  );
  const battery = useMemo(() => batteryStats(displayedPoints), [displayedPoints]);

  /**
   * Idle stretches painted onto the scrubber track, so the stops in a route are
   * visible before you scrub onto them.
   */
  const idleTrackGradient = useMemo(() => {
    const n = displayedPoints.length;
    if (n < 2 || idleEvents.length === 0) return undefined;
    const stops: string[] = [];
    let at = 0;
    for (const e of idleEvents) {
      const from = (e.startIdx / (n - 1)) * 100;
      const to = (e.endIdx / (n - 1)) * 100;
      if (to <= at) continue;
      stops.push(`transparent ${at}%`, `transparent ${Math.max(at, from)}%`);
      stops.push(`#d8b4fe ${Math.max(at, from)}%`, `#d8b4fe ${to}%`);
      at = to;
    }
    if (stops.length === 0) return undefined;
    stops.push(`transparent ${at}%`, "transparent 100%");
    return `linear-gradient(to right, ${stops.join(", ")})`;
  }, [displayedPoints.length, idleEvents]);

  const hasRoute = displayedPoints.length > 0 && !!stats;

  const kindIcon = (kind: TimelineItem["kind"]) => {
    switch (kind) {
      case "start":
        return <Flag className="h-3.5 w-3.5 text-emerald-500" />;
      case "end":
        return <Flag className="h-3.5 w-3.5 text-rose-500" />;
      case "violation":
        return <AlertTriangle className="h-3.5 w-3.5 text-rose-600" />;
      case "max":
        return <Zap className="h-3.5 w-3.5 text-amber-500" />;
      case "trip":
        return <Route className="h-3.5 w-3.5 text-indigo-500" />;
    }
  };

  return (
    <div className="relative h-full w-full overflow-hidden bg-slate-200">
      <RouteHistoryMap
        points={displayedPoints}
        playbackIndex={playbackIndex}
        deviceColor={accent}
        idleEvents={idleEvents}
        violations={violations}
        maxSpeed={maxSpd}
        speedLimitKmh={speedLimitKmh}
        showIdle={showIdle}
        showViolations={showViolations}
        showMaxSpeed={showMaxSpeed}
        focus={focus}
        onFocusConsumed={() => setFocus(null)}
        onSelect={setMapSelection}
      />

      {isLoading && (
        <div className="animate-in fade-in absolute inset-0 z-500 flex items-center justify-center bg-slate-900/10 backdrop-blur-[2px] duration-200">
          <div className="animate-in zoom-in-95 slide-in-from-bottom-2 flex items-center gap-2.5 rounded-full border border-white/60 bg-white/95 px-5 py-2.5 text-sm font-semibold text-slate-700 shadow-[0_8px_30px_-6px_rgba(15,23,42,0.35)] duration-300">
            <Loader2 className="h-4 w-4 animate-spin text-indigo-600" />
            Loading route…
          </div>
        </div>
      )}

      {/* ─── Left column ─── */}
      <div className="absolute left-3 top-3 z-[1100] flex w-[min(calc(100%-1.5rem),24rem)] flex-col gap-2 sm:left-4 sm:top-4">
        {/* Filters panel (collapsible) — Active Employee first, then the
            Date/Time range that's scoped to whoever is selected, so the two
            read as one connected filter rather than separate controls. */}
        <CollapsiblePanel
          title="Route History"
          subtitle={
            selectedLabel
              ? `${selectedLabel} · ${
                  dateSelection.mode === "single"
                    ? format(new Date(`${dateSelection.date}T00:00:00`), "MMM d, y")
                    : `${format(new Date(`${dateSelection.fromDate}T00:00:00`), "MMM d")} – ${format(new Date(`${dateSelection.toDate}T00:00:00`), "MMM d, y")}`
                }`
              : "No employee selected"
          }
          minimized={filtersMinimized}
          onToggle={() => setFiltersMinimized((v) => !v)}
          accent={accent}
          leading={
            <button
              type="button"
              onClick={() => open()}
              className="-ml-1 rounded-full p-1.5 text-slate-500 hover:bg-slate-100 sm:hidden"
              aria-label="Open menu"
            >
              <Menu className="h-4 w-4" />
            </button>
          }
        >
          {/* Active Employee */}
          <EmployeeCombobox
            devices={devices}
            selectedDeviceId={selectedDeviceId}
            onSelect={(d) => {
              setSelectedDeviceId(d.deviceId);
              setFormError("");
            }}
            onClear={() => setSelectedDeviceId(null)}
          />

          {/* Date / time range */}
          <div className="mt-2">
            <span className="mb-1 block text-[11px] font-medium text-slate-500">
              Date
            </span>
            <DateRangeSelector value={dateSelection} onChange={setDateSelection} maxDate={today} />
          </div>

          <label className="mt-2 block">
            <span className="mb-1 block text-[11px] font-medium text-slate-500">
              Speed limit (km/h)
            </span>
            <input
              type="number"
              min={10}
              max={200}
              step={5}
              value={speedLimitKmh}
              onChange={(e) => persistSpeedLimit(Number(e.target.value) || 60)}
              className="h-9 w-full rounded-xl border border-slate-200 bg-slate-50/80 px-2.5 text-sm text-slate-800 outline-none transition-all duration-200 focus:border-indigo-400 focus:bg-white focus:shadow-[0_0_0_4px_rgba(99,102,241,0.12)]"
            />
          </label>

          {filtersStale && !formError && (
            <p className="animate-in fade-in slide-in-from-top-1 mt-2 flex items-center gap-1 text-xs font-medium text-amber-600 duration-200">
              <AlertTriangle className="h-3 w-3 shrink-0" />
              Filters changed — the route below is for the previous selection.
            </p>
          )}

          <button
            type="button"
            onClick={viewRoute}
            disabled={isLoading}
            className={`group relative mt-3 flex h-10.5 w-full items-center justify-center gap-2 overflow-hidden rounded-full text-sm font-semibold text-white shadow-[0_6px_18px_-4px_var(--tw-shadow-color)] transition-all duration-200 hover:shadow-lg active:scale-[0.98] disabled:opacity-60 disabled:active:scale-100 ${
              filtersStale ? "ring-2 ring-amber-400 ring-offset-2" : ""
            }`}
            style={{ background: accent, ["--tw-shadow-color" as string]: `${accent}55` }}
          >
            <span
              aria-hidden
              className="absolute inset-0 -translate-x-full bg-linear-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 group-hover:translate-x-full"
            />
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Route className="h-4 w-4 transition-transform duration-200 group-hover:scale-110" />
            )}
            View route
          </button>

          {formError && (
            <p className="animate-in fade-in slide-in-from-top-1 mt-2 text-xs text-rose-600 duration-200">
              {formError}
            </p>
          )}
        </CollapsiblePanel>

        {/* Stats panel */}
        {hasRoute && (
          <CollapsiblePanel
            title={selectedLabel || "Trip stats"}
            subtitle={selectedDeviceId ? `ID ${selectedDeviceId.slice(0, 12)}…` : undefined}
            minimized={statsMinimized}
            onToggle={() => setStatsMinimized((v) => !v)}
            accent={accent}
            actions={
              <>
                <IconBtn title="Export CSV" onClick={exportCsv}>
                  <Download className="h-4 w-4" />
                </IconBtn>
                <IconBtn title="Print / PDF" onClick={() => window.print()}>
                  <Printer className="h-4 w-4" />
                </IconBtn>
              </>
            }
          >
            <div className="grid grid-cols-2 gap-2 text-xs">
              <Stat icon={<Ruler className="h-3 w-3" />} label="Distance" value={`${stats!.distanceKm.toFixed(2)} km`} />
              <Stat icon={<Clock className="h-3 w-3" />} label="Driving" value={formatDuration(stats!.drivingMs)} />
              <Stat icon={<PauseCircle className="h-3 w-3" />} label="Idle" value={formatDuration(stats!.idleMs)} />
              <Stat icon={<Gauge className="h-3 w-3" />} label="Avg / Max" value={`${stats!.avgKmh.toFixed(0)} / ${stats!.maxKmh.toFixed(0)}`} />
              <Stat icon={<MapPin className="h-3 w-3" />} label="Stops" value={`${stats!.stops}`} />
              <Stat icon={<AlertTriangle className="h-3 w-3" />} label="Violations" value={`${violations.length}`} />
              {battery && (
                <Stat
                  icon={<BatteryMedium className="h-3 w-3" />}
                  label="Battery"
                  value={`${battery.startPercent}% → ${battery.endPercent}%`}
                  hint={`Low ${battery.minPercent}% · ${
                    battery.dropPercent > 0 ? `-${battery.dropPercent}` : `+${-battery.dropPercent}`
                  }% over the route`}
                />
              )}
            </div>

            <div className="mt-2 space-y-1.5 border-t border-slate-100 pt-2 text-xs">
              <p className="flex items-start gap-1.5 text-slate-600">
                <Flag className="mt-0.5 h-3 w-3 shrink-0 text-emerald-500" />
                <span className="line-clamp-2" title={startPlace}>
                  {startPlace || "Resolving start…"}
                </span>
              </p>
              <p className="flex items-start gap-1.5 text-slate-600">
                <Flag className="mt-0.5 h-3 w-3 shrink-0 text-rose-500" />
                <span className="line-clamp-2" title={endPlace}>
                  {endPlace || "Resolving end…"}
                </span>
              </p>
              {roadMatch && roadMatch.pct < 0.98 && (
                <p
                  className={`flex items-start gap-1.5 ${
                    roadMatch.pct < 0.5 ? "text-rose-600" : "text-amber-600"
                  }`}
                  title={
                    roadMatch.snapped === 0
                      ? "Road matching is off or unavailable (check the Roads API key on the server), so the line joins raw GPS fixes directly and can cut across buildings."
                      : `${roadMatch.snapped} of ${roadMatch.total} points sit on a matched road; the rest are raw GPS and may leave the carriageway.`
                  }
                >
                  <Route className="mt-0.5 h-3 w-3 shrink-0" />
                  <span>
                    {roadMatch.snapped === 0
                      ? "Raw GPS — not road-matched"
                      : `${Math.round(roadMatch.pct * 100)}% road-matched`}
                  </span>
                </p>
              )}
            </div>
          </CollapsiblePanel>
        )}

        {/* Idle Stops — placed below the main route/stats info, one row per
            stop with its exact start, end, duration and location so it maps
            1:1 onto the idle markers plotted on the route. */}
        {hasRoute && (
          <CollapsiblePanel
            title="Idle Stops"
            subtitle={`${idleEvents.length}`}
            minimized={idleMinimized}
            onToggle={() => setIdleMinimized((v) => !v)}
            accent={accent}
          >
            {idleEvents.length === 0 ? (
              <p className="py-4 text-center text-xs text-slate-400">No idle stops in this interval</p>
            ) : (
              <div className="max-h-[min(32vh,16rem)] space-y-1.5 overflow-y-auto">
                {idleEvents.map((e, i) => (
                  <IdleStopRow
                    key={e.id}
                    index={i + 1}
                    event={e}
                    batteryPercent={batteryAt(displayedPoints, e.startIdx)}
                    active={mapSelection?.kind === "idle" && mapSelection.id === e.id}
                    onClick={() => setFocus({ type: "idle", id: e.id })}
                  />
                ))}
              </div>
            )}
          </CollapsiblePanel>
        )}

        {/* Event timeline */}
        {hasRoute && (
          <CollapsiblePanel
            title="Events"
            subtitle={`${timeline.length}`}
            minimized={timelineMinimized}
            onToggle={() => setTimelineMinimized((v) => !v)}
            accent={accent}
          >
            <div className="mb-2 flex flex-wrap gap-1">
              {(
                [
                  ["all", "All"],
                  ["violations", "Speeding"],
                  ["max", "Max"],
                  ["trips", "Trips"],
                ] as [EventFilter, string][]
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setEventFilter(key)}
                  style={eventFilter === key ? { background: accent, boxShadow: `0 4px 12px -3px ${accent}80` } : undefined}
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-all duration-200 ${
                    eventFilter === key
                      ? "scale-105 text-white"
                      : "bg-slate-100 text-slate-600 hover:-translate-y-0.5 hover:bg-slate-200 active:scale-95"
                  }`}
                >
                  {key === "all" && <Filter className="h-3 w-3" />}
                  {label}
                </button>
              ))}
            </div>

            <div className="max-h-[min(32vh,16rem)] space-y-1 overflow-y-auto">
              {timeline.length === 0 ? (
                <p className="py-4 text-center text-xs text-slate-400">No events for this filter</p>
              ) : (
                timeline.map((it, i) => {
                  const selected =
                    (it.kind === "start" && mapSelection?.kind === "start") ||
                    (it.kind === "end" && mapSelection?.kind === "end") ||
                    (it.kind === "max" && mapSelection?.kind === "max") ||
                    (it.kind === "violation" &&
                      mapSelection?.kind === "violation" &&
                      mapSelection.id === it.id);
                  return (
                  <button
                    key={it.id}
                    type="button"
                    data-timeline-id={it.id}
                    onClick={() => {
                      if (it.kind === "trip") {
                        const sid = it.id.replace(/^trip-/, "");
                        setSelectedSubTrip(sid);
                      }
                      setFocus(it.focus);
                    }}
                    style={{ animationDelay: `${Math.min(i, 20) * 20}ms` }}
                    className={`animate-in fade-in slide-in-from-left-1 flex w-full items-start gap-2 rounded-xl px-2 py-2 text-left transition-all duration-200 fill-mode-both hover:translate-x-0.5 hover:bg-slate-50 ${
                      selected ? "bg-indigo-50 ring-1 ring-indigo-200" : ""
                    }`}
                  >
                    <span className="mt-0.5">{kindIcon(it.kind)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium text-slate-800">
                        {it.title}
                      </span>
                      <span className="block truncate text-[11px] text-slate-500">{it.subtitle}</span>
                    </span>
                  </button>
                  );
                })
              )}
            </div>
          </CollapsiblePanel>
        )}
      </div>

      {/* ─── Right: trips list ─── */}
      {hasQueried && sessions.length > 0 && (
        <div className="absolute right-3 top-3 z-[1100] w-[min(calc(100%-1.5rem),18rem)] sm:right-4 sm:top-4">
          <CollapsiblePanel
            title={`Trips (${sessions.length})`}
            minimized={tripsMinimized}
            onToggle={() => setTripsMinimized((v) => !v)}
            accent={accent}
          >
            <div className="max-h-[min(50vh,22rem)] space-y-1 overflow-y-auto">
              <button
                type="button"
                onClick={() => {
                  setSelectedSubTrip(null);
                  setFocus({ type: "bounds" });
                }}
                style={selectedSubTrip === null ? { background: accent, boxShadow: `0 4px 14px -4px ${accent}80` } : undefined}
                className={`w-full rounded-xl px-3 py-2 text-left text-xs transition-all duration-200 ${
                  selectedSubTrip === null
                    ? "font-semibold text-white"
                    : "text-slate-600 hover:translate-x-0.5 hover:bg-slate-50"
                }`}
              >
                All trips · {points.length} pts
              </button>
              {sessions.map((s, i) => {
                const sPts = points.filter((p) => p.sessionId === s.sessionId).length;
                const active = selectedSubTrip === s.sessionId;
                return (
                  <button
                    key={s._id}
                    type="button"
                    onClick={() => {
                      setSelectedSubTrip(s.sessionId);
                      setFocus({ type: "bounds" });
                    }}
                    style={{
                      animationDelay: `${Math.min(i, 20) * 25}ms`,
                      ...(active ? { background: accent, boxShadow: `0 4px 14px -4px ${accent}80` } : undefined),
                    }}
                    className={`animate-in fade-in slide-in-from-right-1 w-full rounded-xl border px-3 py-2 text-left transition-all duration-200 fill-mode-both ${
                      active
                        ? "scale-[1.02] border-transparent text-white"
                        : "border-transparent hover:translate-x-0.5 hover:bg-slate-50"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className={`truncate text-xs font-medium ${active ? "text-white" : "text-slate-900"}`}>
                        {selectedLabel || s.deviceId}
                      </span>
                      {!active && (
                        <span
                          className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                            STATUS_CHIP[s.status] || "bg-slate-400 text-white"
                          }`}
                        >
                          {s.status}
                        </span>
                      )}
                    </div>
                    <p className={`mt-1 text-[11px] ${active ? "text-white/80" : "text-slate-500"}`}>
                      {format(new Date(s.startedAt), "MMM dd, HH:mm")}
                      {s.stoppedAt && ` – ${format(new Date(s.stoppedAt), "HH:mm")}`}
                    </p>
                    <p className={`mt-0.5 text-[11px] ${active ? "text-white/70" : "text-slate-400"}`}>
                      {sPts || s.totalPoints} pts
                    </p>
                  </button>
                );
              })}
            </div>
          </CollapsiblePanel>
        </div>
      )}

      {/* ─── Map legend (bottom-left) ─── */}
      {hasRoute && (
        <div className="animate-in fade-in slide-in-from-left-2 absolute bottom-20 left-3 z-[1100] max-h-[min(60vh,26rem)] overflow-y-auto duration-300 sm:bottom-24 sm:left-4">
          <div className="overflow-hidden rounded-2xl border border-white/60 bg-white/90 shadow-[0_8px_28px_-8px_rgba(15,23,42,0.22)] backdrop-blur-xl">
            <button
              type="button"
              onClick={() => setLegendOpen((v) => !v)}
              className="flex w-full items-center justify-between gap-3 px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
            >
              <span>Map legend</span>
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform duration-300 ${legendOpen ? "" : "-rotate-180"}`}
              />
            </button>
            <div
              className="grid transition-[grid-template-rows] duration-300 ease-out"
              style={{ gridTemplateRows: legendOpen ? "1fr" : "0fr" }}
            >
              <div className="overflow-hidden">
              <div className="space-y-3 border-t border-slate-100 px-3 py-2">
                {/* States — matches the marker glyphs plotted on the route */}
                <div className="space-y-1.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    States
                  </p>
                  <LegendRow color="#10b981" glyph="S" label="Start" />
                  <LegendRow color="#ef4444" glyph="E" label="End" />
                  <LegendRow color={IDLE_COLOR} glyph="⏸" label="Idle / stopped" />
                  <LegendRow color={accent} glyph="➤" label="Moving (device accent)" />
                  <LegendRow color={VIOLATION_COLOR} glyph="!" label="Speeding" />
                  <LegendRow color="#f59e0b" glyph="⚡" label="Max speed" />
                </div>
                {/* Speed — colours the drawn route by how fast each leg was */}
                <div className="space-y-1.5 border-t border-slate-100 pt-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    Speed
                  </p>
                  {SPEED_BANDS.map((b) => (
                    <div key={b.band} className="flex items-center gap-2 text-[11px] text-slate-600">
                      <span className="h-2.5 w-6 rounded-full" style={{ background: b.color }} />
                      <span>
                        {b.label}
                        {b.maxKmh !== Infinity ? ` (< ${b.maxKmh} km/h)` : " (≥ 70 km/h)"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── Playback bar ─── */}
      {hasRoute && displayedPoints.length > 1 && (
        <div className="animate-in fade-in slide-in-from-bottom-2 absolute bottom-3 left-1/2 z-[1100] w-[min(720px,calc(100%-1.5rem))] -translate-x-1/2 duration-300 sm:bottom-4">
          <div className="flex items-center gap-3 rounded-full border border-white/60 bg-white/90 px-3 py-2 shadow-[0_10px_32px_-8px_rgba(15,23,42,0.3)] backdrop-blur-xl">
            <button
              type="button"
              onClick={togglePlay}
              className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white transition-transform duration-200 hover:scale-110 hover:brightness-110 active:scale-95"
              style={{ background: accent, boxShadow: `0 4px 14px -3px ${accent}99` }}
              aria-label={isPlaying ? "Pause" : "Play"}
            >
              {isPlaying && (
                <span
                  aria-hidden
                  className="absolute inset-0 animate-ping rounded-full opacity-40"
                  style={{ background: accent }}
                />
              )}
              <span className="relative">
                {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 translate-x-0.5" />}
              </span>
            </button>
            <span className="w-16 shrink-0 font-mono text-xs tabular-nums text-slate-600">
              {playbackTime}
            </span>

            <div className="relative min-w-0 flex-1">
              {idleTrackGradient && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full"
                  style={{ backgroundImage: idleTrackGradient }}
                />
              )}
              <input
                type="range"
                min={0}
                max={Math.max(0, displayedPoints.length - 1)}
                value={playbackIndex ?? 0}
                onChange={(e) => {
                  setIsPlaying(false);
                  setPlaybackIndex(Number(e.target.value));
                }}
                className="relative w-full bg-transparent"
                style={{ accentColor: accent }}
              />
            </div>

            {/* Live idle + battery readouts, alongside the existing time/speed */}
            <div className="hidden shrink-0 items-center gap-1.5 sm:flex">
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold tabular-nums ${
                  activeIdle ? "bg-purple-100 text-purple-700" : "bg-slate-100 text-slate-500"
                }`}
                title={
                  activeIdle
                    ? `Stopped here for ${formatDurationPrecise(activeIdle.durationMs)} · ${formatDurationPrecise(idleSoFarMs)} idle so far`
                    : `${formatDurationPrecise(idleSoFarMs)} idle so far · ${formatDurationPrecise(stats!.idleMs)} total`
                }
              >
                <PauseCircle className="h-3 w-3" />
                {activeIdle
                  ? formatDurationPrecise(activeIdleElapsedMs)
                  : formatDurationPrecise(idleSoFarMs)}
              </span>
              {cursorBattery != null && (
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold tabular-nums ${
                    cursorBattery <= 15
                      ? "bg-rose-100 text-rose-700"
                      : cursorBattery <= 35
                        ? "bg-amber-100 text-amber-700"
                        : "bg-emerald-100 text-emerald-700"
                  }`}
                  title={
                    battery
                      ? `Battery ${cursorBattery}% · route ${battery.startPercent}% → ${battery.endPercent}% (low ${battery.minPercent}%)`
                      : `Battery ${cursorBattery}%`
                  }
                >
                  <BatteryMedium className="h-3 w-3" />
                  {cursorBattery}%
                </span>
              )}
            </div>

            <div className="flex shrink-0 gap-1">
              {PLAYBACK_SPEEDS.map((sp) => (
                <button
                  key={sp}
                  type="button"
                  onClick={() => setSpeed(sp)}
                  className={`rounded-full px-2 py-1 text-xs font-semibold transition-all duration-200 ${
                    speed === sp
                      ? "scale-110 text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200 active:scale-95"
                  }`}
                  style={speed === sp ? { background: accent, boxShadow: `0 3px 10px -2px ${accent}80` } : undefined}
                >
                  {sp}×
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {!isLoading && hasQueried && !hasRoute && (
        <div className="animate-in fade-in zoom-in-95 pointer-events-none absolute inset-x-0 bottom-16 z-[1000] flex justify-center px-4 duration-300">
          <div className="rounded-2xl border border-white/60 bg-white/95 px-4 py-3 text-center shadow-[0_8px_28px_-8px_rgba(15,23,42,0.3)] backdrop-blur-xl">
            <p className="text-sm font-medium text-slate-800">No GPS points in this interval</p>
            <p className="mt-0.5 text-xs text-slate-500">Try another device, day, or time range.</p>
          </div>
        </div>
      )}

      {!isLoading && !hasQueried && (
        <div className="animate-in fade-in slide-in-from-bottom-2 pointer-events-none absolute inset-x-0 bottom-8 z-[1000] flex justify-center px-4 duration-500">
          <div className="rounded-full border border-white/60 bg-white/95 px-4 py-2 text-xs font-medium text-slate-600 shadow-lg backdrop-blur-xl">
            Search by name, set the interval, then View route
          </div>
        </div>
      )}
    </div>
  );
}

function CollapsiblePanel({
  title,
  subtitle,
  minimized,
  onToggle,
  children,
  actions,
  accent,
  leading,
}: {
  title: string;
  subtitle?: string;
  minimized: boolean;
  onToggle: () => void;
  children: ReactNode;
  actions?: ReactNode;
  accent?: string;
  leading?: ReactNode;
}) {
  return (
    <div className="animate-in fade-in slide-in-from-left-2 overflow-hidden rounded-3xl border border-white/60 bg-white/90 shadow-[0_8px_28px_-8px_rgba(15,23,42,0.22)] backdrop-blur-xl duration-300 fill-mode-both">
      {accent && (
        <div
          className="h-0.75 w-full opacity-90"
          style={{ background: `linear-gradient(90deg, ${accent}, color-mix(in srgb, ${accent} 40%, transparent))` }}
        />
      )}
      <div className="flex items-center gap-2 px-3.5 py-2.5">
        {leading}
        {accent && (
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full ring-4"
            style={{ background: accent, ["--tw-ring-color" as string]: `${accent}26` }}
          />
        )}
        <button
          type="button"
          onClick={onToggle}
          className="min-w-0 flex-1 text-left"
        >
          <p className="truncate text-xs font-bold uppercase tracking-wide text-slate-600">
            {title}
          </p>
          {subtitle && (
            <p className="truncate font-mono text-[10px] text-slate-400">{subtitle}</p>
          )}
        </button>
        <div className="flex shrink-0 items-center gap-0.5">
          {actions}
          <button
            type="button"
            onClick={onToggle}
            className="rounded-full p-1.5 text-slate-400 transition-all duration-200 hover:bg-slate-100 hover:text-slate-700 active:scale-90"
            aria-label={minimized ? "Expand" : "Minimize"}
            title={minimized ? "Expand" : "Minimize"}
          >
            <ChevronDown
              className={`h-4 w-4 transition-transform duration-300 ${minimized ? "" : "-rotate-180"}`}
            />
          </button>
        </div>
      </div>
      <div
        className="grid transition-[grid-template-rows] duration-300 ease-out"
        style={{ gridTemplateRows: minimized ? "0fr" : "1fr" }}
      >
        <div className="overflow-hidden">
          <div className="border-t border-slate-100 p-3">{children}</div>
        </div>
      </div>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  hint,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div
      className="group rounded-xl bg-slate-50 px-2.5 py-2 transition-all duration-200 hover:-translate-y-0.5 hover:bg-slate-100 hover:shadow-sm"
      title={hint}
    >
      <p className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-slate-400">
        <span className="transition-transform duration-200 group-hover:scale-110">{icon}</span>
        {label}
      </p>
      <p className="mt-0.5 text-sm font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function IconBtn({
  children,
  onClick,
  title,
}: {
  children: ReactNode;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="rounded-full p-1.5 text-slate-500 transition-all duration-200 hover:bg-slate-100 hover:text-slate-800 active:scale-90"
    >
      {children}
    </button>
  );
}

/** One row in the Map legend's States section — mirrors a marker's PinGlyph. */
function LegendRow({ color, glyph, label }: { color: string; glyph: string; label: string }) {
  return (
    <div className="group flex items-center gap-2 text-[11px] text-slate-600">
      <span
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white shadow-sm transition-transform duration-200 group-hover:scale-125"
        style={{ background: color }}
      >
        {glyph}
      </span>
      <span>{label}</span>
    </div>
  );
}

/**
 * One row per idle stop: exact start, end, duration and the coordinate the
 * vehicle was actually parked at (idle.latitude/longitude are the recorded
 * fix at startIdx — the same point drawn as the idle marker on the map), so
 * this list and the markers never disagree.
 */
function IdleStopRow({
  index,
  event,
  batteryPercent,
  active,
  onClick,
}: {
  index: number;
  event: IdleEvent;
  batteryPercent: number | null;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-idle-id={event.id}
      onClick={onClick}
      style={{ animationDelay: `${Math.min(index - 1, 20) * 20}ms` }}
      className={`animate-in fade-in slide-in-from-left-1 w-full rounded-xl px-3 py-2 text-left transition-all duration-200 fill-mode-both hover:-translate-y-0.5 hover:shadow-sm ${
        active ? "bg-indigo-50 ring-1 ring-indigo-200" : "bg-slate-50 hover:bg-slate-100"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
          <PauseCircle className="h-3.5 w-3.5 text-purple-500" />
          Stop {index}
        </span>
        <span className="rounded-full bg-purple-100 px-2 py-0.5 text-[11px] font-semibold text-purple-700">
          {formatDuration(event.durationMs)}
        </span>
      </div>
      <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
        <span>
          Start <span className="font-medium text-slate-700">{format(new Date(event.startTime), "HH:mm:ss")}</span>
        </span>
        <span>
          End <span className="font-medium text-slate-700">{format(new Date(event.endTime), "HH:mm:ss")}</span>
        </span>
        <span className="col-span-2 font-mono text-slate-500">
          {event.latitude.toFixed(5)}, {event.longitude.toFixed(5)}
        </span>
        {batteryPercent != null && <span className="col-span-2">Battery {batteryPercent}%</span>}
      </div>
    </button>
  );
}
