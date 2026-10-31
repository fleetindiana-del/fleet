"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Loader2, ShieldCheck } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { api } from "../income-expense/apiClient";
import { ShiftStatusBadge } from "@/components/shifts/ShiftStatusBadge";
import {
  formatAgo,
  formatCoords,
  formatDateTimeSec,
  formatDurationMs,
  formatScheduleRange,
  mapsUrl,
} from "@/lib/shiftFormat";
import { CAUSE_HELP } from "@/lib/shiftVocabulary";
import type { InterruptionRow, ShiftEventRow, ShiftRow } from "@/lib/shiftService";

interface Detail {
  shift: ShiftRow;
  lastLocationSource: "shift_report" | "uploaded_track" | null;
  interruptions: InterruptionRow[];
  events: ShiftEventRow[];
}

function Figure({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-0.5 text-sm font-semibold ${tone ?? "text-slate-100"}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

const ACTOR_LABEL: Record<string, string> = {
  driver: "Driver",
  admin: "Staff",
  system: "System",
  device: "Device",
};

export function ShiftDetailDialog({
  shiftId,
  timezone,
  onClose,
}: {
  shiftId: string;
  timezone?: string;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    api<Detail>(`/api/shifts/${encodeURIComponent(shiftId)}`)
      .then((d) => !cancelled && setDetail(d))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Failed to load shift."));
    return () => {
      cancelled = true;
    };
  }, [shiftId]);

  const s = detail?.shift;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] w-full max-w-[min(64rem,calc(100vw-1.5rem))] overflow-x-hidden overflow-y-auto border-slate-800 bg-slate-900 text-slate-100">
        <DialogHeader>
          <div className="flex flex-wrap items-center justify-between gap-3 pr-6">
            <div>
              <DialogTitle className="text-xl">{s?.driverName ?? "Shift"}</DialogTitle>
              <DialogDescription className="text-slate-400">
                {s
                  ? `${s.shiftLabel} - scheduled ${formatScheduleRange(s.scheduledStart, s.scheduledEnd, timezone)}`
                  : "Loading shift log..."}
              </DialogDescription>
            </div>
            {s && (
              <ShiftStatusBadge
                status={s.status}
                currentCause={s.currentCause}
                currentCauseLabel={s.currentCauseLabel}
                connectivityLost={s.connectivityLost}
              />
            )}
          </div>
        </DialogHeader>

        {!detail && !error && (
          <div className="flex justify-center py-12 text-slate-400">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        )}
        {error && <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">{error}</p>}

        {detail && s && (
          <div className="space-y-6">
            {s.outsideSchedule && (
              <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-300">
                This shift was switched on outside its permitted window. It is recorded as it happened.
              </p>
            )}
            {s.status === "INTERRUPTED" && s.currentCauseLabel && (
              <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">
                <p className="font-semibold">{s.currentCauseLabel}</p>
                {s.currentInterruptionStart && (
                  <p className="text-rose-300/80">
                    Since {formatDateTimeSec(s.currentInterruptionStart)} ({formatAgo(s.currentInterruptionStart)})
                  </p>
                )}
                {s.currentCause && CAUSE_HELP[s.currentCause] && (
                  <p className="mt-1 text-xs text-rose-300/70">{CAUSE_HELP[s.currentCause]}</p>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Figure label="Shift started" value={formatDateTimeSec(s.actualStart)} />
              <Figure
                label="Shift ended"
                value={s.actualEnd ? formatDateTimeSec(s.actualEnd) : "In progress"}
                sub={s.endedBy ? `By ${s.endedBy === "driver" ? "the driver" : s.endedBy}` : undefined}
              />
              <Figure label="Scheduled" value={formatDurationMs(s.scheduledMs)} sub={formatScheduleRange(s.scheduledStart, s.scheduledEnd, timezone)} />
              <Figure
                label={s.status === "ENDED" ? "Actual" : "Elapsed"}
                value={formatDurationMs(s.actualMs)}
                sub={`${s.varianceMs >= 0 ? "+" : ""}${formatDurationMs(s.varianceMs)} vs scheduled`}
              />
              <Figure label="Tracked" value={formatDurationMs(s.trackedMs)} tone="text-emerald-300" />
              <Figure
                label="Tracking lost"
                value={formatDurationMs(s.trackingInterruptedMs)}
                sub={`${s.interruptionCount} interruption${s.interruptionCount === 1 ? "" : "s"}`}
                tone={s.trackingInterruptedMs > 0 ? "text-rose-300" : undefined}
              />
              <Figure
                label="Offline, still tracking"
                value={formatDurationMs(s.connectivityMs)}
                sub={`${s.connectivityGapCount} gap${s.connectivityGapCount === 1 ? "" : "s"}`}
                tone={s.connectivityMs > 0 ? "text-sky-300" : undefined}
              />
              <Figure label="Last heard from device" value={formatAgo(s.lastContactAt)} sub={formatDateTimeSec(s.lastContactAt)} />
              <Figure label="Location tracking started" value={formatDateTimeSec(s.trackingStartedAt)} />
              <Figure
                label="Location tracking stopped"
                value={s.trackingStoppedAt ? formatDateTimeSec(s.trackingStoppedAt) : s.status === "ENDED" ? "At shift end" : "Running"}
              />
              <Figure
                label="Last recorded location"
                value={
                  s.lastLocation ? (
                    <a
                      href={mapsUrl(s.lastLocation.lat, s.lastLocation.lng)}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-indigo-300 hover:text-indigo-200"
                    >
                      {formatCoords(s.lastLocation.lat, s.lastLocation.lng)} <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : (
                    "None recorded"
                  )
                }
                sub={s.lastLocation?.recordedAt ? `Recorded ${formatDateTimeSec(s.lastLocation.recordedAt)}` : undefined}
              />
              <Figure label="Device / vehicle" value={s.vehicle ?? "-"} sub={s.deviceId} />
            </div>

            {s.endReasonLabel && (
              <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-sm">
                <p className="text-[11px] uppercase tracking-wide text-slate-500">How the shift ended</p>
                <p className="mt-0.5 font-semibold text-slate-100">{s.endReasonLabel}</p>
                {s.endEvidence && <p className="mt-0.5 text-xs text-slate-400">{s.endEvidence}</p>}
              </div>
            )}

            <section>
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
                Interruptions &amp; reconnections
              </h3>
              {detail.interruptions.length === 0 ? (
                <p className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-sm text-slate-400">
                  No interruptions recorded for this shift.
                </p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-slate-800">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-950 text-left text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-3 py-2">Type</th>
                        <th className="px-3 py-2">Cause (as recorded)</th>
                        <th className="px-3 py-2">Started</th>
                        <th className="px-3 py-2">Reconnected / resolved</th>
                        <th className="px-3 py-2">Duration</th>
                        <th className="px-3 py-2">Source</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {detail.interruptions.map((i) => (
                        <tr key={i.id} className="align-top">
                          <td className="px-3 py-2">
                            {i.kind === "CONNECTIVITY" ? (
                              <Badge className="border-sky-500/40 bg-sky-500/15 text-sky-300">Offline (tracking continued)</Badge>
                            ) : (
                              <Badge className="border-rose-500/40 bg-rose-500/15 text-rose-300">Tracking lost</Badge>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <p className="text-slate-100">{i.causeLabel}</p>
                            {(i.reason || i.evidence) && (
                              <p className="text-xs text-slate-500">{[i.reason, i.evidence].filter(Boolean).join(" - ")}</p>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-slate-300">{formatDateTimeSec(i.startedAt)}</td>
                          <td className="whitespace-nowrap px-3 py-2 text-slate-300">
                            {i.endedAt ? (
                              <>
                                {formatDateTimeSec(i.endedAt)}
                                {i.closedBy === "shift_end" && <p className="text-xs text-slate-500">closed at shift end</p>}
                              </>
                            ) : (
                              <span className="text-amber-300">Still open</span>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 font-mono text-slate-200">{formatDurationMs(i.durationMs)}</td>
                          <td className="px-3 py-2 text-xs text-slate-400">
                            {i.source === "system"
                              ? "Server inference"
                              : i.source === "device_inferred"
                                ? "Device evidence"
                                : "Device report"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section>
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
                Complete event log ({detail.events.length})
              </h3>
              <ol className="divide-y divide-slate-800 overflow-hidden rounded-lg border border-slate-800">
                {detail.events.map((e) => (
                  <li key={e.key} className={`flex flex-col gap-1 px-3 py-2 text-sm md:flex-row md:gap-4 ${e.ignoredReason ? "opacity-60" : ""}`}>
                    <time className="w-52 shrink-0 font-mono text-xs text-slate-400">{formatDateTimeSec(e.occurredAt)}</time>
                    <div className="min-w-0 flex-1">
                      <p className="text-slate-100">
                        {e.label}
                        {e.causeLabel && <span className="text-slate-400"> - {e.causeLabel}</span>}
                      </p>
                      {e.detail && <p className="text-xs text-slate-500">{e.detail}</p>}
                      <p className="text-xs text-slate-500">
                        {ACTOR_LABEL[e.actor.kind] ?? e.actor.kind}
                        {e.actor.name ? ` (${e.actor.name})` : ""}
                        {e.delayedMs > 2 * 60_000 && (
                          <span className="text-amber-400/80"> - reported late, received {formatDateTimeSec(e.receivedAt)}</span>
                        )}
                        {e.clockAdjusted && <span className="text-amber-400/80"> - device clock was ahead; time adjusted</span>}
                        {e.ignoredReason && (
                          <span className="text-slate-400"> - logged, not applied ({e.ignoredReason.toLowerCase().replace(/_/g, " ")})</span>
                        )}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </section>

            <p className="flex items-start gap-2 text-xs text-slate-500">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
              Location is collected only while a driver is on shift, and only the last recorded position is shown here. Opening
              this log is itself recorded and is visible to the driver.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
