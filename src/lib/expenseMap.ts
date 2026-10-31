/** One expense plotted on the expense map. Receipt bytes stay on the receipt URL. */
export interface MapExpense {
  id: string;
  amount: number;
  category: string;
  description: string;
  status: "pending" | "approved" | "rejected" | string;
  timestamp: string;
  location: { lat: number; lng: number };
  locationAccuracy: number | null;
  walletBalanceAfter: number | null;
  driverName: string;
  /** Driver document id. Blank when that driver record has been deleted. */
  driverId?: string;
  /**
   * False when the expense was saved without a receipt photo.
   * Missing means "try the receipt URL" so older rows still show a photo.
   */
  hasReceipt?: boolean;
  receiptUrl: string;
  odometerKm: number | null;
  previousOdometerKm: number | null;
  runKm: number | null;
  vehicleRegistration: string | null;
}

export interface MapExpenseGroup {
  key: string;
  position: { lat: number; lng: number };
  expenses: MapExpense[];
}

/** Green within 50m, amber to 150m, red beyond — the legend uses the same bands. */
export const GPS_ACCURACY_BANDS = [
  { color: "#10b981", label: "Within 50 m" },
  { color: "#f59e0b", label: "Within 150 m" },
  { color: "#ef4444", label: "Beyond 150 m" },
] as const;

export function accuracyColor(meters: number): string {
  if (meters <= 50) return GPS_ACCURACY_BANDS[0].color;
  if (meters <= 150) return GPS_ACCURACY_BANDS[1].color;
  return GPS_ACCURACY_BANDS[2].color;
}

export interface EmployeeMarkerColor {
  background: string;
  border: string;
}

/** Saturated enough that a white pin glyph stays readable, and far enough apart to tell people apart. */
export const EMPLOYEE_PALETTE: EmployeeMarkerColor[] = [
  { background: "#1d4ed8", border: "#1e3a8a" },
  { background: "#b91c1c", border: "#7f1d1d" },
  { background: "#15803d", border: "#14532d" },
  { background: "#b45309", border: "#78350f" },
  { background: "#6d28d9", border: "#4c1d95" },
  { background: "#be185d", border: "#831843" },
  { background: "#0e7490", border: "#164e63" },
  { background: "#c2410c", border: "#7c2d12" },
  { background: "#0f766e", border: "#134e4a" },
  { background: "#4338ca", border: "#312e81" },
  { background: "#4d7c0f", border: "#365314" },
  { background: "#a21caf", border: "#701a75" },
  { background: "#0369a1", border: "#0c4a6e" },
  { background: "#9f1239", border: "#4c0519" },
  { background: "#92400e", border: "#451a03" },
  { background: "#334155", border: "#0f172a" },
];

/** Stable identity: the driver id when we have one, otherwise the name. */
export function employeeKey(expense: { driverId?: string | null; driverName: string }): string {
  const id = expense.driverId?.trim();
  if (id) return `id:${id}`;
  return `name:${expense.driverName.trim().toLowerCase() || "unknown"}`;
}

function hashEmployeeKey(key: string): number {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * One color per employee. Pass every employee on the loaded map, not a filtered
 * subset: the assignment is stable for a given set, so filters do not repaint anyone.
 * A new colleague only borrows a color once the palette is full.
 */
export function assignEmployeeColors(keys: Iterable<string>): Map<string, EmployeeMarkerColor> {
  const unique = [...new Set(keys)].sort((a, b) => a.localeCompare(b));
  const used = new Set<number>();
  const colors = new Map<string, EmployeeMarkerColor>();
  for (const key of unique) {
    let index = hashEmployeeKey(key) % EMPLOYEE_PALETTE.length;
    if (used.has(index)) {
      for (let step = 1; step < EMPLOYEE_PALETTE.length; step++) {
        const next = (index + step) % EMPLOYEE_PALETTE.length;
        if (!used.has(next)) {
          index = next;
          break;
        }
      }
    }
    used.add(index);
    colors.set(key, EMPLOYEE_PALETTE[index]);
  }
  return colors;
}

/** About one metre. Readings from the same stop share a pin so none is hidden under another. */
export function locationKey(lat: number, lng: number): string {
  return `${lat.toFixed(5)},${lng.toFixed(5)}`;
}

export function hasMapLocation(expense: { location?: { lat?: number; lng?: number } | null }): boolean {
  const lat = expense.location?.lat;
  const lng = expense.location?.lng;
  return typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng)
    && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

/**
 * Every expense with a real location, newest first within a spot.
 * Expenses at the same coordinates share one group so the pin can list all of them.
 */
export function groupExpensesByLocation(expenses: MapExpense[]): MapExpenseGroup[] {
  const groups = new Map<string, MapExpenseGroup>();
  for (const expense of expenses) {
    if (!hasMapLocation(expense)) continue;
    const key = locationKey(expense.location.lat, expense.location.lng);
    const existing = groups.get(key);
    if (existing) {
      existing.expenses.push(expense);
      continue;
    }
    groups.set(key, {
      key,
      position: { lat: expense.location.lat, lng: expense.location.lng },
      expenses: [expense],
    });
  }
  return [...groups.values()];
}

function byNewest(a: MapExpense, b: MapExpense): number {
  return b.timestamp.localeCompare(a.timestamp) || b.id.localeCompare(a.id);
}

/** Pixel shift so several employees at one coordinate stay clickable. The GPS point itself does not move. */
const PIN_SPREAD_PX = 30;
const PIN_ROW_PX = 36;

export function pinAnchor(index: number, total: number): { anchorLeft: string; anchorTop: string } | undefined {
  if (total <= 1) return undefined;
  const columns = Math.min(total, 4);
  const col = index % columns;
  const row = Math.floor(index / columns);
  const dx = (col - (columns - 1) / 2) * PIN_SPREAD_PX;
  const dy = row * PIN_ROW_PX;
  return {
    anchorLeft: cssShift("-50%", -dx),
    anchorTop: dy === 0 ? "-100%" : cssShift("-100%", -dy),
  };
}

function cssShift(base: string, px: number): string {
  if (px === 0) return base;
  const sign = px > 0 ? "+" : "-";
  return `calc(${base} ${sign} ${Math.abs(px)}px)`;
}

export interface EmployeeMapMarker {
  key: string;
  employeeKey: string;
  position: { lat: number; lng: number };
  anchorLeft?: string;
  anchorTop?: string;
  /** This employee's expenses at the spot, newest first. */
  expenses: MapExpense[];
  /** Every expense at the spot, newest first, so a shared stop still lists the others. */
  locationExpenses: MapExpense[];
}

/**
 * One pin per employee per stop. People who spent at the same coordinates get
 * separate pins fanned around that point, and each pin still carries the full stop.
 */
export function markersByEmployee(expenses: MapExpense[]): EmployeeMapMarker[] {
  const markers: EmployeeMapMarker[] = [];
  for (const group of groupExpensesByLocation(expenses)) {
    const buckets = new Map<string, MapExpense[]>();
    for (const expense of group.expenses) {
      const key = employeeKey(expense);
      const list = buckets.get(key);
      if (list) list.push(expense);
      else buckets.set(key, [expense]);
    }
    const locationExpenses = [...group.expenses].sort(byNewest);
    const entries = [...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    entries.forEach(([key, list], index) => {
      const anchor = pinAnchor(index, entries.length);
      markers.push({
        key: `${group.key}|${key}`,
        employeeKey: key,
        position: group.position,
        anchorLeft: anchor?.anchorLeft,
        anchorTop: anchor?.anchorTop,
        expenses: [...list].sort(byNewest),
        locationExpenses,
      });
    });
  }
  return markers;
}

/** Calendar day of a timestamp in the viewer's timezone, as YYYY-MM-DD. */
export function localDateKey(timestamp: string): string {
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return "";
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

export type ExpenseSort =
  | "date-desc"
  | "date-asc"
  | "amount-desc"
  | "amount-asc"
  | "employee-asc"
  | "employee-desc"
  | "type-asc"
  | "type-desc";

export interface ExpenseMapQuery {
  from?: string;
  to?: string;
  category?: string;
  employeeKey?: string;
  sort?: ExpenseSort;
}

export interface EmployeeSummary {
  key: string;
  name: string;
  totalCount: number;
  totalAmount: number;
  /** Counts after the date and expense-type filters, before the employee filter. */
  visibleCount: number;
  visibleAmount: number;
  latestTimestamp: string;
  latestCategory: string;
}

export interface ExpenseMapView {
  expenses: MapExpense[];
  /** Date and type matches, before the employee filter. Card totals use this. */
  matching: MapExpense[];
  categories: string[];
  colors: Map<string, EmployeeMarkerColor>;
  summaries: EmployeeSummary[];
}

function matchesDateAndType(expense: MapExpense, from?: string, to?: string, category?: string): boolean {
  if (category && expense.category !== category) return false;
  if (from || to) {
    const day = localDateKey(expense.timestamp);
    if (!day) return false;
    if (from && day < from) return false;
    if (to && day > to) return false;
  }
  return true;
}

export function sortExpenses(expenses: MapExpense[], sort: ExpenseSort = "date-desc"): MapExpense[] {
  const copy = [...expenses];
  copy.sort((a, b) => {
    const newest = byNewest(a, b);
    switch (sort) {
      case "date-asc":
        return -newest;
      case "date-desc":
        return newest;
      case "amount-asc":
        return a.amount - b.amount || newest;
      case "amount-desc":
        return b.amount - a.amount || newest;
      case "employee-asc":
        return a.driverName.localeCompare(b.driverName, "en", { sensitivity: "base" }) || newest;
      case "employee-desc":
        return b.driverName.localeCompare(a.driverName, "en", { sensitivity: "base" }) || newest;
      case "type-asc":
        return a.category.localeCompare(b.category, "en", { sensitivity: "base" }) || newest;
      case "type-desc":
        return b.category.localeCompare(a.category, "en", { sensitivity: "base" }) || newest;
      default:
        return newest;
    }
  });
  return copy;
}

function summarizeEmployees(expenses: MapExpense[], matching: MapExpense[]): EmployeeSummary[] {
  const all = new Map<string, MapExpense[]>();
  for (const expense of expenses) {
    const key = employeeKey(expense);
    const list = all.get(key);
    if (list) list.push(expense);
    else all.set(key, [expense]);
  }
  const visible = new Map<string, MapExpense[]>();
  for (const expense of matching) {
    const key = employeeKey(expense);
    const list = visible.get(key);
    if (list) list.push(expense);
    else visible.set(key, [expense]);
  }
  const summaries: EmployeeSummary[] = [];
  for (const [key, list] of all) {
    const sorted = [...list].sort(byNewest);
    const shown = [...(visible.get(key) ?? [])].sort(byNewest);
    const latest = shown[0] ?? sorted[0];
    summaries.push({
      key,
      name: sorted[0].driverName,
      totalCount: sorted.length,
      totalAmount: sorted.reduce((sum, expense) => sum + expense.amount, 0),
      visibleCount: shown.length,
      visibleAmount: shown.reduce((sum, expense) => sum + expense.amount, 0),
      latestTimestamp: latest.timestamp,
      latestCategory: latest.category,
    });
  }
  summaries.sort(
    (a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }) || a.key.localeCompare(b.key)
  );
  return summaries;
}

/** Filtered, sorted expenses plus the employee roster. Colors always come from the full set. */
export function buildExpenseView(expenses: MapExpense[], query: ExpenseMapQuery = {}): ExpenseMapView {
  const categories = [...new Set(expenses.map((expense) => expense.category).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "en", { sensitivity: "base" })
  );
  const colors = assignEmployeeColors(expenses.map(employeeKey));
  const matching = expenses.filter((expense) => matchesDateAndType(expense, query.from, query.to, query.category));
  const chosen = query.employeeKey
    ? matching.filter((expense) => employeeKey(expense) === query.employeeKey)
    : matching;
  return {
    expenses: sortExpenses(chosen, query.sort ?? "date-desc"),
    matching,
    categories,
    colors,
    summaries: summarizeEmployees(expenses, matching),
  };
}
