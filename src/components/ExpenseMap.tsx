"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { formatDateTime, formatINR, formatKm } from "@/lib/incomeExpenseFormat";
import { groupExpensesByLocation, type MapExpense } from "@/lib/expenseMap";

const ExpenseMapCore = dynamic(() => import("@/components/ExpenseMapCore"), {
  ssr: false,
  loading: () => <div className="h-[600px] w-full animate-pulse rounded-xl bg-slate-900" />,
});

const STATUS_TONE: Record<string, string> = {
  pending: "text-amber-300",
  approved: "text-emerald-300",
  rejected: "text-rose-300",
};

export default function ExpenseMap({ expenses }: { expenses: MapExpense[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const groups = useMemo(() => groupExpensesByLocation(expenses), [expenses]);
  const placeCount = groups.length;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <ExpenseMapCore expenses={expenses} selectedId={selectedId} onSelect={setSelectedId} />
      <div className="max-h-[600px] overflow-y-auto rounded-xl border border-slate-800 bg-slate-900">
        <div className="sticky top-0 border-b border-slate-800 bg-slate-900 px-4 py-3">
          <p className="text-sm font-semibold text-white">
            {expenses.length} expense{expenses.length === 1 ? "" : "s"}
          </p>
          <p className="text-xs text-slate-500">
            {placeCount} location{placeCount === 1 ? "" : "s"}
          </p>
        </div>
        {expenses.length === 0 ? (
          <p className="px-4 py-8 text-sm text-slate-500">No expenses with a location yet.</p>
        ) : (
          <ul>
            {expenses.map((expense) => {
              const active = expense.id === selectedId;
              return (
                <li key={expense.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(expense.id)}
                    className={`w-full border-b border-slate-800 px-4 py-3 text-left hover:bg-slate-800/60 ${
                      active ? "bg-slate-800" : ""
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-100">{expense.driverName}</p>
                        <p className="truncate text-xs text-slate-400">
                          {expense.category}
                          {expense.description ? ` · ${expense.description}` : ""}
                        </p>
                      </div>
                      <p className={`shrink-0 text-sm font-semibold tabular-nums text-slate-100 ${expense.status === "rejected" ? "line-through" : ""}`}>
                        {formatINR(expense.amount)}
                      </p>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2 text-[11px]">
                      <span className="text-slate-500">{formatDateTime(expense.timestamp)}</span>
                      <span className={STATUS_TONE[expense.status] ?? "text-slate-400"}>{expense.status}</span>
                    </div>
                    {expense.runKm != null && (
                      <p className="mt-1 text-[11px] font-medium text-emerald-400">{formatKm(expense.runKm)} this run</p>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
