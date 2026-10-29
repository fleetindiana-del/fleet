/**
 * Expense Type Master rules. Pure (no database) so the driver forms, the API
 * and the tests share one definition of what each type asks for.
 *
 * `code` is what an Expense stores in `category`; it never changes after the
 * type is created, so renaming a type keeps every old expense attached to it.
 * Only the built-in Fuel type tracks the odometer: the ledger's run-kilometre
 * bookkeeping is keyed on it.
 */

export type VehicleMode = "none" | "optional" | "required";

export interface ExpenseTypeRules {
  code: string;
  name: string;
  requiresReceipt: boolean;
  requiresDescription: boolean;
  vehicle: VehicleMode;
  tracksOdometer: boolean;
}

export interface ExpenseTypeDTO extends ExpenseTypeRules {
  id: string;
  active: boolean;
  isSystem: boolean;
  sortOrder: number;
}

export const FUEL_CODE = "Fuel";

export const DEFAULT_EXPENSE_TYPES: (ExpenseTypeRules & { sortOrder: number })[] = [
  { code: "Fuel", name: "Fuel", requiresReceipt: false, requiresDescription: false, vehicle: "required", tracksOdometer: true, sortOrder: 10 },
  { code: "Food", name: "Food", requiresReceipt: true, requiresDescription: false, vehicle: "none", tracksOdometer: false, sortOrder: 20 },
  { code: "Toll", name: "Toll", requiresReceipt: true, requiresDescription: false, vehicle: "optional", tracksOdometer: false, sortOrder: 30 },
  { code: "Parking", name: "Parking", requiresReceipt: true, requiresDescription: false, vehicle: "optional", tracksOdometer: false, sortOrder: 40 },
  { code: "Maintenance", name: "Maintenance", requiresReceipt: true, requiresDescription: true, vehicle: "required", tracksOdometer: false, sortOrder: 50 },
  { code: "Other", name: "Other", requiresReceipt: true, requiresDescription: true, vehicle: "optional", tracksOdometer: false, sortOrder: 60 },
];

export const SYSTEM_CODES = DEFAULT_EXPENSE_TYPES.map((t) => t.code);

const VEHICLE_MODES: VehicleMode[] = ["none", "optional", "required"];

export function isVehicleMode(value: unknown): value is VehicleMode {
  return typeof value === "string" && (VEHICLE_MODES as string[]).includes(value);
}

/** A display name from untrusted input: 2-40 visible characters. */
export function cleanTypeName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.replace(/\s+/g, " ").trim();
  if (name.length < 2 || name.length > 40) return null;
  if (!/^[\p{L}\p{N}][\p{L}\p{N} &/().,'-]*$/u.test(name)) return null;
  return name;
}

/** The stored code for a new type: its name with spaces collapsed. */
export function codeForName(name: string): string {
  return name.replace(/\s+/g, " ").trim();
}

export interface DraftExpense {
  amount: number | null;
  hasReceipt: boolean;
  description: string;
  vehicleId: string;
  odometerKm: number | null;
  lastOdometerKm?: number | null;
}

/**
 * The first thing a driver still has to fill in for this type, or null when
 * the draft can be sent. Mirrors the server checks so the form can say it
 * before a round trip.
 */
export function missingField(type: ExpenseTypeRules, draft: DraftExpense): string | null {
  if (draft.amount == null || !Number.isFinite(draft.amount) || draft.amount <= 0) return "Enter the amount you spent.";
  if (type.vehicle === "required" && !draft.vehicleId) return "Choose the vehicle.";
  if (type.tracksOdometer) {
    if (draft.odometerKm == null || !Number.isFinite(draft.odometerKm) || draft.odometerKm < 0) {
      return "Enter the odometer reading in kilometers.";
    }
    if (draft.lastOdometerKm != null && draft.odometerKm <= draft.lastOdometerKm) {
      return `Odometer must be higher than the last reading (${draft.lastOdometerKm} km).`;
    }
  }
  if (type.requiresReceipt && !draft.hasReceipt) return "Take a photo of the bill.";
  if (type.requiresDescription && !draft.description.trim()) return "Say what this expense was for.";
  return null;
}
