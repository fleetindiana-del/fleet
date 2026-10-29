/**
 * Expense Type Master service. A company gets the built-in types the first
 * time its types are read, so drivers never see an empty picker.
 *
 * Callers must `await connectToDatabase()` first.
 */
import mongoose from "mongoose";
import ExpenseType from "@/models/ExpenseType";
import Expense from "@/models/Expense";
import {
  DEFAULT_EXPENSE_TYPES,
  FUEL_CODE,
  cleanTypeName,
  codeForName,
  isVehicleMode,
  type ExpenseTypeDTO,
} from "@/lib/expenseTypeRules";

/* eslint-disable @typescript-eslint/no-explicit-any */
const TypeM = ExpenseType as mongoose.Model<any>;
const ExpenseM = Expense as mongoose.Model<any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

export class ExpenseTypeError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ExpenseTypeError";
  }
}

function toObjectId(id: unknown): mongoose.Types.ObjectId {
  if (id instanceof mongoose.Types.ObjectId) return id;
  if (typeof id !== "string" || !mongoose.Types.ObjectId.isValid(id)) {
    throw new ExpenseTypeError(400, "Invalid id.");
  }
  return new mongoose.Types.ObjectId(id);
}

interface TypeRow {
  _id: unknown;
  code: string;
  name: string;
  requiresReceipt?: boolean;
  requiresDescription?: boolean;
  vehicle?: string;
  tracksOdometer?: boolean;
  active?: boolean;
  isSystem?: boolean;
  sortOrder?: number;
}

export function toExpenseTypeDTO(t: TypeRow): ExpenseTypeDTO {
  return {
    id: String(t._id),
    code: t.code,
    name: t.name,
    requiresReceipt: t.requiresReceipt !== false,
    requiresDescription: !!t.requiresDescription,
    vehicle: isVehicleMode(t.vehicle) ? t.vehicle : "none",
    tracksOdometer: t.code === FUEL_CODE && !!t.tracksOdometer,
    active: t.active !== false,
    isSystem: !!t.isSystem,
    sortOrder: typeof t.sortOrder === "number" ? t.sortOrder : 100,
  };
}

/** Insert any built-in type the company does not have yet. Never overwrites edits. */
export async function ensureExpenseTypes(companyId: unknown): Promise<void> {
  const cid = toObjectId(companyId);
  const have = await TypeM.find({ companyId: cid, code: { $in: DEFAULT_EXPENSE_TYPES.map((t) => t.code) } })
    .select("code")
    .lean();
  const existing = new Set(have.map((t: { code: string }) => t.code));
  const missing = DEFAULT_EXPENSE_TYPES.filter((t) => !existing.has(t.code));
  if (missing.length === 0) return;
  await TypeM.bulkWrite(
    missing.map((t) => ({
      updateOne: {
        filter: { companyId: cid, code: t.code },
        update: { $setOnInsert: { ...t, companyId: cid, active: true, isSystem: true } },
        upsert: true,
      },
    })),
    { ordered: false }
  );
}

export async function listExpenseTypes(companyId: unknown, opts: { activeOnly?: boolean } = {}): Promise<ExpenseTypeDTO[]> {
  const cid = toObjectId(companyId);
  await ensureExpenseTypes(cid);
  const rows = await TypeM.find({ companyId: cid, ...(opts.activeOnly ? { active: { $ne: false } } : {}) })
    .sort({ sortOrder: 1, name: 1 })
    .lean();
  return rows.map(toExpenseTypeDTO);
}

/** The type an expense in this company is filed under, or null if it does not exist. */
export async function findExpenseType(
  companyId: unknown,
  code: string,
  session?: mongoose.ClientSession
): Promise<ExpenseTypeDTO | null> {
  const cid = toObjectId(companyId);
  let row = await TypeM.findOne({ companyId: cid, code }).session(session ?? null).lean();
  if (!row && DEFAULT_EXPENSE_TYPES.some((t) => t.code === code)) {
    await ensureExpenseTypes(cid);
    row = await TypeM.findOne({ companyId: cid, code }).session(session ?? null).lean();
  }
  return row ? toExpenseTypeDTO(row) : null;
}

export interface ExpenseTypeInput {
  name?: unknown;
  requiresReceipt?: unknown;
  requiresDescription?: unknown;
  vehicle?: unknown;
  active?: unknown;
  sortOrder?: unknown;
}

function readFields(input: ExpenseTypeInput, partial: boolean) {
  const out: Record<string, unknown> = {};
  if (input.name !== undefined || !partial) {
    const name = cleanTypeName(input.name);
    if (!name) throw new ExpenseTypeError(400, "Enter a name of 2 to 40 letters or numbers.");
    out.name = name;
  }
  for (const key of ["requiresReceipt", "requiresDescription", "active"] as const) {
    if (input[key] === undefined) continue;
    if (typeof input[key] !== "boolean") throw new ExpenseTypeError(400, `${key} must be true or false.`);
    out[key] = input[key];
  }
  if (input.vehicle !== undefined) {
    if (!isVehicleMode(input.vehicle)) throw new ExpenseTypeError(400, "Vehicle must be none, optional or required.");
    out.vehicle = input.vehicle;
  }
  if (input.sortOrder !== undefined) {
    const n = Number(input.sortOrder);
    if (!Number.isFinite(n)) throw new ExpenseTypeError(400, "Order must be a number.");
    out.sortOrder = Math.trunc(n);
  }
  return out;
}

export async function createExpenseType(companyId: unknown, input: ExpenseTypeInput): Promise<ExpenseTypeDTO> {
  const cid = toObjectId(companyId);
  const fields = readFields(input, false);
  const code = codeForName(fields.name as string);
  const clash = await TypeM.findOne({
    companyId: cid,
    code: new RegExp(`^${code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"),
  }).lean();
  if (clash) throw new ExpenseTypeError(409, `"${clash.name}" already exists.`);
  const created = await TypeM.create({
    requiresReceipt: true,
    requiresDescription: false,
    vehicle: "none",
    sortOrder: 100,
    ...fields,
    companyId: cid,
    code,
    tracksOdometer: false,
    isSystem: false,
  });
  return toExpenseTypeDTO(created.toObject());
}

export async function updateExpenseType(
  scope: string | null,
  id: unknown,
  input: ExpenseTypeInput
): Promise<ExpenseTypeDTO> {
  const row = await TypeM.findById(toObjectId(id));
  if (!row || (scope && String(row.companyId) !== scope)) throw new ExpenseTypeError(404, "Expense type not found.");
  const fields = readFields(input, true);
  // Fuel always needs its vehicle: the odometer run is measured per vehicle.
  if (row.code === FUEL_CODE && fields.vehicle !== undefined && fields.vehicle !== "required") {
    throw new ExpenseTypeError(400, "Fuel always needs the vehicle, for the odometer reading.");
  }
  row.set(fields);
  await row.save();
  return toExpenseTypeDTO(row.toObject());
}

/**
 * Remove a type. One already used by an expense, or a built-in one, is only
 * switched off so history keeps its name.
 */
export async function deleteExpenseType(scope: string | null, id: unknown): Promise<{ deactivated: boolean }> {
  const row = await TypeM.findById(toObjectId(id));
  if (!row || (scope && String(row.companyId) !== scope)) throw new ExpenseTypeError(404, "Expense type not found.");
  const used = await ExpenseM.exists({ companyId: row.companyId, category: row.code });
  if (row.isSystem || used) {
    row.active = false;
    await row.save();
    return { deactivated: true };
  }
  await TypeM.deleteOne({ _id: row._id });
  return { deactivated: false };
}
