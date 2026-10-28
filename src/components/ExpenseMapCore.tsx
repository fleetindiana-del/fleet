"use client";

import { Fragment, useMemo } from "react";
import { AdvancedMarker, InfoWindow, Pin } from "@vis.gl/react-google-maps";
import MapShell from "@/components/maps/MapShell";
import { Circle, FitBounds, PanTo } from "@/components/maps/overlays";
import { DEFAULT_CENTER, DEFAULT_ZOOM } from "@/components/maps/config";
import { formatDateTime, formatINR, formatKm } from "@/lib/incomeExpenseFormat";
import { groupExpensesByLocation, type MapExpense } from "@/lib/expenseMap";

/** Green under 50m, amber to 150m, red beyond — same bands as the popup badge. */
function accuracyColor(meters: number) {
  if (meters <= 50) return "#10b981";
  if (meters <= 150) return "#f59e0b";
  return "#ef4444";
}

function ExpenseDetails({ expense, highlight }: { expense: MapExpense; highlight: boolean }) {
  const accuracy = expense.locationAccuracy;
  return (
    <div className={`space-y-2 rounded-md p-2 ${highlight ? "bg-amber-50" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-bold text-slate-900">{expense.driverName}</h3>
        <span className="rounded-sm bg-slate-200 px-2 py-0.5 text-[10px] font-bold tracking-wider text-slate-600 uppercase">
          {expense.category}
        </span>
      </div>
      <div className={`text-2xl font-black text-amber-600 ${expense.status === "rejected" ? "line-through decoration-slate-400" : ""}`}>
        {formatINR(expense.amount)}
      </div>
      {expense.description && <p className="text-sm text-slate-700">{expense.description}</p>}
      <div className="text-xs font-medium text-slate-500">{formatDateTime(expense.timestamp)}</div>
      <div className="text-xs font-semibold text-slate-600 capitalize">{expense.status}</div>
      {expense.runKm != null && (
        <div className="text-xs font-semibold text-emerald-700">
          {formatKm(expense.runKm)} this run
          {expense.vehicleRegistration ? ` · ${expense.vehicleRegistration}` : ""}
          {expense.previousOdometerKm != null && expense.odometerKm != null
            ? ` · ${formatKm(expense.previousOdometerKm)} → ${formatKm(expense.odometerKm)}`
            : ""}
        </div>
      )}
      {expense.runKm == null && expense.odometerKm != null && (
        <div className="text-xs text-slate-600">Odometer {formatKm(expense.odometerKm)}</div>
      )}
      {accuracy != null && accuracy > 0 && (
        <div
          className={`rounded-md px-2 py-1 text-xs font-semibold ${
            accuracy <= 50
              ? "bg-emerald-100 text-emerald-700"
              : accuracy <= 150
                ? "bg-amber-100 text-amber-700"
                : "bg-rose-100 text-rose-700"
          }`}
        >
          GPS accuracy: ±{Math.round(accuracy)}m
        </div>
      )}
      {expense.walletBalanceAfter != null && (
        <div className="rounded-md border border-slate-200 bg-slate-100 p-2 text-xs">
          Balance after
          <br />
          <strong className="text-sm text-indigo-600">{formatINR(expense.walletBalanceAfter)}</strong>
        </div>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={expense.receiptUrl}
        alt={`Receipt for ${formatINR(expense.amount)}`}
        className="h-28 w-full rounded-md border border-slate-200 object-contain"
        onError={(event) => {
          event.currentTarget.style.display = "none";
        }}
      />
    </div>
  );
}

export default function ExpenseMapCore({
  expenses,
  selectedId,
  onSelect,
}: {
  expenses: MapExpense[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const groups = useMemo(() => groupExpensesByLocation(expenses), [expenses]);
  const points = useMemo(() => groups.map((group) => group.position), [groups]);
  const fitKey = expenses.length ? `${expenses.length}:${expenses[0].id}:${expenses[expenses.length - 1].id}` : "empty";

  const selectedGroup = groups.find((group) => group.expenses.some((expense) => expense.id === selectedId)) ?? null;
  const focus = selectedId ? selectedGroup?.position ?? null : null;

  if (groups.length === 0) {
    return (
      <div className="flex h-[600px] w-full items-center justify-center rounded-xl border border-slate-800 bg-slate-900">
        <p className="text-lg text-slate-500">No expenses with a location yet.</p>
      </div>
    );
  }

  return (
    <div className="relative z-0 h-[600px] w-full overflow-hidden rounded-xl border border-slate-800 shadow-2xl">
      <MapShell defaultCenter={DEFAULT_CENTER} defaultZoom={DEFAULT_ZOOM} className="h-full w-full">
        <FitBounds points={points} enabled fitOnceKey={fitKey} />
        {focus && <PanTo point={focus} />}
        {groups.map((group) => {
          const latest = group.expenses[0];
          const accuracy = latest.locationAccuracy ?? 0;
          const color = accuracyColor(accuracy);
          const count = group.expenses.length;
          return (
            <Fragment key={group.key}>
              {accuracy > 0 && (
                <Circle
                  center={group.position}
                  radius={accuracy}
                  strokeColor={color}
                  strokeWeight={2}
                  strokeOpacity={0.9}
                  fillColor={color}
                  fillOpacity={0.1}
                />
              )}
              <AdvancedMarker
                position={group.position}
                title={count > 1 ? `${count} expenses` : latest.driverName}
                onClick={() => onSelect(latest.id)}
              >
                <Pin
                  background="#f59e0b"
                  borderColor="#b45309"
                  glyphColor="#fff"
                  glyph={count > 1 ? (count > 9 ? "9+" : String(count)) : undefined}
                />
              </AdvancedMarker>
              {selectedGroup?.key === group.key && (
                <InfoWindow position={group.position} onCloseClick={() => onSelect(null)}>
                  <div className="max-h-80 min-w-[220px] space-y-3 overflow-y-auto font-sans">
                    {count > 1 && (
                      <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                        {count} expenses at this location
                      </p>
                    )}
                    {group.expenses.map((expense) => (
                      <ExpenseDetails key={expense.id} expense={expense} highlight={expense.id === selectedId} />
                    ))}
                  </div>
                </InfoWindow>
              )}
            </Fragment>
          );
        })}
      </MapShell>
    </div>
  );
}
