"use client";

import { useCallback, useMemo, useState } from "react";
import { format } from "date-fns";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarDays, CalendarRange, Clock } from "lucide-react";

export type RouteDateSelection =
  | { mode: "single"; date: string; startTime: string; endTime: string }
  | { mode: "range"; fromDate: string; toDate: string };

type Props = {
  value: RouteDateSelection;
  onChange: (next: RouteDateSelection) => void;
  /** yyyy-MM-dd — the furthest date selectable (today; no future routes). */
  maxDate: string;
};

/** "yyyy-MM-dd" <-> local Date, matching how the rest of the page builds
 * `new Date(`${date}T${time}:00`)` — parsing as local midnight, not UTC. */
function toDate(s: string): Date {
  return new Date(`${s}T00:00:00`);
}
function toDateStr(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

function summaryLabel(value: RouteDateSelection): string {
  if (value.mode === "single") {
    return `${format(toDate(value.date), "MMM d, y")} · ${value.startTime}–${value.endTime}`;
  }
  return `${format(toDate(value.fromDate), "MMM d")} – ${format(toDate(value.toDate), "MMM d, y")}`;
}

/**
 * Single Date vs. Date Range, as two explicit tabs — the single-day path
 * keeps its own Start/End time-of-day bounds (the range path always covers
 * whole days), so there's never an ambiguous "did that apply as one day or
 * a range" moment.
 */
export function DateRangeSelector({ value, onChange, maxDate }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<RouteDateSelection>(value);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (next) setDraft(value);
      setOpen(next);
    },
    [value]
  );

  const maxD = useMemo(() => toDate(maxDate), [maxDate]);

  const apply = useCallback(() => {
    onChange(draft);
    setOpen(false);
  }, [draft, onChange]);

  const draftRange =
    draft.mode === "range" ? { from: toDate(draft.fromDate), to: toDate(draft.toDate) } : undefined;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-11 w-full items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 text-left text-sm text-slate-800 transition-colors hover:border-indigo-300"
        >
          {value.mode === "single" ? (
            <CalendarDays className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          ) : (
            <CalendarRange className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          )}
          <span className="min-w-0 flex-1 truncate font-medium">{summaryLabel(value)}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[19rem] p-0" align="start" sideOffset={6}>
        <div className="flex border-b border-slate-100 p-1.5 gap-1.5">
          <button
            type="button"
            onClick={() =>
              setDraft((d) =>
                d.mode === "single"
                  ? d
                  : { mode: "single", date: d.toDate, startTime: "00:00", endTime: "23:59" }
              )
            }
            className={`flex-1 flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-semibold transition-colors ${
              draft.mode === "single"
                ? "bg-indigo-600 text-white"
                : "text-slate-500 hover:bg-slate-100"
            }`}
          >
            <CalendarDays className="h-3.5 w-3.5" />
            Single Date
          </button>
          <button
            type="button"
            onClick={() =>
              setDraft((d) =>
                d.mode === "range" ? d : { mode: "range", fromDate: d.date, toDate: d.date }
              )
            }
            className={`flex-1 flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-semibold transition-colors ${
              draft.mode === "range"
                ? "bg-indigo-600 text-white"
                : "text-slate-500 hover:bg-slate-100"
            }`}
          >
            <CalendarRange className="h-3.5 w-3.5" />
            Date Range
          </button>
        </div>

        {draft.mode === "single" ? (
          <>
            <div className="border-b border-slate-100 px-3 py-2">
              <p className="text-xs font-semibold text-slate-700">
                {format(toDate(draft.date), "MMM d, y")}
              </p>
              <p className="text-[11px] text-slate-400">Shows this exact day only.</p>
            </div>
            <Calendar
              mode="single"
              captionLayout="label"
              defaultMonth={toDate(draft.date)}
              selected={toDate(draft.date)}
              disabled={{ after: maxD }}
              onSelect={(d) =>
                d && setDraft((cur) => (cur.mode === "single" ? { ...cur, date: toDateStr(d) } : cur))
              }
              numberOfMonths={1}
              showOutsideDays={false}
              className="p-2 [--cell-size:2.25rem]"
            />
            <div className="border-t border-slate-100 px-3 py-2.5">
              <div className="grid grid-cols-2 gap-2">
                <label>
                  <span className="mb-1 flex items-center gap-1 text-[11px] font-medium text-slate-500">
                    <Clock className="h-3 w-3" /> Start
                  </span>
                  <input
                    type="time"
                    value={draft.startTime}
                    onChange={(e) =>
                      setDraft((cur) =>
                        cur.mode === "single" ? { ...cur, startTime: e.target.value } : cur
                      )
                    }
                    className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-800 outline-none focus:border-indigo-400"
                  />
                </label>
                <label>
                  <span className="mb-1 flex items-center gap-1 text-[11px] font-medium text-slate-500">
                    <Clock className="h-3 w-3" /> End
                  </span>
                  <input
                    type="time"
                    value={draft.endTime}
                    onChange={(e) =>
                      setDraft((cur) =>
                        cur.mode === "single" ? { ...cur, endTime: e.target.value } : cur
                      )
                    }
                    className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-800 outline-none focus:border-indigo-400"
                  />
                </label>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="border-b border-slate-100 px-3 py-2.5 space-y-1.5">
              <p className="text-xs font-semibold text-slate-700">Pick a date range</p>
              <div className="flex items-center gap-2 text-[11px]">
                <span className="rounded bg-indigo-50 px-1.5 py-0.5 font-medium text-indigo-700">
                  From: {draft.mode === "range" ? format(toDate(draft.fromDate), "MMM d, y") : "—"}
                </span>
                <span className="rounded bg-indigo-50 px-1.5 py-0.5 font-medium text-indigo-700">
                  To: {draft.mode === "range" ? format(toDate(draft.toDate), "MMM d, y") : "—"}
                </span>
              </div>
            </div>
            <Calendar
              mode="range"
              captionLayout="label"
              defaultMonth={draftRange?.from}
              selected={draftRange}
              disabled={{ after: maxD }}
              onSelect={(r) =>
                setDraft((cur) => {
                  if (cur.mode !== "range") return cur;
                  return {
                    mode: "range",
                    fromDate: r?.from ? toDateStr(r.from) : cur.fromDate,
                    toDate: r?.to ? toDateStr(r.to) : r?.from ? toDateStr(r.from) : cur.toDate,
                  };
                })
              }
              numberOfMonths={1}
              showOutsideDays={false}
              className="p-2 [--cell-size:2.25rem]"
            />
          </>
        )}

        <div className="border-t border-slate-100 px-3 py-2.5 flex justify-end">
          <button
            type="button"
            onClick={apply}
            className="h-8 rounded-full bg-indigo-600 px-4 text-xs font-semibold text-white hover:bg-indigo-500"
          >
            Apply
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
