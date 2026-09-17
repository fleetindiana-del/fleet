"use client";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PhoneIncoming, PhoneOutgoing, PhoneMissed, HelpCircle, Search, Loader2, User, UserX, ArrowRight, ArrowLeftRight, Plus, XCircle, ChevronDown, Clock, CheckCircle2, X, Filter, Pencil, Check, ChevronUp } from "lucide-react";
import { format, addDays, subDays, startOfDay, endOfDay, isSameDay } from "date-fns";
import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { cn } from "@/lib/utils";
import { normalizePhoneNumber } from "@/lib/phone";
import { DateRange } from "react-day-picker";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Info } from "lucide-react";
import {
  ComposedChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  LabelList,
} from "recharts";
import { useNavbarCount } from "@/components/layout/NavbarCountContext";
import ComparisonPanel from "./ComparisonPanel";
import { CustomRangePopover } from "./CustomRangePopover";
import { DivideByEmployeeChartJs } from "./DivideByEmployeeChartJs";
import { formatHourRangeLabel } from "./timeExclusion";

const GraphSkeleton = () => (
  <div className="w-full h-full flex flex-col items-center justify-end pt-8 pb-4 px-2 sm:px-6">
    <div className="flex items-end justify-between w-full h-[80%] gap-1.5 sm:gap-2 px-1 border-b border-slate-800/60 pb-1">
      {[40, 70, 45, 90, 65, 30, 80, 50, 60, 35, 75, 40].map((h, i) => (
        <div key={i} className="w-full bg-slate-800/30 rounded-t flex flex-col justify-end overflow-hidden" style={{ height: `${h}%` }}>
          <div 
            className="w-full bg-indigo-500/20 rounded-t animate-pulse" 
            style={{ height: '100%', animationDelay: `${i * 0.1}s`, animationDuration: '1.5s' }} 
          />
        </div>
      ))}
    </div>
    <div className="w-full mt-8 flex justify-center items-center gap-3">
        <div className="relative flex h-2.5 w-2.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-indigo-500"></span>
        </div>
        <span className="text-sm text-slate-400 font-medium">Crunching the latest call data...</span>
    </div>
  </div>
);


const CATEGORY_LIST = ["personal", "staff", "New Client", "Existing Client", "courier"] as const;

const CATEGORY_COLORS_MAP: Record<string, string> = {
  personal: "bg-purple-500/15 text-purple-300 border-purple-500/30",
  staff: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  "Existing Client": "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  "New Client": "bg-amber-500/15 text-amber-300 border-amber-500/30",
  courier: "bg-orange-500/15 text-orange-300 border-orange-500/30",
};

const CATEGORY_OPTIONS_LIST = ["personal", "staff", "New Client", "Existing Client", "courier"] as const;

function IdentifiedTag({
  log,
  getEmployeeName,
  intelligenceTags,
  savingEdit,
  saveInlineEdit,
}: {
  log: any;
  getEmployeeName: (log: any) => string;
  intelligenceTags: Record<string, { category?: string; contactName?: string }>;
  savingEdit: string | null;
  saveInlineEdit: (phoneNumber: string, employeeName: string, field: "contactName" | "category", value: string) => void;
}) {
  const last10 = (phone: string) => String(phone ?? "").replace(/\D/g, "").slice(-10);
  const normalized = last10(normalizePhoneNumber(String(log.phoneNumber ?? ""))) || last10(String(log.phoneNumber ?? ""));
  const emp = getEmployeeName(log);
  const key = `${normalized}|${emp}`;
  const tag = intelligenceTags[key] ?? {};
  const isSaving = savingEdit === key;

  const [editingField, setEditingField] = useState<"contactName" | "category" | null>(null);
  const [localValue, setLocalValue] = useState("");

  const startEdit = (field: "contactName" | "category", current: string) => {
    setEditingField(field);
    setLocalValue(current);
  };

  const commitEdit = () => {
    if (!editingField) return;
    saveInlineEdit(log.phoneNumber, emp, editingField, localValue);
    setEditingField(null);
  };

  const cancelEdit = () => setEditingField(null);

  return (
    <div className="flex flex-wrap gap-1 items-center min-w-[120px]">
      {/* Category chip — click to edit */}
      {editingField === "category" ? (
        <div className="flex items-center gap-1">
          <select
            autoFocus
            value={localValue}
            onChange={e => setLocalValue(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={e => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") cancelEdit(); }}
            className="text-[11px] rounded border border-indigo-500/60 bg-slate-800 text-slate-100 px-1.5 py-0.5 outline-none"
          >
            <option value="">— none —</option>
            {CATEGORY_OPTIONS_LIST.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <button type="button" onClick={commitEdit} className="text-indigo-400 hover:text-indigo-300"><Check className="h-3.5 w-3.5" /></button>
          <button type="button" onClick={cancelEdit} className="text-slate-500 hover:text-slate-300"><X className="h-3.5 w-3.5" /></button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => startEdit("category", tag.category ?? "")}
          title="Click to edit category"
          className={cn(
            "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border transition-colors group",
            tag.category
              ? CATEGORY_COLORS_MAP[tag.category] ?? "bg-slate-700 text-slate-300 border-slate-600"
              : "border-dashed border-slate-700 text-slate-600 hover:border-slate-500 hover:text-slate-400"
          )}
        >
          {tag.category ?? "add category"}
          <Pencil className="h-2.5 w-2.5 opacity-0 group-hover:opacity-60 transition-opacity" />
        </button>
      )}

      {/* Contact name chip — click to edit */}
      {editingField === "contactName" ? (
        <div className="flex items-center gap-1">
          <input
            autoFocus
            type="text"
            value={localValue}
            onChange={e => setLocalValue(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={e => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") cancelEdit(); }}
            className="text-[11px] rounded border border-indigo-500/60 bg-slate-800 text-slate-100 px-2 py-0.5 outline-none w-28"
            placeholder="Contact name"
          />
          <button type="button" onClick={commitEdit} className="text-indigo-400 hover:text-indigo-300"><Check className="h-3.5 w-3.5" /></button>
          <button type="button" onClick={cancelEdit} className="text-slate-500 hover:text-slate-300"><X className="h-3.5 w-3.5" /></button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => startEdit("contactName", tag.contactName ?? "")}
          title="Click to edit contact name"
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border group transition-colors bg-violet-500/15 text-violet-300 border-violet-500/30 hover:bg-violet-500/25"
        >
          {isSaving ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : null}
          {tag.contactName ?? <span className="text-slate-600 italic">add name</span>}
          <Pencil className="h-2.5 w-2.5 opacity-0 group-hover:opacity-60 transition-opacity" />
        </button>
      )}
    </div>
  );
}

export default function CallLogsPage() {
  const [logs, setLogs] = useState<any[]>([]);
  const [tags, setTags] = useState<Record<string, Array<{name: string, savedBy: any[]}>>>({});
  const [intelligenceTags, setIntelligenceTags] = useState<Record<string, { category?: string; contactName?: string }>>({});
  const [totalCount, setTotalCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCallTypeFilters, setActiveCallTypeFilters] = useState<Set<string>>(new Set(["ALL"]));
  const [dateFilter, setDateFilter] = useState<"ALL" | "TODAY" | "TOMORROW" | "YESTERDAY" | "CUSTOM">("TODAY");
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [selectedEmployee, setSelectedEmployee] = useState<string>("ALL");
  const [selectedDepartment, setSelectedDepartment] = useState<string>("Marketing");
  const [departments, setDepartments] = useState<Array<{ _id: string; name: string }>>([]);
  const [isTagModalOpen, setIsTagModalOpen] = useState(false);
  const [selectedPhoneForTags, setSelectedPhoneForTags] = useState<string | null>(null);
  const [isFetchingTags, setIsFetchingTags] = useState(false);
  const logsRef = useRef<HTMLDivElement>(null);
  const graphCardRef = useRef<HTMLDivElement>(null);
  const categoryFilterRef = useRef<HTMLDivElement>(null);
  const [comparisonMode, setComparisonMode] = useState(false);
  const [divideByEmployee, setDivideByEmployee] = useState(false);
  const [hideShortCalls, setHideShortCalls] = useState(true); // default: keep >=10s (except MISSED)
  const [hideMissedCalls, setHideMissedCalls] = useState(false);
  const [hidePersonalContacts, setHidePersonalContacts] = useState(false);
  const [hideStaffContacts, setHideStaffContacts] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string>("ALL"); // intelligence category filter
  const [contactPhoneFilter, setContactPhoneFilter] = useState<string | null>(null); // table-only phone filter from insights click
  const [comparisonPanels, setComparisonPanels] = useState<
    Array<{ id: string; dateFilter: "TODAY" | "YESTERDAY" | "CUSTOM" }>
  >([]);
  const [compareViewMode, setCompareViewMode] = useState<"panels" | "singleGraph">("singleGraph");
  const [selectedCompareEmployees, setSelectedCompareEmployees] = useState<string[]>([]);
  const [compareXAxisMode, setCompareXAxisMode] = useState<"hour" | "date">("hour");
  const [ignoredGraphEmployees, setIgnoredGraphEmployees] = useState<string[]>([]);
  const [graphExclusionEmployeesOpen, setGraphExclusionEmployeesOpen] = useState(false);
  const [excludedGraphHours, setExcludedGraphHours] = useState<number[]>([]);
  const [graphExclusionHoursOpen, setGraphExclusionHoursOpen] = useState(false);
  const [showUnidentifiedModal, setShowUnidentifiedModal] = useState(false);
  const [isDesktop, setIsDesktop] = useState(true);
  const [showFilterPopup, setShowFilterPopup] = useState(false);
  const [insightsExpanded, setInsightsExpanded] = useState(true);
  const [insightsLimit, setInsightsLimit] = useState(3);
  // Inline edit state: key = "phoneNorm|employeeName", value = { contactName, category }
  const [savingEdit, setSavingEdit] = useState<string | null>(null); // key being saved
  const logsCacheRef = useRef<Map<string, { logs: any[]; totalCount: number }>>(new Map());
  const latestFetchKeyRef = useRef<string>("");
  const fetchedTagPhonesRef = useRef<Set<string>>(new Set());
  const fetchedIntelligencePairsRef = useRef<Set<string>>(new Set());
  const { setShowingCount } = useNavbarCount();

  const [graphFilter, setGraphFilter] = useState<
    | null
    | {
        xMode: "hour";
        hour: number;
        callType?: "INCOMING" | "OUTGOING" | "MISSED";
        employee?: string;
        range?: { startTs: number; endTs: number };
      }
    | {
        xMode: "date";
        dateTs: number;
        callType?: "INCOMING" | "OUTGOING" | "MISSED";
        employee?: string;
        range?: { startTs: number; endTs: number };
      }
  >(null);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 640px)");
    const set = () => setIsDesktop(mq.matches);
    set();
    mq.addEventListener("change", set);
    return () => mq.removeEventListener("change", set);
  }, []);

  useEffect(() => {
    fetch("/api/departments")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setDepartments(data);
      })
      .catch(() => {});
  }, []);

  // When in compare mode and employees load, default to all selected if none selected yet
  const employeeNames = useMemo(() => {
    const names = new Set<string>();
    logs.forEach((log) => {
      const name = log.employeeName || log.driverId?.userId?.name;
      if (name) names.add(name);
    });
    return Array.from(names).sort();
  }, [logs]);

  // Employees filtered to those belonging to the selected department
  const employeeNamesForDept = useMemo(() => {
    if (selectedDepartment === "ALL") return employeeNames;
    const deptLower = selectedDepartment.toLowerCase();
    return employeeNames.filter((name) =>
      logs.some((log) => {
        const empName = log.employeeName || log.driverId?.userId?.name || "Unknown";
        const dept = log.driverId?.userId?.departmentId?.name || log.employeeDepartment?.departmentName || "";
        return empName === name && dept.toLowerCase() === deptLower;
      })
    );
  }, [employeeNames, logs, selectedDepartment]);

  // Reset selected employee when department changes
  useEffect(() => {
    setSelectedEmployee("ALL");
  }, [selectedDepartment]);

  useEffect(() => {
    if (comparisonMode && selectedCompareEmployees.length === 0 && employeeNames.length > 0) {
      setSelectedCompareEmployees(employeeNames);
    }
  }, [comparisonMode, employeeNames, selectedCompareEmployees.length]);

  const toggleComparisonMode = () => {
    if (!comparisonMode) {
      setComparisonPanels([
        { id: "panel-a", dateFilter: "TODAY" },
        { id: "panel-b", dateFilter: "YESTERDAY" },
      ]);
      setSelectedCompareEmployees(employeeNames);
      setCompareXAxisMode("hour");
    }
    setComparisonMode(!comparisonMode);
  };

  const addComparisonPanel = () => {
    if (comparisonPanels.length >= 4) return;
    setComparisonPanels((prev) => [
      ...prev,
      { id: `panel-${Date.now()}`, dateFilter: "TODAY" },
    ]);
  };

  const removeComparisonPanel = (id: string) => {
    setComparisonPanels((prev) => prev.filter((p) => p.id !== id));
  };

  const scrollToLogs = () => {
    // Only auto-scroll on small (mobile) screens
    if (window.innerWidth < 640 && logsRef.current) {
      setTimeout(() => {
        logsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 80);
    }
  };

  const scrollToRecords = () => {
    if (!logsRef.current) return;
    setTimeout(() => {
      logsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
  };

  const applyCustomRange = useCallback((range: DateRange | undefined) => {
    if (range?.from) {
      setDateRange(range);
      setDateFilter("CUSTOM");
    }
  }, []);

  const resetDateFilterToToday = useCallback(() => {
    setDateRange(undefined);
    setDateFilter("TODAY");
  }, []);

  const fetchLogs = useCallback(async () => {
    const getRange = () => {
      let start: Date | null = null;
      let end: Date | null = null;

      if (dateFilter === "TODAY") {
        start = startOfDay(new Date());
        end = endOfDay(new Date());
      } else if (dateFilter === "TOMORROW") {
        const tomorrow = addDays(new Date(), 1);
        start = startOfDay(tomorrow);
        end = endOfDay(tomorrow);
      } else if (dateFilter === "YESTERDAY") {
        const yesterday = subDays(new Date(), 1);
        start = startOfDay(yesterday);
        end = endOfDay(yesterday);
      } else if (dateFilter === "CUSTOM" && dateRange?.from) {
        start = startOfDay(dateRange.from);
        end = dateRange.to ? endOfDay(dateRange.to) : endOfDay(dateRange.from);
      }

      return { start, end };
    };

    const { start, end } = getRange();
    const cacheKey = JSON.stringify({
      typeFilters: Array.from(activeCallTypeFilters).sort().join(","),
      dateFilter,
      start: start?.toISOString() ?? null,
      end: end?.toISOString() ?? null,
    });
    latestFetchKeyRef.current = cacheKey;

    const cached = logsCacheRef.current.get(cacheKey);
    if (cached) {
      setLogs(cached.logs);
      setTotalCount(cached.totalCount);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setFetchError(null);
    try {
      const url = new URL("/api/call-logs", window.location.origin);
      if (!activeCallTypeFilters.has("ALL")) {
        url.searchParams.append("callType", Array.from(activeCallTypeFilters).join(","));
      }

      if (start) url.searchParams.append("startDate", start.toISOString());
      if (end) url.searchParams.append("endDate", end.toISOString());

      const res = await fetch(url.toString());
      if (res.ok) {
        const data = await res.json();
        const nextPayload = Array.isArray(data)
          ? { logs: data, totalCount: data.length }
          : { logs: data.logs || [], totalCount: data.totalCount || 0 };
        logsCacheRef.current.set(cacheKey, nextPayload);
        if (latestFetchKeyRef.current !== cacheKey) return;
        setLogs(nextPayload.logs);
        setTotalCount(nextPayload.totalCount);
        setFetchError(null);
      } else {
        const err = await res.json().catch(() => ({}));
        console.error("Call logs fetch failed:", res.status, err);
        if (latestFetchKeyRef.current !== cacheKey) return;
        setLogs([]);
        setTotalCount(0);
        setFetchError(
          res.status === 401
            ? "Not authorised — your session may have expired. Please refresh the page."
            : `Failed to load call logs (${res.status}): ${(err as any)?.error ?? "Server error"}`
        );
      }
    } catch (error) {
      console.error("Failed to fetch call logs:", error);
      if (latestFetchKeyRef.current === cacheKey) {
        setLogs([]);
        setTotalCount(0);
        setFetchError("Network error — could not reach the server. Check your connection and try again.");
      }
    } finally {
      if (latestFetchKeyRef.current === cacheKey) {
        setIsLoading(false);
      }
    }
  }, [activeCallTypeFilters, dateFilter, dateRange]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const invalidateCacheAndRefetch = useCallback(() => {
    logsCacheRef.current.clear();
    latestFetchKeyRef.current = "";
    setIsLoading(true);
    void fetchLogs();
  }, [fetchLogs]);

  // Cross-page / same-tab invalidation: when employees or logs change elsewhere,
  // trigger a fresh fetch so new employees appear without manual reload.
  useEffect(() => {
    const onCustom = () => invalidateCacheAndRefetch();
    const onStorage = (e: StorageEvent) => {
      if (e.key === "app:invalidateEmployees" || e.key === "app:invalidateCallLogs") {
        invalidateCacheAndRefetch();
      }
    };

    window.addEventListener("app:invalidateEmployees", onCustom as EventListener);
    window.addEventListener("app:invalidateCallLogs", onCustom as EventListener);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("app:invalidateEmployees", onCustom as EventListener);
      window.removeEventListener("app:invalidateCallLogs", onCustom as EventListener);
      window.removeEventListener("storage", onStorage);
    };
  }, [invalidateCacheAndRefetch]);

  const fetchTags = async (logsToProcess: any[]) => {
    const uniquePhones = [...new Set(logsToProcess.map((log) => log.phoneNumber))];
    const uncachedPhones = uniquePhones.filter((phone) => !fetchedTagPhonesRef.current.has(phone));
    if (uncachedPhones.length === 0) return;

    uncachedPhones.forEach((phone) => fetchedTagPhonesRef.current.add(phone));

    try {
      const res = await fetch("/api/contacts/tags/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumbers: uncachedPhones }),
      });
      if (res.ok) {
        const data = await res.json();
        setTags((prev) => ({ ...prev, ...data.tags }));
      } else {
        uncachedPhones.forEach((phone) => fetchedTagPhonesRef.current.delete(phone));
      }
    } catch (error) {
      uncachedPhones.forEach((phone) => fetchedTagPhonesRef.current.delete(phone));
      console.error("Failed to fetch tags:", error);
    }
  };

  const fetchIntelligenceTags = async (logsToProcess: any[]) => {
    const last10 = (phone: string) => String(phone ?? "").replace(/\D/g, "").slice(-10);
    const pairs = Array.from(
      new Map(
        logsToProcess.map((log) => {
          const emp = log.employeeName || log.driverId?.userId?.name || "Unknown";
          const normalized = last10(normalizePhoneNumber(String(log.phoneNumber ?? ""))) || last10(String(log.phoneNumber ?? ""));
          return [`${normalized}|${emp}`, { phoneNumber: normalized, employeeName: emp }];
        })
      ).values()
    );
    const uncachedPairs = pairs.filter(({ phoneNumber, employeeName }) => {
      const key = `${phoneNumber}|${employeeName}`;
      return !fetchedIntelligencePairsRef.current.has(key);
    });
    if (uncachedPairs.length === 0) return;

    uncachedPairs.forEach(({ phoneNumber, employeeName }) => {
      fetchedIntelligencePairsRef.current.add(`${phoneNumber}|${employeeName}`);
    });

    try {
      const res = await fetch("/api/contact-intelligence/tags-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pairs: uncachedPairs }),
      });
      if (res.ok) {
        const data = await res.json();
        setIntelligenceTags((prev) => ({ ...prev, ...data.tags }));
      } else {
        uncachedPairs.forEach(({ phoneNumber, employeeName }) => {
          fetchedIntelligencePairsRef.current.delete(`${phoneNumber}|${employeeName}`);
        });
      }
    } catch (error) {
      uncachedPairs.forEach(({ phoneNumber, employeeName }) => {
        fetchedIntelligencePairsRef.current.delete(`${phoneNumber}|${employeeName}`);
      });
      console.error("Failed to fetch intelligence tags:", error);
    }
  };

  // We should fetch tags once the page determines the filteredLogs that are visible.
  // Using an effect that triggers on filteredLogs changes ensures tags represent
  // what's visible, and avoids excessive repeated loading.
  
  // When employee list changes, reset selection if selected employee no longer present
  useEffect(() => {
    if (selectedEmployee !== "ALL" && !employeeNames.includes(selectedEmployee)) {
      setSelectedEmployee("ALL");
    }
  }, [employeeNames]);

  const ignoredEmployeeSet = useMemo(() => new Set(ignoredGraphEmployees), [ignoredGraphEmployees]);
  const excludedHourSet = useMemo(() => new Set(excludedGraphHours), [excludedGraphHours]);

  useEffect(() => {
    setIgnoredGraphEmployees((prev) => prev.filter((n) => employeeNames.includes(n)));
  }, [employeeNames]);

  const getEmployeeName = (log: any) =>
    log.employeeName || log.driverId?.userId?.name || "Unknown";

  const getEmployeeDepartment = (log: any) =>
    log.driverId?.userId?.departmentId?.name || log.employeeDepartment?.departmentName || "";

  // Strict date boundaries for client-side enforcement (prevents data leakage from cached API results)
  const activeDateBounds = useMemo(() => {
    if (dateFilter === "TODAY") {
      return { start: startOfDay(new Date()).getTime(), end: endOfDay(new Date()).getTime() };
    }
    if (dateFilter === "TOMORROW") {
      const t = addDays(new Date(), 1);
      return { start: startOfDay(t).getTime(), end: endOfDay(t).getTime() };
    }
    if (dateFilter === "YESTERDAY") {
      const y = subDays(new Date(), 1);
      return { start: startOfDay(y).getTime(), end: endOfDay(y).getTime() };
    }
    if (dateFilter === "CUSTOM" && dateRange?.from) {
      return {
        start: startOfDay(dateRange.from).getTime(),
        end: (dateRange.to ? endOfDay(dateRange.to) : endOfDay(dateRange.from)).getTime(),
      };
    }
    return null; // ALL — no strict bound
  }, [dateFilter, dateRange]);

  const rawFilteredLogs = useMemo(() => {
    const q = String(searchQuery ?? "").trim();
    const qLower = q.toLowerCase();
    const qDigits = q.replace(/\D/g, "");
    const last10 = (phone: string) => String(phone ?? "").replace(/\D/g, "").slice(-10);
    return logs.filter((log) => {
      // Strict client-side date boundary check to prevent data leakage between date filter changes
      if (activeDateBounds && log.timestamp) {
        const ts = new Date(log.timestamp).getTime();
        if (isNaN(ts) || ts < activeDateBounds.start || ts > activeDateBounds.end) return false;
      }

      const phoneRaw = String(log.phoneNumber ?? "");
      const phoneNorm = last10(normalizePhoneNumber(phoneRaw)) || last10(phoneRaw);
      const emp = getEmployeeName(log);
      const intelKey = `${phoneNorm}|${emp}`;
      const intel = intelligenceTags[intelKey];
      const tagNames = (tags[phoneRaw] ?? []).map((t: any) => String(t?.name ?? ""));

      const matchesSearch =
        q === "" ||
        // Number search: allow +91/91, spaces, and partial digits (e.g. last 4-10).
        (qDigits.length > 0 && phoneNorm.includes(qDigits)) ||
        // Text search fallback: match visible labels (case-insensitive).
        (qDigits.length === 0 &&
          [
            String(log.contactName ?? ""),
            String(intel?.contactName ?? ""),
            String(intel?.category ?? ""),
            ...tagNames,
          ]
            .join(" ")
            .toLowerCase()
            .includes(qLower));
      const matchesEmployee =
        selectedEmployee === "ALL" || getEmployeeName(log) === selectedEmployee;
      const matchesDepartment =
        selectedDepartment === "ALL" ||
        getEmployeeDepartment(log).toLowerCase() === selectedDepartment.toLowerCase();
      const durationSec = Number(log.duration) || 0;
      const keepByDuration = !hideShortCalls || log.callType === "MISSED" || durationSec >= 10;
      const keepByMissed = !hideMissedCalls || log.callType !== "MISSED";
      return matchesSearch && matchesEmployee && matchesDepartment && keepByDuration && keepByMissed;
    });
  }, [logs, searchQuery, selectedEmployee, selectedDepartment, hideShortCalls, hideMissedCalls, intelligenceTags, tags, activeDateBounds]);

  // Deduplicate logs introduced by an old Android app bug
  const dedupedFilteredLogs = useMemo(() => {
    const uniqueLogs: any[] = [];
    
    // Sort raw logs descending by timestamp first so the newest in a duplicate cluster comes first
    const sortedRaw = [...rawFilteredLogs].sort((a, b) => {
      const timeA = new Date(a.timestamp).getTime();
      const timeB = new Date(b.timestamp).getTime();
      return timeB - timeA;
    });

    sortedRaw.forEach(log => {
      if (!log.timestamp) {
        uniqueLogs.push(log);
        return;
      }
      
      const logTime = new Date(log.timestamp).getTime();
      const emp = getEmployeeName(log);
      
      // Check if this log matches an existing one in our unique array
      const isDuplicate = uniqueLogs.some(existing => {
        if (existing.phoneNumber !== log.phoneNumber || 
            existing.callType !== log.callType || 
            getEmployeeName(existing) !== emp) {
          return false;
        }
        
        // Time difference within 5 minutes (300000 ms) since some syncs got super delayed
        const existingTime = new Date(existing.timestamp).getTime();
        const isTimeClose = Math.abs(existingTime - logTime) < 300000;
        
        // Duration difference within 30 seconds
        const isDurationClose = Math.abs(existing.duration - log.duration) <= 30;
        
        return isTimeClose && isDurationClose;
      });

      if (!isDuplicate) {
        uniqueLogs.push(log);
      }
    });

    return uniqueLogs;
  }, [rawFilteredLogs]);

  const intelKey = (log: any) => {
    const last10 = (phone: string) => String(phone ?? "").replace(/\D/g, "").slice(-10);
    const phoneNorm = last10(normalizePhoneNumber(String(log.phoneNumber ?? ""))) || last10(String(log.phoneNumber ?? ""));
    return `${phoneNorm}|${getEmployeeName(log)}`;
  };

  const filteredLogs = useMemo(() => {
    if (!hidePersonalContacts && !hideStaffContacts) return dedupedFilteredLogs;

    return dedupedFilteredLogs.filter((log) => {
      const category = intelligenceTags[intelKey(log)]?.category;
      if (hidePersonalContacts && category === "personal") return false;
      if (hideStaffContacts && category === "staff") return false;
      return true;
    });
  }, [dedupedFilteredLogs, hidePersonalContacts, hideStaffContacts, intelligenceTags]);

  const categoryFilteredLogs = useMemo(() => {
    if (categoryFilter === "ALL") return filteredLogs;
    return filteredLogs.filter((log) => intelligenceTags[intelKey(log)]?.category === categoryFilter);
  }, [filteredLogs, categoryFilter, intelligenceTags]);

  useEffect(() => {
    setShowingCount(categoryFilteredLogs.length);
    return () => setShowingCount(null);
  }, [categoryFilteredLogs.length, setShowingCount]);

  const graphDisplayLogs = useMemo(() => {
    return categoryFilteredLogs.filter((log) => {
      if (ignoredEmployeeSet.has(getEmployeeName(log))) return false;
      if (excludedHourSet.size === 0) return true;
      if (!log.timestamp) return true;
      const d = new Date(log.timestamp);
      if (isNaN(d.getTime())) return true;
      return !excludedHourSet.has(d.getHours());
    });
  }, [categoryFilteredLogs, ignoredEmployeeSet, excludedHourSet]);

  // Used for category stats in the summary bar — always based on pre-category-filter data
  // so all category chips remain visible even when one is active.
  const graphDisplayLogsForStats = useMemo(() => {
    return filteredLogs.filter((log) => {
      if (ignoredEmployeeSet.has(getEmployeeName(log))) return false;
      if (excludedHourSet.size === 0) return true;
      if (!log.timestamp) return true;
      const d = new Date(log.timestamp);
      if (isNaN(d.getTime())) return true;
      return !excludedHourSet.has(d.getHours());
    });
  }, [filteredLogs, ignoredEmployeeSet, excludedHourSet]);

  useEffect(() => {
    if (dedupedFilteredLogs.length > 0) {
      fetchTags(dedupedFilteredLogs);
      fetchIntelligenceTags(dedupedFilteredLogs);
    }
  }, [dedupedFilteredLogs]);

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s}s`;
  };

  const formatMinutesOrHours = (seconds: number) => {
    const totalMinutes = Math.round((Number(seconds) || 0) / 60);
    if (totalMinutes <= 0) return "0m";
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    if (h <= 0) return `${totalMinutes}m`;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  };

  const CallTypeBadge = ({ callType, className }: { callType: string; className?: string }) => {
    if (callType === "INCOMING")
      return (
        <Badge className={cn("bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/20 gap-1.5 rounded-full px-1.5 py-0.5", className)}>
          <PhoneIncoming className="w-3.5 h-3.5" /> Incoming
        </Badge>
      );
    if (callType === "OUTGOING")
      return (
        <Badge className={cn("bg-sky-500/10 text-sky-400 hover:bg-sky-500/20 border border-sky-500/20 gap-1.5 rounded-full px-2.5 py-1", className)}>
          <PhoneOutgoing className="w-3.5 h-3.5" /> Outgoing
        </Badge>
      );
    if (callType === "MISSED")
      return (
        <Badge className={cn("bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 border border-rose-500/20 gap-1.5 rounded-full px-2.5 py-1", className)}>
          <PhoneMissed className="w-3.5 h-3.5" /> Missed
        </Badge>
      );
    if (callType === "UNKNOWN")
      return (
        <Badge className={cn("bg-slate-500/10 text-slate-400 hover:bg-slate-500/20 border border-slate-500/20 gap-1.5 rounded-full px-2.5 py-1", className)}>
          <HelpCircle className="w-3.5 h-3.5" /> Unknown
        </Badge>
      );
    return null;
  };

  const CATEGORY_COLORS = CATEGORY_COLORS_MAP;

  const categoryOptions = useMemo(() => {
    return ["ALL", "personal", "staff", "New Client", "Existing Client", "courier"];
  }, []);

  const timeBuckets = useMemo(() => {
    const labels = [];
    for (let hour = 0; hour < 24; hour++) {
      const nextHour = (hour + 1) % 24;
      const formatHour = (h: number) => {
        const period = h < 12 ? "AM" : "PM";
        const display = h % 12 === 0 ? 12 : h % 12;
        return `${display} ${period}`;
      };
      labels.push({
        key: `${hour}`,
        label: `${formatHour(hour)} – ${formatHour(nextHour)}`,
        hour,
      });
    }
    return labels;
  }, []);

  const chartData = useMemo(() => {
    const catKeys = CATEGORY_LIST.map((c) => `cat_${c}`);
    const base = timeBuckets.map((b) => {
      const row: Record<string, any> = {
        timeRange: b.label,
        hour: b.hour,
        incoming: 0,
        outgoing: 0,
        missed: 0,
        missedBar: 0,
        total: 0,
      };
      for (const ck of catKeys) row[ck] = 0;
      return row;
    });

    graphDisplayLogs.forEach((log) => {
      if (!log.timestamp) return;
      const date = new Date(log.timestamp);
      if (isNaN(date.getTime())) return;
      const hour = date.getHours();
      const bucket = base[hour];
      if (!bucket) return;
      if (log.callType === "INCOMING") bucket.incoming += 1;
      else if (log.callType === "OUTGOING") bucket.outgoing += 1;
      else if (log.callType === "MISSED") bucket.missed += 1;
      bucket.total += 1;
      const cat = intelligenceTags[intelKey(log)]?.category;
      if (cat && `cat_${cat}` in bucket) bucket[`cat_${cat}`] += Number(log.duration) || 0;
    });

    // Only keep buckets that actually have calls so the x-axis
    // shows only hours with activity (no empty columns).
    // missedBar is 0.01 minimum so the bar always renders (needed for LabelList position="top").
    return base
      .filter((b) => b.total > 0)
      .map((b) => ({ ...b, missedBar: b.missed > 0 ? b.missed : 0.01 }));
  }, [graphDisplayLogs, timeBuckets, intelligenceTags]);

  const divideGraphEmployees = useMemo(() => {
    if (selectedEmployee !== "ALL") {
      return ignoredEmployeeSet.has(selectedEmployee) ? [] : [selectedEmployee];
    }
    return employeeNames.filter((e) => !ignoredEmployeeSet.has(e));
  }, [employeeNames, ignoredEmployeeSet, selectedEmployee]);

  const chartDataDividedByEmployee = useMemo(() => {
    const empKeys = divideGraphEmployees;
    if (empKeys.length === 0) return [];
    const base = timeBuckets.map((b) => {
      const row: Record<string, string | number> = { timeRange: b.label, hour: b.hour };
      empKeys.forEach((e) => {
        row[`${e}_incoming`] = 0;
        row[`${e}_outgoing`] = 0;
        row[`${e}_missed`] = 0;
      });
      return row;
    });
    graphDisplayLogs.forEach((log) => {
      if (!log.timestamp) return;
      const date = new Date(log.timestamp);
      if (isNaN(date.getTime())) return;
      const hour = date.getHours();
      const bucket = base[hour];
      if (!bucket) return;
      const emp = getEmployeeName(log);
      if (!empKeys.includes(emp)) return;
      const key =
        log.callType === "INCOMING"
          ? `${emp}_incoming`
          : log.callType === "OUTGOING"
            ? `${emp}_outgoing`
            : `${emp}_missed`;
      if (typeof bucket[key] === "number") (bucket[key] as number) += 1;
    });
    return base.filter((b) =>
      empKeys.some(
        (e) =>
          ((b[`${e}_incoming`] as number) || 0) +
            ((b[`${e}_outgoing`] as number) || 0) +
            ((b[`${e}_missed`] as number) || 0) >
          0
      )
    );
  }, [graphDisplayLogs, timeBuckets, divideGraphEmployees]);

  const callTypeStats = useMemo(() => {
    let incoming = 0;
    let outgoing = 0;
    let missed = 0;
    for (const log of graphDisplayLogs) {
      if (log.callType === "INCOMING") incoming += 1;
      else if (log.callType === "OUTGOING") outgoing += 1;
      else if (log.callType === "MISSED") missed += 1;
    }
    return {
      total: graphDisplayLogs.length,
      incoming,
      outgoing,
      missed,
    };
  }, [graphDisplayLogs]);

  const callDurationStats = useMemo(() => {
    let incomingSec = 0;
    let outgoingSec = 0;
    let totalSec = 0;
    for (const log of graphDisplayLogs) {
      const d = Number(log.duration) || 0;
      totalSec += d;
      if (log.callType === "INCOMING") incomingSec += d;
      else if (log.callType === "OUTGOING") outgoingSec += d;
    }
    return { totalSec, incomingSec, outgoingSec };
  }, [graphDisplayLogs]);

  const categoryDurationStats = useMemo(() => {
    const result: Record<string, number> = {};
    for (const cat of CATEGORY_LIST) result[cat] = 0;
    for (const log of graphDisplayLogsForStats) {
      const key = intelKey(log);
      const cat = intelligenceTags[key]?.category;
      if (cat && cat in result) result[cat] += Number(log.duration) || 0;
    }
    return result;
  }, [graphDisplayLogsForStats, intelligenceTags]);

  const categoryCallCountStats = useMemo(() => {
    const result: Record<string, number> = {};
    for (const cat of CATEGORY_LIST) result[cat] = 0;
    for (const log of graphDisplayLogsForStats) {
      const key = intelKey(log);
      const cat = intelligenceTags[key]?.category;
      if (cat && cat in result) result[cat] += 1;
    }
    return result;
  }, [graphDisplayLogs, intelligenceTags]);

  const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

  type CompletionRow = {
    id: string;
    employee: string;
    phoneNumber: string;
    contactName: string;
    category: string;
    missedAt: number;
    callbackAt: number | null;
    completed: boolean;
    totalCalls: number;
  };

  // Produces one row per missed call (limited to New Client / Existing Client / Unknown),
  // paired with the earliest unused outgoing callback within 2 hours.
  const completionRows = useMemo((): CompletionRow[] => {
    const last10 = (p: string) => String(p ?? "").replace(/\D/g, "").slice(-10);

    // Build total-call count per phone+employee across the full filtered set
    const callCountByKey = new Map<string, number>();
    for (const log of categoryFilteredLogs) {
      const phoneNorm = last10(normalizePhoneNumber(String(log.phoneNumber ?? ""))) || last10(String(log.phoneNumber ?? ""));
      const emp = getEmployeeName(log);
      const k = `${phoneNorm}|${emp}`;
      callCountByKey.set(k, (callCountByKey.get(k) ?? 0) + 1);
    }

    // Build lookup of outgoing calls keyed by "phoneNorm|emp", sorted ascending
    const outgoingByKey = new Map<string, { ts: number; used: boolean }[]>();
    for (const log of categoryFilteredLogs) {
      if (log.callType !== "OUTGOING" || !log.timestamp) continue;
      const ts = new Date(log.timestamp).getTime();
      if (isNaN(ts)) continue;
      const phoneNorm = last10(normalizePhoneNumber(String(log.phoneNumber ?? ""))) || last10(String(log.phoneNumber ?? ""));
      const emp = getEmployeeName(log);
      const k = `${phoneNorm}|${emp}`;
      if (!outgoingByKey.has(k)) outgoingByKey.set(k, []);
      outgoingByKey.get(k)!.push({ ts, used: false });
    }
    outgoingByKey.forEach((arr) => arr.sort((a, b) => a.ts - b.ts));

    const rows: CompletionRow[] = [];

    for (const log of categoryFilteredLogs) {
      if (log.callType !== "MISSED" || !log.timestamp) continue;
      const missedTs = new Date(log.timestamp).getTime();
      if (isNaN(missedTs)) continue;

      const phoneRaw = String(log.phoneNumber ?? "");
      const phoneNorm = last10(normalizePhoneNumber(phoneRaw)) || last10(phoneRaw);
      const emp = getEmployeeName(log);
      const k = `${phoneNorm}|${emp}`;
      const intel = intelligenceTags[k];
      const cat = intel?.category ?? "";
      const contactName = intel?.contactName || log.contactName || "";

      // Skip staff and personal categories in call completion
      if (cat === "staff" || cat === "personal") continue;

      // Pair: find earliest unused outgoing to same phone by same employee within 2h
      let callbackAt: number | null = null;
      const outgoing = outgoingByKey.get(k) ?? [];
      for (const entry of outgoing) {
        if (entry.used || entry.ts < missedTs) continue;
        if (entry.ts - missedTs > TWO_HOURS_MS) break;
        entry.used = true;
        callbackAt = entry.ts;
        break;
      }

      // Skip already called-back entries
      if (callbackAt !== null) continue;

      rows.push({
        id: `${String(log._id ?? "")}|${missedTs}`,
        employee: emp,
        phoneNumber: phoneRaw,
        contactName,
        category: cat,
        missedAt: missedTs,
        callbackAt,
        completed: false,
        totalCalls: callCountByKey.get(k) ?? 1,
      });
    }

    // Sort: not-completed first (needs attention), then by missedAt desc
    return rows.sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1;
      return b.missedAt - a.missedAt;
    });
  }, [categoryFilteredLogs, intelligenceTags, TWO_HOURS_MS]);

  // Summary aggregates derived from completionRows
  const completionSummary = useMemo(() => {
    type Cat = "New Client" | "Existing Client" | "Unknown";
    const cats: Cat[] = ["New Client", "Existing Client", "Unknown"];
    const result: Record<Cat, { missed: number; completed: number; notCompleted: number; ratio: number }> = {
      "New Client":      { missed: 0, completed: 0, notCompleted: 0, ratio: 0 },
      "Existing Client": { missed: 0, completed: 0, notCompleted: 0, ratio: 0 },
      "Unknown":         { missed: 0, completed: 0, notCompleted: 0, ratio: 0 },
    };
    for (const row of completionRows) {
      const bucket: Cat = (row.category === "New Client" || row.category === "Existing Client") ? row.category : "Unknown";
      result[bucket].missed += 1;
      if (row.completed) result[bucket].completed += 1;
      else result[bucket].notCompleted += 1;
    }
    for (const cat of cats) {
      const r = result[cat];
      r.ratio = r.missed > 0 ? Math.round((r.completed / r.missed) * 100) : 0;
    }
    return result;
  }, [completionRows]);

  const topContactInsights = useMemo(() => {
    const last10 = (phone: string) => String(phone ?? "").replace(/\D/g, "").slice(-10);
    const UNKNOWN_VALUES = new Set(["unknown", "", "null", "undefined"]);
    const isUnknown = (name: string) => UNKNOWN_VALUES.has(name.trim().toLowerCase());
    const contactMap = new Map<string, { contactName: string; phone: string; calls: number; totalDurationSec: number }>();
    let unknownCalls = 0;
    let unknownDuration = 0;
    for (const log of categoryFilteredLogs) {
      const phoneRaw = String(log.phoneNumber ?? "");
      const phoneNorm = last10(normalizePhoneNumber(phoneRaw)) || last10(phoneRaw);
      const emp = getEmployeeName(log);
      const intelK = `${phoneNorm}|${emp}`;
      const intel = intelligenceTags[intelK];
      const rawName = intel?.contactName || log.contactName || "";
      const duration = Number(log.duration) || 0;
      if (!rawName || isUnknown(rawName)) {
        unknownCalls += 1;
        unknownDuration += duration;
        continue;
      }
      const mapKey = phoneNorm || phoneRaw;
      const existing = contactMap.get(mapKey);
      if (existing) {
        existing.calls += 1;
        existing.totalDurationSec += duration;
      } else {
        contactMap.set(mapKey, { contactName: rawName, phone: phoneRaw, calls: 1, totalDurationSec: duration });
      }
    }
    if (contactMap.size === 0 && unknownCalls === 0) return [];
    const sorted = Array.from(contactMap.values()).sort((a, b) => b.calls - a.calls || b.totalDurationSec - a.totalDurationSec);
    if (unknownCalls > 0) {
      sorted.push({ contactName: "Unknown", phone: "", calls: unknownCalls, totalDurationSec: unknownDuration });
    }
    return sorted;
  }, [categoryFilteredLogs, intelligenceTags]);

  const unidentifiedClients = useMemo(() => {
    const last10 = (phone: string) => String(phone ?? "").replace(/\D/g, "").slice(-10);
    const contactMap = new Map<string, {
      phoneNumber: string;
      totalCalls: number;
      timestamps: string[];
      employeeNames: Set<string>;
      callTypes: string[];
    }>();

    for (const log of categoryFilteredLogs) {
      const phoneRaw = String(log.phoneNumber ?? "");
      const phoneNorm = last10(normalizePhoneNumber(phoneRaw)) || last10(phoneRaw);
      const emp = getEmployeeName(log);
      const intelK = `${phoneNorm}|${emp}`;
      const intel = intelligenceTags[intelK];
      const rawName = intel?.contactName || log.contactName || "";
      
      const UNKNOWN_VALUES = new Set(["unknown", "", "null", "undefined"]);
      const isUnknown = !rawName || UNKNOWN_VALUES.has(rawName.trim().toLowerCase());

      if (isUnknown) {
        const mapKey = phoneNorm || phoneRaw;
        const existing = contactMap.get(mapKey);
        if (existing) {
          existing.totalCalls += 1;
          if (log.timestamp) existing.timestamps.push(log.timestamp);
          existing.employeeNames.add(emp);
          if (log.callType) existing.callTypes.push(log.callType);
        } else {
          contactMap.set(mapKey, {
            phoneNumber: phoneRaw,
            totalCalls: 1,
            timestamps: log.timestamp ? [log.timestamp] : [],
            employeeNames: new Set([emp]),
            callTypes: log.callType ? [log.callType] : []
          });
        }
      }
    }
    
    return Array.from(contactMap.values())
      .map(c => ({
        ...c,
        employeeNames: Array.from(c.employeeNames),
        timestamps: c.timestamps.sort((a, b) => new Date(b).getTime() - new Date(a).getTime())
      }))
      .sort((a, b) => b.totalCalls - a.totalCalls);
  }, [categoryFilteredLogs, intelligenceTags]);

  const applyGraphFilter = useCallback(
    (next: NonNullable<typeof graphFilter>) => {
      setGraphFilter(next);
      scrollToRecords();
    },
    []
  );

  const applyGraphFilterWithDateRange = useCallback(
    (
      next: NonNullable<typeof graphFilter>,
      range?: { start: Date; end: Date }
    ) => {
      if (!range) return applyGraphFilter(next);
      const startTs = range.start.getTime();
      const endTs = range.end.getTime();
      if (!Number.isFinite(startTs) || !Number.isFinite(endTs)) return applyGraphFilter(next);
      applyGraphFilter({ ...(next as any), range: { startTs, endTs } });
    },
    [applyGraphFilter]
  );

  const resetGraphFilter = useCallback(() => {
    setGraphFilter(null);
  }, []);

  // Graph filter no longer resets on outside click — use the Reset button in the graph header.

  // Category filter no longer resets on outside click — use the Reset button instead.

  const saveInlineEdit = useCallback(async (
    phoneNumber: string,
    employeeName: string,
    field: "contactName" | "category",
    value: string
  ) => {
    const last10 = (p: string) => String(p ?? "").replace(/\D/g, "").slice(-10);
    const norm = last10(normalizePhoneNumber(phoneNumber)) || last10(phoneNumber);
    const key = `${norm}|${employeeName}`;
    setSavingEdit(key);
    try {
      const body: any = { phoneNumber, employeeName };
      body[field] = value;
      const res = await fetch("/api/contact-intelligence/update", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        // Optimistically update local intelligenceTags so UI reflects immediately
        setIntelligenceTags(prev => ({
          ...prev,
          [key]: { ...(prev[key] ?? {}), [field]: value },
        }));
      }
    } finally {
      setSavingEdit(null);
    }
  }, []);

  // Base for table: same exclusions as the graph (employees + hours)
  const tableBaseLogs = useMemo(() => {
    return categoryFilteredLogs.filter((log) => {
      if (ignoredEmployeeSet.has(getEmployeeName(log))) return false;
      if (excludedHourSet.size === 0) return true;
      if (!log.timestamp) return true;
      const d = new Date(log.timestamp);
      if (isNaN(d.getTime())) return true;
      return !excludedHourSet.has(d.getHours());
    });
  }, [categoryFilteredLogs, ignoredEmployeeSet, excludedHourSet]);

  const tableLogs = useMemo(() => {
    const last10 = (phone: string) => String(phone ?? "").replace(/\D/g, "").slice(-10);
    let base = tableBaseLogs;

    if (graphFilter) {
      base = base.filter((log) => {
        if (!log.timestamp) return false;
        const t = new Date(log.timestamp);
        if (isNaN(t.getTime())) return false;
        if (graphFilter.range) {
          const ts = t.getTime();
          if (ts < graphFilter.range.startTs || ts > graphFilter.range.endTs) return false;
        }
        if (graphFilter.employee && getEmployeeName(log) !== graphFilter.employee) return false;
        if (graphFilter.callType && log.callType !== graphFilter.callType) return false;
        if (graphFilter.xMode === "hour") return t.getHours() === graphFilter.hour;
        return startOfDay(t).getTime() === graphFilter.dateTs;
      });
    }

    if (contactPhoneFilter) {
      const target = last10(contactPhoneFilter);
      base = base.filter((log) => {
        const norm = last10(normalizePhoneNumber(String(log.phoneNumber ?? ""))) || last10(String(log.phoneNumber ?? ""));
        return norm === target;
      });
    }

    return base;
  }, [tableBaseLogs, graphFilter, contactPhoneFilter]);

  const compareGraphEmployees = useMemo(
    () => selectedCompareEmployees.filter((e) => !ignoredEmployeeSet.has(e)),
    [selectedCompareEmployees, ignoredEmployeeSet]
  );

  // Date range for "by day" chart: derived from selected date range (each day in range = Day 1, Day 2, ...)
  const chartDateRange = useMemo(() => {
    let start: Date;
    let end: Date;
    if (dateFilter === "TODAY") {
      start = startOfDay(new Date());
      end = endOfDay(new Date());
    } else if (dateFilter === "YESTERDAY") {
      const y = subDays(new Date(), 1);
      start = startOfDay(y);
      end = endOfDay(y);
    } else if (dateFilter === "CUSTOM" && dateRange?.from) {
      start = startOfDay(dateRange.from);
      end = dateRange.to ? endOfDay(dateRange.to) : endOfDay(dateRange.from);
    } else {
      end = endOfDay(new Date());
      start = startOfDay(subDays(end, 4));
    }
    const days: { label: string; dateTs: number; dayIndex: number }[] = [];
    const maxDays = 31;
    for (let i = 0; i < maxDays; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      const dayStart = startOfDay(d);
      if (dayStart.getTime() > end.getTime()) break;
      days.push({
        label: format(dayStart, "d MMM"),
        dateTs: dayStart.getTime(),
        dayIndex: i,
      });
    }
    return { start, end, days };
  }, [dateFilter, dateRange]);

  // Logs filtered for single-graph compare (selected employees + date range + call type filter)
  const singleGraphLogs = useMemo(() => {
    if (compareGraphEmployees.length === 0) return [];
    const empSet = new Set(compareGraphEmployees);
    let list = logs.filter((log) => empSet.has(getEmployeeName(log)));
    if (!activeCallTypeFilters.has("ALL")) {
      list = list.filter((log) => log.callType && activeCallTypeFilters.has(log.callType));
    }
    const { start, end } = chartDateRange;
    list = list.filter((log) => {
      if (!log.timestamp) return false;
      const t = new Date(log.timestamp).getTime();
      return t >= start.getTime() && t <= end.getTime();
    });

    if (excludedHourSet.size > 0) {
      list = list.filter((log) => {
        if (!log.timestamp) return true;
        const d = new Date(log.timestamp);
        if (isNaN(d.getTime())) return true;
        return !excludedHourSet.has(d.getHours());
      });
    }

    const unique: any[] = [];
    const sorted = [...list].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    sorted.forEach((log) => {
      if (!log.timestamp) {
        unique.push(log);
        return;
      }
      const logTime = new Date(log.timestamp).getTime();
      const emp = getEmployeeName(log);
      const isDup = unique.some((ex) => {
        if (ex.phoneNumber !== log.phoneNumber || ex.callType !== log.callType || getEmployeeName(ex) !== emp) return false;
        return Math.abs(new Date(ex.timestamp).getTime() - logTime) < 300000 && Math.abs(ex.duration - log.duration) <= 30;
      });
      if (!isDup) unique.push(log);
    });
    return unique;
  }, [logs, compareGraphEmployees, chartDateRange, activeCallTypeFilters, excludedHourSet]);

  // Single-graph: grouped bars (one bar per employee per slot), each bar stacked by incoming/outgoing/missed. By hour.
  const singleGraphChartDataByHour = useMemo(() => {
    const empKeys = compareGraphEmployees;
    if (empKeys.length === 0) return [];
    const base = timeBuckets.map((b) => {
      const row: Record<string, string | number> = { timeRange: b.label, hour: b.hour };
      empKeys.forEach((e) => {
        row[`${e}_incoming`] = 0;
        row[`${e}_outgoing`] = 0;
        row[`${e}_missed`] = 0;
      });
      return row;
    });
    singleGraphLogs.forEach((log) => {
      const date = new Date(log.timestamp);
      if (isNaN(date.getTime())) return;
      const hour = date.getHours();
      const bucket = base[hour];
      if (!bucket) return;
      const emp = getEmployeeName(log);
      if (!empKeys.includes(emp)) return;
      const key = log.callType === "INCOMING" ? `${emp}_incoming` : log.callType === "OUTGOING" ? `${emp}_outgoing` : `${emp}_missed`;
      if (typeof bucket[key] === "number") (bucket[key] as number) += 1;
    });
    return base.filter((b) =>
      empKeys.some((e) => ((b[`${e}_incoming`] as number) || 0) + ((b[`${e}_outgoing`] as number) || 0) + ((b[`${e}_missed`] as number) || 0) > 0)
    );
  }, [singleGraphLogs, timeBuckets, compareGraphEmployees]);

  // Single-graph: by date (one group per day in range, e.g. "10 Mar", "11 Mar", ...)
  const singleGraphChartDataByDate = useMemo(() => {
    const empKeys = compareGraphEmployees;
    const { days } = chartDateRange;
    if (empKeys.length === 0 || days.length === 0) return [];
    const base = days.map((d) => {
      const row: Record<string, string | number> = { timeRange: d.label, dayIndex: d.dayIndex, dateTs: d.dateTs };
      empKeys.forEach((e) => {
        row[`${e}_incoming`] = 0;
        row[`${e}_outgoing`] = 0;
        row[`${e}_missed`] = 0;
      });
      return row;
    });
    singleGraphLogs.forEach((log) => {
      const logDate = new Date(log.timestamp);
      if (isNaN(logDate.getTime())) return;
      const logDayStart = startOfDay(logDate).getTime();
      const row = base.find((b) => b.dateTs === logDayStart);
      if (!row) return;
      const emp = getEmployeeName(log);
      if (!empKeys.includes(emp)) return;
      const key = log.callType === "INCOMING" ? `${emp}_incoming` : log.callType === "OUTGOING" ? `${emp}_outgoing` : `${emp}_missed`;
      if (typeof row[key] === "number") (row[key] as number) += 1;
    });
    return base;
  }, [singleGraphLogs, chartDateRange, compareGraphEmployees]);

  const singleGraphChartData = compareXAxisMode === "date" ? singleGraphChartDataByDate : singleGraphChartDataByHour;

  // Compare chart: same call-type colors as rest of app (green/blue/red).
  const COMPARE_CALL_TYPE_COLORS = { incoming: "#22c55e", outgoing: "#3b82f6", missed: "#ef4444" };

  const getInitials = (name: string) =>
    name
      .split(/\s+/)
      .map((w) => w[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);

  const truncateNameForBarWidth = (name: string, barWidth: number) => {
    const w = Math.max(20, barWidth);
    const maxChars = Math.max(4, Math.floor(w / 5.8));
    if (name.length <= maxChars) return name;
    return `${name.slice(0, Math.max(1, maxChars - 1))}…`;
  };

  /**
   * Recharts `LabelList` + custom `content` is unreliable for stacked segments when some values are 0.
   * Use `Bar`’s `label` on the **missed** (top) series only: it still runs per cell and receives geometry for
   * anchoring above the stack; totals are read from `payload` so initials/name show even when missed === 0.
   */
  const makeEmployeeStackTopBarLabel = (emp: string) => (props: any) => {
    const pl = props.payload;
    if (!pl) return null;
    const inc = Number(pl[`${emp}_incoming`]) || 0;
    const out = Number(pl[`${emp}_outgoing`]) || 0;
    const mis = Number(pl[`${emp}_missed`]) || 0;
    const total = inc + out + mis;
    if (total === 0) return null;

    const w = Number(props.width) || 0;
    if (w <= 0) return null;

    const cx = (Number(props.x) || 0) + w / 2;
    const yTop = Number(props.y) || 0;
    const nameLine = truncateNameForBarWidth(emp, w);
    const initials = getInitials(emp);

    // Keep labels visible even when a stack reaches the top of the plot area.
    // Recharts clips anything rendered above the chart's inner viewport.
    const safeNameY = Math.max(12, yTop - 20);
    const safeInitialsY = safeNameY + 14;

    return (
      <g>
        <text
          x={cx}
          y={safeNameY}
          textAnchor="middle"
          dominantBaseline="alphabetic"
          fill="#cbd5e1"
          fontSize={8}
          fontWeight={600}
          paintOrder="stroke"
          stroke="rgba(15, 23, 42, 0.9)"
          strokeWidth={2}
          strokeLinejoin="round"
          style={{ pointerEvents: "none" }}
        >
          {nameLine}
        </text>
        <text
          x={cx}
          y={safeInitialsY}
          textAnchor="middle"
          dominantBaseline="alphabetic"
          fill="#ffffff"
          fontSize={11}
          fontWeight={700}
          paintOrder="stroke"
          stroke="rgba(10, 20, 40, 0.95)"
          strokeWidth={3}
          strokeLinejoin="round"
          style={{ pointerEvents: "none" }}
        >
          {initials}
        </text>
      </g>
    );
  };

  const TOOLTIP_CAT_STYLES: Record<string, { label: string; text: string }> = {
    personal:          { label: "Personal",        text: "text-purple-300" },
    staff:             { label: "Staff",           text: "text-sky-300" },
    "New Client":      { label: "New Client",      text: "text-amber-300" },
    "Existing Client": { label: "Existing Client", text: "text-emerald-300" },
    courier:           { label: "Courier",         text: "text-orange-300" },
  };

  const AnalyticsTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload || payload.length === 0) return null;
    const data = payload[0].payload;
    const catEntries = CATEGORY_LIST.map((cat) => ({
      cat,
      secs: Number(data[`cat_${cat}`]) || 0,
    })).filter((e) => e.secs > 0);

    return (
      <div className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs shadow-lg min-w-[160px]">
        <div className="font-semibold text-slate-100 mb-1">{label}</div>
        <div className="space-y-0.5">
          <div className="flex items-center justify-between gap-4">
            <span className="text-slate-400">Incoming</span>
            <span className="font-medium text-emerald-400">{data.incoming}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-slate-400">Outgoing</span>
            <span className="font-medium text-sky-400">{data.outgoing}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-slate-400">Missed</span>
            <span className="font-medium text-rose-400">{data.missed}</span>
          </div>
          <div className="mt-1 flex items-center justify-between gap-4 border-t border-slate-800 pt-1.5">
            <span className="text-slate-400">Total</span>
            <span className="font-semibold text-slate-100">{data.total}</span>
          </div>
          {catEntries.length > 0 && (
            <>
              <div className="mt-1 pt-1.5 border-t border-slate-800">
                <div className="text-slate-500 mb-0.5">Time by category</div>
                {catEntries.map(({ cat, secs }) => {
                  const style = TOOLTIP_CAT_STYLES[cat];
                  return (
                    <div key={cat} className="flex items-center justify-between gap-4">
                      <span className="text-slate-400">{style.label}</span>
                      <span className={cn("font-medium", style.text)}>{formatMinutesOrHours(secs)}</span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    );
  };

  const CompareTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload || payload.length === 0) return null;
    const items = payload.filter((p: any) => typeof p.dataKey === "string" && (p.dataKey.endsWith("_incoming") || p.dataKey.endsWith("_outgoing") || p.dataKey.endsWith("_missed")));
    const byEmployee: Record<string, { incoming: number; outgoing: number; missed: number }> = {};
    items.forEach((p: any) => {
      const key = String(p.dataKey);
      const emp = key.replace(/_incoming$|_outgoing$|_missed$/, "");
      if (!byEmployee[emp]) byEmployee[emp] = { incoming: 0, outgoing: 0, missed: 0 };
      if (key.endsWith("_incoming")) byEmployee[emp].incoming = Number(p.value);
      else if (key.endsWith("_outgoing")) byEmployee[emp].outgoing = Number(p.value);
      else byEmployee[emp].missed = Number(p.value);
    });
    return (
      <div className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs shadow-lg min-w-[180px]">
        <div className="font-semibold text-slate-100 mb-2">{label}</div>
        <div className="space-y-3">
          {Object.entries(byEmployee).map(([emp, { incoming, outgoing, missed }]) => {
            const total = incoming + outgoing + missed;
            return (
              <div key={emp} className="space-y-0.5">
                <div className="font-medium border-b border-slate-700 pb-0.5 text-slate-200">
                  {getInitials(emp)} — {emp}
                </div>
                <div className="flex justify-between gap-4 text-slate-400">
                  <span>Incoming</span>
                  <span className="font-medium text-slate-200">{incoming}</span>
                </div>
                <div className="flex justify-between gap-4 text-slate-400">
                  <span>Outgoing</span>
                  <span className="font-medium text-slate-200">{outgoing}</span>
                </div>
                <div className="flex justify-between gap-4 text-slate-400">
                  <span>Missed</span>
                  <span className="font-medium text-slate-200">{missed}</span>
                </div>
                <div className="flex justify-between gap-4 pt-0.5 border-t border-slate-800 text-slate-300">
                  <span>Total</span>
                  <span className="font-semibold">{total}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const graphTimeExclusionSection = (
    <div className="space-y-1.5">
      {graphExclusionHoursOpen && (
        <div className="flex flex-wrap gap-1.5">
          {Array.from({ length: 24 }, (_, hour) => {
            const excluded = excludedHourSet.has(hour);
            return (
              <button
                key={`hour-${hour}`}
                type="button"
                onClick={() =>
                  setExcludedGraphHours((prev) =>
                    excluded ? prev.filter((h) => h !== hour) : [...prev, hour].sort((a, b) => a - b)
                  )
                }
                className={cn(
                  "px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors",
                  excluded
                    ? "border-amber-500/40 bg-amber-500/10 text-amber-200/90 line-through decoration-amber-200/50"
                    : "border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700"
                )}
              >
                {formatHourRangeLabel(hour)}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );

  const graphExclusionSection =
    employeeNames.length > 0 ? (
      <div className="space-y-1.5">
        {graphExclusionEmployeesOpen && (
          <div className="flex flex-wrap gap-1.5">
            {employeeNames.map((name) => {
              const ignored = ignoredEmployeeSet.has(name);
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() =>
                    setIgnoredGraphEmployees((prev) =>
                      ignored ? prev.filter((n) => n !== name) : [...prev, name].sort()
                    )
                  }
                  className={cn(
                    "px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors",
                    ignored
                      ? "border-amber-500/40 bg-amber-500/10 text-amber-200/90 line-through decoration-amber-200/50"
                      : "border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700"
                  )}
                >
                  {name}
                </button>
              );
            })}
          </div>
        )}
      </div>
    ) : null;

  const graphExclusionControls = (
    <div className="space-y-2">
      {/* Single horizontal row: both exclusion toggles side by side */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <button
          type="button"
          onClick={() => setGraphExclusionHoursOpen((v) => !v)}
          aria-expanded={graphExclusionHoursOpen}
          className="flex items-center gap-1.5 rounded-md text-left hover:bg-slate-800/60 px-1.5 py-1 transition-colors"
        >
          <Clock className="h-3.5 w-3.5 text-slate-500 shrink-0" />
          <span className="text-xs font-medium text-slate-300">Exclude time</span>
          <ChevronDown className={cn("h-3.5 w-3.5 text-slate-500 shrink-0 transition-transform duration-200", graphExclusionHoursOpen && "rotate-180")} aria-hidden />
          {excludedGraphHours.length > 0 && <span className="text-[11px] text-amber-400/90">· {excludedGraphHours.length}</span>}
        </button>
        {excludedGraphHours.length > 0 && (
          <button type="button" onClick={() => { setExcludedGraphHours([]); setGraphExclusionHoursOpen(false); }} className="text-[11px] font-medium text-indigo-400 hover:text-indigo-300">Clear</button>
        )}

        {employeeNames.length > 0 && (
          <>
            <span className="text-slate-700 text-xs">|</span>
            <button
              type="button"
              onClick={() => setGraphExclusionEmployeesOpen((v) => !v)}
              aria-expanded={graphExclusionEmployeesOpen}
              className="flex items-center gap-1.5 rounded-md text-left hover:bg-slate-800/60 px-1.5 py-1 transition-colors"
            >
              <UserX className="h-3.5 w-3.5 text-slate-500 shrink-0" />
              <span className="text-xs font-medium text-slate-300">Exclude employee</span>
              <ChevronDown className={cn("h-3.5 w-3.5 text-slate-500 shrink-0 transition-transform duration-200", graphExclusionEmployeesOpen && "rotate-180")} aria-hidden />
              {ignoredGraphEmployees.length > 0 && <span className="text-[11px] text-amber-400/90">· {ignoredGraphEmployees.length}</span>}
            </button>
            {ignoredGraphEmployees.length > 0 && (
              <button type="button" onClick={() => setIgnoredGraphEmployees([])} className="text-[11px] font-medium text-indigo-400 hover:text-indigo-300">Clear</button>
            )}
          </>
        )}

        <span className="text-slate-700 text-xs">|</span>
        <button 
          type="button"
          onClick={() => setShowUnidentifiedModal(true)}
          className="flex items-center gap-1.5 rounded-md text-left hover:bg-slate-800/60 px-1.5 py-1 transition-colors"
        >
          <UserX className="h-3.5 w-3.5 text-orange-400 shrink-0" />
          <span className="text-xs font-medium text-orange-400">Probable Client</span>
          {unidentifiedClients.length > 0 && <span className="text-[11px] text-orange-400/90 font-bold">· {unidentifiedClients.length}</span>}
        </button>
      </div>
      {graphTimeExclusionSection}
      {graphExclusionSection}
    </div>
  );

  const resetAllFilters = useCallback(() => {
    setCategoryFilter("ALL");
    setSelectedEmployee("ALL");
    setActiveCallTypeFilters(new Set(["ALL"]));
    setHidePersonalContacts(false);
    setHideStaffContacts(false);
    setHideMissedCalls(false);
    setDateFilter("TODAY");
    setDateRange(undefined);
    setIgnoredGraphEmployees([]);
    setExcludedGraphHours([]);
    setContactPhoneFilter(null);
    setSearchQuery("");
    setGraphFilter(null);
  }, []);

  const activeFilters = useMemo(() => {
    const filters: { id: string; label: string; onRemove: () => void }[] = [];
    if (categoryFilter !== "ALL")
      filters.push({ id: "cat", label: categoryFilter, onRemove: () => setCategoryFilter("ALL") });
    if (selectedEmployee !== "ALL")
      filters.push({ id: "emp", label: selectedEmployee, onRemove: () => setSelectedEmployee("ALL") });
    if (!activeCallTypeFilters.has("ALL")) {
      Array.from(activeCallTypeFilters).forEach(t =>
        filters.push({
          id: `ct-${t}`,
          label: t[0] + t.slice(1).toLowerCase(),
          onRemove: () => setActiveCallTypeFilters(prev => {
            const n = new Set(prev); n.delete(t);
            return n.size === 0 ? new Set(["ALL"]) : n;
          }),
        })
      );
    }
    if (hidePersonalContacts) filters.push({ id: "hpc", label: "Personal hidden", onRemove: () => setHidePersonalContacts(false) });
    if (hideStaffContacts)    filters.push({ id: "hsc", label: "Staff hidden",    onRemove: () => setHideStaffContacts(false) });
    if (hideMissedCalls)      filters.push({ id: "hmc", label: "Missed hidden",   onRemove: () => setHideMissedCalls(false) });
    if (dateFilter !== "TODAY")
      filters.push({
        id: "date",
        label:
          dateFilter === "ALL"
            ? "All Time"
            : dateFilter === "YESTERDAY"
              ? "Yesterday"
              : dateFilter === "CUSTOM"
                ? dateRange?.from
                  ? dateRange.to && !isSameDay(dateRange.from, dateRange.to)
                    ? `${format(dateRange.from, "MMM d")} – ${format(dateRange.to, "MMM d, y")}`
                    : format(dateRange.from, "MMM d, y")
                  : "Custom range"
                : dateFilter,
        onRemove: () => { setDateFilter("TODAY"); setDateRange(undefined); },
      });
    if (ignoredGraphEmployees.length > 0)
      filters.push({ id: "ige", label: `${ignoredGraphEmployees.length} excluded from graph`, onRemove: () => setIgnoredGraphEmployees([]) });
    if (excludedGraphHours.length > 0)
      filters.push({ id: "egh", label: `${excludedGraphHours.length} hour(s) excluded`, onRemove: () => setExcludedGraphHours([]) });
    if (contactPhoneFilter) {
      const name = topContactInsights.find(i => i.phone.replace(/\D/g, "").slice(-10) === contactPhoneFilter)?.contactName ?? contactPhoneFilter;
      filters.push({ id: "cpf", label: `Contact: ${name}`, onRemove: () => setContactPhoneFilter(null) });
    }
    if (searchQuery.trim())
      filters.push({ id: "sq", label: `Search: "${searchQuery.trim()}"`, onRemove: () => setSearchQuery("") });
    if (graphFilter)
      filters.push({ id: "gf", label: "Graph selection", onRemove: () => setGraphFilter(null) });
    return filters;
  }, [categoryFilter, selectedEmployee, activeCallTypeFilters, hidePersonalContacts, hideStaffContacts, hideMissedCalls, dateFilter, ignoredGraphEmployees, excludedGraphHours, contactPhoneFilter, searchQuery, graphFilter, topContactInsights]);

  return (
    <div className="space-y-3 relative pb-20 sm:pb-16">
      {/* ── STICKY FILTER POPUP ── always visible */}
      <div className="fixed bottom-4 right-3 sm:bottom-5 sm:right-5 z-[100] flex flex-col items-end gap-2 pointer-events-none">
        {/* Expanded panel — only when filters exist and popup is open */}
        {showFilterPopup && activeFilters.length > 0 && (
          <div
            className="pointer-events-auto w-[min(320px,calc(100vw-24px))] rounded-2xl border border-slate-700 bg-slate-900/95 shadow-2xl shadow-black/60 backdrop-blur-md overflow-hidden"
            style={{ maxHeight: "calc(100vh - 120px)" }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Filter className="h-3.5 w-3.5 text-indigo-400" />
                <span className="text-xs font-bold text-slate-200 uppercase tracking-wider">Active Filters</span>
                <span className="text-[10px] font-bold text-indigo-400 bg-indigo-500/15 rounded-full px-1.5 py-0.5">{activeFilters.length}</span>
              </div>
              <button
                type="button"
                onClick={() => { resetAllFilters(); setShowFilterPopup(false); }}
                className="text-[11px] font-bold text-rose-400 hover:text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 rounded-full px-2.5 py-1 transition-colors"
              >
                Reset all
              </button>
            </div>
            {/* Chips */}
            <div className="overflow-y-auto p-3 flex flex-col gap-2" style={{ maxHeight: "320px" }}>
              {activeFilters.map((f) => (
                <div
                  key={f.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-slate-700/80 bg-slate-800/60 px-3 py-2"
                >
                  <span className="text-xs text-slate-200 font-medium truncate">{f.label}</span>
                  <button
                    type="button"
                    onClick={() => { f.onRemove(); if (activeFilters.length === 1) setShowFilterPopup(false); }}
                    className="shrink-0 rounded-full p-1 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                    aria-label={`Remove ${f.label}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
        {/* Bottom row: Reset all (when filters active) + FAB toggle */}
        <div className="pointer-events-auto flex items-center gap-2">
          {activeFilters.length > 0 && (
            <button
              type="button"
              onClick={() => { resetAllFilters(); setShowFilterPopup(false); }}
              className="flex items-center gap-1.5 rounded-full px-3.5 py-2.5 text-xs font-bold shadow-xl shadow-black/40 bg-rose-600/90 hover:bg-rose-500 text-white border border-rose-500/60 transition-all duration-200"
              title="Clear all active filters"
            >
              <X className="h-3.5 w-3.5 shrink-0" />
              Reset with Active Filters
            </button>
          )}
          <button
            type="button"
            onClick={() => activeFilters.length > 0 && setShowFilterPopup(v => !v)}
            className={cn(
              "flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-bold shadow-xl shadow-black/40 transition-all duration-200",
              activeFilters.length === 0
                ? "bg-slate-800/60 border border-slate-700/50 text-slate-500 cursor-default"
                : showFilterPopup
                  ? "bg-slate-800 border border-slate-700 text-slate-200 hover:bg-slate-700"
                  : "bg-indigo-600 hover:bg-indigo-500 text-white border border-indigo-500"
            )}
          >
            <Filter className="h-4 w-4 shrink-0" />
            <span>
              {activeFilters.length === 0
                ? "No active filters"
                : `${activeFilters.length} filter${activeFilters.length !== 1 ? "s" : ""} active`}
            </span>
            {activeFilters.length > 0 && (
              showFilterPopup
                ? <ChevronDown className="h-3.5 w-3.5" />
                : <ChevronUp className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </div>

      {/* Employee Filter + Category Filter — side by side */}
      <div className="relative z-10 grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Employee Filter */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
          <div className="flex items-center gap-2 mb-2">
            <User className="h-4 w-4 text-slate-400" />
            <span className="text-xs font-medium text-slate-400">Filter by Employee</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => {
                setSelectedEmployee("ALL");
                scrollToLogs();
              }}
              className={cn(
                "px-3 py-1.5 rounded-full text-xs font-semibold transition-all duration-200",
                selectedEmployee === "ALL"
                  ? "bg-indigo-600 text-white shadow-lg shadow-indigo-500/25 scale-105"
                  : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200"
              )}
            >
              All Employees
            </button>
            {employeeNamesForDept.length === 0 && isLoading ? (
              <div className="flex items-center gap-2 px-3 py-1.5">
                <Loader2 className="h-3 w-3 animate-spin text-slate-500" />
                <span className="text-xs text-slate-500">Loading...</span>
              </div>
            ) : (
              employeeNamesForDept.map((name) => (
                <button
                  key={name}
                  onClick={() => {
                    setSelectedEmployee(name);
                    scrollToLogs();
                  }}
                  className={cn(
                    "px-3 py-1.5 rounded-full text-xs font-semibold transition-all duration-200 flex items-center gap-1.5",
                    selectedEmployee === name
                      ? "bg-indigo-600 text-white shadow-lg shadow-indigo-500/25 scale-105"
                      : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200",
                    isLoading && "opacity-50 pointer-events-none"
                  )}
                >
                  <span
                    className={cn(
                      "w-1.5 h-1.5 rounded-full",
                      selectedEmployee === name ? "bg-white" : "bg-slate-600"
                    )}
                  />
                  {name}
                </button>
              ))
            )}
          </div>
        </div>

        {/* Category Filter + Department Dropdown */}
        <div ref={categoryFilterRef} className="bg-slate-900 border border-slate-800 rounded-xl p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-slate-400">Category</span>
            <div className="flex items-center gap-2">
              {/* Department Dropdown */}
              <select
                value={selectedDepartment}
                onChange={(e) => setSelectedDepartment(e.target.value)}
                className="text-xs bg-slate-800 border border-slate-700 text-slate-300 rounded-lg px-2.5 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 cursor-pointer"
              >
                <option value="ALL">All Departments</option>
                {departments.map((dept) => (
                  <option key={dept._id} value={dept.name}>
                    {dept.name}
                  </option>
                ))}
              </select>
              {categoryFilter !== "ALL" && (
                <button
                  type="button"
                  onClick={() => setCategoryFilter("ALL")}
                  className="text-[11px] font-semibold text-indigo-400 hover:text-indigo-300 transition-colors"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {categoryOptions.map((cat) => {
              const active = categoryFilter === cat;
              const isAll = cat === "ALL";
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategoryFilter(cat)}
                  className={cn(
                    "px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap border transition-colors",
                    active
                      ? isAll
                        ? "bg-indigo-600 text-white border-indigo-500"
                        : "bg-slate-950 text-slate-100 border-slate-600"
                      : isAll
                        ? "bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700"
                        : "bg-slate-900/40 text-slate-300 border-slate-800 hover:bg-slate-800/70"
                  )}
                  title={isAll ? "Show all categories" : `Show only: ${cat}`}
                >
                  {isAll ? "All" : cat}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Global call/date filters */}
      <div className="relative z-10">
        <div className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3">
          <div className="flex flex-col sm:flex-row gap-3 sm:justify-between">
            {/* Call Type */}
            <div className="flex gap-2 overflow-x-auto pb-1 sm:pb-0 flex-shrink-0">
              {["ALL", "INCOMING", "OUTGOING", "MISSED"].map((type) => {
                const isActive = activeCallTypeFilters.has(type);
                return (
                  <button
                    key={type}
                    onClick={() => {
                      setActiveCallTypeFilters(prev => {
                        const next = new Set(prev);
                        if (type === "ALL") {
                          return new Set(["ALL"]);
                        }
                        next.delete("ALL");
                        if (next.has(type)) {
                          next.delete(type);
                          if (next.size === 0) return new Set(["ALL"]);
                        } else {
                          next.add(type);
                        }
                        return next;
                      });
                    }}
                    className={cn(
                      "px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors",
                      isActive
                        ? "bg-indigo-600 text-white shadow-lg shadow-indigo-500/20"
                        : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200"
                    )}
                  >
                    {type}
                  </button>
                );
              })}

              <button
                type="button"
                onClick={() => setHideShortCalls((v) => !v)}
                className={cn(
                  "px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors border",
                  hideShortCalls
                    ? "bg-emerald-600/15 border-emerald-500/30 text-emerald-300 hover:bg-emerald-600/25"
                    : "bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700 hover:text-slate-100"
                )}
                title={hideShortCalls ? "Showing calls ≥ 10s (missed always kept)" : "Showing all call durations"}
              >
                {hideShortCalls ? "≥10s only" : "All durations"}
              </button>

              <button
                type="button"
                onClick={() => setHidePersonalContacts((v) => !v)}
                className={cn(
                  "px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors border",
                  hidePersonalContacts
                    ? "bg-violet-600/15 border-violet-500/30 text-violet-300 hover:bg-violet-600/25"
                    : "bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700 hover:text-slate-100"
                )}
                title={hidePersonalContacts ? "Personal identified contacts are hidden" : "Show all contacts including personal"}
              >
                {hidePersonalContacts ? "Personal hidden" : "Hide personal"}
              </button>

              <button
                type="button"
                onClick={() => setHideStaffContacts((v) => !v)}
                className={cn(
                  "px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors border",
                  hideStaffContacts
                    ? "bg-sky-600/15 border-sky-500/30 text-sky-300 hover:bg-sky-600/25"
                    : "bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700 hover:text-slate-100"
                )}
                title={hideStaffContacts ? "Staff identified contacts are hidden" : "Show all contacts including staff"}
              >
                {hideStaffContacts ? "Staff hidden" : "Hide staff"}
              </button>

              <button
                type="button"
                onClick={() => setHideMissedCalls((v) => !v)}
                className={cn(
                  "px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors border",
                  hideMissedCalls
                    ? "bg-rose-600/15 border-rose-500/30 text-rose-300 hover:bg-rose-600/25"
                    : "bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700 hover:text-slate-100"
                )}
                title={hideMissedCalls ? "Missed calls are hidden" : "Hide missed calls"}
              >
                {hideMissedCalls ? "Unhide Missed" : "Hide Missed"}
              </button>
            </div>

            {/* Date Filters */}
            <div className="flex gap-2 overflow-x-auto pb-1 sm:pb-0 items-center">
              {["ALL", "TODAY", "YESTERDAY"].map((df) => (
                <button
                  key={df}
                  onClick={() => setDateFilter(df as any)}
                  className={cn(
                    "px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors",
                    dateFilter === df && dateFilter !== "CUSTOM"
                      ? "bg-emerald-600 text-white"
                      : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200"
                  )}
                >
                  {df === "ALL" ? "All Time" : df === "TODAY" ? "Today" : "Yesterday"}
                </button>
              ))}

              <CustomRangePopover
                dateFilter={dateFilter}
                committedRange={dateRange}
                onApply={applyCustomRange}
                onResetToToday={resetDateFilterToToday}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Fetch error banner */}
      {fetchError && !isLoading && (
        <div className="flex items-center gap-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          <XCircle className="h-4 w-4 shrink-0 text-rose-400" />
          <span>{fetchError}</span>
          <button
            onClick={() => { setFetchError(null); invalidateCacheAndRefetch(); }}
            className="ml-auto shrink-0 rounded-md border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-xs text-rose-300 hover:bg-rose-500/20"
          >
            Retry
          </button>
        </div>
      )}

      {/* Call Activity Graph */}
      {!comparisonMode && (
      <div ref={graphCardRef}>
      <Card className="bg-slate-900 border-slate-800 text-slate-100 relative z-10">
        <div className="p-3 sm:p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div className="space-y-0.5">
              <p className="text-sm font-medium text-slate-200">Call Activity by Hour</p>
              <p className="text-xs text-slate-500">
                {selectedEmployee === "ALL" ? "All employees" : <span className="text-[13.2px] font-bold text-slate-200">{selectedEmployee}</span>}
                {ignoredGraphEmployees.length > 0 && (
                  <span className="text-amber-400/90"> · {ignoredGraphEmployees.length} excluded from chart</span>
                )}{" "}
                {excludedGraphHours.length > 0 && (
                  <span className="text-amber-400/90"> · {excludedGraphHours.length} hour(s) excluded</span>
                )}{" "}
                ·{" "}
                {divideByEmployee
                  ? chartDataDividedByEmployee.length > 0
                    ? "Grouped by employee · stacked by call type"
                    : "No calls in selected range"
                  : chartData.length > 0
                    ? "Stacked by call type"
                    : "No calls in selected range"}
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <div className="flex items-center gap-2">
                {selectedEmployee === "ALL" && employeeNames.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setDivideByEmployee((v) => !v)}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200",
                      divideByEmployee
                        ? "bg-emerald-600 text-white shadow-lg shadow-emerald-500/20"
                        : "bg-slate-800 text-slate-300 hover:bg-emerald-600 hover:text-white"
                    )}
                  >
                    {divideByEmployee ? "Total view" : "Divide by employee"}
                  </button>
                )}
                <button
                  onClick={toggleComparisonMode}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200",
                    comparisonMode
                      ? "bg-indigo-600 text-white shadow-lg shadow-indigo-500/25"
                      : "bg-slate-800 text-slate-300 hover:bg-indigo-600 hover:text-white"
                  )}
                >
                  <ArrowLeftRight className="w-3.5 h-3.5" />
                  {comparisonMode ? "Exit Compare" : "Compare"}
                </button>
              </div>
            </div>
          </div>
          <div className="mb-3">
            {graphExclusionControls}
          </div>
          <div
            className={cn(
              "mb-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[11px] leading-none",
              isLoading && categoryFilteredLogs.length > 0 && "opacity-60"
            )}
          >
            <span className="whitespace-nowrap">
              <span className="text-indigo-400/90">Total calls</span>{" "}
              <span className="tabular-nums font-medium text-indigo-200">
                {isLoading && categoryFilteredLogs.length === 0 ? "—" : callTypeStats.total}
              </span>
            </span>
            <span className="whitespace-nowrap">
              <span className="text-emerald-500/90">Incoming</span>{" "}
              <span className="tabular-nums font-medium text-emerald-400">
                {isLoading && categoryFilteredLogs.length === 0 ? "—" : callTypeStats.incoming}
              </span>
            </span>
            <span className="whitespace-nowrap">
              <span className="text-blue-400/90">Outgoing</span>{" "}
              <span className="tabular-nums font-medium text-blue-300">
                {isLoading && categoryFilteredLogs.length === 0 ? "—" : callTypeStats.outgoing}
              </span>
            </span>
            <span className="whitespace-nowrap">
              <span className="text-red-400/90">Missed</span>{" "}
              <span className="tabular-nums font-medium text-red-300">
                {isLoading && categoryFilteredLogs.length === 0 ? "—" : callTypeStats.missed}
              </span>
            </span>
          </div>
          {(() => {
            const catColors: Record<string, { label: string; text: string; muted: string }> = {
              personal:          { label: "Personal",        text: "text-purple-300",  muted: "text-purple-400/80" },
              staff:             { label: "Staff",           text: "text-sky-300",     muted: "text-sky-400/80" },
              "New Client":      { label: "New Client",      text: "text-amber-300",   muted: "text-amber-400/80" },
              "Existing Client": { label: "Existing Client", text: "text-emerald-300", muted: "text-emerald-400/80" },
              courier:           { label: "Courier",         text: "text-orange-300",  muted: "text-orange-400/80" },
            };
            const categorisedSec = CATEGORY_LIST.reduce((sum, c) => sum + categoryDurationStats[c], 0);
            const unknownSec = Math.max(0, callDurationStats.totalSec - categorisedSec);
            const loading = isLoading && categoryFilteredLogs.length === 0;
            return (
              <div
                className={cn(
                  "mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[11px] leading-none",
                  isLoading && categoryFilteredLogs.length > 0 && "opacity-60"
                )}
              >
                <span className="whitespace-nowrap">
                  <span className="text-slate-400">Total duration</span>{" "}
                  <span className="tabular-nums font-medium text-slate-200">
                    {loading ? "—" : formatMinutesOrHours(callDurationStats.totalSec)}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setActiveCallTypeFilters(new Set(["INCOMING"]));
                  }}
                  className="whitespace-nowrap hover:opacity-80 transition-opacity rounded px-0.5"
                  title="Filter by Incoming calls"
                >
                  <span className="text-emerald-500/90">Incoming</span>{" "}
                  <span className="tabular-nums font-medium text-emerald-400">
                    {loading ? "—" : formatMinutesOrHours(callDurationStats.incomingSec)}
                  </span>
                  {!loading && <span className="text-emerald-600/70 ml-0.5">({callTypeStats.incoming})</span>}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActiveCallTypeFilters(new Set(["OUTGOING"]));
                  }}
                  className="whitespace-nowrap hover:opacity-80 transition-opacity rounded px-0.5"
                  title="Filter by Outgoing calls"
                >
                  <span className="text-blue-400/90">Outgoing</span>{" "}
                  <span className="tabular-nums font-medium text-blue-300">
                    {loading ? "—" : formatMinutesOrHours(callDurationStats.outgoingSec)}
                  </span>
                  {!loading && <span className="text-blue-600/70 ml-0.5">({callTypeStats.outgoing})</span>}
                </button>
                {/* separator */}
                <span className="text-slate-700 select-none">·</span>
                {CATEGORY_LIST.map((cat) => {
                  const secs = categoryDurationStats[cat];
                  const count = categoryCallCountStats[cat];
                  const c = catColors[cat];
                  const isActive = categoryFilter === cat;
                  const isFiltering = categoryFilter !== "ALL";
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setCategoryFilter(isActive ? "ALL" : cat)}
                      className={cn(
                        "whitespace-nowrap transition-opacity rounded px-0.5",
                        isActive
                          ? "ring-1 ring-slate-600 bg-slate-800/50 opacity-100"
                          : isFiltering
                            ? "opacity-40 hover:opacity-70"
                            : "hover:opacity-80"
                      )}
                      title={isActive ? `Clear ${c.label} filter` : `Filter by ${c.label}`}
                    >
                      <span className={c.muted}>{c.label}</span>{" "}
                      <span className={cn("tabular-nums font-medium", c.text)}>
                        {loading ? "—" : formatMinutesOrHours(secs)}
                      </span>
                      {!loading && count > 0 && <span className={cn("ml-0.5 opacity-60", c.text)}>({count})</span>}
                    </button>
                  );
                })}
                {!loading && unknownSec > 0 && (
                  <span className="whitespace-nowrap">
                    <span className="text-slate-500">Unknown</span>{" "}
                    <span className="tabular-nums font-medium text-slate-400">{formatMinutesOrHours(unknownSec)}</span>
                  </span>
                )}
              </div>
            );
          })()}
          {graphFilter && (
            <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px]">
              <span className="text-slate-500 font-medium">Graph filter:</span>
              <span className="inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-900/60 px-2.5 py-1 text-slate-300">
                {graphFilter.employee ? (
                  <span className="text-slate-200 font-semibold">{graphFilter.employee}</span>
                ) : (
                  <span className="text-slate-200 font-semibold">All employees</span>
                )}
                <span className="text-slate-600">·</span>
                <span className="text-slate-300">
                  {graphFilter.xMode === "hour"
                    ? timeBuckets.find((b) => b.hour === graphFilter.hour)?.label ?? `Hour ${graphFilter.hour}`
                    : format(new Date(graphFilter.dateTs), "d MMM")}
                </span>
                {graphFilter.callType && (
                  <>
                    <span className="text-slate-600">·</span>
                    <span className="font-semibold text-slate-200">{graphFilter.callType}</span>
                  </>
                )}
              </span>
            </div>
          )}
          <div className="relative h-80 sm:h-[30rem] min-h-[320px]">
            {isLoading && categoryFilteredLogs.length > 0 && (
              <div className="absolute inset-0 z-20 flex items-center justify-center rounded-lg bg-slate-950/45 backdrop-blur-[1px]">
                <div className="flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900 px-3 py-1.5 shadow-lg">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-500" />
                  <span className="text-[11px] font-medium text-slate-300">Loading chart…</span>
                </div>
              </div>
            )}
            {isLoading && categoryFilteredLogs.length === 0 ? (
              <GraphSkeleton />
            ) : graphDisplayLogs.length === 0 && categoryFilteredLogs.length > 0 ? (
              <div className="flex h-full items-center justify-center text-xs text-slate-500 px-4 text-center">
                Everyone is excluded from the chart. Clear exclusions above or pick different employees.
              </div>
            ) : (divideByEmployee ? chartDataDividedByEmployee.length > 0 : chartData.length > 0) ? (
              <div className="w-full h-full">
                <div className="h-full w-full">
                  {divideByEmployee ? (
                    <DivideByEmployeeChartJs
                      rows={chartDataDividedByEmployee}
                      employees={divideGraphEmployees}
                      onSelect={({ hour, employee, callType }) => {
                        applyGraphFilter({ xMode: "hour", hour, employee, callType });
                      }}
                    />
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart
                        data={chartData}
                        margin={{ top: 28, right: 0, left: -20, bottom: 72 }}
                        barCategoryGap="6%"
                        barGap={0}
                        onClick={(e: any) => {
                          const ap = e?.activePayload;
                          const hit = Array.isArray(ap) && ap.length > 0 ? ap[0] : null;
                          const payload = hit?.payload;
                          const dk = String(hit?.dataKey ?? "");
                          if (!payload) return;
                          const hour = Number(payload.hour);
                          if (!Number.isFinite(hour)) return;
                          const callType =
                            dk === "incoming" ? "INCOMING" : dk === "outgoing" ? "OUTGOING" : dk === "missed" ? "MISSED" : undefined;
                          applyGraphFilter({ xMode: "hour", hour, callType });
                        }}
                      >
                        <XAxis
                          dataKey="timeRange"
                          tickLine={false}
                          axisLine={{ stroke: "#1f2937" }}
                          tick={{ fill: "#9ca3af", fontSize: 10, textAnchor: "end" }}
                          interval={0}
                          angle={-45}
                        />
                        <YAxis
                          allowDecimals={false}
                          tickLine={false}
                          axisLine={{ stroke: "#1f2937" }}
                          tick={{ fill: "#9ca3af", fontSize: 10 }}
                          tickCount={10}
                        />
                        <RechartsTooltip content={<AnalyticsTooltip />} />
                        <Bar
                          dataKey="incoming"
                          stackId="calls"
                          fill="#22c55e"
                          isAnimationActive={false}
                          cursor="pointer"
                          onClick={(data: any) => {
                            if (!data?.payload) return;
                            applyGraphFilter({
                              xMode: "hour",
                              hour: Number(data.payload.hour),
                              callType: "INCOMING",
                            });
                          }}
                        >
                          <LabelList
                            dataKey="incoming"
                            position="center"
                            fill="#fff"
                            fontSize={10}
                            fontWeight={600}
                            style={{ pointerEvents: "none" }}
                            formatter={(value: any) => (value > 0 ? String(value) : "")}
                          />
                        </Bar>
                        <Bar
                          dataKey="outgoing"
                          stackId="calls"
                          fill="#3b82f6"
                          isAnimationActive={false}
                          cursor="pointer"
                          onClick={(data: any) => {
                            if (!data?.payload) return;
                            applyGraphFilter({
                              xMode: "hour",
                              hour: Number(data.payload.hour),
                              callType: "OUTGOING",
                            });
                          }}
                        >
                          <LabelList
                            dataKey="outgoing"
                            position="center"
                            fill="#fff"
                            fontSize={10}
                            fontWeight={600}
                            style={{ pointerEvents: "none" }}
                            formatter={(value: any) => (value > 0 ? String(value) : "")}
                          />
                        </Bar>
                        <Bar
                          dataKey="missedBar"
                          stackId="calls"
                          fill="#ef4444"
                          radius={[4, 4, 0, 0]}
                          isAnimationActive={false}
                          cursor="pointer"
                          onClick={(data: any) => {
                            if (!data?.payload) return;
                            applyGraphFilter({
                              xMode: "hour",
                              hour: Number(data.payload.hour),
                              callType: "MISSED",
                            });
                          }}
                        >
                          <LabelList
                            dataKey="missed"
                            position="center"
                            fill="#fff"
                            fontSize={10}
                            fontWeight={600}
                            style={{ pointerEvents: "none" }}
                            formatter={(value: any) => (value > 0 ? String(value) : "")}
                          />
                          <LabelList
                            dataKey="total"
                            position="top"
                            content={(props: any) => {
                              const { x, y, width, value, index } = props;
                              if (!value || value === 0) return null;
                              const entry = chartData[index] as any;
                              if (!entry) return null;
                              const cx = x + width / 2;
                              const cy = y - 8;
                              const label = String(value);
                              const entryHour = Number(entry.hour);
                              const isActive = graphFilter?.xMode === "hour" && graphFilter.hour === entryHour && !graphFilter.callType;
                              const w = Math.max(label.length * 7 + 10, 24);
                              return (
                                <g
                                  key={`total-${index}`}
                                  onClick={(e) => { e.stopPropagation(); applyGraphFilter({ xMode: "hour", hour: entryHour }); }}
                                  style={{ cursor: "pointer" }}
                                >
                                  {isActive && (
                                    <rect x={cx - w / 2} y={cy - 8} width={w} height={17} rx={8} fill="#6366f1" stroke="#818cf8" strokeWidth={1} />
                                  )}
                                  <text x={cx} y={cy} fill={isActive ? "#fff" : "#e2e8f0"} fontSize={11} fontWeight={700} textAnchor="middle" dominantBaseline="middle">
                                    {label}
                                  </text>
                                </g>
                              );
                            }}
                          />
                        </Bar>
                      </ComposedChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-slate-500">
                No call activity for the selected filters.
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* Top Contact Insights */}
      <div className="mt-3 rounded-xl border border-slate-800 bg-slate-900 overflow-hidden">
        <button
          type="button"
          onClick={() => setInsightsExpanded(v => !v)}
          className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-slate-800/40 transition-colors"
        >
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Top Contact Insights{selectedEmployee !== "ALL" ? ` · ${selectedEmployee}` : ""}
          </p>
          <div className="flex items-center gap-2.5">
            {topContactInsights.length > 0 && (
              <span className="text-[11px] text-slate-600">{topContactInsights.length} contact{topContactInsights.length !== 1 ? "s" : ""}</span>
            )}
            <ChevronDown className={cn("h-3.5 w-3.5 text-slate-500 transition-transform duration-200", insightsExpanded && "rotate-180")} />
          </div>
        </button>

        {insightsExpanded && (
          topContactInsights.length === 0 ? (
            <div className="px-4 py-4 text-xs text-slate-500 text-center border-t border-slate-800">
              No call data found with current filters
            </div>
          ) : (
          <div className="border-t border-slate-800 overflow-y-auto p-3" style={{ maxHeight: "420px" }}>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              {topContactInsights.slice(0, insightsLimit).map((item, idx) => {
                const isActive = !!(contactPhoneFilter && item.phone && item.phone.replace(/\D/g, "").slice(-10) === contactPhoneFilter);
                return (
                  <button
                    key={`ci-${item.phone}-${idx}`}
                    type="button"
                    onClick={() => {
                      if (!item.phone) return;
                      const norm = item.phone.replace(/\D/g, "").slice(-10);
                      setContactPhoneFilter(prev => prev === norm ? null : norm);
                      scrollToRecords();
                    }}
                    className={cn(
                      "flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-all sm:hover:scale-[1.02] sm:hover:shadow-lg active:scale-[0.99]",
                      isActive
                        ? "border-indigo-500/60 bg-indigo-500/10 ring-1 ring-indigo-500/40"
                        : idx === 0
                          ? "border-amber-500/40 bg-amber-500/8 hover:bg-amber-500/12 hover:border-amber-500/60"
                          : idx === 1
                            ? "border-slate-500/40 bg-slate-500/8 hover:bg-slate-500/12 hover:border-slate-400/50"
                            : idx === 2
                              ? "border-orange-700/30 bg-orange-900/8 hover:bg-orange-900/12 hover:border-orange-600/40"
                              : "border-slate-700/40 bg-slate-800/30 hover:bg-slate-800/60 hover:border-slate-600/50"
                    )}
                  >
                    <span className={cn(
                      "text-2xl font-black tabular-nums shrink-0 leading-none",
                      idx === 0 ? "text-amber-400" : idx === 1 ? "text-slate-400" : idx === 2 ? "text-orange-700" : "text-slate-600"
                    )}>
                      #{idx + 1}
                    </span>
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className={cn(
                        "text-sm font-bold truncate leading-snug",
                        item.contactName === "Unknown" ? "text-slate-400 italic" : "text-slate-100"
                      )} title={item.contactName}>
                        {item.contactName}
                      </span>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-indigo-300 tabular-nums font-semibold">{item.calls} calls</span>
                        <span className="text-slate-700 text-[10px]">·</span>
                        <span className="text-xs text-emerald-300 tabular-nums font-medium">
                          {item.totalDurationSec > 0 ? formatMinutesOrHours(item.totalDurationSec) : "—"}
                        </span>
                      </div>
                    </div>
                    {item.phone && <ArrowRight className="h-3.5 w-3.5 text-slate-600 shrink-0" />}
                  </button>
                );
              })}
            </div>
            {topContactInsights.length > 3 && (
              <button
                type="button"
                onClick={() => setInsightsLimit(v => v === 3 ? topContactInsights.length : 3)}
                className="mt-2.5 w-full py-1.5 rounded-lg border border-slate-700/60 text-[11px] font-semibold text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 transition-colors"
              >
                {insightsLimit === 3 ? `Show all ${topContactInsights.length} contacts` : "Show less"}
              </button>
            )}
          </div>
          )
        )}
      </div>

      {/* Call Completion Table */}
      {(completionRows.length > 0 || isLoading) && (() => {
        type SumCat = "New Client" | "Existing Client" | "Unknown";
        const summaryDefs: { key: SumCat; label: string; chipColors: string }[] = [
          { key: "New Client",      label: "New Client",      chipColors: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
          { key: "Existing Client", label: "Existing Client", chipColors: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
          { key: "Unknown",         label: "Unknown",         chipColors: "bg-slate-500/15 text-slate-300 border-slate-600/40" },
        ];

        const formatCallbackGap = (missedTs: number, callbackTs: number) => {
          const diffMin = Math.round((callbackTs - missedTs) / 60000);
          if (diffMin < 60) return `${diffMin}m`;
          const h = Math.floor(diffMin / 60);
          const m = diffMin % 60;
          return m > 0 ? `${h}h ${m}m` : `${h}h`;
        };

        return (
          <div className="mt-3 rounded-xl border border-slate-800 bg-slate-900 overflow-hidden">
            {/* Header */}
            <div className="px-4 py-2.5 border-b border-slate-800 flex flex-wrap items-center justify-between gap-y-2 gap-x-4">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-3.5 w-3.5 text-indigo-400 shrink-0" />
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Call Completion{selectedEmployee !== "ALL" ? ` · ${selectedEmployee}` : ""}
                </p>
                {completionRows.length > 0 && (
                  <span className="text-[10px] font-bold text-indigo-400 bg-indigo-500/15 rounded-full px-1.5 py-0.5">
                    {completionRows.length} missed
                  </span>
                )}
              </div>
              {/* Per-category summary chips */}
              <div className="flex flex-wrap items-center gap-1.5">
                {summaryDefs.map(({ key, label, chipColors }) => {
                  const s = completionSummary[key];
                  if (s.missed === 0) return null;
                  return (
                    <span key={key} className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold", chipColors)}>
                      {label}
                      <span className="opacity-70">·</span>
                      <span className="text-emerald-300">{s.completed}✓</span>
                      <span className="opacity-40">/</span>
                      <span className="text-rose-300">{s.notCompleted}✗</span>
                      <span className="opacity-40">/</span>
                      <span>{s.ratio}%</span>
                    </span>
                  );
                })}
                <span className="text-[10px] text-slate-600 hidden sm:inline">callback within 2h</span>
              </div>
            </div>

            {isLoading && completionRows.length === 0 ? (
              <div className="flex items-center justify-center gap-2 py-8 text-xs text-slate-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading...
              </div>
            ) : (
              <>
                {/* Desktop table */}
                <div className="hidden sm:block overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 bg-slate-950/50">
                        <th className="px-3 py-2 text-left font-semibold text-slate-400 whitespace-nowrap">Status</th>
                        <th className="px-3 py-2 text-left font-semibold text-slate-400 whitespace-nowrap">Employee</th>
                        <th className="px-3 py-2 text-left font-semibold text-slate-400 whitespace-nowrap">Contact</th>
                        <th className="px-3 py-2 text-left font-semibold text-slate-400 whitespace-nowrap">Category</th>
                        <th className="px-3 py-2 text-left font-semibold text-slate-400 whitespace-nowrap">Missed At</th>
                        <th className="px-3 py-2 text-left font-semibold text-slate-400 whitespace-nowrap">Callback At</th>
                        <th className="px-3 py-2 text-right font-semibold text-slate-400 whitespace-nowrap">Total Calls</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {completionRows.map((row) => {
                        const catChip =
                          row.category === "New Client"      ? "bg-amber-500/15 text-amber-300 border-amber-500/30" :
                          row.category === "Existing Client" ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" :
                          row.category === "personal"        ? "bg-purple-500/15 text-purple-300 border-purple-500/30" :
                          row.category === "staff"           ? "bg-sky-500/15 text-sky-300 border-sky-500/30" :
                          row.category === "courier"         ? "bg-orange-500/15 text-orange-300 border-orange-500/30" :
                          "bg-slate-700/30 text-slate-400 border-slate-700";
                        return (
                          <tr key={row.id} className="hover:bg-slate-800/40 transition-colors">
                            {/* Status */}
                            <td className="px-3 py-2.5 whitespace-nowrap">
                              {row.completed ? (
                                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 px-2 py-0.5 text-[10px] font-semibold">
                                  <CheckCircle2 className="h-3 w-3" />
                                  Called back
                                  {row.callbackAt && (
                                    <span className="opacity-70 font-normal">· {formatCallbackGap(row.missedAt, row.callbackAt)}</span>
                                  )}
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/10 border border-rose-500/25 text-rose-300 px-2 py-0.5 text-[10px] font-semibold">
                                  <XCircle className="h-3 w-3" />
                                  Not called back
                                </span>
                              )}
                            </td>
                            {/* Employee */}
                            <td className="px-3 py-2.5 font-medium text-slate-300 whitespace-nowrap">{row.employee}</td>
                            {/* Contact */}
                            <td className="px-3 py-2.5 whitespace-nowrap">
                              <div className="flex flex-col gap-0.5">
                                {row.contactName ? (
                                  <span className="text-slate-200 font-medium">{row.contactName}</span>
                                ) : null}
                                <span className={cn("font-mono", row.contactName ? "text-slate-500 text-[10px]" : "text-slate-300")}>{row.phoneNumber}</span>
                              </div>
                            </td>
                            {/* Category */}
                            <td className="px-3 py-2.5 whitespace-nowrap">
                              <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium", catChip)}>
                                {row.category || "Unknown"}
                              </span>
                            </td>
                            {/* Missed At */}
                            <td className="px-3 py-2.5 text-slate-400 whitespace-nowrap tabular-nums">
                              {format(new Date(row.missedAt), "MMM d, HH:mm")}
                            </td>
                            {/* Callback At */}
                            <td className="px-3 py-2.5 whitespace-nowrap tabular-nums">
                              {row.callbackAt ? (
                                <span className="text-emerald-400">{format(new Date(row.callbackAt), "MMM d, HH:mm")}</span>
                              ) : (
                                <span className="text-slate-600">—</span>
                              )}
                            </td>
                            {/* Total calls */}
                            <td className="px-3 py-2.5 text-right text-slate-400 tabular-nums">{row.totalCalls}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Mobile card list */}
                <div className="block sm:hidden divide-y divide-slate-800/60">
                  {completionRows.map((row) => {
                    const catChip =
                      row.category === "New Client"      ? "bg-amber-500/15 text-amber-300 border-amber-500/30" :
                      row.category === "Existing Client" ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" :
                      row.category === "personal"        ? "bg-purple-500/15 text-purple-300 border-purple-500/30" :
                      row.category === "staff"           ? "bg-sky-500/15 text-sky-300 border-sky-500/30" :
                      row.category === "courier"         ? "bg-orange-500/15 text-orange-300 border-orange-500/30" :
                      "bg-slate-700/30 text-slate-400 border-slate-700";
                    return (
                      <div key={row.id} className="px-3 py-2.5 flex flex-col gap-1.5">
                        {/* Row 1: employee + status badge */}
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-sm font-semibold text-white leading-snug">{row.employee}</span>
                          {row.completed ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 px-2 py-0.5 text-[10px] font-semibold shrink-0">
                              <CheckCircle2 className="h-3 w-3" />
                              Called back
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/10 border border-rose-500/25 text-rose-300 px-2 py-0.5 text-[10px] font-semibold shrink-0">
                              <XCircle className="h-3 w-3" />
                              Not called back
                            </span>
                          )}
                        </div>
                        {/* Row 2: contact + phone */}
                        <div className="flex items-center gap-1.5 text-xs">
                          {row.contactName && <span className="text-slate-200 font-medium">{row.contactName}</span>}
                          {row.contactName && <span className="text-slate-600">·</span>}
                          <span className="font-mono text-slate-400">{row.phoneNumber}</span>
                        </div>
                        {/* Row 3: category + call count */}
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium", catChip)}>
                            {row.category || "Unknown"}
                          </span>
                          <span className="text-[11px] text-slate-500">{row.totalCalls} calls total</span>
                        </div>
                        {/* Row 4: timestamps */}
                        <div className="flex items-center gap-2 text-[11px]">
                          <span className="text-slate-500">Missed</span>
                          <span className="text-slate-300 tabular-nums">{format(new Date(row.missedAt), "MMM d, HH:mm")}</span>
                          {row.callbackAt && (
                            <>
                              <span className="text-slate-600">→</span>
                              <span className="text-slate-500">Callback</span>
                              <span className="text-emerald-400 tabular-nums">{format(new Date(row.callbackAt), "MMM d, HH:mm")}</span>
                              <span className="text-slate-600 font-medium">({formatCallbackGap(row.missedAt, row.callbackAt)})</span>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Footer count */}
                <div className="px-4 py-2.5 border-t border-slate-800 flex items-center justify-between text-[11px] text-slate-500">
                  <span>
                    <span className="text-slate-300 font-medium">{completionRows.length}</span> missed call{completionRows.length !== 1 ? "s" : ""}{" "}
                    · <span className="text-emerald-300 font-medium">{completionRows.filter(r => r.completed).length}</span> called back
                    · <span className="text-rose-300 font-medium">{completionRows.filter(r => !r.completed).length}</span> not called back
                  </span>
                  <span className="text-slate-600 hidden sm:inline">2h window</span>
                </div>
              </>
            )}
          </div>
        );
      })()}
      </div>
      )}

      {/* Comparison Mode */}
      {comparisonMode && (
        <div className="space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <ArrowLeftRight className="w-4 h-4 text-indigo-400" />
                <span className="text-sm font-semibold text-slate-200">Comparison Mode</span>
                <span className="text-xs text-slate-500">
                  · {compareViewMode === "singleGraph" ? "Single graph" : `${comparisonPanels.length} panels`}
                </span>
                {/* View mode toggle */}
                <div className="flex rounded-full bg-slate-800 p-0.5">
                  <button
                    onClick={() => setCompareViewMode("singleGraph")}
                    className={cn(
                      "px-3 py-1 rounded-full text-xs font-medium transition-colors",
                      compareViewMode === "singleGraph"
                        ? "bg-indigo-600 text-white"
                        : "text-slate-400 hover:text-slate-200"
                    )}
                  >
                    Single graph
                  </button>
                  <button
                    onClick={() => setCompareViewMode("panels")}
                    className={cn(
                      "px-3 py-1 rounded-full text-xs font-medium transition-colors",
                      compareViewMode === "panels"
                        ? "bg-indigo-600 text-white"
                        : "text-slate-400 hover:text-slate-200"
                    )}
                  >
                    Panels
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {compareViewMode === "panels" && comparisonPanels.length < 4 && (
                  <button
                    onClick={addComparisonPanel}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add Panel
                  </button>
                )}
                <button
                  onClick={toggleComparisonMode}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 border border-rose-500/20 transition-colors"
                >
                  Exit Compare
                </button>
              </div>
            </div>
          </div>

          {compareViewMode === "singleGraph" && (
            <Card className="bg-slate-900 border-slate-800 text-slate-100 relative z-10">
              <div className="p-4 sm:p-6 space-y-4">
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <User className="w-4 h-4 text-slate-400 shrink-0" />
                    <span className="text-xs sm:text-sm font-medium text-slate-400">Compare employees (same graph)</span>
                  </div>
                  <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2">
                    <div className="overflow-x-auto overflow-y-hidden pb-1 -mx-1 scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent" style={{ WebkitOverflowScrolling: "touch" }}>
                      <div className="flex gap-1.5 sm:gap-2 min-w-max sm:min-w-0 sm:flex-wrap">
                        {employeeNames.length === 0 && isLoading ? (
                          <span className="text-xs text-slate-500 py-2">Loading...</span>
                        ) : (
                          employeeNames.map((name) => {
                            const isSelected = selectedCompareEmployees.includes(name);
                            return (
                              <button
                                key={name}
                                onClick={() => {
                                  if (isSelected) {
                                    setSelectedCompareEmployees((prev) => prev.filter((n) => n !== name));
                                  } else {
                                    setSelectedCompareEmployees((prev) => [...prev, name].sort());
                                  }
                                }}
                                className={cn(
                                  "px-2 py-1 sm:py-1.5 rounded-full text-[11px] sm:text-xs font-medium transition-all border shrink-0",
                                  isSelected
                                    ? "bg-indigo-600 text-white border-indigo-500"
                                    : "bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700"
                                )}
                              >
                                {name}
                              </button>
                            );
                          })
                        )}
                      </div>
                    </div>
                    {selectedCompareEmployees.length > 0 && (
                      <span className="text-xs text-slate-500 shrink-0">
                        {selectedCompareEmployees.length} selected
                        {compareGraphEmployees.length < selectedCompareEmployees.length && (
                          <span className="text-amber-400/90">
                            {" "}
                            · {selectedCompareEmployees.length - compareGraphEmployees.length} excluded from chart
                          </span>
                        )}
                      </span>
                    )}
                  </div>
                </div>

                <div>
                  {graphExclusionControls}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium text-slate-400">X-axis</span>
                  <div className="flex rounded-full bg-slate-800 p-0.5">
                    <button
                      type="button"
                      onClick={() => setCompareXAxisMode("hour")}
                      className={cn(
                        "px-3 py-1 rounded-full text-xs font-medium transition-colors",
                        compareXAxisMode === "hour" ? "bg-emerald-600 text-white" : "text-slate-400 hover:text-slate-200"
                      )}
                    >
                      By hour
                    </button>
                    <button
                      type="button"
                      onClick={() => setCompareXAxisMode("date")}
                      className={cn(
                        "px-3 py-1 rounded-full text-xs font-medium transition-colors",
                        compareXAxisMode === "date" ? "bg-emerald-600 text-white" : "text-slate-400 hover:text-slate-200"
                      )}
                    >
                      By date range
                    </button>
                  </div>
                  {compareXAxisMode === "date" && (
                    <span className="text-[11px] text-slate-500">
                      Use Custom range above (e.g. 10 Mar – 15 Mar).
                    </span>
                  )}
                </div>

                <div className="min-h-[340px] h-[50vh] sm:h-[400px] sm:min-h-[360px] max-h-[520px]">
                  {selectedCompareEmployees.length === 0 ? (
                    <div className="flex h-full items-center justify-center text-sm text-slate-500">
                      Select one or more employees to compare in the same graph.
                    </div>
                  ) : compareGraphEmployees.length === 0 ? (
                    <div className="flex h-full items-center justify-center text-sm text-slate-500 px-4 text-center">
                      All selected employees are excluded from the chart. Adjust exclusions above.
                    </div>
                  ) : singleGraphChartData.length === 0 ? (
                    <div className="flex h-full items-center justify-center text-sm text-slate-500">
                      No call activity for selected employees and date range.
                    </div>
                  ) : (
                    <div className="w-full h-full flex flex-col">
                      <div className="w-full flex-1 min-h-0">
                        <div className="h-full min-h-[300px] w-full">
                          <ResponsiveContainer width="100%" height="100%" minHeight={300}>
                      <ComposedChart
                        data={singleGraphChartData}
                        margin={{ top: 84, right: 16, left: 8, bottom: 88 }}
                        // Remove gaps between employee stacks within the same time bucket.
                        barCategoryGap={0}
                        barGap={0}
                        style={{ overflow: "visible" }}
                        onClick={(e: any) => {
                          const ap = e?.activePayload;
                          const hit = Array.isArray(ap) && ap.length > 0 ? ap[0] : null;
                          const payload = hit?.payload;
                          const dk = String(hit?.dataKey ?? "");
                          if (!payload || !dk) return;
                          const m = dk.match(/^(.*)_(incoming|outgoing|missed)$/);
                          if (!m) return;
                          const employee = m[1];
                          const callType = m[2] === "incoming" ? "INCOMING" : m[2] === "outgoing" ? "OUTGOING" : "MISSED";
                          if (compareXAxisMode === "date") {
                            const dateTs = Number(payload.dateTs);
                            if (!Number.isFinite(dateTs)) return;
                            applyGraphFilter({ xMode: "date", dateTs, employee, callType });
                          } else {
                            const hour = Number(payload.hour);
                            if (!Number.isFinite(hour)) return;
                            applyGraphFilter({ xMode: "hour", hour, employee, callType });
                          }
                        }}
                      >
                        <XAxis
                          dataKey="timeRange"
                          tickLine={false}
                          axisLine={{ stroke: "#1f2937" }}
                          tick={{ fill: "#9ca3af", fontSize: 10 }}
                          interval="preserveStartEnd"
                          minTickGap={14}
                          angle={0}
                        />
                        <YAxis
                          allowDecimals={false}
                          tickLine={false}
                          axisLine={{ stroke: "#1f2937" }}
                          tick={{ fill: "#9ca3af", fontSize: 11 }}
                          tickCount={8}
                          width={28}
                        />
                        <RechartsTooltip content={<CompareTooltip />} />
                        {compareGraphEmployees.flatMap((emp) => {
                          return [
                            <Bar
                              key={`${emp}_incoming`}
                              dataKey={`${emp}_incoming`}
                              name="Incoming"
                              stackId={emp}
                              fill={COMPARE_CALL_TYPE_COLORS.incoming}
                              radius={[0, 0, 0, 0]}
                              cursor="pointer"
                              onClick={(data: any) => {
                                if (!data?.payload) return;
                                if (compareXAxisMode === "date") {
                                  applyGraphFilter({
                                    xMode: "date",
                                    dateTs: Number(data.payload.dateTs),
                                    employee: emp,
                                    callType: "INCOMING",
                                  });
                                } else {
                                  applyGraphFilter({
                                    xMode: "hour",
                                    hour: Number(data.payload.hour),
                                    employee: emp,
                                    callType: "INCOMING",
                                  });
                                }
                              }}
                            >
                              <LabelList
                                dataKey={`${emp}_incoming`}
                                position="center"
                                fill="#fff"
                                fontSize={9}
                                fontWeight={600}
                                style={{ pointerEvents: "none" }}
                                formatter={(value: any) => (value > 0 ? String(value) : "")}
                              />
                            </Bar>,
                            <Bar
                              key={`${emp}_outgoing`}
                              dataKey={`${emp}_outgoing`}
                              name="Outgoing"
                              stackId={emp}
                              fill={COMPARE_CALL_TYPE_COLORS.outgoing}
                              radius={[0, 0, 0, 0]}
                              cursor="pointer"
                              onClick={(data: any) => {
                                if (!data?.payload) return;
                                if (compareXAxisMode === "date") {
                                  applyGraphFilter({
                                    xMode: "date",
                                    dateTs: Number(data.payload.dateTs),
                                    employee: emp,
                                    callType: "OUTGOING",
                                  });
                                } else {
                                  applyGraphFilter({
                                    xMode: "hour",
                                    hour: Number(data.payload.hour),
                                    employee: emp,
                                    callType: "OUTGOING",
                                  });
                                }
                              }}
                            >
                              <LabelList
                                dataKey={`${emp}_outgoing`}
                                position="center"
                                fill="#fff"
                                fontSize={9}
                                fontWeight={600}
                                style={{ pointerEvents: "none" }}
                                formatter={(value: any) => (value > 0 ? String(value) : "")}
                              />
                            </Bar>,
                            <Bar
                              key={`${emp}_missed`}
                              dataKey={`${emp}_missed`}
                              name="Missed"
                              stackId={emp}
                              fill={COMPARE_CALL_TYPE_COLORS.missed}
                              radius={[4, 4, 0, 0]}
                              label={makeEmployeeStackTopBarLabel(emp)}
                              cursor="pointer"
                              onClick={(data: any) => {
                                if (!data?.payload) return;
                                if (compareXAxisMode === "date") {
                                  applyGraphFilter({
                                    xMode: "date",
                                    dateTs: Number(data.payload.dateTs),
                                    employee: emp,
                                    callType: "MISSED",
                                  });
                                } else {
                                  applyGraphFilter({
                                    xMode: "hour",
                                    hour: Number(data.payload.hour),
                                    employee: emp,
                                    callType: "MISSED",
                                  });
                                }
                              }}
                            >
                              <LabelList
                                dataKey={`${emp}_missed`}
                                position="center"
                                fill="#fff"
                                fontSize={9}
                                fontWeight={600}
                                style={{ pointerEvents: "none" }}
                                formatter={(value: any) => (value > 0 ? String(value) : "")}
                              />
                            </Bar>,
                          ];
                        })}
                      </ComposedChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                {compareGraphEmployees.length > 0 && (
                  <div className="pt-3 border-t border-slate-800 space-y-3">
                    <div>
                      <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                        Employees (name + initials above each column)
                      </div>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                        {compareGraphEmployees.map((emp) => (
                          <div key={emp} className="flex items-center gap-1.5">
                            <span className="text-xs font-semibold text-slate-400">{getInitials(emp)}</span>
                            <span className="text-xs text-slate-300">= {emp}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Segment colors (call type)</div>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
                        <span className="flex items-center gap-1.5">
                          <span className="w-3 h-2 rounded-sm bg-emerald-500" />
                          Incoming
                        </span>
                        <span className="flex items-center gap-1.5">
                          <span className="w-3 h-2 rounded-sm bg-sky-500" />
                          Outgoing
                        </span>
                        <span className="flex items-center gap-1.5">
                          <span className="w-3 h-2 rounded-sm bg-rose-500" />
                          Missed
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </Card>
          )}

          {compareViewMode === "panels" && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {comparisonPanels.map((panel, index) => (
                <ComparisonPanel
                  key={panel.id}
                  panelIndex={index}
                  initialDateFilter={panel.dateFilter}
                  excludedGraphHours={excludedGraphHours}
                  onRemove={() => removeComparisonPanel(panel.id)}
                  canRemove={comparisonPanels.length > 2}
                  onSelectFromPanel={({ start, end, hour, callType, employee }) => {
                    applyGraphFilterWithDateRange(
                      { xMode: "hour", hour, callType, employee },
                      { start, end }
                    );
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Filters & Search */}
      <div ref={logsRef} className="scroll-mt-4">
      <Card className="bg-slate-900 border-slate-800 text-slate-100 relative z-10">
        <div className="p-3 sm:p-4 border-b border-slate-800 flex flex-col gap-3">
          {/* Search */}
          <div className="relative w-full">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
            <Input
              placeholder="Search by phone number..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 bg-slate-950 border-slate-700 text-white w-full"
            />
          </div>
        </div>

        {/* Desktop Table */}
        <div className="hidden sm:block relative min-h-[200px]">
          {isLoading && tableLogs.length > 0 && (
            <div className="absolute inset-0 z-20 bg-slate-950/40 backdrop-blur-[1px] flex items-center justify-center rounded-b-xl border-t border-slate-800 transition-all duration-300">
              <div className="flex bg-slate-900 border border-slate-700 px-4 py-2.5 rounded-full shadow-xl items-center gap-3">
                <Loader2 className="w-4 h-4 animate-spin text-indigo-500" />
                <span className="text-sm font-medium text-slate-200">Updating results...</span>
              </div>
            </div>
          )}
          <Table>
            <TableHeader className="bg-slate-950/50">
              <TableRow className="border-slate-800 hover:bg-transparent">
                <TableHead className="text-slate-400">Employee</TableHead>
                <TableHead className="text-slate-400">Contact</TableHead>
                <TableHead className="text-slate-400">Identified</TableHead>
                <TableHead className="text-slate-400">Phone Number</TableHead>
                <TableHead className="text-slate-400">Type</TableHead>
                <TableHead className="text-slate-400">Duration</TableHead>
                <TableHead className="text-slate-400">Date & Time</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && tableLogs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-32 text-center border-b-0">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto text-indigo-500" />
                  </TableCell>
                </TableRow>
              ) : tableLogs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center text-slate-500 border-b-0">
                    No call logs found matching your filters.
                  </TableCell>
                </TableRow>
              ) : (
                tableLogs.map((log: any) => (
                  <TableRow
                    key={log._id}
                    data-scroll-anchor-id={`${String(log._id ?? "")}|${String(log.timestamp ?? "")}|${String(log.phoneNumber ?? "")}`}
                    className="border-slate-800 hover:bg-slate-800/50"
                  >
                    <TableCell className="font-medium text-slate-300">
                      <div className="flex flex-col gap-0.5">
                        <span>{getEmployeeName(log)}</span>
                        {getEmployeeDepartment(log) ? (
                          <span className="text-[11px] text-slate-500">{getEmployeeDepartment(log)}</span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-slate-400">
                      <div className="flex flex-col gap-1 items-start">
                        <span>{log.contactName || "Unknown"}</span>
                        {/* Tags Display Desktop */}
                        {tags[log.phoneNumber] && tags[log.phoneNumber].length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-0.5">
                            {tags[log.phoneNumber].map((t: any, idx: number) => (
                              <button 
                                key={idx} 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedPhoneForTags(log.phoneNumber);
                                  setIsTagModalOpen(true);
                                }}
                                className="text-[10px] px-1.5 py-0 border border-slate-700 bg-slate-900/50 text-slate-400 hover:bg-slate-800 transition-colors rounded-full"
                              >
                                {t.name}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-slate-400">
                      <IdentifiedTag
                        log={log}
                        getEmployeeName={getEmployeeName}
                        intelligenceTags={intelligenceTags}
                        savingEdit={savingEdit}
                        saveInlineEdit={saveInlineEdit}
                      />
                    </TableCell>
                    <TableCell className="text-slate-300 font-mono text-sm">
                      {log.phoneNumber}
                    </TableCell>
                    <TableCell>
                      <CallTypeBadge callType={log.callType} />
                    </TableCell>
                    <TableCell className="text-slate-400">{formatDuration(log.duration)}</TableCell>
                    <TableCell className="text-slate-400">
                      {log.timestamp && !isNaN(new Date(log.timestamp).getTime())
                        ? format(new Date(log.timestamp), "MMM dd, yyyy HH:mm")
                        : "N/A"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Mobile Card List */}
        <div className="block sm:hidden relative min-h-[200px]">
          {isLoading && tableLogs.length > 0 && (
            <div className="absolute inset-0 z-20 bg-slate-950/40 backdrop-blur-[1px] flex items-center justify-center rounded-b-xl border-t border-slate-800 transition-all duration-300">
              <div className="flex bg-slate-900 border border-slate-700 px-4 py-2.5 rounded-full shadow-xl items-center gap-3">
                <Loader2 className="w-4 h-4 animate-spin text-indigo-500" />
                <span className="text-sm font-medium text-slate-200">Updating...</span>
              </div>
            </div>
          )}
          {isLoading && tableLogs.length === 0 ? (
            <div className="flex items-center justify-center h-48 border-t border-slate-800">
              <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
            </div>
          ) : tableLogs.length === 0 ? (
            <div className="text-center text-slate-500 py-16 text-sm border-t border-slate-800">No call logs found matching your filters.</div>
          ) : (
            <div className="divide-y divide-slate-800/50 border-t border-slate-800/50">
              {tableLogs.map((log: any) => {
                const employee = getEmployeeName(log);
                const displayContactName = log.contactName && log.contactName !== "Unknown" ? log.contactName : log.phoneNumber;
                const logTags = tags[log.phoneNumber] || [];
                const maxVisibleTags = 2;
                const visibleTags = logTags.slice(0, maxVisibleTags);
                const overflowTagCount = logTags.length - maxVisibleTags;
                const intelKey = `${log.phoneNumber}|${employee}`;
                const intelTag = intelligenceTags[intelKey];

                const mobileCallTypeLabel =
                  log.callType === "INCOMING"
                    ? "Incoming"
                    : log.callType === "OUTGOING"
                      ? "Outgoing"
                      : log.callType === "MISSED"
                        ? "Missed"
                        : log.callType === "UNKNOWN"
                          ? "Unknown"
                          : "";

                return (
                  <div key={log._id} className="p-2.5 hover:bg-slate-800/40 transition-colors w-full flex flex-col gap-1 min-h-0">
                    {/* Row 1: Tracked user (full width priority) + call type badge */}
                    <div className="flex items-start justify-between gap-2 min-w-0">
                      <div className="min-w-0 flex-1 pr-1">
                        <div className="text-sm font-semibold text-white leading-snug line-clamp-2 break-words">{employee}</div>
                        {getEmployeeDepartment(log) ? (
                          <div className="text-[11px] text-slate-500 truncate">{getEmployeeDepartment(log)}</div>
                        ) : null}
                      </div>
                      <CallTypeBadge callType={log.callType} className="border-0 text-[10px] px-1.5 py-0.5 font-medium shrink-0 self-center" />
                    </div>
                    {/* Row 2: Contact truncates; call type + duration stay visible */}
                    <div className="flex items-center gap-1 min-w-0 text-xs text-slate-400">
                      <span className="font-medium text-slate-300 truncate min-w-0">{displayContactName}</span>
                      {mobileCallTypeLabel && (
                        <>
                          <span className="shrink-0">·</span>
                          <span className="shrink-0">{mobileCallTypeLabel}</span>
                        </>
                      )}
                      <span className="shrink-0">·</span>
                      <span className="shrink-0 tabular-nums font-medium">{formatDuration(log.duration)}</span>
                    </div>
                    {/* Row 3: Phone + Date */}
                    <div className="flex items-center justify-between gap-2 min-w-0">
                      <span className="text-xs font-medium text-slate-300 font-mono truncate min-w-0">{log.phoneNumber}</span>
                      <span className="text-sm text-slate-400 shrink-0 font-medium">
                        {log.timestamp && !isNaN(new Date(log.timestamp).getTime())
                          ? format(new Date(log.timestamp), "MMM d · HH:mm")
                          : "N/A"}
                      </span>
                    </div>
                    {/* Identified: Scenario A category or Scenario B name */}
                    {(intelTag?.category || intelTag?.contactName) && (
                      <div className="flex flex-wrap gap-1">
                        {intelTag.category && (
                          <span
                            className={cn(
                              "inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border",
                              CATEGORY_COLORS[intelTag.category] ?? "bg-slate-700 text-slate-300 border-slate-600"
                            )}
                          >
                            {intelTag.category}
                          </span>
                        )}
                        {intelTag.contactName && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border bg-violet-500/15 text-violet-300 border-violet-500/30">
                            {intelTag.contactName}
                          </span>
                        )}
                      </div>
                    )}
                    {/* Row 3: Tags in one row, overflow as +N — tap to open tag modal */}
                    {logTags.length > 0 && (
                      <div className="flex items-center gap-1 overflow-hidden min-w-0">
                        <div className="flex items-center gap-1 min-w-0 overflow-hidden">
                          {visibleTags.map((t: any, idx: number) => (
                            <button
                              type="button"
                              key={idx}
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedPhoneForTags(log.phoneNumber);
                                setIsTagModalOpen(true);
                              }}
                              className="text-[10px] px-1.5 py-0.5 border border-slate-700 bg-slate-900/50 text-slate-400 hover:bg-slate-800 transition-colors rounded-full whitespace-nowrap shrink-0"
                            >
                              {t.name}
                            </button>
                          ))}
                          {overflowTagCount > 0 && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedPhoneForTags(log.phoneNumber);
                                setIsTagModalOpen(true);
                              }}
                              className="text-[10px] px-1.5 py-0.5 border border-slate-600 bg-slate-800/60 text-slate-400 hover:bg-slate-800 rounded-full shrink-0 font-medium"
                            >
                              +{overflowTagCount}
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer count */}
        {!isLoading && tableLogs.length > 0 && (
          <div className="px-4 py-3 border-t border-slate-800 text-xs text-slate-500">
            Showing <span className="text-slate-300 font-medium">{tableLogs.length}</span> record{tableLogs.length !== 1 ? "s" : ""}
            {selectedEmployee !== "ALL" && (
              <> for <span className="text-indigo-400 font-medium">{selectedEmployee}</span></>
            )}
          </div>
        )}
      </Card>
      </div>

      {/* Info Modal for Mobile Views */}
      <Dialog open={isTagModalOpen} onOpenChange={setIsTagModalOpen}>
        <DialogContent className="max-w-sm rounded-2xl bg-slate-950 border-slate-800 mx-4 w-[calc(100%-2rem)]">
          <DialogHeader className="mb-2">
            <DialogTitle className="text-lg font-bold text-white flex items-center gap-2">
              <Info className="w-5 h-5 text-indigo-400" />
              Contact Tags
            </DialogTitle>
            <div className="text-sm text-slate-400 font-mono mt-1 tracking-tight">
              {selectedPhoneForTags}
            </div>
          </DialogHeader>
          
          <div className="flex flex-col px-1 pb-2">
            <div className="text-sm font-semibold text-slate-300 mb-3 uppercase tracking-widest text-[11px] opacity-80">
              Saved By Employees As
            </div>
            {selectedPhoneForTags && tags[selectedPhoneForTags] && tags[selectedPhoneForTags].length > 0 ? (
              <div className="space-y-4">
                {tags[selectedPhoneForTags].map((tag: any, i: number) => (
                  <div key={i} className="flex flex-col gap-1.5 bg-slate-900/40 p-3 rounded-xl border border-slate-800/50">
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                      <span className="text-sm font-bold text-slate-200">{tag.name}</span>
                    </div>
                    {tag.savedBy && tag.savedBy.length > 0 && (
                      <div className="pl-3.5 space-y-1 mt-1">
                        {tag.savedBy.map((sb: any, idx: number) => (
                          <div key={idx} className="flex items-center justify-between text-[11px]">
                            <span className="text-slate-400 flex items-center gap-1.5">
                              <User className="w-3 h-3 text-slate-500" />
                              {sb.employeeName}
                            </span>
                            {sb.timestamp && (
                              <span className="text-slate-500 font-mono tracking-tight">
                                {format(new Date(sb.timestamp), "MMM dd, yyyy")}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-slate-500 italic py-2 text-center">
                No tags found
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── PROBABLE CLIENT MODAL ── */}
      {showUnidentifiedModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-4xl max-h-[85vh] shadow-2xl shadow-orange-500/10 flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/50">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-orange-500/10 rounded-lg">
                  <UserX className="h-5 w-5 text-orange-400" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-white">Probable Clients</h2>
                  <p className="text-xs text-slate-400 mt-0.5">All contacts with no name · sorted by call count</p>
                </div>
              </div>
              <button 
                onClick={() => setShowUnidentifiedModal(false)}
                className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            
            {/* Modal Content */}
            <div className="flex-1 overflow-y-auto p-0 bg-[#080b14]">
              {unidentifiedClients.length === 0 ? (
                <div className="text-center py-12">
                  <div className="w-16 h-16 bg-slate-800/50 rounded-full flex items-center justify-center mx-auto mb-4">
                    <CheckCircle2 className="h-8 w-8 text-emerald-500" />
                  </div>
                  <h3 className="text-slate-200 font-semibold mb-1">All Clear!</h3>
                  <p className="text-slate-400 text-sm">No probable clients found matching your current filters.</p>
                </div>
              ) : (
                <Table>
                  <TableHeader className="bg-slate-900/50 sticky top-0 z-10">
                    <TableRow className="border-slate-800 hover:bg-transparent">
                      <TableHead className="text-slate-400 font-semibold h-10">Phone Number</TableHead>
                      <TableHead className="text-slate-400 font-semibold h-10 text-center">Calls</TableHead>
                      <TableHead className="text-slate-400 font-semibold h-10">Employees</TableHead>
                      <TableHead className="text-slate-400 font-semibold h-10">Call Times</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {unidentifiedClients.map((client, idx) => (
                      <TableRow key={idx} className="border-slate-800/60 hover:bg-slate-800/30 transition-colors">
                        <TableCell className="font-medium text-slate-200 py-3">
                          <div className="flex items-center gap-2">
                            {client.phoneNumber}
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-slate-800 text-slate-500">
                              Unknown
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-center py-3">
                          <span className="inline-flex items-center justify-center min-w-[1.5rem] px-2 py-0.5 rounded-full bg-orange-500/10 text-orange-400 font-bold text-xs">
                            {client.totalCalls}
                          </span>
                        </TableCell>
                        <TableCell className="py-3">
                          <div className="text-xs text-slate-400 truncate max-w-[200px]" title={client.employeeNames.join(", ")}>
                            {client.employeeNames.length > 0 ? client.employeeNames.join(", ") : "—"}
                          </div>
                        </TableCell>
                        <TableCell className="py-3">
                          <div className="flex flex-col gap-0.5 max-h-[80px] overflow-y-auto pr-1">
                            {client.timestamps.slice(0, 8).map((ts, tIdx) => (
                              <span key={tIdx} className="text-[11px] text-slate-300 font-mono whitespace-nowrap">
                                {format(new Date(ts), "MMM d, h:mm a")}
                              </span>
                            ))}
                            {client.timestamps.length > 8 && (
                              <span className="text-[10px] text-slate-500">+{client.timestamps.length - 8} more</span>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
            
            {/* Modal Footer */}
            <div className="px-6 py-3 border-t border-slate-800 bg-slate-900/50 flex justify-end">
              <Button onClick={() => setShowUnidentifiedModal(false)} variant="secondary" size="sm" className="bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white border-0">
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
