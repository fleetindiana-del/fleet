"use client";

import { useCallback, useMemo, useState, memo } from "react";
import { format, isSameDay } from "date-fns";
import { DateRange } from "react-day-picker";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Calendar as CalendarIcon, CalendarDays, CalendarRange } from "lucide-react";
import { cn } from "@/lib/utils";

type DateFilter = "ALL" | "TODAY" | "TOMORROW" | "YESTERDAY" | "CUSTOM";
type PickerMode = "single" | "range";

type Props = {
  dateFilter: DateFilter;
  committedRange: DateRange | undefined;
  onApply: (range: DateRange | undefined) => void;
  onResetToToday: () => void;
};

function CustomRangePopoverInner({
  dateFilter,
  committedRange,
  onApply,
  onResetToToday,
}: Props) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<PickerMode>("single");
  const [draftSingle, setDraftSingle] = useState<Date | undefined>(undefined);
  const [draftRange, setDraftRange] = useState<DateRange | undefined>(undefined);

  // A committed range with no "to" (or a "to" equal to "from") is a
  // single-day selection — used both to seed the right tab on open and to
  // render the trigger label without an ambiguous "start – start" range.
  const committedIsSingleDay =
    !!committedRange?.from && (!committedRange.to || isSameDay(committedRange.from, committedRange.to));

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (next) {
        if (committedRange?.from && !committedIsSingleDay) {
          setMode("range");
          setDraftRange(committedRange);
          setDraftSingle(undefined);
        } else {
          setMode("single");
          setDraftSingle(committedRange?.from);
          setDraftRange(undefined);
        }
      }
      setOpen(next);
    },
    [committedRange, committedIsSingleDay]
  );

  // Selections never carry over between tabs — that's what keeps "one date"
  // and "a range" from bleeding into each other.
  const switchMode = useCallback((next: PickerMode) => {
    setMode(next);
    setDraftSingle(undefined);
    setDraftRange(undefined);
  }, []);

  const selectSingleDay = useCallback(
    (day: Date | undefined) => {
      setDraftSingle(day);
      if (day) {
        // from === to, explicitly: the fetch/filter logic treats an equal
        // pair as "this exact day only," never spilling into neighbors.
        onApply({ from: day, to: day });
        setOpen(false);
      }
    },
    [onApply]
  );

  const applyRangeAndClose = useCallback(() => {
    if (draftRange?.from && draftRange?.to) {
      onApply(draftRange);
      setOpen(false);
    }
  }, [draftRange, onApply]);

  const resetAndClose = useCallback(() => {
    onResetToToday();
    setOpen(false);
  }, [onResetToToday]);

  const defaultMonth = useMemo(() => {
    if (mode === "single") return draftSingle ?? new Date();
    return draftRange?.from ?? new Date();
  }, [mode, draftSingle, draftRange?.from]);

  const triggerLabel = useMemo(() => {
    if (dateFilter !== "CUSTOM" || !committedRange?.from) return "Custom date";
    if (committedIsSingleDay) return format(committedRange.from, "MMM d, y");
    return `${format(committedRange.from, "MMM d")} – ${format(committedRange.to!, "MMM d, y")}`;
  }, [dateFilter, committedRange, committedIsSingleDay]);

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors min-w-[110px]",
            dateFilter === "CUSTOM"
              ? "bg-emerald-600 text-white"
              : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200",
            open && dateFilter !== "CUSTOM" && "ring-1 ring-emerald-500/40 ring-offset-2 ring-offset-slate-900"
          )}
        >
          <CalendarIcon className="w-3 h-3" />
          {triggerLabel}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[19rem] p-0 border-slate-800 bg-slate-950 shadow-xl"
        align="end"
        sideOffset={6}
      >
        {/* Single Date vs. Date Range — mutually exclusive, so there's no
            trick (like clicking the same day twice) needed to get one day. */}
        <div className="flex border-b border-slate-800 p-1.5 gap-1.5">
          <button
            type="button"
            onClick={() => switchMode("single")}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-semibold transition-colors",
              mode === "single"
                ? "bg-emerald-600 text-white"
                : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            )}
          >
            <CalendarDays className="w-3.5 h-3.5" />
            Single Date
          </button>
          <button
            type="button"
            onClick={() => switchMode("range")}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-semibold transition-colors",
              mode === "range"
                ? "bg-emerald-600 text-white"
                : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            )}
          >
            <CalendarRange className="w-3.5 h-3.5" />
            Date Range
          </button>
        </div>

        {mode === "single" ? (
          <>
            <div className="border-b border-slate-800 px-3 py-2.5">
              <p className="text-xs font-semibold text-slate-200">Pick one date</p>
              <p className="text-[11px] text-slate-500 pt-0.5">
                Shows data for that exact day only — applies as soon as you pick it.
              </p>
            </div>
            {open && (
              <Calendar
                mode="single"
                captionLayout="label"
                defaultMonth={defaultMonth}
                selected={draftSingle}
                onSelect={selectSingleDay}
                numberOfMonths={1}
                showOutsideDays={false}
                className="text-white bg-slate-950 border-slate-800 p-2 [--cell-size:2.25rem]"
              />
            )}
          </>
        ) : (
          <>
            <div className="border-b border-slate-800 px-3 py-2.5 space-y-1.5">
              <p className="text-xs font-semibold text-slate-200">Pick a date range</p>
              <div className="flex items-center gap-2 text-[11px]">
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 font-medium",
                    draftRange?.from ? "bg-emerald-500/15 text-emerald-300" : "bg-slate-800 text-slate-500"
                  )}
                >
                  From: {draftRange?.from ? format(draftRange.from, "MMM d, y") : "—"}
                </span>
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 font-medium",
                    draftRange?.to ? "bg-emerald-500/15 text-emerald-300" : "bg-slate-800 text-slate-500"
                  )}
                >
                  To: {draftRange?.to ? format(draftRange.to, "MMM d, y") : "—"}
                </span>
              </div>
            </div>
            {open && (
              <Calendar
                mode="range"
                captionLayout="label"
                defaultMonth={defaultMonth}
                selected={draftRange}
                onSelect={setDraftRange}
                numberOfMonths={1}
                showOutsideDays={false}
                className="text-white bg-slate-950 border-slate-800 p-2 [--cell-size:2.25rem]"
              />
            )}
            <div className="border-t border-slate-800 px-3 py-2.5 flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="h-8 text-xs bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700"
                onClick={resetAndClose}
              >
                Reset to today
              </Button>
              <Button
                type="button"
                size="sm"
                className="h-8 text-xs bg-emerald-700 text-white hover:bg-emerald-600"
                disabled={!draftRange?.from || !draftRange?.to}
                onClick={applyRangeAndClose}
              >
                Apply range
              </Button>
            </div>
          </>
        )}

        {mode === "single" && (
          <div className="border-t border-slate-800 px-3 py-2.5">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-8 text-xs bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700"
              onClick={resetAndClose}
            >
              Reset to today
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

export const CustomRangePopover = memo(CustomRangePopoverInner);
