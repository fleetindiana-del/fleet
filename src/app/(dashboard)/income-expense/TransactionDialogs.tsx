"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EXPENSE_CATEGORIES } from "@/lib/expenseMath";
import { formatINR, formatKm } from "@/lib/incomeExpenseFormat";
import { api } from "./apiClient";

export interface TransactionTarget {
  kind: "advance" | "expense";
  id: string;
  driverName: string;
  amount: number;
  note: string;
  category: string;
  description: string;
  odometerKm?: number | null;
  previousOdometerKm?: number | null;
  vehicleRegistration?: string | null;
}

export function EditTransactionDialog({
  target,
  onClose,
  onDone,
}: {
  target: TransactionTarget;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [amount, setAmount] = useState(String(target.amount));
  const [note, setNote] = useState(target.note);
  const [category, setCategory] = useState(target.category || "Other");
  const [description, setDescription] = useState(target.description);
  const [odometer, setOdometer] = useState(target.odometerKm != null ? String(target.odometerKm) : "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const parsed = Number(amount);
  const validAmount = amount.trim() !== "" && Number.isFinite(parsed) && parsed > 0;
  const odometerNum = Number(odometer);
  const fuel = target.kind === "expense" && category === "Fuel";
  const runPreview =
    fuel && target.previousOdometerKm != null && Number.isFinite(odometerNum) && odometerNum > target.previousOdometerKm
      ? Math.round((odometerNum - target.previousOdometerKm) * 10) / 10
      : null;

  async function submit() {
    if (!validAmount) return setError("Enter a valid positive amount.");
    if (fuel && (!odometer.trim() || !Number.isFinite(odometerNum) || odometerNum < 0)) {
      return setError("Enter the odometer reading in kilometers.");
    }
    setSubmitting(true);
    setError("");
    try {
      const res =
        target.kind === "advance"
          ? await api<{ balance: number }>(`/api/income-expense/ledger/${target.id}`, {
              method: "PATCH",
              body: JSON.stringify({ amount: parsed, note: note.trim() }),
            })
          : await api<{ balance: number }>(`/api/income-expense/expenses/${target.id}`, {
              method: "PATCH",
              body: JSON.stringify({
                amount: parsed,
                category,
                description: description.trim(),
                ...(fuel ? { odometerKm: odometerNum } : {}),
              }),
            });
      onDone(`Updated ${formatINR(parsed)} for ${target.driverName}. Balance now ${formatINR(res.balance)}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the change.");
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !submitting && onClose()}>
      <DialogContent className="border-slate-800 bg-slate-900 text-slate-100 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit {target.kind === "advance" ? "money added" : "expense"}</DialogTitle>
          <DialogDescription className="text-slate-400">
            {target.driverName}. The balance is rebuilt from the corrected amount.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-slate-300">Amount (₹)</Label>
            <Input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              className="border-slate-700 bg-slate-950 text-slate-100"
            />
          </div>
          {target.kind === "expense" ? (
            <>
              <div className="space-y-1.5">
                <Label className="text-slate-300">Type</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger className="w-full border-slate-700 bg-slate-950 text-slate-200">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="border-slate-800 bg-slate-900 text-slate-200">
                    {EXPENSE_CATEGORIES.map((item) => (
                      <SelectItem key={item} value={item}>
                        {item}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-slate-300">Details</Label>
                <Input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="border-slate-700 bg-slate-950 text-slate-100"
                />
              </div>
              {fuel && (
                <div className="space-y-1.5">
                  <Label className="text-slate-300">Odometer (km)</Label>
                  <Input
                    value={odometer}
                    inputMode="decimal"
                    onChange={(e) => setOdometer(e.target.value.replace(/[^\d.]/g, ""))}
                    className="border-slate-700 bg-slate-950 text-slate-100"
                  />
                  <p className="text-xs text-slate-500">
                    {target.vehicleRegistration ? `${target.vehicleRegistration}. ` : ""}
                    {target.previousOdometerKm != null ? `Previous reading ${formatKm(target.previousOdometerKm)}. ` : ""}
                    {runPreview != null ? `This run ${formatKm(runPreview)}.` : "The run is the kilometers since the previous reading."}
                  </p>
                </div>
              )}
            </>
          ) : (
            <div className="space-y-1.5">
              <Label className="text-slate-300">Note</Label>
              <Input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="border-slate-700 bg-slate-950 text-slate-100"
              />
            </div>
          )}
          {error && <p className="text-sm text-rose-300">{error}</p>}
          <div className="flex gap-3 pt-1">
            <Button
              type="button"
              variant="outline"
              className="flex-1 border-slate-600 bg-transparent text-slate-200 hover:bg-slate-800 hover:text-white"
              disabled={submitting}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="flex-1 bg-indigo-600 font-semibold text-white hover:bg-indigo-700"
              disabled={submitting}
              onClick={submit}
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Save
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteTransactionDialog({
  target,
  onClose,
  onDone,
}: {
  target: TransactionTarget;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setSubmitting(true);
    setError("");
    try {
      const url =
        target.kind === "advance"
          ? `/api/income-expense/ledger/${target.id}`
          : `/api/income-expense/expenses/${target.id}`;
      const res = await api<{ balance: number }>(url, { method: "DELETE" });
      onDone(`Removed ${formatINR(target.amount)} for ${target.driverName}. Balance now ${formatINR(res.balance)}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete it.");
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !submitting && onClose()}>
      <DialogContent className="border-slate-800 bg-slate-900 text-slate-100 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete this row?</DialogTitle>
          <DialogDescription className="text-slate-400">
            {formatINR(target.amount)} for {target.driverName} will be removed and their balance rebuilt.
          </DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-rose-300">{error}</p>}
        <div className="flex gap-3 pt-1">
          <Button
            type="button"
            variant="outline"
            className="flex-1 border-slate-600 bg-transparent text-slate-200 hover:bg-slate-800 hover:text-white"
            disabled={submitting}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button type="button" variant="destructive" className="flex-1" disabled={submitting} onClick={submit}>
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Delete
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
