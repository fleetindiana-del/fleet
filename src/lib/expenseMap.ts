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
