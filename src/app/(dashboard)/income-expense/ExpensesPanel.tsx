"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Check, Loader2, MapPin, Receipt, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { computeExcess } from "@/lib/expenseMath";
import { formatDateOnly, formatDateTime, formatINR } from "@/lib/incomeExpenseFormat";
import { api, type AccountRow, type ExpenseDTO, type Page } from "./apiClient";
import { Pager } from "./Pager";

type StatusFilter = "pending" | "approved" | "rejected" | "all";

interface Props {
  /** Fix to one driver (driver detail view). */
  driverId?: string;
  /** Used to warn about expenses that exceed the driver's available balance. */
  driversById: Map<string, AccountRow>;
  refreshKey: number;
  initialStatus?: StatusFilter;
  pageSize?: number;
  onReview: (expense: ExpenseDTO, mode: "approve" | "reject") => void;
}

const STATUS_BADGE = {
  pending: "border-amber-500/20 bg-amber-500/10 text-amber-500",
  approved: "border-emerald-500/20 bg-emerald-500/10 text-emerald-500",
  rejected: "border-rose-500/20 bg-rose-500/10 text-rose-500",
} as const;

export function ExpensesPanel({
  driverId,
  driversById,
  refreshKey,
  initialStatus = "pending",
  pageSize = 15,
  onReview,
}: Props) {
  const [status, setStatus] = useState<StatusFilter>(initialStatus);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page<ExpenseDTO> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const qs = new URLSearchParams({ status, page: String(page), limit: String(pageSize) });
    if (driverId) qs.set("driverId", driverId);
    api<Page<ExpenseDTO>>(`/api/income-expense/expenses?${qs}`)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setError("");
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Failed to load expenses."))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [status, page, driverId, pageSize, refreshKey]);

  const pick = (s: StatusFilter) => {
    setStatus(s);
    setPage(1);
    setLoading(true);
  };

  return (
    <div>
      <div className="flex items-center gap-2 overflow-x-auto border-b border-slate-800 p-4">
        {(["pending", "approved", "rejected", "all"] as const).map((f) => (
          <button
            key={f}
            onClick={() => pick(f)}
            className={`whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium capitalize transition-colors ${
              status === f ? "bg-slate-800 text-white" : "text-slate-400 hover:bg-slate-800/50 hover:text-slate-200"
            }`}
          >
            {f === "pending" ? "Awaiting approval" : f}
          </button>
        ))}
      </div>

      {error && <p className="p-4 text-sm text-rose-400">{error}</p>}

      <Table>
        <TableHeader className="bg-slate-950/50">
          <TableRow className="border-slate-800">
            {!driverId && <TableHead className="text-slate-400">Driver</TableHead>}
            <TableHead className="text-slate-400">Expense</TableHead>
            <TableHead className="text-slate-400">Evidence</TableHead>
            <TableHead className="text-slate-400">Status &amp; approval details</TableHead>
            <TableHead className="text-right text-slate-400">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableRow>
              <TableCell colSpan={5} className="h-32 text-center">
                <Loader2 className="mx-auto h-6 w-6 animate-spin text-indigo-500" />
              </TableCell>
            </TableRow>
          ) : !data || data.items.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="h-24 text-center text-slate-500">
                {status === "pending" ? "Nothing is waiting for approval." : "No expenses in this view."}
              </TableCell>
            </TableRow>
          ) : (
            data.items.map((e) => {
              const acct = driversById.get(e.driverId);
              // Only legacy expenses still have a deduction ahead of them.
              const wouldExceed =
                e.status === "pending" && !e.deductedOnSubmit && acct ? computeExcess(acct.balance, e.amount) : 0;
              return (
                <TableRow key={e.id} className="border-slate-800 align-top hover:bg-slate-800/30">
                  {!driverId && (
                    <TableCell>
                      <div className="font-semibold text-white">{e.driverName}</div>
                      {acct && (
                        <div className={`mt-1 text-xs ${acct.balance < 0 ? "text-rose-400" : "text-slate-500"}`}>
                          Balance {formatINR(acct.balance)}
                        </div>
                      )}
                    </TableCell>
                  )}
                  <TableCell className="max-w-sm">
                    <div className="font-mono text-lg font-bold text-amber-400">{formatINR(e.amount)}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="h-5 border-slate-700 text-[10px] text-slate-300">
                        {e.category}
                      </Badge>
                      <span className="text-xs text-slate-500">spent {formatDateOnly(e.expenseDate)}</span>
                    </div>
                    {e.description && <p className="mt-1.5 text-sm text-slate-300">{e.description}</p>}
                    <p className="mt-1 text-xs text-slate-600">submitted {formatDateTime(e.submittedAt)}</p>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1.5">
                      {e.hasReceipt !== false && (
                      <>
                      <a href={e.receiptUrl} target="_blank" rel="noreferrer" title="Open receipt" className="block w-fit">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={e.receiptUrl}
                          alt={`Receipt for ${formatINR(e.amount)}`}
                          loading="lazy"
                          className="h-16 w-16 rounded-md border border-slate-700 bg-slate-950 object-cover hover:border-indigo-400"
                        />
                      </a>
                      <a
                        href={e.receiptUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="flex w-fit items-center rounded-md bg-indigo-500/10 px-2 py-1 text-xs text-indigo-400 hover:text-indigo-300"
                      >
                        <Receipt className="mr-1 h-3 w-3" /> Receipt
                      </a>
                      </>
                      )}
                      {e.location && (
                        <a
                          href={`https://maps.google.com/?q=${e.location.lat},${e.location.lng}`}
                          target="_blank"
                          rel="noreferrer"
                          className="flex w-fit items-center rounded-md bg-sky-500/10 px-2 py-1 text-xs text-sky-400 hover:text-sky-300"
                        >
                          <MapPin className="mr-1 h-3 w-3" /> Location
                        </a>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">
                    <Badge variant="outline" className={STATUS_BADGE[e.status]}>
                      {e.status === "pending" ? "Pending approval" : e.status === "approved" ? "Approved" : "Rejected"}
                    </Badge>
                    {e.status !== "pending" && (
                      <div className="mt-1.5 space-y-0.5 text-xs text-slate-400">
                        <div>
                          by {e.reviewedByName ?? "—"} · {formatDateTime(e.reviewedAt)}
                        </div>
                        {e.status === "rejected" && e.rejectionReason && (
                          <div className="text-rose-300">Reason: {e.rejectionReason}</div>
                        )}
                        {e.status === "approved" && e.excessAmount > 0 && (
                          <div className="text-rose-300">{formatINR(e.excessAmount)} approved beyond balance</div>
                        )}
                        {e.status === "approved" && !e.deductedOnSubmit && e.balanceAfterApproval !== null && (
                          <div>balance after {formatINR(e.balanceAfterApproval)}</div>
                        )}
                        {e.status === "rejected" && e.deductedOnSubmit && (
                          <div className="text-emerald-400">{formatINR(e.amount)} refunded to wallet</div>
                        )}
                      </div>
                    )}
                    {e.deductedOnSubmit && (
                      <div className="mt-1.5 space-y-0.5 text-xs text-slate-400">
                        <div>
                          Deducted on submit
                          {e.walletBalanceAfter !== null && (
                            <>
                              {" "}· wallet after{" "}
                              <span className={e.walletBalanceAfter < 0 ? "text-rose-400" : "text-slate-300"}>
                                {formatINR(e.walletBalanceAfter)}
                              </span>
                            </>
                          )}
                        </div>
                        {e.status === "pending" && e.excessAmount > 0 && (
                          <div className="flex items-center gap-1 text-rose-300">
                            <AlertTriangle className="h-3 w-3" /> {formatINR(e.excessAmount)} beyond the balance at submission
                          </div>
                        )}
                      </div>
                    )}
                    {wouldExceed > 0 && (
                      <div className="mt-1.5 flex items-center gap-1 text-xs text-rose-300">
                        <AlertTriangle className="h-3 w-3" /> exceeds balance by {formatINR(wouldExceed)}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {e.status === "pending" ? (
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          className="border border-emerald-500/30 bg-emerald-600/20 text-emerald-500 hover:bg-emerald-600/30"
                          onClick={() => onReview(e, "approve")}
                        >
                          <Check className="mr-1 h-4 w-4" /> Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-rose-500/30 text-rose-500 hover:bg-rose-500/10"
                          onClick={() => onReview(e, "reject")}
                          title="Reject (reason required)"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ) : (
                      <span className="rounded-md bg-slate-800/50 px-3 py-1.5 text-xs font-medium text-slate-500">
                        Processed
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
      {data && <Pager page={data.page} limit={data.limit} total={data.total} onPage={(p) => { setPage(p); setLoading(true); }} />}
    </div>
  );
}
