"use client";

import { useMemo, useState } from "react";
import { Search, X, Check, Users } from "lucide-react";
import { deviceColor } from "@/lib/routeAnalytics";
import { type FleetDevice, vehicleLabel, deviceDisplayName, initialsOf } from "./deviceUtils";

/**
 * Employee/device picker for Route History.
 *
 * Every available name is rendered as its own filter chip up front — nothing
 * is hidden behind a dropdown that has to be opened first — so the full
 * roster is scannable at a glance. The search box above just narrows which
 * chips are showing. Picking a chip is the filter action itself, with a
 * spring-like pop so the selection reads as immediate and alive rather than
 * a plain text-in-a-box swap.
 */
export function EmployeeCombobox({
  devices,
  selectedDeviceId,
  onSelect,
  onClear,
}: {
  devices: FleetDevice[];
  selectedDeviceId: string | null;
  onSelect: (d: FleetDevice) => void;
  onClear: () => void;
}) {
  const [query, setQuery] = useState("");

  const sorted = useMemo(
    () => [...devices].sort((a, b) => deviceDisplayName(a).localeCompare(deviceDisplayName(b))),
    [devices]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((d) => {
      const vehicle = vehicleLabel(d.vehicle) || "";
      const hay = `${d.employeeName || ""} ${vehicle} ${d.deviceId}`.toLowerCase();
      return hay.includes(q);
    });
  }, [sorted, query]);

  const selected = devices.find((d) => d.deviceId === selectedDeviceId) || null;

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Active Employee
        </span>
        {devices.length > 0 && (
          <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-slate-500">
            {selected ? "1 selected" : `${devices.length} available`}
          </span>
        )}
      </div>

      {/* Search box — narrows the chip roster below, doesn't gate it */}
      <div className="flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/80 px-3 transition-all duration-200 focus-within:border-indigo-400 focus-within:bg-white focus-within:shadow-[0_0_0_4px_rgba(99,102,241,0.12)]">
        <Search className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name or vehicle…"
          className="h-full min-w-0 flex-1 bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="rounded-full p-1 text-slate-400 transition-colors hover:bg-slate-200/70 hover:text-slate-600"
            aria-label="Clear search"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Every available name, as filter chips */}
      <div className="mt-2 flex max-h-44 flex-wrap content-start gap-1.5 overflow-y-auto pr-0.5">
        {filtered.length === 0 ? (
          <div className="flex w-full flex-col items-center gap-1.5 py-6 text-center">
            <Users className="h-5 w-5 text-slate-300" />
            <span className="text-xs text-slate-500">
              {devices.length === 0 ? "No devices yet" : "No matches"}
            </span>
          </div>
        ) : (
          filtered.map((d, i) => {
            const active = selectedDeviceId === d.deviceId;
            const color = deviceColor(d.deviceId);
            const vehicle = vehicleLabel(d.vehicle);
            return (
              <button
                key={d.deviceId}
                type="button"
                onClick={() => (active ? onClear() : onSelect(d))}
                title={vehicle && vehicle !== deviceDisplayName(d) ? vehicle : undefined}
                style={{
                  animationDelay: `${Math.min(i, 24) * 16}ms`,
                  ...(active
                    ? {
                        background: `linear-gradient(135deg, ${color}, color-mix(in srgb, ${color} 70%, #4f46e5))`,
                        boxShadow: `0 4px 14px -2px ${color}66`,
                      }
                    : undefined),
                }}
                className={`group relative flex origin-center animate-in fade-in slide-in-from-bottom-1 items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs font-semibold transition-all duration-200 ease-out fill-mode-both ${
                  active
                    ? "scale-[1.06] border-transparent text-white"
                    : "border-slate-200 bg-white text-slate-600 hover:-translate-y-0.5 hover:border-slate-300 hover:bg-slate-50 hover:shadow-md active:scale-95"
                }`}
              >
                <span
                  className={`flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full text-[8px] font-bold text-white transition-transform duration-200 ${
                    active ? "scale-110 bg-white/25" : ""
                  }`}
                  style={!active ? { background: color } : undefined}
                >
                  {active ? <Check className="h-2.5 w-2.5" strokeWidth={3} /> : initialsOf(deviceDisplayName(d))}
                </span>
                <span className="max-w-30 truncate">{deviceDisplayName(d)}</span>
                {active && (
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-0 rounded-full ring-2 ring-white/40"
                  />
                )}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
