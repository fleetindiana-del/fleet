"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import {
  ArrowDown,
  ArrowDownLeft,
  ArrowUp,
  ArrowUpDown,
  Car,
  Fuel,
  IndianRupee,
  Loader2,
  MapPin,
  Package,
  ParkingSquare,
  Plus,
  Receipt,
  RefreshCw,
  Search,
  UtensilsCrossed,
  Wallet,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EXPENSE_CATEGORY_LABEL, type ExpenseCategory } from "@/lib/expenseMath";
import {
  addCounts,
  applyExpenseTable,
  countsFromAccount,
  countsFromSpend,
  EMPTY_COUNTS,
  EXPENSE_TIME_ZONE,
  expenseDayFromIso,
  type CapsuleCounts,
  type ExpenseSortKey,
  type ExpenseTableQuery,
  type SortDir,
} from "@/lib/expenseTableView";
import { formatDateOnly, formatINR, formatKm } from "@/lib/incomeExpenseFormat";
import { cn } from "@/lib/utils";
import { api, type AccountRow, type ExpenseDTO, type LedgerEntryDTO, type Page, type SummaryResponse } from "./apiClient";
import { AllocateAdvanceDialog } from "./AllocateAdvanceDialog";
import { ReviewDialog } from "./ReviewDialog";
import { DeleteTransactionDialog, EditTransactionDialog, type TransactionTarget } from "./TransactionDialogs";

type FeedFilter = "all" | "pending" | "approved" | "rejected" | "advance";
type TxnStatus = "pending" | "approved" | "rejected" | "advance";
type CountStatus = "approved" | "pending" | "rejected";

interface Txn {
  key: string;
  at: string;
  title: string;
  driverName: string;
  driverId: string;
  category: string;
  amount: number;
  credit: boolean;
  struck: boolean;
  status: TxnStatus;
  expense?: ExpenseDTO;
  note: string | null;
  balanceAfter: number | null;
  ledgerId?: string;
  expenseDay: string | null;
  vehicle: string | null;
  odometerKm: number | null;
  previousOdometerKm: number | null;
  runKm: number | null;
  approver: string | null;
}

const OTHERS = "__others__";
const PAGE_LIMIT = 100;
const MAX_PAGES = 50;
const COLUMNS = 12;

/** Demo accounts created while testing. They stay in the database and stay off this page. */
function isTestEmployee(name: string) {
  return /test/i.test(name);
}

const FILTERS: { key: FeedFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "pending", label: "To be approved" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
  { key: "advance", label: "Money added" },
];

const CATEGORY_META: Record<string, { icon: LucideIcon; chip: string }> = {
  Fuel: { icon: Fuel, chip: "border-rose-500/30 bg-rose-500/10 text-rose-300" },
  Toll: { icon: Car, chip: "border-sky-500/30 bg-sky-500/10 text-sky-300" },
  Food: { icon: UtensilsCrossed, chip: "border-pink-500/30 bg-pink-500/10 text-pink-300" },
  Parking: { icon: ParkingSquare, chip: "border-violet-500/30 bg-violet-500/10 text-violet-300" },
  Maintenance: { icon: Wrench, chip: "border-amber-500/30 bg-amber-500/10 text-amber-300" },
  Other: { icon: Package, chip: "border-slate-600 bg-slate-800 text-slate-300" },
  Advance: { icon: ArrowDownLeft, chip: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" },
};

const STATUS_CHIP: Record<TxnStatus, string> = {
  pending: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  approved: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  rejected: "border-rose-500/30 bg-rose-500/10 text-rose-300",
  advance: "border-sky-500/30 bg-sky-500/10 text-sky-300",
};

const STATUS_LABEL: Record<TxnStatus, string> = {
  pending: "To be approved",
  approved: "Approved",
  rejected: "Rejected",
  advance: "Money added",
};

const fieldClass =
  "mt-1 h-9 w-full min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-2 text-xs text-slate-100 outline-none [color-scheme:dark] focus:ring-2 focus:ring-indigo-500";

function timeOf(iso: string, timeZone: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone });
}

function localDayLabel(iso: string, timeZone: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone });
}

function dateTimeInZone(iso: string, timeZone: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  });
}

function expenseTxn(e: ExpenseDTO): Txn {
  return {
    key: `e:${e.id}`,
    at: e.submittedAt,
    title: e.description || e.category,
    driverName: e.driverName,
    driverId: e.driverId,
    category: e.category,
    amount: e.amount,
    credit: false,
    struck: e.status === "rejected",
    status: e.status,
    expense: e,
    note: e.rejectionReason,
    balanceAfter: e.walletBalanceAfter,
    expenseDay: expenseDayFromIso(e.expenseDate),
    vehicle: e.vehicleRegistration,
    odometerKm: e.odometerKm,
    previousOdometerKm: e.previousOdometerKm,
    runKm: e.runKm,
    approver: e.reviewedByName,
  };
}

function advanceTxn(e: LedgerEntryDTO): Txn {
  return {
    key: `a:${e.id}`,
    at: e.timestamp,
    title: e.note || "Money added",
    driverName: e.driverName,
    driverId: e.driverId,
    category: "Advance",
    amount: e.amount,
    credit: true,
    struck: false,
    status: "advance",
    note: e.note,
    balanceAfter: e.balanceAfter,
    ledgerId: e.id,
    expenseDay: null,
    vehicle: null,
    odometerKm: null,
    previousOdometerKm: null,
    runKm: null,
    approver: e.performedByName,
  };
}

function targetFrom(txn: Txn): TransactionTarget {
  if (txn.ledgerId) {
    return {
      kind: "advance",
      id: txn.ledgerId,
      driverName: txn.driverName,
      amount: txn.amount,
      note: txn.note ?? "",
      category: "",
      description: txn.title,
    };
  }
  return {
    kind: "expense",
    id: txn.expense?.id ?? "",
    driverName: txn.driverName,
    amount: txn.amount,
    note: "",
    category: txn.category,
    description: txn.expense?.description ?? txn.title,
    odometerKm: txn.expense?.odometerKm ?? null,
    previousOdometerKm: txn.expense?.previousOdometerKm ?? null,
    vehicleRegistration: txn.expense?.vehicleRegistration ?? null,
  };
}

async function fetchEveryPage<T extends { id: string }>(base: string) {
  const seen = new Set<string>();
  const items: T[] = [];
  let total = 0;
  let complete = false;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const sep = base.includes("?") ? "&" : "?";
    const res = await api<Page<T>>(`${base}${sep}page=${page}&limit=${PAGE_LIMIT}`);
    total = res.total;
    let added = 0;
    for (const item of res.items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      items.push(item);
      added += 1;
    }
    if (items.length >= total || res.items.length < PAGE_LIMIT || added === 0) {
      complete = items.length >= total;
      break;
    }
  }
  return { items, total, complete };
}

/** Page through the staff list APIs so search and sort see every expense, not one screen of rows. */
async function loadAllRecords() {
  const [expenses, advances] = await Promise.all([
    fetchEveryPage<ExpenseDTO>("/api/income-expense/expenses?status=all"),
    fetchEveryPage<LedgerEntryDTO>("/api/income-expense/ledger?type=advance"),
  ]);
  return {
    expenses: expenses.items,
    advances: advances.items,
    expenseTotal: expenses.total,
    advanceTotal: advances.total,
    complete: expenses.complete && advances.complete,
  };
}

function sumCounts(rows: AccountRow[]): CapsuleCounts {
  return rows.reduce((total, row) => addCounts(total, countsFromAccount(row)), EMPTY_COUNTS);
}

function StatusCountButton({
  label,
  count,
  active,
  tone,
  title,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  tone: string;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={active}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={cn(
        "rounded px-1 py-0.5 tabular-nums hover:bg-white/10",
        tone,
        active && "bg-white/10 ring-1 ring-inset ring-current"
      )}
    >
      {count} {label}
    </button>
  );
}

function EmployeeCapsule({
  name,
  counts,
  selected,
  activeStatus,
  onToggle,
  onStatus,
}: {
  name: string;
  counts: CapsuleCounts;
  selected: boolean;
  activeStatus: CountStatus | null;
  onToggle: () => void;
  onStatus: (status: CountStatus) => void;
}) {
  return (
    <div
      data-employee-capsule=""
      onDoubleClick={(event) => event.stopPropagation()}
      className={cn(
        "rounded-xl border px-3 py-2",
        selected ? "border-indigo-500 bg-indigo-500/10" : "border-slate-800 bg-slate-900"
      )}
    >
      <button type="button" onClick={onToggle} aria-pressed={selected} className="w-full text-left">
        <div className="truncate text-sm font-medium text-white">{name}</div>
        <div className="mt-0.5 text-[11px] text-slate-400 tabular-nums">
          {counts.expenseCount} {counts.expenseCount === 1 ? "expense" : "expenses"} · {formatINR(counts.expenseAmount)}
        </div>
      </button>
      <div className="mt-1 flex flex-wrap gap-x-1 gap-y-0.5 text-[11px]">
        <StatusCountButton
          label="approved"
          count={counts.approvedCount}
          active={activeStatus === "approved"}
          tone="text-emerald-400"
          title={`Show ${name}'s approved expenses`}
          onClick={() => onStatus("approved")}
        />
        <StatusCountButton
          label="pending"
          count={counts.pendingCount}
          active={activeStatus === "pending"}
          tone="text-amber-300"
          title={`Show ${name}'s pending expenses`}
          onClick={() => onStatus("pending")}
        />
        <StatusCountButton
          label="rejected"
          count={counts.rejectedCount}
          active={activeStatus === "rejected"}
          tone="text-rose-400"
          title={`Show ${name}'s rejected expenses`}
          onClick={() => onStatus("rejected")}
        />
      </div>
    </div>
  );
}

export default function IncomeExpenseClient({ timeZone = EXPENSE_TIME_ZONE }: { timeZone?: string }) {
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [summaryError, setSummaryError] = useState("");
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const [filter, setFilter] = useState<FeedFilter>("all");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [fromTime, setFromTime] = useState("");
  const [toTime, setToTime] = useState("");
  const [category, setCategory] = useState("");
  const [sort, setSort] = useState<{ key: ExpenseSortKey; dir: SortDir }>({ key: "date", dir: "desc" });

  const [expenses, setExpenses] = useState<ExpenseDTO[]>([]);
  const [advances, setAdvances] = useState<LedgerEntryDTO[]>([]);
  const [expenseTotal, setExpenseTotal] = useState(0);
  const [advanceTotal, setAdvanceTotal] = useState(0);
  const [feedComplete, setFeedComplete] = useState(true);
  const [feedLoading, setFeedLoading] = useState(true);
  const [feedError, setFeedError] = useState("");

  const [allocateFor, setAllocateFor] = useState<string | undefined | null>(null);
  const [review, setReview] = useState<{ expense: ExpenseDTO; mode: "approve" | "reject" } | null>(null);
  const [editTarget, setEditTarget] = useState<TransactionTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TransactionTarget | null>(null);
  const feedGen = useRef(0);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    api<SummaryResponse>("/api/income-expense/summary")
      .then((s) => {
        if (cancelled) return;
        setSummary(s);
        setSummaryError("");
      })
      .catch((e) => !cancelled && setSummaryError(e instanceof Error ? e.message : "Failed to load."))
      .finally(() => !cancelled && setSummaryLoading(false));
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const dialogOpen = review !== null || editTarget !== null || deleteTarget !== null || allocateFor !== null;
  useEffect(() => {
    if (dialogOpen) return;
    let busy = false;
    const tick = () => {
      if (busy || document.visibilityState !== "visible") return;
      busy = true;
      const gen = feedGen.current;
      Promise.all([api<SummaryResponse>("/api/income-expense/summary"), loadAllRecords()])
        .then(([s, data]) => {
          setSummary(s);
          setSummaryError("");
          if (feedGen.current !== gen) return;
          setExpenses(data.expenses);
          setAdvances(data.advances);
          setExpenseTotal(data.expenseTotal);
          setAdvanceTotal(data.advanceTotal);
          setFeedComplete(data.complete);
        })
        .catch(() => {})
        .finally(() => {
          busy = false;
        });
    };
    const id = window.setInterval(tick, 10_000);
    const onVisible = () => document.visibilityState === "visible" && tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [dialogOpen]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 8000);
    return () => clearTimeout(t);
  }, [notice]);

  useEffect(() => {
    const gen = ++feedGen.current;
    setFeedLoading(true);
    setFeedError("");
    loadAllRecords()
      .then((data) => {
        if (feedGen.current !== gen) return;
        setExpenses(data.expenses);
        setAdvances(data.advances);
        setExpenseTotal(data.expenseTotal);
        setAdvanceTotal(data.advanceTotal);
        setFeedComplete(data.complete);
      })
      .catch((e) => {
        if (feedGen.current !== gen) return;
        setFeedError(e instanceof Error ? e.message : "Failed to load transactions.");
        setExpenses([]);
        setAdvances([]);
        setFeedComplete(false);
      })
      .finally(() => {
        if (feedGen.current === gen) setFeedLoading(false);
      });
  }, [refreshKey]);

  const driversById = useMemo(() => new Map((summary?.drivers ?? []).map((d) => [d.driverId, d])), [summary]);

  const roster = useMemo(() => (summary?.drivers ?? []).filter((d) => !isTestEmployee(d.name)), [summary]);
  const rosterIds = useMemo(() => roster.map((d) => d.driverId), [roster]);
  const rosterIdSet = useMemo(() => new Set(rosterIds), [rosterIds]);
  const testIds = useMemo(
    () => new Set((summary?.drivers ?? []).filter((d) => isTestEmployee(d.name)).map((d) => d.driverId)),
    [summary]
  );

  const people = useMemo(() => roster.slice().sort((a, b) => a.name.localeCompare(b.name)), [roster]);

  const rosterCounts = useMemo(() => sumCounts(roster), [roster]);
  const othersCounts = useMemo(
    () =>
      countsFromSpend(
        (summary?.categories ?? []).filter((row) => !rosterIdSet.has(row.driverId) && !testIds.has(row.driverId))
      ),
    [summary, rosterIdSet, testIds]
  );

  const txns = useMemo(
    () =>
      [...expenses.map(expenseTxn), ...advances.map(advanceTxn)].filter((txn) => !isTestEmployee(txn.driverName)),
    [expenses, advances]
  );

  const hasOthers = othersCounts.expenseCount > 0 || txns.some((txn) => !rosterIdSet.has(txn.driverId));
  const allCounts = useMemo(
    () => (hasOthers ? addCounts(rosterCounts, othersCounts) : rosterCounts),
    [hasOthers, rosterCounts, othersCounts]
  );

  const everyone = useMemo(() => [...rosterIds, ...(hasOthers ? [OTHERS] : [])], [rosterIds, hasOthers]);
  const showingAll = selectedIds.length === 0 || (everyone.length > 0 && everyone.every((id) => selectedIds.includes(id)));
  const explicitlyAll = everyone.length > 0 && everyone.every((id) => selectedIds.includes(id));

  const categories = useMemo(() => {
    const names = new Set(txns.map((txn) => txn.category).filter(Boolean));
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [txns]);

  const query = useMemo<ExpenseTableQuery>(
    () => ({
      driverIds: showingAll ? null : selectedIds.filter((id) => id !== OTHERS),
      includeUnassigned: showingAll || selectedIds.includes(OTHERS),
      rosterIds,
      status: filter,
      category,
      from,
      to,
      fromTime,
      toTime,
      search,
      timeZone,
    }),
    [showingAll, selectedIds, rosterIds, filter, category, from, to, fromTime, toTime, search, timeZone]
  );

  const visible = useMemo(() => applyExpenseTable(txns, query, sort), [txns, query, sort]);

  const selectedAccounts = showingAll ? roster : roster.filter((row) => selectedIds.includes(row.driverId));
  const selectedCounts = useMemo(() => {
    if (showingAll) return allCounts;
    const named = sumCounts(selectedAccounts);
    return selectedIds.includes(OTHERS) ? addCounts(named, othersCounts) : named;
  }, [showingAll, allCounts, selectedAccounts, selectedIds, othersCounts]);

  const advanceCount = useMemo(() => {
    const named = (showingAll ? roster : roster.filter((row) => selectedIds.includes(row.driverId))).reduce(
      (total, row) => total + row.advanceCount,
      0
    );
    if (!(showingAll || selectedIds.includes(OTHERS))) return named;
    const extra = advances.filter((entry) => !rosterIdSet.has(entry.driverId) && !isTestEmployee(entry.driverName)).length;
    return named + extra;
  }, [showingAll, roster, selectedIds, advances, rosterIdSet]);

  const available = Math.round(selectedAccounts.reduce((total, row) => total + row.balance, 0) * 100) / 100;
  const excess = Math.round(selectedAccounts.reduce((total, row) => total + row.excessAmount, 0) * 100) / 100;
  const onlyOthers = !showingAll && selectedAccounts.length === 0 && selectedIds.includes(OTHERS);

  const selectionLabel = useMemo(() => {
    if (showingAll) return "All employees";
    const names = people.filter((row) => selectedIds.includes(row.driverId)).map((row) => row.name);
    if (selectedIds.includes(OTHERS)) names.push("Others");
    if (names.length === 0) return "All employees";
    if (names.length <= 3) return names.join(", ");
    return `${names.length} employees`;
  }, [showingAll, people, selectedIds]);

  const balanceNote = onlyOthers
    ? "Unassigned expenses"
    : selectedAccounts.length === 1 && !showingAll
      ? excess > 0
        ? "Payable to this employee"
        : "Available to spend"
      : excess > 0
        ? `${formatINR(excess)} payable`
        : showingAll
          ? `Across ${roster.length} ${roster.length === 1 ? "employee" : "employees"}`
          : "Selected employees";

  const datesInverted = Boolean(from && to && from > to);
  const timesInverted = Boolean(fromTime && toTime && fromTime > toTime);
  const sortIsDefault = sort.key === "date" && sort.dir === "desc";
  const narrowed =
    selectedIds.length > 0 || filter !== "all" || search !== "" || Boolean(from || to || fromTime || toTime || category);
  const filtersActive = narrowed || !sortIsDefault;

  const singleDriverId =
    !showingAll && selectedAccounts.length === 1 && !selectedIds.includes(OTHERS) ? selectedAccounts[0].driverId : undefined;

  function toggleEmployee(id: string) {
    setSelectedIds((current) => {
      if (current.length === 0) return [id];
      return current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
    });
  }

  function pickCapsuleStatus(id: string | null, status: CountStatus) {
    const sameScope =
      filter === status &&
      (id === null ? showingAll : !showingAll && selectedIds.length === 1 && selectedIds[0] === id);
    setSelectedIds(id === null ? [] : [id]);
    setFilter(sameScope ? "all" : status);
  }

  function statusActive(id: string | null, status: CountStatus) {
    if (filter !== status) return false;
    if (showingAll) return id === null;
    if (id === null) return false;
    return selectedIds.includes(id);
  }

  function toggleSort(key: ExpenseSortKey) {
    setSort((current) =>
      current.key === key ? { key, dir: current.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }
    );
  }

  function resetFilters() {
    setSelectedIds([]);
    setFilter("all");
    setSearch("");
    setSearchOpen(false);
    setFrom("");
    setTo("");
    setFromTime("");
    setToTime("");
    setCategory("");
    setSort({ key: "date", dir: "desc" });
  }

  function resetOnEmptyDoubleClick(event: MouseEvent) {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest("[data-employee-capsule], button, a, input, select, textarea, label, table")) return;
    resetFilters();
  }

  function tabCount(key: FeedFilter) {
    if (key === "pending") return selectedCounts.pendingCount;
    if (key === "approved") return selectedCounts.approvedCount;
    if (key === "rejected") return selectedCounts.rejectedCount;
    if (key === "advance") return advanceCount;
    return 0;
  }

  const emptyMessage = datesInverted
    ? "The start date is after the end date, so no expenses match."
    : timesInverted
      ? "The start time is after the end time, so no expenses match."
      : search.trim()
        ? `No expenses match “${search.trim()}”.`
        : narrowed
          ? "No expenses match the current employees, status, dates, or type."
          : "No transactions yet.";

  function SortHead({
    label,
    column,
    align,
  }: {
    label: string;
    column: ExpenseSortKey;
    align?: "right";
  }) {
    const active = sort.key === column;
    const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
    return (
      <TableHead
        aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
        className={cn("px-3 text-slate-400", align === "right" && "text-right")}
      >
        <button
          type="button"
          onClick={() => toggleSort(column)}
          aria-label={`${label}, ${active ? (sort.dir === "asc" ? "sorted ascending" : "sorted descending") : "not sorted"}`}
          className={cn(
            "inline-flex items-center gap-1 hover:text-white",
            align === "right" && "ml-auto flex-row-reverse"
          )}
        >
          {label}
          <Icon className={cn("h-3.5 w-3.5 shrink-0", active ? "text-indigo-300" : "text-slate-600")} aria-hidden />
        </button>
      </TableHead>
    );
  }

  return (
    <div className="space-y-6" onDoubleClick={resetOnEmptyDoubleClick}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="flex items-center gap-3 text-2xl font-bold tracking-tight text-white sm:text-3xl">
            <Wallet className="h-8 w-8 shrink-0 text-indigo-400" />
            Expenses
          </h1>
          <p className="mt-1 truncate text-sm text-slate-400">{selectionLabel}</p>
        </div>
        <div className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900 px-4 py-2.5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-300">
            <IndianRupee className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <div className="text-xs text-slate-400">Available balance</div>
            <div className={cn("text-xl font-bold tabular-nums", available < 0 ? "text-rose-400" : "text-white")}>
              {summaryLoading && !summary ? "—" : formatINR(onlyOthers ? 0 : available)}
            </div>
            <div className="text-xs text-slate-500">{summaryLoading && !summary ? "Loading" : balanceNote}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={refresh}
            className="flex items-center justify-center gap-2 rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-200 transition-colors hover:bg-slate-800"
          >
            <RefreshCw className={cn("h-4 w-4", (summaryLoading || feedLoading) && "animate-spin")} />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => setAllocateFor(singleDriverId)}
            className="flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700"
          >
            <Plus className="h-4 w-4" />
            Add money
          </button>
        </div>
      </div>

      {notice && (
        <div className="flex items-start justify-between gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice("")} aria-label="Dismiss" className="text-emerald-300">
            ×
          </button>
        </div>
      )}
      {summaryError && (
        <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{summaryError}</div>
      )}
      {roster.some((row) => row.drifted) && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          {roster.filter((row) => row.drifted).length} employee{" "}
          {roster.filter((row) => row.drifted).length === 1 ? "balance does" : "balances do"} not match the ledger.
          Figures here come from the ledger.
        </div>
      )}

      <section aria-label="Employees">
        <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <h2 className="text-sm font-medium text-slate-300">Employees</h2>
          <p className="text-[11px] text-slate-500">
            Select employees to combine them. Select a count to filter by status. Double-click empty space to reset.
          </p>
          <button
            type="button"
            onClick={() => setSelectedIds(explicitlyAll ? [] : everyone)}
            disabled={everyone.length === 0}
            className="text-[11px] font-medium text-indigo-300 hover:text-indigo-200 disabled:opacity-40"
          >
            {explicitlyAll ? "Clear selection" : "Select all"}
          </button>
          {filtersActive && (
            <button type="button" onClick={resetFilters} className="text-[11px] font-medium text-slate-400 hover:text-white">
              Reset filters
            </button>
          )}
        </div>
        {summaryLoading && !summary ? (
          <div className="flex h-10 items-center">
            <Loader2 className="h-5 w-5 animate-spin text-indigo-500" />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            <EmployeeCapsule
              name="All employees"
              counts={allCounts}
              selected={showingAll}
              activeStatus={
                statusActive(null, "approved") ? "approved" : statusActive(null, "pending") ? "pending" : statusActive(null, "rejected") ? "rejected" : null
              }
              onToggle={() => setSelectedIds([])}
              onStatus={(status) => pickCapsuleStatus(null, status)}
            />
            {people.map((row) => (
              <EmployeeCapsule
                key={row.driverId}
                name={row.name}
                counts={countsFromAccount(row)}
                selected={selectedIds.includes(row.driverId)}
                activeStatus={
                  statusActive(row.driverId, "approved")
                    ? "approved"
                    : statusActive(row.driverId, "pending")
                      ? "pending"
                      : statusActive(row.driverId, "rejected")
                        ? "rejected"
                        : null
                }
                onToggle={() => toggleEmployee(row.driverId)}
                onStatus={(status) => pickCapsuleStatus(row.driverId, status)}
              />
            ))}
            {hasOthers && (
              <EmployeeCapsule
                name="Others"
                counts={othersCounts}
                selected={selectedIds.includes(OTHERS)}
                activeStatus={
                  statusActive(OTHERS, "approved")
                    ? "approved"
                    : statusActive(OTHERS, "pending")
                      ? "pending"
                      : statusActive(OTHERS, "rejected")
                        ? "rejected"
                        : null
                }
                onToggle={() => toggleEmployee(OTHERS)}
                onStatus={(status) => pickCapsuleStatus(OTHERS, status)}
              />
            )}
            {!summaryLoading && people.length === 0 && !hasOthers && (
              <p className="px-1 py-1.5 text-sm text-slate-500">No employees yet.</p>
            )}
          </div>
        )}
      </section>

      <Card className="border-slate-800 bg-slate-900">
        <CardHeader className="flex flex-col gap-3 border-b border-slate-800 pb-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <CardTitle className="text-base text-slate-200">Transactions</CardTitle>
              <p className="mt-1 text-xs text-slate-500">
                {selectionLabel}
                {!feedLoading && (
                  <span>
                    {" "}
                    · {visible.length} of {txns.length}
                  </span>
                )}
              </p>
            </div>
            <div className="flex min-w-0 items-center gap-2">
              <button
                type="button"
                aria-label={searchOpen ? "Close search" : "Search transactions"}
                aria-expanded={searchOpen}
                onClick={() => {
                  if (searchOpen) setSearch("");
                  setSearchOpen((open) => !open);
                }}
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                  searchOpen || search ? "bg-indigo-600 text-white" : "bg-slate-800 text-slate-300 hover:text-white"
                )}
              >
                <Search className="h-4 w-4" />
              </button>
              <div className="flex gap-2 overflow-x-auto" role="tablist" aria-label="Transaction filter">
                {FILTERS.map((item) => {
                  const on = filter === item.key;
                  const count = tabCount(item.key);
                  return (
                    <button
                      key={item.key}
                      type="button"
                      role="tab"
                      aria-selected={on}
                      onClick={() => setFilter(item.key !== "all" && filter === item.key ? "all" : item.key)}
                      className={cn(
                        "rounded-full px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors",
                        on ? "bg-indigo-600 text-white" : "bg-slate-800 text-slate-300 hover:text-white"
                      )}
                    >
                      {item.label}
                      {count > 0 && <span className="ml-1.5">{count}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          {searchOpen && (
            <div className="relative w-full sm:max-w-md">
              <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search name, type, amount, vehicle, date…"
                aria-label="Search transactions"
                autoFocus
                className="h-10 w-full rounded-lg border border-slate-700 bg-slate-950 pr-10 pl-10 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:ring-2 focus:ring-indigo-500"
              />
              {search && (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => setSearch("")}
                  className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          )}
        </CardHeader>
        <CardContent className="p-0">
          <div className="grid grid-cols-2 gap-2 border-b border-slate-800 px-4 py-3 sm:grid-cols-3 lg:grid-cols-5">
            <label className="text-[11px] text-slate-500">
              From date
              <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} aria-label="From date" className={fieldClass} />
            </label>
            <label className="text-[11px] text-slate-500">
              To date
              <input type="date" value={to} onChange={(event) => setTo(event.target.value)} aria-label="To date" className={fieldClass} />
            </label>
            <label className="text-[11px] text-slate-500">
              From time
              <input type="time" value={fromTime} onChange={(event) => setFromTime(event.target.value)} aria-label="From time" className={fieldClass} />
            </label>
            <label className="text-[11px] text-slate-500">
              To time
              <input type="time" value={toTime} onChange={(event) => setToTime(event.target.value)} aria-label="To time" className={fieldClass} />
            </label>
            <label className="col-span-2 text-[11px] text-slate-500 sm:col-span-1">
              Expense type
              <select
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                aria-label="Expense type"
                className={fieldClass}
              >
                <option value="">All types</option>
                {categories.map((name) => (
                  <option key={name} value={name}>
                    {EXPENSE_CATEGORY_LABEL[name as ExpenseCategory] ?? name}
                  </option>
                ))}
              </select>
            </label>
            <p className="col-span-2 text-[11px] leading-4 text-slate-500 sm:col-span-3 lg:col-span-5">
              Dates follow the expense date. Times are when the expense was recorded, in {timeZone}.
            </p>
          </div>
          {datesInverted && (
            <p className="px-4 pt-3 text-xs text-amber-200">The start date is after the end date, so nothing matches.</p>
          )}
          {timesInverted && (
            <p className="px-4 pt-3 text-xs text-amber-200">
              The start time is after the end time. Time filters cover a single day, so nothing matches.
            </p>
          )}
          {!feedComplete && !feedLoading && (
            <p className="px-4 pt-3 text-xs text-amber-200">
              Showing {expenses.length} of {expenseTotal} expenses and {advances.length} of {advanceTotal} money-added
              records. Capsule totals still include every expense.
            </p>
          )}
          {feedError && <p className="px-4 pt-4 text-sm text-rose-300">{feedError}</p>}
          <Table>
            <TableHeader className="bg-slate-950/50">
              <TableRow className="border-slate-800 hover:bg-transparent">
                <SortHead label="Employee" column="employee" />
                <SortHead label="Type" column="type" />
                <SortHead label="Details" column="details" />
                <SortHead label="Date" column="date" />
                <SortHead label="Time" column="time" />
                <SortHead label="Status" column="status" />
                <SortHead label="Amount" column="amount" align="right" />
                <SortHead label="Balance" column="balance" align="right" />
                <SortHead label="Vehicle" column="vehicle" />
                <SortHead label="Odometer" column="odometer" align="right" />
                <SortHead label="Approver" column="approver" />
                <TableHead className="px-3 text-right text-slate-400">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {feedLoading ? (
                <TableRow className="border-slate-800">
                  <TableCell colSpan={COLUMNS} className="h-32 text-center">
                    <Loader2 className="mx-auto h-6 w-6 animate-spin text-indigo-500" />
                  </TableCell>
                </TableRow>
              ) : visible.length === 0 ? (
                <TableRow className="border-slate-800">
                  <TableCell colSpan={COLUMNS} className="h-28 px-4 text-center text-slate-500">
                    {emptyMessage}
                  </TableCell>
                </TableRow>
              ) : (
                visible.map((txn) => {
                  const pending = txn.status === "pending" && txn.expense;
                  return (
                    <TableRow key={txn.key} className="border-slate-800 align-top hover:bg-slate-800/30">
                      <TableCell className="px-3 py-3 whitespace-normal">
                        <div className="font-medium text-slate-100">{txn.driverName}</div>
                      </TableCell>
                      <TableCell className="px-3 py-3">
                        <TypeMark category={txn.category} />
                      </TableCell>
                      <TableCell className="max-w-xs px-3 py-3 whitespace-normal">
                        <div className="text-sm text-slate-200">{txn.title}</div>
                        {txn.expense?.runKm != null && (
                          <p className="mt-1 text-xs font-medium text-emerald-400">{formatKm(txn.expense.runKm)} this run</p>
                        )}
                        {txn.expense && txn.expense.hasReceipt !== false && (
                          <a href={txn.expense.receiptUrl} target="_blank" rel="noreferrer" className="mt-2 block w-fit">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={txn.expense.receiptUrl}
                              alt="Bill"
                              className="h-16 w-16 rounded-md border border-slate-700 bg-black object-cover sm:h-20 sm:w-20"
                            />
                          </a>
                        )}
                        {txn.expense?.status === "rejected" && txn.expense.rejectionReason && (
                          <p className="mt-1 text-xs text-rose-300">Rejected: {txn.expense.rejectionReason}</p>
                        )}
                      </TableCell>
                      <TableCell className="px-3 py-3 whitespace-nowrap text-slate-400">
                        {txn.expense ? formatDateOnly(txn.expense.expenseDate) : localDayLabel(txn.at, timeZone)}
                      </TableCell>
                      <TableCell className="px-3 py-3 whitespace-nowrap text-slate-400">{timeOf(txn.at, timeZone)}</TableCell>
                      <TableCell className="px-3 py-3">
                        <Badge variant="outline" className={STATUS_CHIP[txn.status]}>
                          {STATUS_LABEL[txn.status]}
                        </Badge>
                      </TableCell>
                      <TableCell
                        className={cn(
                          "px-3 py-3 text-right font-medium whitespace-nowrap tabular-nums",
                          txn.credit ? "text-emerald-400" : "text-slate-100",
                          txn.struck && "text-slate-500 line-through"
                        )}
                      >
                        {txn.credit ? "+" : "−"}
                        {formatINR(txn.amount)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "px-3 py-3 text-right whitespace-nowrap tabular-nums",
                          txn.balanceAfter !== null && txn.balanceAfter < 0 ? "text-rose-400" : "text-slate-400"
                        )}
                      >
                        {txn.balanceAfter === null ? "—" : formatINR(txn.balanceAfter)}
                      </TableCell>
                      <TableCell className="px-3 py-3 whitespace-nowrap text-slate-300">{txn.vehicle || "—"}</TableCell>
                      <TableCell className="px-3 py-3 text-right whitespace-nowrap text-slate-300 tabular-nums">
                        {txn.odometerKm == null ? "—" : formatKm(txn.odometerKm)}
                      </TableCell>
                      <TableCell className="px-3 py-3 whitespace-normal text-slate-300">
                        <div>{txn.approver || "—"}</div>
                        {txn.expense?.reviewedAt && (
                          <div className="text-xs text-slate-500">{dateTimeInZone(txn.expense.reviewedAt, timeZone)}</div>
                        )}
                      </TableCell>
                      <TableCell className="px-3 py-3 whitespace-normal">
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => setEditTarget(targetFrom(txn))}
                            className="rounded-md bg-slate-800 px-2 py-1 text-[11px] font-medium text-slate-100 hover:bg-slate-700"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            disabled={!pending}
                            title={pending ? "Approve this expense" : "Only an expense waiting for approval can be approved"}
                            onClick={() => pending && setReview({ expense: txn.expense!, mode: "approve" })}
                            className="rounded-md bg-indigo-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(targetFrom(txn))}
                            className="rounded-md bg-rose-500/15 px-2 py-1 text-[11px] font-medium text-rose-300 hover:bg-rose-500/25"
                          >
                            Delete
                          </button>
                          {txn.expense && (
                            <a
                              href={txn.expense.receiptUrl}
                              target="_blank"
                              rel="noreferrer"
                              aria-label="Open receipt"
                              className="inline-flex items-center gap-1 px-1 text-[11px] text-indigo-300 hover:text-indigo-200"
                            >
                              <Receipt className="h-3.5 w-3.5" />
                            </a>
                          )}
                          {txn.expense?.location && (
                            <a
                              href={`https://maps.google.com/?q=${txn.expense.location.lat},${txn.expense.location.lng}`}
                              target="_blank"
                              rel="noreferrer"
                              aria-label="Open location"
                              className="inline-flex items-center gap-1 px-1 text-indigo-300 hover:text-indigo-200"
                            >
                              <MapPin className="h-3.5 w-3.5" />
                            </a>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {allocateFor !== null && (
        <AllocateAdvanceDialog
          drivers={roster}
          initialDriverId={allocateFor}
          onClose={() => setAllocateFor(null)}
          onDone={(msg) => {
            setAllocateFor(null);
            setNotice(msg);
            refresh();
          }}
        />
      )}

      {editTarget && (
        <EditTransactionDialog
          target={editTarget}
          onClose={() => setEditTarget(null)}
          onDone={(msg) => {
            setEditTarget(null);
            setNotice(msg);
            refresh();
          }}
        />
      )}

      {deleteTarget && (
        <DeleteTransactionDialog
          target={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDone={(msg) => {
            setDeleteTarget(null);
            setNotice(msg);
            refresh();
          }}
        />
      )}

      {review && (
        <ReviewDialog
          expense={review.expense}
          mode={review.mode}
          driverBalance={driversById.get(review.expense.driverId)?.balance ?? 0}
          onClose={() => {
            setReview(null);
            refresh();
          }}
          onDone={(msg) => {
            setReview(null);
            setNotice(msg);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function TypeMark({ category }: { category: string }) {
  const meta = CATEGORY_META[category] ?? CATEGORY_META.Other;
  const Icon = meta.icon;
  return (
    <Badge variant="outline" className={cn("gap-1.5 px-2 py-0.5", meta.chip)}>
      <Icon className="h-3 w-3" aria-hidden />
      {EXPENSE_CATEGORY_LABEL[category as ExpenseCategory] ?? category}
    </Badge>
  );
}
