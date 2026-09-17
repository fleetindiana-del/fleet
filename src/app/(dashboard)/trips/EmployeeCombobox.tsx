"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X, ChevronDown, Users } from "lucide-react";
import { deviceColor } from "@/lib/routeAnalytics";
import { type FleetDevice, vehicleLabel, deviceDisplayName, initialsOf } from "./deviceUtils";

/**
 * Employee/device picker for Route History.
 *
 * Two states: a compact "selected" chip (colour dot + name + vehicle) once
 * someone is picked, or a searchable, keyboard-navigable list beforehand —
 * so the active selection reads at a glance instead of sitting as plain text
 * inside a search box indistinguishable from an unfinished query.
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
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const selected = devices.find((d) => d.deviceId === selectedDeviceId) || null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = [...devices].sort((a, b) =>
      deviceDisplayName(a).localeCompare(deviceDisplayName(b))
    );
    if (!q) return list;
    return list.filter((d) => {
      const vehicle = vehicleLabel(d.vehicle) || "";
      const hay = `${d.employeeName || ""} ${vehicle} ${d.deviceId}`.toLowerCase();
      return hay.includes(q);
    });
  }, [devices, query]);

  // Reset the highlighted row whenever the query or open state changes,
  // derived during render rather than in an effect (avoids an extra
  // cascading render for what's really just resetting on a prop change).
  const listKey = `${open}|${query}`;
  const [lastListKey, setLastListKey] = useState(listKey);
  if (lastListKey !== listKey) {
    setLastListKey(listKey);
    setActiveIndex(0);
  }

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const openSearch = () => {
    setQuery("");
    setOpen(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const pick = (d: FleetDevice) => {
    onSelect(d);
    setOpen(false);
    setQuery("");
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[activeIndex]) pick(filtered[activeIndex]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  // Keep the highlighted row scrolled into view during keyboard navigation.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${activeIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  return (
    <div ref={wrapRef} className="relative">
      <span className="mb-1 block text-[11px] font-medium text-slate-500">Active Employee</span>

      {selected && !open ? (
        // Selected chip — the whole selection is visible at a glance, not
        // buried as text inside a generic search field.
        <button
          type="button"
          onClick={openSearch}
          className="flex h-11 w-full items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 pl-1.5 pr-2 text-left transition-colors hover:border-indigo-300 hover:bg-indigo-50/40"
        >
          <span
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ring-2 ring-white"
            style={{ background: deviceColor(selected.deviceId) }}
          >
            {initialsOf(deviceDisplayName(selected))}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-slate-900">
              {deviceDisplayName(selected)}
            </span>
            {vehicleLabel(selected.vehicle) && vehicleLabel(selected.vehicle) !== deviceDisplayName(selected) && (
              <span className="block truncate text-[11px] text-slate-500">
                {vehicleLabel(selected.vehicle)}
              </span>
            )}
          </span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onClear();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.stopPropagation();
                onClear();
              }
            }}
            className="rounded-full p-1.5 text-slate-400 hover:bg-slate-200/60 hover:text-slate-600"
            aria-label="Clear selection"
          >
            <X className="h-3.5 w-3.5" />
          </span>
        </button>
      ) : (
        <div className="flex h-11 items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 pl-2 pr-1 focus-within:border-indigo-400">
          <Search className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            placeholder="Search by name or vehicle…"
            className="h-full min-w-0 flex-1 bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400"
          />
          {(query || selected) && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                onClear();
                inputRef.current?.focus();
              }}
              className="rounded-full p-1.5 text-slate-400 hover:bg-slate-200/60"
              aria-label="Clear"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      {open && (
        <div
          ref={listRef}
          className="absolute inset-x-0 top-full z-10 mt-1 max-h-[min(42vh,20rem)] overflow-y-auto rounded-2xl bg-white py-1 shadow-[0_4px_16px_rgba(0,0,0,0.18)]"
        >
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-1.5 px-4 py-8 text-center">
              <Users className="h-5 w-5 text-slate-300" />
              <span className="text-sm text-slate-500">
                {devices.length === 0 ? "No devices yet" : "No matches"}
              </span>
            </div>
          ) : (
            filtered.map((d, i) => {
              const vehicle = vehicleLabel(d.vehicle);
              const active = selectedDeviceId === d.deviceId;
              const highlighted = i === activeIndex;
              const color = deviceColor(d.deviceId);
              return (
                <button
                  key={d.deviceId}
                  type="button"
                  data-idx={i}
                  onMouseEnter={() => setActiveIndex(i)}
                  onClick={() => pick(d)}
                  className={`flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors ${
                    highlighted ? "bg-slate-50" : ""
                  } ${active ? "bg-indigo-50/70" : ""}`}
                >
                  <span
                    className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ring-2 ring-white"
                    style={{ background: color }}
                  >
                    {initialsOf(deviceDisplayName(d))}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-900">
                      {deviceDisplayName(d)}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-slate-500">
                      {[vehicle && vehicle !== deviceDisplayName(d) ? vehicle : null, `ID ${d.deviceId.slice(0, 8)}…`]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
