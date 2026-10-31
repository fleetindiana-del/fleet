"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { formatDateTime, formatINR, formatKm } from "@/lib/incomeExpenseFormat";
import {
  buildExpenseView,
  employeeKey,
  groupExpensesByLocation,
  type ExpenseSort,
  type MapExpense,
} from "@/lib/expenseMap";

const ExpenseMapCore = dynamic(() => import("@/components/ExpenseMapCore"), {
  ssr: false,
  loading: () => <div className="h-full min-h-[280px] w-full animate-pulse rounded-xl bg-slate-900" />,
});

const STATUS_TONE: Record<string, string> = {
  pending: "text-amber-300",
  approved: "text-emerald-300",
  rejected: "text-rose-300",
};

const SORT_OPTIONS: { value: ExpenseSort; label: string }[] = [
  { value: "date-desc", label: "Date · newest first" },
  { value: "date-asc", label: "Date · oldest first" },
  { value: "amount-desc", label: "Amount · high to low" },
  { value: "amount-asc", label: "Amount · low to high" },
  { value: "employee-asc", label: "Employee · A to Z" },
  { value: "employee-desc", label: "Employee · Z to A" },
  { value: "type-asc", label: "Expense type · A to Z" },
  { value: "type-desc", label: "Expense type · Z to A" },
];

const fieldClass =
  "h-9 w-full max-w-full rounded-md border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 outline-none [color-scheme:dark] focus:border-indigo-500";

const buttonClass =
  "h-9 rounded-md border border-slate-700 bg-slate-800 px-3 text-sm text-slate-100 transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40";

export default function ExpenseMap({ expenses }: { expenses: MapExpense[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [category, setCategory] = useState("");
  const [selectedEmployee, setSelectedEmployee] = useState("");
  const [sort, setSort] = useState<ExpenseSort>("date-desc");

  const roster = useMemo(() => {
    const categories = new Set<string>();
    const employees = new Set<string>();
    for (const expense of expenses) {
      if (expense.category) categories.add(expense.category);
      employees.add(employeeKey(expense));
    }
    return { categories, employees };
  }, [expenses]);

  const activeCategory = category && roster.categories.has(category) ? category : "";
  const activeEmployee = selectedEmployee && roster.employees.has(selectedEmployee) ? selectedEmployee : "";

  const view = useMemo(
    () =>
      buildExpenseView(expenses, {
        from,
        to,
        category: activeCategory,
        employeeKey: activeEmployee,
        sort,
      }),
    [expenses, from, to, activeCategory, activeEmployee, sort]
  );

  const activeId = selectedId && view.expenses.some((expense) => expense.id === selectedId) ? selectedId : null;
  const placeCount = useMemo(() => groupExpensesByLocation(view.expenses).length, [view.expenses]);
  const datesActive = Boolean(from || to);
  const filtersActive = datesActive || Boolean(activeCategory || activeEmployee) || sort !== "date-desc";
  const rangeInverted = Boolean(from && to && from > to);

  function resetDates() {
    setFrom("");
    setTo("");
  }

  function resetFilters() {
    setFrom("");
    setTo("");
    setCategory("");
    setSelectedEmployee("");
    setSort("date-desc");
  }

  return (
    <div className="min-w-0 space-y-4">
      <section className="rounded-xl border border-slate-800 bg-slate-900 p-4" aria-label="Expense filters">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-[10rem_10rem_minmax(11rem,14rem)_auto] xl:items-end">
          <div className="min-w-0">
            <label htmlFor="expense-map-from" className="mb-1 block text-xs font-medium text-slate-400">
              From
            </label>
            <input
              id="expense-map-from"
              type="date"
              value={from}
              max={to || undefined}
              onChange={(event) => setFrom(event.target.value)}
              className={fieldClass}
            />
          </div>
          <div className="min-w-0">
            <label htmlFor="expense-map-to" className="mb-1 block text-xs font-medium text-slate-400">
              To
            </label>
            <input
              id="expense-map-to"
              type="date"
              value={to}
              min={from || undefined}
              onChange={(event) => setTo(event.target.value)}
              className={fieldClass}
            />
          </div>
          <div className="min-w-0 sm:col-span-2 xl:col-span-1">
            <label htmlFor="expense-map-type" className="mb-1 block text-xs font-medium text-slate-400">
              Expense type
            </label>
            <select
              id="expense-map-type"
              value={activeCategory}
              onChange={(event) => setCategory(event.target.value)}
              className={fieldClass}
            >
              <option value="">All types</option>
              {view.categories.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-2 sm:col-span-2 sm:flex-row xl:col-span-1 xl:items-end">
            <button type="button" onClick={resetDates} disabled={!datesActive} className={`${buttonClass} w-full sm:w-auto`}>
              Clear dates
            </button>
            <button type="button" onClick={resetFilters} disabled={!filtersActive} className={`${buttonClass} w-full sm:w-auto`}>
              Reset filters
            </button>
          </div>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          {rangeInverted
            ? "The start date is after the end date, so nothing matches. Clear the dates to see every expense."
            : "Set both dates to the same day for one date, or leave either open. Filters apply together."}
        </p>
      </section>

      <section aria-label="Employees" className="min-w-0">
        <div className="mb-2 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
          <h2 className="text-sm font-semibold text-white">Employees</h2>
          <p className="text-xs text-slate-500">Select a card to show only that person&apos;s expenses</p>
        </div>
        {view.summaries.length === 0 ? (
          <p className="rounded-xl border border-slate-800 bg-slate-900 px-4 py-6 text-sm text-slate-500">
            No employees have recorded an expense with a location yet.
          </p>
        ) : (
          <div className="flex max-w-full gap-3 overflow-x-auto pb-1">
            <button
              type="button"
              aria-pressed={activeEmployee === ""}
              onClick={() => setSelectedEmployee("")}
              className={`min-w-[180px] shrink-0 rounded-xl border px-3 py-3 text-left transition-colors ${
                activeEmployee === ""
                  ? "border-indigo-400 bg-slate-800"
                  : "border-slate-800 bg-slate-900 hover:bg-slate-800/80"
              }`}
            >
              <p className="text-sm font-medium text-white">All employees</p>
              <p className="mt-1 text-xs text-slate-400">
                {view.matching.length} expense{view.matching.length === 1 ? "" : "s"}
              </p>
              <p className="mt-0.5 text-[11px] text-slate-500">
                {view.summaries.length} employee{view.summaries.length === 1 ? "" : "s"}
              </p>
            </button>
            {view.summaries.map((summary) => {
              const color = view.colors.get(summary.key);
              const pressed = activeEmployee === summary.key;
              return (
                <button
                  key={summary.key}
                  type="button"
                  aria-pressed={pressed}
                  title={summary.name}
                  onClick={() => setSelectedEmployee(pressed ? "" : summary.key)}
                  className={`min-w-[220px] shrink-0 rounded-xl border border-l-4 px-3 py-3 text-left transition-colors ${
                    pressed ? "border-slate-600 bg-slate-800" : "border-slate-800 bg-slate-900 hover:bg-slate-800/80"
                  } ${summary.visibleCount === 0 && !pressed ? "opacity-60" : ""}`}
                  style={{ borderLeftColor: color?.background ?? "#64748b" }}
                >
                  <p className="flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: color?.background ?? "#64748b" }}
                    />
                    <span className="truncate text-sm font-medium text-white">{summary.name}</span>
                  </p>
                  {summary.visibleCount > 0 ? (
                    <>
                      <p className="mt-1 text-xs tabular-nums text-slate-300">
                        {summary.visibleCount} expense{summary.visibleCount === 1 ? "" : "s"} · {formatINR(summary.visibleAmount)}
                      </p>
                      <p className="mt-0.5 truncate text-[11px] text-slate-500">
                        Latest {summary.latestCategory} · {formatDateTime(summary.latestTimestamp)}
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="mt-1 text-xs text-slate-400">No expenses in this view</p>
                      <p className="mt-0.5 text-[11px] tabular-nums text-slate-500">
                        {summary.totalCount} recorded · {formatINR(summary.totalAmount)}
                      </p>
                    </>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </section>

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,340px)]">
        <div className="h-[min(70vh,420px)] min-w-0 sm:h-[520px] lg:h-[600px]">
          <ExpenseMapCore
            expenses={view.expenses}
            colors={view.colors}
            selectedId={activeId}
            onSelect={setSelectedId}
            emptyMessage={
              expenses.length === 0 ? "No expenses with a location yet." : "No expenses match these filters."
            }
          />
        </div>
        <div className="max-h-[70vh] min-w-0 overflow-y-auto rounded-xl border border-slate-800 bg-slate-900 lg:max-h-[600px]">
          <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 bg-slate-900 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white">
                {view.expenses.length} expense{view.expenses.length === 1 ? "" : "s"}
                {view.expenses.length !== expenses.length ? ` of ${expenses.length}` : ""}
              </p>
              <p className="text-xs text-slate-500">
                {placeCount} location{placeCount === 1 ? "" : "s"}
              </p>
            </div>
            <div className="w-full min-w-0 sm:w-48">
              <label htmlFor="expense-map-sort" className="sr-only">
                Sort expenses
              </label>
              <select
                id="expense-map-sort"
                value={sort}
                onChange={(event) => setSort(event.target.value as ExpenseSort)}
                aria-label="Sort expenses"
                className={fieldClass}
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {view.expenses.length === 0 ? (
            <div className="px-4 py-8">
              <p className="text-sm text-slate-500">
                {expenses.length === 0 ? "No expenses with a location yet." : "No expenses match these filters."}
              </p>
              {expenses.length > 0 && (
                <button type="button" onClick={resetFilters} className={`${buttonClass} mt-3`}>
                  Reset filters
                </button>
              )}
            </div>
          ) : (
            <ul>
              {view.expenses.map((expense) => {
                const active = expense.id === activeId;
                const color = view.colors.get(employeeKey(expense));
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
                        <div className="flex min-w-0 items-start gap-2">
                          <span
                            className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
                            style={{ backgroundColor: color?.background ?? "#64748b" }}
                          />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-slate-100">{expense.driverName}</p>
                            <p className="truncate text-xs text-slate-400">
                              {expense.category}
                              {expense.description ? ` · ${expense.description}` : ""}
                            </p>
                          </div>
                        </div>
                        <p className={`shrink-0 text-sm font-semibold tabular-nums text-slate-100 ${expense.status === "rejected" ? "line-through" : ""}`}>
                          {formatINR(expense.amount)}
                        </p>
                      </div>
                      <div className="mt-1 flex items-center justify-between gap-2 pl-4 text-[11px]">
                        <span className="text-slate-500">{formatDateTime(expense.timestamp)}</span>
                        <span className={STATUS_TONE[expense.status] ?? "text-slate-400"}>{expense.status}</span>
                      </div>
                      {expense.runKm != null && (
                        <p className="mt-1 pl-4 text-[11px] font-medium text-emerald-400">{formatKm(expense.runKm)} this run</p>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
