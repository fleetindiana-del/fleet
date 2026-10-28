"use client";

import { useState } from "react";
import { AlertTriangle, Check, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { computeExcess } from "@/lib/expenseMath";
import { formatDateOnly, formatINR } from "@/lib/incomeExpenseFormat";
import { api, ApiError, type ExpenseDTO } from "./apiClient";

interface Props {
  expense: ExpenseDTO;
  mode: "approve" | "reject";
  /** The driver's balance as last loaded; the server re-checks authoritatively. */
  driverBalance: number;
  onClose: () => void;
  onDone: (message: string) => void;
}

export function ReviewDialog({ expense, mode, driverBalance, onClose, onDone }: Props) {
  const [reason, setReason] = useState("");
  const [confirmExcess, setConfirmExcess] = useState(false);
  // Overrides the client estimate when the server reports different (fresher) numbers.
  const [serverExcess, setServerExcess] = useState<{ balanceBefore: number; excessAmount: number } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Already taken from the wallet at submission: approving changes nothing, rejecting refunds.
  const deducted = expense.deductedOnSubmit;
  const balanceBefore = serverExcess?.balanceBefore ?? driverBalance;
  const excess = deducted ? 0 : serverExcess?.excessAmount ?? computeExcess(driverBalance, expense.amount);
  const change = deducted ? (mode === "reject" ? expense.amount : 0) : mode === "approve" ? -expense.amount : 0;
  const balanceAfter = Math.round((balanceBefore + change) * 100) / 100;
  const approve = mode === "approve";
  const reasonOk = reason.trim().length >= 3;
  const canSubmit = approve ? excess === 0 || confirmExcess : reasonOk;

  async function submit() {
    setSubmitting(true);
    setError("");
    try {
      const res = await api<{ excessAmount: number; balance: number }>(
        `/api/income-expense/expenses/${expense.id}/review`,
        {
          method: "POST",
          body: JSON.stringify(
            approve
              ? { decision: "approve", confirmExcess }
              : { decision: "reject", reason: reason.trim() }
          ),
        }
      );
      onDone(
        approve
          ? `Approved ${formatINR(expense.amount)} for ${expense.driverName}. Balance now ${formatINR(res.balance)}${res.excessAmount > 0 ? ` (includes ${formatINR(res.excessAmount)} excess)` : ""}.`
          : deducted
            ? `Rejected ${formatINR(expense.amount)} for ${expense.driverName} and refunded it. Balance now ${formatINR(res.balance)}.`
            : `Rejected ${formatINR(expense.amount)} for ${expense.driverName}. Their balance is unchanged.`
      );
    } catch (e) {
      if (e instanceof ApiError && e.code === "EXCESS_CONFIRMATION_REQUIRED" && e.details) {
        // The balance changed since this page loaded. Show the real numbers and ask again.
        setServerExcess({
          balanceBefore: Number(e.details.balanceBefore),
          excessAmount: Number(e.details.excessAmount),
        });
        setConfirmExcess(false);
        setError("The driver's balance changed. Review the updated figures and confirm again.");
      } else if (e instanceof ApiError && e.code === "ALREADY_REVIEWED") {
        setError(`${e.message} Close this dialog to refresh the list.`);
      } else {
        setError(e instanceof Error ? e.message : "Something went wrong.");
      }
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !submitting && onClose()}>
      <DialogContent className="bg-slate-900 border-slate-800 text-slate-100 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{approve ? "Approve expense" : "Reject expense"}</DialogTitle>
          <DialogDescription className="text-slate-400">
            {expense.driverName} · {expense.category} · {formatDateOnly(expense.expenseDate)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-sm space-y-1.5">
            <div className="flex justify-between">
              <span className="text-slate-400">Amount</span>
              <span className="font-mono text-lg font-bold text-amber-400">{formatINR(expense.amount)}</span>
            </div>
            {expense.description && <p className="text-slate-300">{expense.description}</p>}
            {(approve || deducted) && (
              <>
                <div className="flex justify-between border-t border-slate-800 pt-1.5">
                  <span className="text-slate-400">Driver balance now</span>
                  <span className={balanceBefore < 0 ? "text-rose-400" : "text-slate-200"}>{formatINR(balanceBefore)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Balance after {approve ? "approval" : "refund"}</span>
                  <span className={`font-semibold ${balanceAfter < 0 ? "text-rose-400" : "text-emerald-400"}`}>
                    {formatINR(balanceAfter)}
                  </span>
                </div>
              </>
            )}
            {deducted && (
              <p className="border-t border-slate-800 pt-1.5 text-xs text-slate-400">
                Already deducted from the wallet when the driver submitted it.
                {approve ? " Approving confirms it; the balance does not change." : ""}
                {expense.excessAmount > 0 && (
                  <span className="text-rose-300"> It went {formatINR(expense.excessAmount)} beyond the balance at the time.</span>
                )}
              </p>
            )}
            {expense.hasReceipt !== false && (
            <a href={expense.receiptUrl} target="_blank" rel="noreferrer" className="block border-t border-slate-800 pt-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={expense.receiptUrl}
                alt="Receipt"
                className="max-h-56 w-full rounded-md border border-slate-800 bg-black object-contain"
              />
            </a>
            )}
          </div>

          {approve && excess > 0 && (
            <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-sm space-y-2">
              <div className="flex items-start gap-2 text-rose-300">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <p>
                  This exceeds the driver&apos;s available balance by{" "}
                  <span className="font-bold">{formatINR(excess)}</span>. Approving records it as an outstanding amount
                  payable to the driver until another advance is allocated.
                </p>
              </div>
              <label className="flex cursor-pointer items-start gap-2 text-slate-200">
                <input
                  type="checkbox"
                  checked={confirmExcess}
                  onChange={(e) => setConfirmExcess(e.target.checked)}
                  className="mt-1 h-4 w-4 accent-rose-500"
                />
                <span>I approve this excess spending of {formatINR(excess)}.</span>
              </label>
            </div>
          )}

          {!approve && (
            <div className="space-y-1.5">
              <Label className="text-slate-300">Reason for rejection</Label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={500}
                rows={3}
                autoFocus
                placeholder="e.g. Receipt is unreadable / not a business expense"
                className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-rose-500/40"
              />
              <p className="text-xs text-slate-500">
                The driver will see this reason.{" "}
                {deducted
                  ? `Rejecting refunds ${formatINR(expense.amount)} to their wallet.`
                  : "Rejection does not change their balance."}
              </p>
            </div>
          )}

          {error && <p className="text-sm text-rose-400">{error}</p>}

          <div className="flex gap-3">
            <Button
              variant="outline"
              className="flex-1 border-slate-600 bg-transparent text-slate-300"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              className={`flex-1 font-semibold text-white ${approve ? "bg-emerald-600 hover:bg-emerald-700" : "bg-rose-600 hover:bg-rose-700"}`}
              onClick={submit}
              disabled={submitting || !canSubmit}
            >
              {submitting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : approve ? (
                <Check className="mr-2 h-4 w-4" />
              ) : (
                <X className="mr-2 h-4 w-4" />
              )}
              {approve ? (excess > 0 ? "Approve excess" : "Approve") : "Reject"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
