"use client";

import { Fragment, useMemo } from "react";
import MapShell from "@/components/maps/MapShell";
import { Circle, DivMarker, FitBounds, MapPopup, PanTo } from "@/components/maps/overlays";
import { DEFAULT_CENTER, DEFAULT_ZOOM } from "@/components/maps/config";
import { formatINR, formatKm } from "@/lib/incomeExpenseFormat";
import {
  accuracyColor,
  EMPLOYEE_PALETTE,
  employeeKey,
  groupExpensesByLocation,
  markersByEmployee,
  type EmployeeMapMarker,
  type EmployeeMarkerColor,
  type MapExpense,
} from "@/lib/expenseMap";

function formatMapDate(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function formatMapTime(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

const PIN_W = 28;
const PIN_H = 40;

/** Signed pixel added to a Google-style anchor such as `calc(-50% + 15px)`. */
function cssExtraPx(value: string | undefined): number {
  if (!value) return 0;
  const match = value.match(/([+-])\s*([\d.]+)px/);
  if (!match) return 0;
  return Number(match[2]) * (match[1] === "-" ? -1 : 1);
}

function ExpensePin({
  background,
  border,
  glyph,
}: {
  background: string;
  border: string;
  glyph?: string;
}) {
  return (
    <svg width={PIN_W} height={PIN_H} viewBox="0 0 28 40" aria-hidden>
      <path
        d="M14 38.5C14 38.5 2 23.2 2 14.2 2 7.4 7.4 2 14 2s12 5.4 12 12.2C26 23.2 14 38.5 14 38.5z"
        fill={background}
        stroke={border}
        strokeWidth={1.4}
      />
      {glyph ? (
        <text
          x="14"
          y="17.5"
          textAnchor="middle"
          fill="#fff"
          fontSize="11"
          fontWeight="700"
          fontFamily="system-ui, sans-serif"
        >
          {glyph}
        </text>
      ) : (
        <circle cx="14" cy="14" r="4.2" fill="#fff" />
      )}
    </svg>
  );
}

function newest(expenses: MapExpense[]): MapExpense {
  return expenses.reduce((best, expense) =>
    expense.timestamp > best.timestamp || (expense.timestamp === best.timestamp && expense.id > best.id)
      ? expense
      : best
  );
}

function ExpenseDetails({
  expense,
  highlight,
  color,
  showName,
}: {
  expense: MapExpense;
  highlight: boolean;
  color: EmployeeMarkerColor;
  showName: boolean;
}) {
  const accuracy = expense.locationAccuracy;
  const showReceipt = expense.hasReceipt !== false && !!expense.receiptUrl;
  return (
    <div
      className={`space-y-2 rounded-md border-l-4 p-2 ${highlight ? "bg-amber-50" : ""}`}
      style={{ borderColor: color.background }}
    >
      {showName && (
        <div className="flex items-start justify-between gap-3">
          <h3 className="flex items-center gap-2 font-bold text-slate-900">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color.background }} />
            {expense.driverName}
          </h3>
        </div>
      )}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold tracking-wide text-slate-400 uppercase">Expense type</p>
          <p className="text-sm font-semibold text-slate-800">{expense.category}</p>
        </div>
        <div className={`text-right text-2xl font-black text-amber-600 ${expense.status === "rejected" ? "line-through decoration-slate-400" : ""}`}>
          {formatINR(expense.amount)}
        </div>
      </div>
      {expense.description && <p className="text-sm text-slate-700">{expense.description}</p>}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <p className="font-semibold tracking-wide text-slate-400 uppercase">Date</p>
          <p className="font-medium text-slate-700">{formatMapDate(expense.timestamp)}</p>
        </div>
        <div>
          <p className="font-semibold tracking-wide text-slate-400 uppercase">Time</p>
          <p className="font-medium text-slate-700">{formatMapTime(expense.timestamp)}</p>
        </div>
      </div>
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
      {showReceipt && (
        <div>
          <p className="text-[10px] font-semibold tracking-wide text-slate-400 uppercase">Receipt</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={expense.receiptUrl}
            alt={`Receipt for ${formatINR(expense.amount)}`}
            className="mt-1 h-28 w-full rounded-md border border-slate-200 object-contain"
            onError={(event) => {
              const box = event.currentTarget.parentElement;
              if (box) box.style.display = "none";
            }}
          />
        </div>
      )}
    </div>
  );
}

function markerSections(marker: EmployeeMapMarker, colors: ReadonlyMap<string, EmployeeMarkerColor>) {
  const buckets = new Map<string, MapExpense[]>();
  for (const expense of marker.locationExpenses) {
    const key = employeeKey(expense);
    const list = buckets.get(key);
    if (list) list.push(expense);
    else buckets.set(key, [expense]);
  }
  const keys = [...buckets.keys()].sort((a, b) => {
    if (a === marker.employeeKey) return -1;
    if (b === marker.employeeKey) return 1;
    return buckets.get(a)![0].driverName.localeCompare(buckets.get(b)![0].driverName, "en", { sensitivity: "base" });
  });
  return keys.map((key) => {
    const expenses = buckets.get(key)!;
    return {
      key,
      name: expenses[0].driverName,
      expenses,
      color: colors.get(key) ?? EMPLOYEE_PALETTE[0],
    };
  });
}

export default function ExpenseMapCore({
  expenses,
  colors,
  selectedId,
  onSelect,
  emptyMessage = "No expenses with a location yet.",
}: {
  expenses: MapExpense[];
  colors: ReadonlyMap<string, EmployeeMarkerColor>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  emptyMessage?: string;
}) {
  const groups = useMemo(() => groupExpensesByLocation(expenses), [expenses]);
  const markers = useMemo(() => markersByEmployee(expenses), [expenses]);
  const points = useMemo(() => groups.map((group) => group.position), [groups]);
  const fitKey = useMemo(() => expenses.map((expense) => expense.id).sort().join(","), [expenses]);

  const selectedMarker = markers.find((marker) => marker.expenses.some((expense) => expense.id === selectedId)) ?? null;
  const focus = selectedMarker?.position ?? null;

  if (groups.length === 0) {
    return (
      <div className="flex h-full min-h-[280px] w-full items-center justify-center rounded-xl border border-slate-800 bg-slate-900">
        <p className="px-6 text-center text-lg text-slate-500">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="relative z-0 h-full min-h-[280px] w-full overflow-hidden rounded-xl border border-slate-800 shadow-2xl">
      <MapShell defaultCenter={DEFAULT_CENTER} defaultZoom={DEFAULT_ZOOM} className="h-full w-full">
        <FitBounds points={points} enabled fitOnceKey={fitKey} />
        {focus && <PanTo point={focus} />}
        {groups.map((group) => {
          const latest = newest(group.expenses);
          const accuracy = latest.locationAccuracy ?? 0;
          const color = accuracyColor(accuracy);
          if (accuracy <= 0) return null;
          return (
            <Circle
              key={group.key}
              center={group.position}
              radius={accuracy}
              strokeColor={color}
              strokeWeight={2}
              strokeOpacity={0.9}
              fillColor={color}
              fillOpacity={0.1}
            />
          );
        })}
        {markers.map((marker, index) => {
          const latest = marker.expenses[0];
          const color = colors.get(marker.employeeKey) ?? EMPLOYEE_PALETTE[0];
          const count = marker.expenses.length;
          const selected = marker.expenses.some((expense) => expense.id === selectedId);
          const shared = marker.locationExpenses.length > count;
          const title = shared
            ? `${latest.driverName}: ${count} here, ${marker.locationExpenses.length} at this place`
            : count > 1
              ? `${latest.driverName}: ${count} expenses`
              : `${latest.driverName}: ${latest.category}`;
          const shiftX = cssExtraPx(marker.anchorLeft);
          const shiftY = cssExtraPx(marker.anchorTop);
          return (
            <Fragment key={marker.key}>
              <DivMarker
                position={marker.position}
                width={PIN_W}
                height={PIN_H}
                anchorX={PIN_W / 2 - shiftX}
                anchorY={PIN_H - shiftY}
                zIndex={selected ? 800 : index + 1}
                title={title}
                onClick={() => onSelect(latest.id)}
              >
                <ExpensePin
                  background={color.background}
                  border={color.border}
                  glyph={count > 1 ? (count > 9 ? "9+" : String(count)) : undefined}
                />
              </DivMarker>
              <MapPopup
                position={marker.position}
                open={selected}
                onClose={() => onSelect(null)}
                offsetX={shiftX}
                offsetY={-(PIN_H + 8 - shiftY)}
              >
                <MarkerPopup marker={marker} colors={colors} selectedId={selectedId} />
              </MapPopup>
            </Fragment>
          );
        })}
      </MapShell>
    </div>
  );
}

function MarkerPopup({
  marker,
  colors,
  selectedId,
}: {
  marker: EmployeeMapMarker;
  colors: ReadonlyMap<string, EmployeeMarkerColor>;
  selectedId: string | null;
}) {
  const sections = markerSections(marker, colors);
  const [primary, ...rest] = sections;
  if (!primary) return null;
  const shared = rest.length > 0;
  return (
    <div className="max-h-[70vh] w-[min(280px,calc(100vw-3rem))] space-y-3 overflow-y-auto font-sans">
      {shared && (
        <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
          {sections.length} employees at this location
        </p>
      )}
      <PopupSection section={primary} selectedId={selectedId} showHeader={shared} />
      {rest.length > 0 && (
        <div className="space-y-3 border-t border-slate-200 pt-3">
          <p className="text-[10px] font-semibold tracking-wide text-slate-400 uppercase">Also at this location</p>
          {rest.map((section) => (
            <PopupSection key={section.key} section={section} selectedId={selectedId} showHeader />
          ))}
        </div>
      )}
    </div>
  );
}

function PopupSection({
  section,
  selectedId,
  showHeader,
}: {
  section: { key: string; name: string; expenses: MapExpense[]; color: EmployeeMarkerColor };
  selectedId: string | null;
  showHeader: boolean;
}) {
  return (
    <section className="space-y-2">
      {showHeader && (
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: section.color.background }} />
          <h3 className="text-sm font-bold text-slate-900">{section.name}</h3>
        </div>
      )}
      {section.expenses.map((expense) => (
        <ExpenseDetails
          key={expense.id}
          expense={expense}
          highlight={expense.id === selectedId}
          color={section.color}
          showName={!showHeader}
        />
      ))}
    </section>
  );
}
