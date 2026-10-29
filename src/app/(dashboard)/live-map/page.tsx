"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2 } from "lucide-react";
import ExpenseMap from "@/components/ExpenseMap";
import type { MapExpense } from "@/lib/expenseMap";

export default function LiveMapPage() {
  const [expenses, setExpenses] = useState<MapExpense[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchExpenses = useCallback(async (quiet = false) => {
    if (!quiet) setIsLoading(true);
    setError("");
    try {
      const res = await fetch("/api/live-map", { cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error || "Could not load expenses for the map.");
        return;
      }
      setExpenses(Array.isArray(body?.expenses) ? body.expenses : []);
      setTotal(typeof body?.total === "number" ? body.total : 0);
    } catch {
      setError("Could not load expenses for the map.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchExpenses();
    // New expenses from the phone appear on the map without a manual Refresh.
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") fetchExpenses(true);
    }, 15_000);
    return () => window.clearInterval(id);
  }, [fetchExpenses]);

  const truncated = total > expenses.length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="mb-2 text-3xl font-bold tracking-tight text-white">Expense Map</h1>
          <p className="text-slate-400">
            Every expense recorded with a location.
            {truncated ? ` Showing the latest ${expenses.length} of ${total}.` : ""}
          </p>
        </div>
        <button
          onClick={() => fetchExpenses()}
          className="flex items-center gap-2 rounded-md border border-slate-700 bg-slate-800 px-4 py-2 text-slate-100 transition-colors hover:bg-slate-700"
        >
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Refresh
        </button>
      </div>

      {error && (
        <p className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</p>
      )}

      {isLoading && expenses.length === 0 ? (
        <div className="flex h-[600px] w-full items-center justify-center rounded-xl border border-slate-800 bg-slate-900">
          <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
        </div>
      ) : (
        <ExpenseMap expenses={expenses} />
      )}
    </div>
  );
}
