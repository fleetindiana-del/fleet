"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownLeft,
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
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EXPENSE_CATEGORY_LABEL, type ExpenseCategory } from "@/lib/expenseMath";
import { formatDateOnly, formatDateTime, formatINR, formatKm } from "@/lib/incomeExpenseFormat";
import { cn } from "@/lib/utils";
import { api, type AccountRow, type ExpenseDTO, type LedgerEntryDTO, type Page, type SummaryResponse } from "./apiClient";
import { AllocateAdvanceDialog } from "./AllocateAdvanceDialog";
import { ReviewDialog } from "./ReviewDialog";
import { DeleteTransactionDialog, EditTransactionDialog, type TransactionTarget } from "./TransactionDialogs";

type FeedFilter = "all" | "pending" | "approved" | "rejected" | "advance";
type TxnStatus = "pending" | "approved" | "rejected" | "advance";

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
  note?: string | null;
  balanceAfter: number | null;
  ledgerId?: string;
}

const LIMIT = 30;

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

function timeOf(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
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
    balanceAfter: e.walletBalanceAfter,
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

function dedupe<T>(items: T[], idOf: (item: T) => string) {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const id = idOf(item);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(item);
  }
  return out;
}

async function fetchFeed(page: number, filter: FeedFilter, driverId: string | null) {
  const drv = driverId ? `&driverId=${encodeURIComponent(driverId)}` : "";
  if (filter === "advance") {
    const advances = await api<Page<LedgerEntryDTO>>(
      `/api/income-expense/ledger?type=advance&page=${page}&limit=${LIMIT}${drv}`
    );
    return { expenses: [] as ExpenseDTO[], advances: advances.items, expenseTotal: 0, advanceTotal: advances.total };
  }
  const status = filter === "all" ? "all" : filter;
  const expensesPromise = api<Page<ExpenseDTO>>(
    `/api/income-expense/expenses?status=${status}&page=${page}&limit=${LIMIT}${drv}`
  );
  const advancesPromise =
    filter === "all"
      ? api<Page<LedgerEntryDTO>>(`/api/income-expense/ledger?type=advance&page=${page}&limit=${LIMIT}${drv}`)
      : Promise.resolve(null);
  const [expenses, advances] = await Promise.all([expensesPromise, advancesPromise]);
  return {
    expenses: expenses.items,
    advances: advances?.items ?? [],
    expenseTotal: expenses.total,
    advanceTotal: advances?.total ?? 0,
  };
}

function SpendLines({ approved, notApproved, total }: { approved: number; notApproved: number; total: number }) {
  const items = [
    { key: "A", title: "Approved", value: approved, tone: "text-[#3dcc6d]" },
    { key: "N", title: "Not approved", value: notApproved, tone: "text-[#f05252]" },
    { key: "T", title: "Total balance, including money added", value: total, tone: "text-white" },
  ];
  return (
    <div className="mt-1 flex items-center gap-2 overflow-hidden text-[11px] leading-4 font-medium whitespace-nowrap">
      {items.map((item) => (
        <span key={item.key} title={item.title} className={cn("tabular-nums", item.tone)}>
          {item.key} {formatINR(item.value)}
        </span>
      ))}
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

export default function IncomeExpenseClient() {
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [summaryError, setSummaryError] = useState("");
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const [filter, setFilter] = useState<FeedFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const [expenses, setExpenses] = useState<ExpenseDTO[]>([]);
  const [advances, setAdvances] = useState<LedgerEntryDTO[]>([]);
  const [page, setPage] = useState(1);
  const [expenseTotal, setExpenseTotal] = useState(0);
  const [advanceTotal, setAdvanceTotal] = useState(0);
  const [feedLoading, setFeedLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
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

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 8000);
    return () => clearTimeout(t);
  }, [notice]);

  useEffect(() => {
    const gen = ++feedGen.current;
    setFeedLoading(true);
    setFeedError("");
    fetchFeed(1, filter, selectedId)
      .then((data) => {
        if (feedGen.current !== gen) return;
        setExpenses(data.expenses);
        setAdvances(data.advances);
        setExpenseTotal(data.expenseTotal);
        setAdvanceTotal(data.advanceTotal);
        setPage(1);
      })
      .catch((e) => {
        if (feedGen.current !== gen) return;
        setFeedError(e instanceof Error ? e.message : "Failed to load transactions.");
        setExpenses([]);
        setAdvances([]);
      })
      .finally(() => {
        if (feedGen.current === gen) setFeedLoading(false);
      });
  }, [filter, selectedId, refreshKey]);

  const driversById = useMemo(
    () => new Map((summary?.drivers ?? []).map((d) => [d.driverId, d])),
    [summary]
  );

  const roster = useMemo(
    () => (summary?.drivers ?? []).filter((d) => !isTestEmployee(d.name)),
    [summary]
  );
  const rosterTotals = useMemo(() => {
    const sum = (pick: (row: AccountRow) => number) =>
      Math.round(roster.reduce((total, row) => total + pick(row), 0) * 100) / 100;
    return {
      balance: sum((row) => row.balance),
      approved: sum((row) => row.totalApproved),
      pending: sum((row) => row.totalPending),
      advance: sum((row) => row.totalAdvance),
      excess: sum((row) => row.excessAmount),
      pendingCount: roster.reduce((total, row) => total + row.pendingCount, 0),
      count: roster.length,
      drifted: roster.filter((row) => row.drifted).length,
    };
  }, [roster]);

  const selected = selectedId ? roster.find((d) => d.driverId === selectedId) : undefined;

  const available = selected ? selected.balance : rosterTotals.balance;
  const excess = selected ? selected.excessAmount : rosterTotals.excess;
  const pendingCount = selected ? selected.pendingCount : rosterTotals.pendingCount;

  const people = useMemo(() => {
    const q = search.trim().toLowerCase();
    return roster
      .filter((d) => !q || d.name.toLowerCase().includes(q))
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [roster, search]);

  const txns = useMemo(() => {
    const q = search.trim().toLowerCase();
    const merged = [...expenses.map(expenseTxn), ...advances.map(advanceTxn)]
      .filter((t) => !isTestEmployee(t.driverName))
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || a.key.localeCompare(b.key));
    if (!q) return merged;
    return merged.filter((t) =>
      `${t.title} ${t.driverName} ${t.category} ${STATUS_LABEL[t.status]}`.toLowerCase().includes(q)
    );
  }, [expenses, advances, search]);

  const hasMore =
    filter === "advance" ? page * LIMIT < advanceTotal : page * LIMIT < expenseTotal || (filter === "all" && page * LIMIT < advanceTotal);

  function pickFilter(next: FeedFilter) {
    setFilter(next);
  }

  async function loadMore() {
    const next = page + 1;
    const gen = feedGen.current;
    setLoadingMore(true);
    setFeedError("");
    try {
      const data = await fetchFeed(next, filter, selectedId);
      if (feedGen.current !== gen) return;
      setExpenses((prev) => dedupe([...prev, ...data.expenses], (e) => e.id));
      setAdvances((prev) => dedupe([...prev, ...data.advances], (e) => e.id));
      setExpenseTotal(data.expenseTotal);
      setAdvanceTotal(data.advanceTotal);
      setPage(next);
    } catch (e) {
      setFeedError(e instanceof Error ? e.message : "Failed to load more transactions.");
    } finally {
      setLoadingMore(false);
    }
  }

  const balanceNote = selected
    ? excess > 0
      ? "Payable to this employee"
      : "Available to spend"
    : excess > 0
      ? `${formatINR(excess)} payable`
      : `Across ${rosterTotals.count} ${rosterTotals.count === 1 ? "employee" : "employees"}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight text-white">
            <Wallet className="h-8 w-8 text-indigo-400" />
            Expenses
          </h1>
          <p className="mt-1 text-sm text-slate-400">{selected ? selected.name : "All employees"}</p>
        </div>
        <div className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900 px-4 py-2.5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-300">
            <IndianRupee className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <div className="text-xs text-slate-400">Available balance</div>
            <div className={cn("text-xl font-bold tabular-nums", available < 0 ? "text-rose-400" : "text-white")}>
              {summaryLoading && !summary ? "—" : formatINR(available)}
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
            onClick={() => setAllocateFor(selectedId ?? undefined)}
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
      {rosterTotals.drifted > 0 && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          {rosterTotals.drifted} employee {rosterTotals.drifted === 1 ? "balance does" : "balances do"} not match the
          ledger. Figures here come from the ledger.
        </div>
      )}

      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-500" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search employees or transactions"
          aria-label="Search employees or transactions"
          className="h-11 w-full rounded-lg border border-slate-700 bg-slate-950 pr-4 pl-10 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      <section aria-label="Employees">
        <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-sm font-medium text-slate-300">Employees</h2>
          <p className="text-[11px] text-slate-500">
            <span className="text-[#3dcc6d]">A</span> approved
            <span className="mx-1.5">·</span>
            <span className="text-[#f05252]">N</span> not approved
            <span className="mx-1.5">·</span>
            <span className="text-white">T</span> total balance
          </p>
        </div>
        {summaryLoading && !summary ? (
          <div className="flex h-10 items-center">
            <Loader2 className="h-5 w-5 animate-spin text-indigo-500" />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
            {people.map((d: AccountRow) => {
              const on = selectedId === d.driverId;
              return (
                <button
                  key={d.driverId}
                  type="button"
                  onClick={() => setSelectedId(on ? null : d.driverId)}
                  aria-pressed={on}
                  className={cn(
                    "rounded-xl border px-3 py-2 text-left transition-colors",
                    on
                      ? "border-indigo-500 bg-indigo-500/10"
                      : "border-slate-800 bg-slate-900 hover:border-slate-600"
                  )}
                >
                  <div className="truncate text-sm font-medium text-white">{d.name}</div>
                  <SpendLines approved={d.totalApproved} notApproved={d.totalPending} total={d.balance} />
                </button>
              );
            })}
            {!summaryLoading && people.length === 0 && (
              <p className="px-1 py-1.5 text-sm text-slate-500">
                {search.trim() ? "No employees match that search." : "No employees yet."}
              </p>
            )}
          </div>
        )}
      </section>

      <Card className="border-slate-800 bg-slate-900">
        <CardHeader className="flex flex-col gap-3 border-b border-slate-800 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-base text-slate-200">Transactions</CardTitle>
            <p className="mt-1 text-xs text-slate-500">{selected ? selected.name : "All employees"}</p>
          </div>
          <div className="flex gap-2 overflow-x-auto" role="tablist" aria-label="Transaction filter">
            {FILTERS.map((f) => {
              const on = filter === f.key;
              const count = f.key === "pending" ? pendingCount : 0;
              return (
                <button
                  key={f.key}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => pickFilter(f.key)}
                  className={cn(
                    "rounded-full px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors",
                    on ? "bg-indigo-600 text-white" : "bg-slate-800 text-slate-300 hover:text-white"
                  )}
                >
                  {f.label}
                  {count > 0 && <span className="ml-1.5">{count}</span>}
                </button>
              );
            })}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {feedError && <p className="px-4 pt-4 text-sm text-rose-300">{feedError}</p>}
          <Table>
            <TableHeader className="bg-slate-950/50">
              <TableRow className="border-slate-800 hover:bg-transparent">
                <TableHead className="px-4 text-slate-400">Employee</TableHead>
                <TableHead className="px-4 text-slate-400">Type</TableHead>
                <TableHead className="px-4 text-slate-400">Details</TableHead>
                <TableHead className="px-4 text-slate-400">Date</TableHead>
                <TableHead className="px-4 text-slate-400">Status</TableHead>
                <TableHead className="px-4 text-right text-slate-400">Amount</TableHead>
                <TableHead className="px-4 text-right text-slate-400">Balance</TableHead>
                <TableHead className="px-4 text-right text-slate-400">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {feedLoading ? (
                <TableRow className="border-slate-800">
                  <TableCell colSpan={8} className="h-32 text-center">
                    <Loader2 className="mx-auto h-6 w-6 animate-spin text-indigo-500" />
                  </TableCell>
                </TableRow>
              ) : txns.length === 0 ? (
                <TableRow className="border-slate-800">
                  <TableCell colSpan={8} className="h-28 text-center text-slate-500">
                    {search.trim() ? "No transactions match that search." : "No transactions in this view."}
                  </TableCell>
                </TableRow>
              ) : (
                txns.map((txn) => {
                  const pending = txn.status === "pending" && txn.expense;
                  return (
                    <TableRow key={txn.key} className="border-slate-800 align-top hover:bg-slate-800/30">
                      <TableCell className="px-4 py-3 whitespace-normal">
                        <div className="font-medium text-slate-100">{txn.driverName}</div>
                      </TableCell>
                      <TableCell className="px-4 py-3">
                        <TypeMark category={txn.category} />
                      </TableCell>
                      <TableCell className="max-w-xs px-4 py-3 whitespace-normal">
                        <div className="text-sm text-slate-200">{txn.title}</div>
                        {txn.expense?.runKm != null && (
                          <p className="mt-1 text-xs font-medium text-emerald-400">
                            {formatKm(txn.expense.runKm)} this run
                            {txn.expense.vehicleRegistration ? ` · ${txn.expense.vehicleRegistration}` : ""}
                            {txn.expense.previousOdometerKm != null && txn.expense.odometerKm != null
                              ? ` · ${formatKm(txn.expense.previousOdometerKm)} → ${formatKm(txn.expense.odometerKm)}`
                              : ""}
                          </p>
                        )}
                        {txn.expense?.runKm == null && txn.expense?.odometerKm != null && (
                          <p className="mt-1 text-xs text-slate-400">Odometer {formatKm(txn.expense.odometerKm)}</p>
                        )}
                        {txn.expense && txn.expense.hasReceipt !== false && (
                          <a href={txn.expense.receiptUrl} target="_blank" rel="noreferrer" className="mt-2 block w-fit">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={txn.expense.receiptUrl}
                              alt="Bill"
                              className="h-20 w-20 rounded-md border border-slate-700 bg-black object-cover"
                            />
                          </a>
                        )}
                        {txn.expense?.status === "rejected" && txn.expense.rejectionReason && (
                          <p className="mt-1 text-xs text-rose-300">Rejected: {txn.expense.rejectionReason}</p>
                        )}
                        {txn.expense?.reviewedByName && (
                          <p className="mt-1 text-xs text-slate-500">Reviewed by {txn.expense.reviewedByName}</p>
                        )}
                      </TableCell>
                      <TableCell className="px-4 py-3 whitespace-normal text-slate-400">
                        {txn.expense ? (
                          <>
                            <div>{formatDateOnly(txn.expense.expenseDate)}</div>
                            <div className="text-xs text-slate-500">{timeOf(txn.at)}</div>
                          </>
                        ) : (
                          formatDateTime(txn.at)
                        )}
                      </TableCell>
                      <TableCell className="px-4 py-3">
                        <Badge variant="outline" className={STATUS_CHIP[txn.status]}>
                          {STATUS_LABEL[txn.status]}
                        </Badge>
                      </TableCell>
                      <TableCell
                        className={cn(
                          "px-4 py-3 text-right font-medium tabular-nums",
                          txn.credit ? "text-emerald-400" : "text-slate-100",
                          txn.struck && "text-slate-500 line-through"
                        )}
                      >
                        {txn.credit ? "+" : "−"}
                        {formatINR(txn.amount)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "px-4 py-3 text-right tabular-nums",
                          txn.balanceAfter !== null && txn.balanceAfter < 0 ? "text-rose-400" : "text-slate-400"
                        )}
                      >
                        {txn.balanceAfter === null ? "—" : formatINR(txn.balanceAfter)}
                      </TableCell>
                      <TableCell className="px-4 py-3 whitespace-normal">
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
          {hasMore && !search.trim() && !feedLoading && (
            <div className="border-t border-slate-800 px-4 py-3">
              <button
                type="button"
                onClick={loadMore}
                disabled={loadingMore}
                className="flex items-center gap-2 text-sm font-medium text-indigo-300 disabled:opacity-60"
              >
                {loadingMore && <Loader2 className="h-4 w-4 animate-spin" />}
                Show older transactions
              </button>
            </div>
          )}
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
