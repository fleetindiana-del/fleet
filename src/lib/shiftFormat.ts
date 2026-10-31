/** Display helpers for the shift screens (admin board and driver portal). */

export { formatDurationMs } from "./shiftVocabulary";

/** Calendar date and clock time, without seconds. Used where "N min ago" stops being readable. */
export function formatActiveAt(value: string | Date | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Timestamp with seconds, in the viewer's local time - audit rows need the exact second. */
export function formatDateTimeSec(value: string | Date | null | undefined): string {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** Clock time of a scheduled boundary, in the SHIFT timezone so every viewer sees the same schedule. */
export function formatScheduleTime(value: string | Date, timeZone?: string): string {
  return new Date(value).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    ...(timeZone ? { timeZone } : {}),
  });
}

export function formatScheduleRange(start: string, end: string, timeZone?: string): string {
  return `${formatScheduleTime(start, timeZone)} - ${formatScheduleTime(end, timeZone)}`;
}

/** "3 min ago" style, for last-contact columns. */
export function formatAgo(value: string | Date | null | undefined, now = Date.now()): string {
  if (!value) return "never";
  const ms = now - new Date(value).getTime();
  if (!Number.isFinite(ms)) return "-";
  if (ms < 60_000) return "just now";
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function mapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

export function formatCoords(lat: number, lng: number): string {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}
