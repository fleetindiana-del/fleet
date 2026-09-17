// Shared analytics for Route History: speed bands, idle detection, speeding
// violations, max-speed, per-device colour, and trip statistics.

export interface RoutePoint {
  pointId?: string;
  sessionId?: string;
  sequenceNumber?: number;
  latitude: number;
  longitude: number;
  recordedAt: string;
  speedMetersPerSecond?: number;
  bearingDegrees?: number;
  accuracyMeters?: number;
  altitudeMeters?: number;
  batteryPercent?: number;
  provider?: string;
  isMockLocation?: boolean;
  /** Road geometry filled in between two fixes, not a surveyed sample. */
  isInterpolated?: boolean;
  /** The fix was map-matched onto the road network. */
  isRoadSnapped?: boolean;
  /** Recorded during a standstill and held at the position it was recorded at. */
  isStationary?: boolean;
  /** Where the fix sat before map-matching. */
  rawLatitude?: number;
  rawLongitude?: number;
}

export type SpeedBand = "idle" | "normal" | "moderate" | "high";

/**
 * Purple is the route's stopped colour — idle markers, the idle stretch of the
 * drawn line, the scrubber bands and the timeline all use it, so a stop reads
 * as the same thing wherever it appears.
 */
export const IDLE_COLOR = "#a855f7";

// Upper bound (km/h, exclusive) for each band; "high" is everything above.
export const SPEED_BANDS: {
  band: SpeedBand;
  label: string;
  maxKmh: number;
  color: string;
}[] = [
  { band: "idle", label: "Idle / Stopped", maxKmh: 3, color: IDLE_COLOR },
  { band: "normal", label: "Normal", maxKmh: 40, color: "#10b981" },
  { band: "moderate", label: "Moderate", maxKmh: 70, color: "#f59e0b" },
  { band: "high", label: "High", maxKmh: Infinity, color: "#ef4444" },
];

export const VIOLATION_COLOR = "#dc2626";

export function speedKmh(p: RoutePoint): number {
  return Math.max(0, (p.speedMetersPerSecond ?? 0) * 3.6);
}

export function bandForSpeed(kmh: number): SpeedBand {
  for (const b of SPEED_BANDS) if (kmh < b.maxKmh) return b.band;
  return "high";
}

export function colorForSpeed(kmh: number): string {
  return SPEED_BANDS.find((b) => b.band === bandForSpeed(kmh))!.color;
}

/** Haversine distance in metres. */
export function haversineM(a: RoutePoint, b: RoutePoint): number {
  const R = 6371000;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const dLat = lat2 - lat1;
  const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Bearing in degrees (0=N, 90=E) from a → b. */
export function bearingDeg(a: RoutePoint, b: RoutePoint): number {
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180) / Math.PI + 360;
}

/** Smallest displacement (m) that counts as real movement rather than GPS jitter. */
const HEADING_MIN_MOVE_M = 8;
/** How far to look for a moving neighbour before giving up on geometry. */
const HEADING_LOOKAROUND = 8;

/**
 * Heading for a point, derived from geometry first.
 *
 * The reported `bearingDegrees` is unusable while a vehicle is stopped — Android
 * emits 0.0 when it has no fix on the direction of travel — so trusting it made
 * the playback arrow snap north for the whole of every idle period and again on
 * the first fix after it. Walking back to the nearest point that actually moved
 * holds the last true direction through a stop and picks the new one up as soon
 * as the vehicle rolls, which keeps the arrow continuous across idle events.
 */
export function headingAt(points: RoutePoint[], idx: number): number {
  const p = points[idx];
  if (!p) return 0;

  for (let j = idx - 1; j >= 0 && idx - j <= HEADING_LOOKAROUND; j--) {
    if (haversineM(points[j], p) >= HEADING_MIN_MOVE_M) return bearingDeg(points[j], p) % 360;
  }
  for (let j = idx + 1; j < points.length && j - idx <= HEADING_LOOKAROUND; j++) {
    if (haversineM(p, points[j]) >= HEADING_MIN_MOVE_M) return bearingDeg(p, points[j]) % 360;
  }

  if (p.bearingDegrees != null) return ((p.bearingDegrees % 360) + 360) % 360;
  return 0;
}

// ─── Colored polyline segments (consecutive points grouped by band) ──────────
export interface ColoredSegment {
  color: string;
  band: SpeedBand;
  positions: [number, number][];
  /** True when the samples either side are far apart in time — logging gap. */
  isGap: boolean;
}

/** Interval longer than this is treated as a logging gap, not a sampled leg. */
const GAP_MS = 5 * 60_000;
/** Below this displacement a long interval is a stop, not a gap. */
const STATIONARY_RADIUS_M = 60;
/**
 * Above this interval, the two endpoint speed readings are instantaneous samples
 * that say nothing about the leg between them — use the implied speed instead.
 */
const IMPLIED_SPEED_MIN_MS = 15_000;

/** Average speed (km/h) actually travelled between two samples. */
function intervalKmh(a: RoutePoint, b: RoutePoint): number {
  const dtMs = new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime();
  const reported = (speedKmh(a) + speedKmh(b)) / 2;
  if (!Number.isFinite(dtMs) || dtMs <= 0) return reported;
  const implied = (haversineM(a, b) / (dtMs / 1000)) * 3.6;
  // Short intervals: the implied speed is dominated by GPS jitter, so the
  // reported readings are the better estimate. Long ones (a stop collapsed by
  // the track filter, or a downsampled leg) are the other way round — reporting
  // the pre-stop speed there painted parked stretches as high-speed red.
  return dtMs >= IMPLIED_SPEED_MIN_MS ? implied : reported;
}

export function speedSegments(points: RoutePoint[]): ColoredSegment[] {
  if (points.length < 2) return [];
  const segments: ColoredSegment[] = [];
  let current: ColoredSegment | null = null;

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    const kmh = intervalKmh(prev, cur);
    const band = bandForSpeed(kmh);
    const color = colorForSpeed(kmh);

    const dtMs = new Date(cur.recordedAt).getTime() - new Date(prev.recordedAt).getTime();
    const isGap = dtMs >= GAP_MS && haversineM(prev, cur) > STATIONARY_RADIUS_M;

    const a: [number, number] = [prev.latitude, prev.longitude];
    const b: [number, number] = [cur.latitude, cur.longitude];

    if (current && current.band === band && current.isGap === isGap) {
      current.positions.push(b);
    } else {
      // Each new run restarts at the previous point so the drawn route stays
      // unbroken across band changes.
      current = { color, band, positions: [a, b], isGap };
      segments.push(current);
    }
  }
  return segments;
}

// ─── Idle events ─────────────────────────────────────────────────────────────
export interface IdleEvent {
  id: string;
  startIdx: number;
  endIdx: number;
  latitude: number;
  longitude: number;
  startTime: string;
  endTime: string;
  durationMs: number;
}

/**
 * Find the stretches where the vehicle was parked.
 *
 * Detection is per-interval rather than per-point. `/api/location/history` runs
 * the trail through `filterGpsTrack`, which collapses a standstill down to a
 * keepalive fix every few minutes — so a stop is often represented by two
 * samples whose *reported* speeds are both non-zero (the last reading before
 * stopping and the first after pulling away). Testing point speeds alone missed
 * those stops entirely and charged the time to driving, which is what made both
 * the idle total and the average speed wrong. Comparing displacement against
 * elapsed time recovers them: no distance covered over minutes is a stop, no
 * matter what the individual fixes claim.
 */
export function detectIdleEvents(
  points: RoutePoint[],
  opts: { minIdleMs?: number; idleSpeedKmh?: number; idleRadiusM?: number } = {}
): IdleEvent[] {
  const minIdleMs = opts.minIdleMs ?? 3 * 60_000;
  const idleSpeedKmh = opts.idleSpeedKmh ?? 3;
  const idleRadiusM = opts.idleRadiusM ?? STATIONARY_RADIUS_M;
  const events: IdleEvent[] = [];

  let runStart = -1;
  const flush = (endIdx: number) => {
    if (runStart < 0 || endIdx <= runStart) {
      runStart = -1;
      return;
    }
    const s = points[runStart];
    const e = points[endIdx];
    const durationMs = new Date(e.recordedAt).getTime() - new Date(s.recordedAt).getTime();
    if (durationMs >= minIdleMs) {
      events.push({
        id: `idle-${runStart}-${endIdx}`,
        startIdx: runStart,
        endIdx,
        latitude: s.latitude,
        longitude: s.longitude,
        startTime: s.recordedAt,
        endTime: e.recordedAt,
        durationMs,
      });
    }
    runStart = -1;
  };

  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const dtMs = new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime();
    const dist = haversineM(a, b);
    const impliedKmh = dtMs > 0 ? (dist / (dtMs / 1000)) * 3.6 : 0;

    const stationary =
      dist <= idleRadiusM &&
      (impliedKmh <= idleSpeedKmh ||
        (speedKmh(a) <= idleSpeedKmh && speedKmh(b) <= idleSpeedKmh));

    if (stationary) {
      if (runStart < 0) runStart = i - 1;
    } else {
      // The stop ends at the last stationary sample, i-1, not at this moving one.
      flush(i - 1);
    }
  }
  flush(points.length - 1);
  return events;
}

/** The idle event the cursor sits inside, if any. */
export function idleEventAt(events: IdleEvent[], idx: number): IdleEvent | null {
  return events.find((e) => idx >= e.startIdx && idx <= e.endIdx) ?? null;
}

export type PointStatus = "start" | "end" | "idle" | "moving";

/** What the vehicle was doing at [idx] — drives the Start/End/Idle/Moving badge on a data point. */
export function statusAt(points: RoutePoint[], idle: IdleEvent[], idx: number): PointStatus {
  if (idx <= 0) return "start";
  if (idx >= points.length - 1) return "end";
  return idleEventAt(idle, idx) ? "idle" : "moving";
}

/** Distance travelled (km) from the start of the route up to and including [idx]. */
export function distanceUpToKm(points: RoutePoint[], idx: number): number {
  let m = 0;
  const end = Math.min(idx, points.length - 1);
  for (let i = 1; i <= end; i++) m += haversineM(points[i - 1], points[i]);
  return m / 1000;
}

/**
 * Idle time accumulated from the start of the route up to (and including) [idx],
 * counting only the elapsed part of a stop the cursor is currently inside.
 */
export function idleMsUpTo(events: IdleEvent[], points: RoutePoint[], idx: number): number {
  const at = points[idx] ? new Date(points[idx].recordedAt).getTime() : 0;
  let total = 0;
  for (const e of events) {
    if (e.endIdx <= idx) {
      total += e.durationMs;
    } else if (e.startIdx <= idx) {
      total += Math.max(0, at - new Date(e.startTime).getTime());
    }
  }
  return total;
}

// ─── Speed-limit violations ──────────────────────────────────────────────────
export interface ViolationSegment {
  id: string;
  startIdx: number;
  endIdx: number;
  peakIdx: number;
  peakKmh: number;
  startTime: string;
  endTime: string;
  durationMs: number;
  positions: [number, number][];
}

export function detectViolations(
  points: RoutePoint[],
  limitKmh: number
): ViolationSegment[] {
  if (!limitKmh || limitKmh <= 0) return [];
  const out: ViolationSegment[] = [];
  let start = -1;
  let peakIdx = -1;
  let peak = 0;

  const flush = (endIdx: number) => {
    if (start < 0) return;
    const s = points[start];
    const e = points[endIdx];
    out.push({
      id: `viol-${start}-${endIdx}`,
      startIdx: start,
      endIdx,
      peakIdx,
      peakKmh: peak,
      startTime: s.recordedAt,
      endTime: e.recordedAt,
      durationMs: new Date(e.recordedAt).getTime() - new Date(s.recordedAt).getTime(),
      positions: points.slice(start, endIdx + 1).map((p) => [p.latitude, p.longitude]),
    });
    start = -1;
    peakIdx = -1;
    peak = 0;
  };

  for (let i = 0; i < points.length; i++) {
    const kmh = speedKmh(points[i]);
    if (kmh > limitKmh) {
      if (start < 0) start = i;
      if (kmh > peak) {
        peak = kmh;
        peakIdx = i;
      }
    } else {
      flush(i - 1 >= start ? i - 1 : start);
    }
  }
  flush(points.length - 1);
  return out.filter((v) => v.startIdx >= 0);
}

// ─── Max speed point ─────────────────────────────────────────────────────────
export interface MaxSpeed {
  idx: number;
  kmh: number;
  time: string;
  latitude: number;
  longitude: number;
}

export function maxSpeedPoint(points: RoutePoint[]): MaxSpeed | null {
  let best = -1;
  let bestKmh = -1;
  for (let i = 0; i < points.length; i++) {
    // Road-geometry fillers carry a speed interpolated across the leg, not a
    // reading — reporting one as the trip's maximum would credit the vehicle
    // with a speed no device ever measured.
    if (points[i].isInterpolated) continue;
    const kmh = speedKmh(points[i]);
    if (kmh > bestKmh) {
      bestKmh = kmh;
      best = i;
    }
  }
  if (best < 0) return null;
  return {
    idx: best,
    kmh: bestKmh,
    time: points[best].recordedAt,
    latitude: points[best].latitude,
    longitude: points[best].longitude,
  };
}

// ─── Trip statistics ─────────────────────────────────────────────────────────
export interface TripStats {
  distanceKm: number;
  totalMs: number;
  idleMs: number;
  drivingMs: number;
  avgKmh: number;
  maxKmh: number;
  stops: number;
}

export function tripStats(points: RoutePoint[], idle: IdleEvent[]): TripStats | null {
  if (points.length === 0) return null;
  let distanceM = 0;
  for (let i = 1; i < points.length; i++) distanceM += haversineM(points[i - 1], points[i]);
  const totalMs =
    new Date(points[points.length - 1].recordedAt).getTime() -
    new Date(points[0].recordedAt).getTime();
  const idleMs = idle.reduce((a, e) => a + e.durationMs, 0);
  const drivingMs = Math.max(0, totalMs - idleMs);
  const speeds = points.map(speedKmh).filter((s) => s >= 0);
  const maxKmh = speeds.length ? Math.max(...speeds) : 0;
  const drivingHours = drivingMs / 3_600_000;
  const avgKmh = drivingHours > 0 ? distanceM / 1000 / drivingHours : 0;
  return {
    distanceKm: distanceM / 1000,
    totalMs,
    idleMs,
    drivingMs,
    avgKmh,
    maxKmh,
    stops: idle.length,
  };
}

export function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  // Sub-minute stops used to render as a bare "0m", which read as "no idle at
  // all" during playback. Show seconds until there is a minute to show.
  if (totalSec < 60) return `${totalSec}s`;
  const mins = Math.floor(totalSec / 60);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

/** Duration with seconds retained under an hour — for the live playback readout. */
export function formatDurationPrecise(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// ─── Battery ─────────────────────────────────────────────────────────────────
export interface BatteryStats {
  startPercent: number;
  endPercent: number;
  minPercent: number;
  maxPercent: number;
  /** Positive when the battery drained over the route. */
  dropPercent: number;
}

/**
 * Battery level at [idx]. Not every fix carries one, so fall back to the nearest
 * reading either side — the level is a slow-moving signal and a hole in the
 * samples should not blank the readout mid-playback.
 */
export function batteryAt(points: RoutePoint[], idx: number): number | null {
  if (points[idx]?.batteryPercent != null) return points[idx].batteryPercent!;
  for (let d = 1; d < points.length; d++) {
    const before = points[idx - d];
    if (before?.batteryPercent != null) return before.batteryPercent;
    const after = points[idx + d];
    if (after?.batteryPercent != null) return after.batteryPercent;
    if (idx - d < 0 && idx + d >= points.length) break;
  }
  return null;
}

export function batteryStats(points: RoutePoint[]): BatteryStats | null {
  const levels = points
    .map((p) => p.batteryPercent)
    .filter((v): v is number => v != null && Number.isFinite(v));
  if (levels.length === 0) return null;
  const startPercent = levels[0];
  const endPercent = levels[levels.length - 1];
  return {
    startPercent,
    endPercent,
    minPercent: Math.min(...levels),
    maxPercent: Math.max(...levels),
    dropPercent: startPercent - endPercent,
  };
}

// ─── Per-device colour ───────────────────────────────────────────────────────
const DEVICE_PALETTE = [
  "#6366f1", // indigo
  "#0ea5e9", // sky
  "#14b8a6", // teal
  "#f97316", // orange
  "#ec4899", // pink
  "#8b5cf6", // violet
  "#22c55e", // green
  "#eab308", // amber
  "#ef4444", // red
  "#06b6d4", // cyan
];

export function deviceColor(deviceId: string): string {
  let hash = 0;
  for (let i = 0; i < deviceId.length; i++) {
    hash = (hash * 31 + deviceId.charCodeAt(i)) | 0;
  }
  return DEVICE_PALETTE[Math.abs(hash) % DEVICE_PALETTE.length];
}
