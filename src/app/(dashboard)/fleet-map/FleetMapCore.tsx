"use client";

import { Fragment, useState, type ReactNode } from "react";
import { AlertTriangle, Loader2, Navigation, Radio, Satellite, StopCircle, Zap, ZapOff } from "lucide-react";
import { vehicleLabel } from "@/lib/vehicleLabel";
import { formatActiveAt, formatAgo } from "@/lib/shiftFormat";
import MapShell from "@/components/maps/MapShell";
import { Circle, DivMarker, FitBounds, MapPopup, PanTo, Polyline, type LatLng } from "@/components/maps/overlays";

const TRACK_COLOR: Record<string, string> = {
  fresh: "#10b981",
  parked: "#0ea5e9",
  stale: "#f59e0b",
  old: "#ef4444",
  unavailable: "#64748b",
};

interface DeviceState {
  deviceId: string;
  employeeName?: string;
  vehicle?: string | { id?: string; registration?: string };
  latestCoordinates: { lat: number; lng: number };
  latestAccuracy?: number;
  latestSpeed?: number;
  lastReceivedAt?: string;
  /** When the last GPS fix was recorded — the pin's position is from this moment. */
  lastRecordedAt?: string;
  batteryPercent?: number;
  freshness: "fresh" | "parked" | "stale" | "old" | "unavailable";
  /** Minutes since the vehicle last moved. */
  ageMinutes: number | null;
  /** Minutes since the phone last checked in, moving or not. */
  heardMinutes?: number | null;
}

export interface DeviceTrack {
  deviceId: string;
  /** Filtered GPS fixes — used for marker tip / trail start. */
  points: { lat: number; lng: number; recordedAt?: string; speed?: number }[];
  /** Road-snapped path for the polyline (may equal points if snap failed). */
  route?: { lat: number; lng: number }[];
  snapped?: boolean;
}

export type LocationCommand =
  | "location_latest"
  | "location_upload"
  | "location_live_mode"
  | "location_stop_live_mode"
  | "location_start_tracking"
  | "location_stop_tracking";

interface Props {
  devices: DeviceState[];
  tracks?: DeviceTrack[];
  autoFit?: boolean;
  selectedDeviceId?: string | null;
  onSelectDevice?: (deviceId: string) => void;
  onCommand?: (deviceId: string, type: LocationCommand) => void;
  commandStates?: Record<string, boolean>;
  /** Devices whose last fix-and-upload command expired without a GPS fix. */
  notRespondingDeviceIds?: string[];
  focusPoint?: { lat: number; lng: number } | null;
}

const ACCURACY_CIRCLE_MAX_M = 80;
const ACCURACY_CIRCLE_HIDE_ABOVE_M = 150;

/** Date and time of a clock on the device, plus a short "3h ago" so a live pin still reads as recent. */
function WhenLine({ label, at }: { label: string; at?: string }) {
  const when = formatActiveAt(at);
  if (!when) return null;
  return (
    <p>
      <span className="text-slate-400">{label}</span>{" "}
      <span className="font-medium text-slate-800">{when}</span>
      <span className="text-slate-400"> · {formatAgo(at)}</span>
    </p>
  );
}

/** Teardrop pin. The tip sits on the coordinate. */
function PinGlyph({ color, selected }: { color: string; selected: boolean }) {
  const size = selected ? 30 : 24;
  const height = selected ? 40 : 32;
  const r = selected ? 12 : 10;
  return (
    <svg width={size} height={height} viewBox={`0 0 ${size} ${height}`}>
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill={color}
        stroke="white"
        strokeWidth={selected ? 3 : 2}
      />
      <line
        x1={size / 2}
        y1={size / 2 + r}
        x2={size / 2}
        y2={height}
        stroke={color}
        strokeWidth={2}
      />
    </svg>
  );
}

function CmdButton({
  label,
  icon,
  busy,
  onClick,
  tone = "neutral",
}: {
  label: string;
  icon: ReactNode;
  busy: boolean;
  onClick: () => void;
  tone?: "neutral" | "live" | "stop";
}) {
  const toneClass =
    tone === "live"
      ? "border-indigo-300 text-indigo-700 hover:bg-indigo-50"
      : tone === "stop"
        ? "border-rose-300 text-rose-700 hover:bg-rose-50"
        : "border-slate-200 text-slate-700 hover:bg-slate-50";
  return (
    <button
      type="button"
      disabled={busy}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium disabled:opacity-50 ${toneClass}`}
    >
      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : icon}
      {label}
    </button>
  );
}

export default function FleetMapCore({
  devices,
  tracks = [],
  autoFit = true,
  selectedDeviceId = null,
  onSelectDevice,
  onCommand,
  commandStates = {},
  notRespondingDeviceIds = [],
  focusPoint = null,
}: Props) {
const [openInfo, setOpenInfo] = useState<string | null>(null);

  const trackByDevice = new Map(tracks.map((t) => [t.deviceId, t]));
  const center: LatLng =
    devices.length > 0
      ? { lat: devices[0].latestCoordinates.lat, lng: devices[0].latestCoordinates.lng }
      : { lat: 20.5937, lng: 78.9629 };

  // Fit to device pins only — including raw trails zooms out around GPS outliers.
  const pinPoints: LatLng[] = devices
    .filter((d) => d.latestCoordinates?.lat != null && d.latestCoordinates?.lng != null)
    .map((d) => {
      const tipPts = trackByDevice.get(d.deviceId)?.points || [];
      const tip = tipPts.length > 0 ? tipPts[tipPts.length - 1] : null;
      return tip
        ? { lat: tip.lat, lng: tip.lng }
        : { lat: d.latestCoordinates.lat, lng: d.latestCoordinates.lng };
    });

  const isCmd = (deviceId: string, type: string) => !!commandStates[`${deviceId}:${type}`];
  const notResponding = new Set(notRespondingDeviceIds);

  return (
    <MapShell defaultCenter={center} defaultZoom={devices.length ? 13 : 5}>
      <FitBounds points={pinPoints} enabled={autoFit && !focusPoint} padding={72} maxZoom={16} />
      <PanTo point={focusPoint} />

      {devices.map((d) => {
        const track = trackByDevice.get(d.deviceId);
        const gps = track?.points || [];
        const path = (track?.route && track.route.length >= 2 ? track.route : gps).filter(
          (p) => p.lat != null && p.lng != null
        );
        const latlngs: LatLng[] = path.map((p) => ({ lat: p.lat, lng: p.lng }));
        const tipGps = gps.length > 0 ? gps[gps.length - 1] : null;
        const markerPos: LatLng = tipGps
          ? { lat: tipGps.lat, lng: tipGps.lng }
          : { lat: d.latestCoordinates.lat, lng: d.latestCoordinates.lng };
        const color = TRACK_COLOR[d.freshness];
        const selected = selectedDeviceId === d.deviceId;
        const plate = vehicleLabel(d.vehicle);
        const accuracyM =
          d.latestAccuracy != null &&
          d.latestAccuracy > 0 &&
          d.latestAccuracy <= ACCURACY_CIRCLE_HIDE_ABOVE_M
            ? Math.min(d.latestAccuracy, ACCURACY_CIRCLE_MAX_M)
            : null;

        const startKey = `start:${d.deviceId}`;
        const pinKey = `pin:${d.deviceId}`;

        const pinW = selected ? 30 : 24;
        const pinH = selected ? 40 : 32;

        return (
          <Fragment key={d.deviceId}>
            {latlngs.length > 1 && (
              <>
                <Polyline
                  path={latlngs}
                  strokeColor={color}
                  strokeWeight={selected ? 5 : 4}
                  strokeOpacity={selected ? 0.95 : 0.8}
                />
                <DivMarker
                  position={latlngs[0]}
                  width={14}
                  height={14}
                  anchorX={7}
                  anchorY={7}
                  title="Trail start"
                  onClick={() => setOpenInfo(startKey)}
                >
                  <span
                    className="block h-2.5 w-2.5 rounded-full border-2 border-white"
                    style={{ backgroundColor: color }}
                  />
                </DivMarker>
                <MapPopup
                  position={latlngs[0]}
                  open={openInfo === startKey}
                  onClose={() => setOpenInfo(null)}
                  offsetY={-14}
                >
                  <p className="text-xs font-semibold text-slate-700">Trail start</p>
                  {gps[0]?.recordedAt && (
                    <p className="text-xs text-slate-500">
                      {new Date(gps[0].recordedAt).toLocaleTimeString()}
                    </p>
                  )}
                </MapPopup>
              </>
            )}

            {accuracyM != null && (
              <Circle
                center={markerPos}
                radius={accuracyM}
                strokeColor={color}
                strokeWeight={1.5}
                strokeOpacity={0.8}
                fillColor={color}
                fillOpacity={0.08}
              />
            )}

            <DivMarker
              position={markerPos}
              width={pinW}
              height={pinH}
              anchorX={pinW / 2}
              anchorY={pinH}
              zIndex={selected ? 800 : 200}
              title={d.employeeName || d.deviceId}
              onClick={() => {
                onSelectDevice?.(d.deviceId);
                setOpenInfo(pinKey);
              }}
            >
              <PinGlyph color={color} selected={selected} />
            </DivMarker>

            <MapPopup
              position={markerPos}
              open={openInfo === pinKey}
              onClose={() => setOpenInfo(null)}
              offsetY={-(pinH + 6)}
            >
              <div className="min-w-[210px] space-y-2 font-sans text-sm">
                  <div>
                    <p className="font-bold text-slate-900">{d.employeeName || d.deviceId}</p>
                    {plate && <p className="font-mono text-xs text-slate-600">{plate}</p>}
                  </div>
                  <div className="space-y-0.5 text-xs text-slate-600">
                    {d.latestSpeed != null && <p>{(d.latestSpeed * 3.6).toFixed(1)} km/h</p>}
                    {latlngs.length > 1 && (
                      <p>
                        {gps.length} GPS · {latlngs.length} route pts
                        {track?.snapped ? " · road-matched" : ""}
                      </p>
                    )}
                    {d.batteryPercent != null && <p>Battery: {d.batteryPercent}%</p>}
                    {/* Two clocks: "moved" is the GPS fix on this pin, "heard"
                        is the last time the phone checked in. Both are a date
                        and time, because a gap of weeks is unreadable as minutes. */}
                    <WhenLine label="Last moved" at={d.lastRecordedAt} />
                    <WhenLine label="Last heard" at={d.lastReceivedAt} />
                  </div>
                  {notResponding.has(d.deviceId) && (
                    <p className="flex gap-1 rounded bg-amber-50 p-1.5 text-[11px] leading-snug text-amber-900">
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-600" />
                      <span>
                        <span className="font-semibold">Not responding</span> — last location
                        request expired with no GPS fix. Check the phone’s location permission
                        and battery settings.
                      </span>
                    </p>
                  )}
                  {onCommand && (
                    <div className="flex flex-wrap gap-1.5 border-t border-slate-100 pt-2">
                      <CmdButton
                        label="Start"
                        icon={<Radio className="h-3 w-3" />}
                        busy={isCmd(d.deviceId, "location_start_tracking")}
                        onClick={() => onCommand(d.deviceId, "location_start_tracking")}
                        tone="live"
                      />
                      <CmdButton
                        label="End"
                        icon={<StopCircle className="h-3 w-3" />}
                        busy={isCmd(d.deviceId, "location_stop_tracking")}
                        onClick={() => onCommand(d.deviceId, "location_stop_tracking")}
                        tone="stop"
                      />
                      <CmdButton
                        label="Live"
                        icon={<Zap className="h-3 w-3" />}
                        busy={isCmd(d.deviceId, "location_live_mode")}
                        onClick={() => onCommand(d.deviceId, "location_live_mode")}
                        tone="live"
                      />
                      <CmdButton
                        label="Live off"
                        icon={<ZapOff className="h-3 w-3" />}
                        busy={isCmd(d.deviceId, "location_stop_live_mode")}
                        onClick={() => onCommand(d.deviceId, "location_stop_live_mode")}
                        tone="stop"
                      />
                      <CmdButton
                        label="Latest"
                        icon={<Navigation className="h-3 w-3" />}
                        busy={isCmd(d.deviceId, "location_latest")}
                        onClick={() => onCommand(d.deviceId, "location_latest")}
                      />
                      <CmdButton
                        label="Upload"
                        icon={<Satellite className="h-3 w-3" />}
                        busy={isCmd(d.deviceId, "location_upload")}
                        onClick={() => onCommand(d.deviceId, "location_upload")}
                      />
                    </div>
                  )}
                </div>
            </MapPopup>
          </Fragment>
        );
      })}
    </MapShell>
  );
}
