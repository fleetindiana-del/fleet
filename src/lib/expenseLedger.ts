/**
 * Income & Expense service: the ONLY place that moves driver money.
 *
 * Every operation runs in one MongoDB transaction that writes three things
 * together or not at all:
 *   1. the Expense (status change / creation),
 *   2. the Driver's cached `walletBalance`,
 *   3. an append-only LedgerEntry describing what happened and who did it.
 *
 * API routes and pages must go through here rather than touching
 * `walletBalance` directly, otherwise the ledger and the balance diverge.
 *
 * Callers must `await connectToDatabase()` first.
 */
import { createHash } from "node:crypto";
import mongoose from "mongoose";
import Driver from "@/models/Driver";
import Expense from "@/models/Expense";
import LedgerEntry from "@/models/LedgerEntry";
import Vehicle from "@/models/Vehicle";
// Legacy collection: only read, to detect drivers who still need migrating.
import WalletTransaction from "@/models/WalletTransaction";
import { findExpenseType } from "@/lib/expenseTypes";
import type { ExpenseTypeDTO } from "@/lib/expenseTypeRules";
import {
  balanceEffectFor,
  buildAccountFigures,
  computeExcess,
  expenseSubmissionKey,
  parseAmount,
  parseExpenseDate,
  parseOdometer,
  parseReceiptDataUrl,
  round2,
  runKilometers,
  type AccountFigures,
  type LedgerEntryType,
} from "@/lib/expenseMath";

// The models are exported as `Model<any> | Model<T>` unions, which TypeScript
// cannot call overloads on, and populate()/aggregate() results do not fit the
// document interfaces. We use them structurally, so widen once here; every value
// that leaves this file goes through a typed DTO mapper below.
/* eslint-disable @typescript-eslint/no-explicit-any */
const DriverM = Driver as mongoose.Model<any>;
const ExpenseM = Expense as mongoose.Model<any>;
const LedgerM = LedgerEntry as mongoose.Model<any>;
const VehicleM = Vehicle as mongoose.Model<any>;
const WalletTransactionM = WalletTransaction as mongoose.Model<any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// Errors & actors
// ---------------------------------------------------------------------------

export class LedgerError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "LedgerError";
  }
}

/** The authenticated user performing an operation (from the NextAuth session). */
export interface Actor {
  id: string;
  name: string;
  role: string;
  companyId?: string | null;
}

/**
 * Tenant scope for an actor: a company id, or null for a super admin (all
 * companies). Anyone else without a company is refused rather than given
 * unscoped access.
 */
export function companyScopeFor(actor: Actor): string | null {
  if (actor.role === "super_admin") return actor.companyId ?? null;
  if (!actor.companyId) throw new LedgerError(403, "NO_COMPANY", "Your account is not assigned to a company.");
  return actor.companyId;
}

function toObjectId(value: unknown, what: string): mongoose.Types.ObjectId {
  if (typeof value !== "string" || !mongoose.Types.ObjectId.isValid(value)) {
    throw new LedgerError(400, "INVALID_ID", `Invalid ${what}.`);
  }
  return new mongoose.Types.ObjectId(value);
}

function cleanText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const t = value.trim();
  return t ? t.slice(0, max) : undefined;
}

/** `$round(walletBalance + delta, 2)` as an update pipeline: atomic and float-noise free. */
function adjustBalance(delta: number) {
  return [
    {
      $set: {
        walletBalance: { $round: [{ $add: [{ $ifNull: ["$walletBalance", 0] }, delta] }, 2] },
      },
    },
  ];
}

function isDuplicateKey(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: number }).code === 11000;
}

function asKm(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function kmLabel(value: number): string {
  return value.toLocaleString("en-IN", { maximumFractionDigits: 1 });
}

interface FuelStamp {
  odometerKm: number;
  previousOdometerKm?: number;
  runKm?: number;
  vehicleId?: mongoose.Types.ObjectId;
  vehicleRegistration?: string;
}

/**
 * Resolve the vehicle and the kilometers since its last reading, then move
 * the vehicle's odometer forward. Fuel only. A company with several vehicles
 * must name which one; a company with one vehicle is filled in.
 */
async function stampFuelOdometer(
  session: mongoose.ClientSession,
  input: {
    driverId: mongoose.Types.ObjectId;
    companyId: mongoose.Types.ObjectId;
    odometerKm: number;
    vehicleId?: string;
  }
): Promise<FuelStamp> {
  let vehicle: {
    _id: mongoose.Types.ObjectId;
    registration?: string;
    vehicleModel?: string;
    odometerKm?: number;
    companyId?: unknown;
  } | null = null;
  if (input.vehicleId) {
    if (!mongoose.Types.ObjectId.isValid(input.vehicleId)) {
      throw new LedgerError(400, "INVALID_VEHICLE", "Choose a vehicle.");
    }
    vehicle = await VehicleM.findById(input.vehicleId).session(session).lean();
    if (!vehicle || String(vehicle.companyId) !== String(input.companyId)) {
      throw new LedgerError(404, "VEHICLE_NOT_FOUND", "That vehicle is not in this company.");
    }
  } else {
    const active = await VehicleM.find({ companyId: input.companyId, status: "active" })
      .select("_id registration vehicleModel odometerKm companyId")
      .session(session)
      .lean();
    if (active.length > 1) {
      throw new LedgerError(400, "VEHICLE_REQUIRED", "Choose the vehicle for this petrol fill.");
    }
    vehicle = active[0] ?? null;
  }

  let previous: number | null = null;
  if (vehicle && typeof vehicle.odometerKm === "number") {
    previous = vehicle.odometerKm;
  } else if (vehicle) {
    const last = await ExpenseM.findOne({ vehicleId: vehicle._id, odometerKm: { $type: "number" } })
      .sort({ timestamp: -1, _id: -1 })
      .select("odometerKm")
      .session(session)
      .lean();
    previous = asKm(last?.odometerKm);
  } else {
    const last = await ExpenseM.findOne({
      driverId: input.driverId,
      category: "Fuel",
      odometerKm: { $type: "number" },
    })
      .sort({ timestamp: -1, _id: -1 })
      .select("odometerKm")
      .session(session)
      .lean();
    previous = asKm(last?.odometerKm);
  }

  if (previous != null && input.odometerKm <= previous) {
    throw new LedgerError(
      400,
      "ODOMETER_TOO_LOW",
      `Odometer must be higher than the last reading (${kmLabel(previous)} km).`
    );
  }

  const run = runKilometers(previous, input.odometerKm);
  if (vehicle) {
    await VehicleM.updateOne(
      { _id: vehicle._id },
      run == null
        ? { $set: { odometerKm: input.odometerKm }, $unset: { lastRunKm: 1 } }
        : { $set: { odometerKm: input.odometerKm, lastRunKm: run } },
      { session }
    );
  }

  return {
    odometerKm: input.odometerKm,
    previousOdometerKm: previous ?? undefined,
    runKm: run ?? undefined,
    vehicleId: vehicle?._id,
    vehicleRegistration: vehicle?.vehicleModel?.trim() || vehicle?.registration,
  };
}

/** The next petrol reading after this expense, for the same vehicle. */
async function nextFuelFill(
  session: mongoose.ClientSession,
  expense: { _id: unknown; vehicleId?: unknown; timestamp?: Date }
) {
  if (!expense.vehicleId || !expense.timestamp) return null;
  return ExpenseM.findOne({
    vehicleId: expense.vehicleId,
    _id: { $ne: expense._id },
    odometerKm: { $type: "number" },
    $or: [
      { timestamp: { $gt: expense.timestamp } },
      { timestamp: expense.timestamp, _id: { $gt: expense._id } },
    ],
  })
    .sort({ timestamp: 1, _id: 1 })
    .select("odometerKm runKm timestamp")
    .session(session);
}

/** The petrol reading just before this expense, for the same vehicle. */
async function previousFuelFill(
  session: mongoose.ClientSession,
  expense: { _id: unknown; vehicleId?: unknown; timestamp?: Date }
) {
  if (!expense.vehicleId || !expense.timestamp) return null;
  return ExpenseM.findOne({
    vehicleId: expense.vehicleId,
    _id: { $ne: expense._id },
    odometerKm: { $type: "number" },
    $or: [
      { timestamp: { $lt: expense.timestamp } },
      { timestamp: expense.timestamp, _id: { $lt: expense._id } },
    ],
  })
    .sort({ timestamp: -1, _id: -1 })
    .select("odometerKm runKm")
    .session(session);
}

/** Point the vehicle at the latest remaining petrol reading after one is removed. */
async function rollbackVehicleOdometer(
  session: mongoose.ClientSession,
  expense: { vehicleId?: unknown; odometerKm?: number; previousOdometerKm?: number; timestamp?: Date; _id: unknown }
) {
  if (!expense.vehicleId || typeof expense.odometerKm !== "number") return;
  const next = await nextFuelFill(session, expense);
  if (next) {
    const baseline = asKm(expense.previousOdometerKm);
    const run = baseline == null ? null : runKilometers(baseline, next.odometerKm);
    await ExpenseM.updateOne(
      { _id: next._id },
      run == null
        ? { $unset: { previousOdometerKm: 1, runKm: 1 } }
        : { $set: { previousOdometerKm: baseline, runKm: run } },
      { session }
    );
    const later = await nextFuelFill(session, {
      _id: next._id,
      vehicleId: expense.vehicleId,
      timestamp: next.timestamp,
    });
    if (!later) {
      await VehicleM.updateOne(
        { _id: expense.vehicleId },
        run == null ? { $unset: { lastRunKm: 1 } } : { $set: { lastRunKm: run } },
        { session }
      );
    }
    return;
  }
  const prior = await previousFuelFill(session, expense);
  if (prior) {
    await VehicleM.updateOne(
      { _id: expense.vehicleId },
      asKm(prior.runKm) == null
        ? { $set: { odometerKm: prior.odometerKm }, $unset: { lastRunKm: 1 } }
        : { $set: { odometerKm: prior.odometerKm, lastRunKm: prior.runKm } },
      { session }
    );
    return;
  }
  const baseline = asKm(expense.previousOdometerKm);
  await VehicleM.updateOne(
    { _id: expense.vehicleId },
    baseline == null
      ? { $unset: { odometerKm: 1, lastRunKm: 1 } }
      : { $set: { odometerKm: baseline }, $unset: { lastRunKm: 1 } },
    { session }
  );
}

/** Correct the reading on an existing petrol fill and the fill that follows it. */
async function reviseFuelReading(
  session: mongoose.ClientSession,
  expense: {
    _id: unknown;
    vehicleId?: unknown;
    timestamp?: Date;
    previousOdometerKm?: number;
    odometerKm?: number;
  },
  reading: number
) {
  const previous = asKm(expense.previousOdometerKm);
  if (previous != null && reading <= previous) {
    throw new LedgerError(
      400,
      "ODOMETER_TOO_LOW",
      `Odometer must be higher than the previous reading (${kmLabel(previous)} km).`
    );
  }
  const next = await nextFuelFill(session, expense);
  if (next && reading >= next.odometerKm) {
    throw new LedgerError(
      400,
      "ODOMETER_TOO_HIGH",
      `Odometer must stay below the next reading (${kmLabel(next.odometerKm)} km).`
    );
  }
  const run = runKilometers(previous, reading);
  await ExpenseM.updateOne(
    { _id: expense._id },
    run == null ? { $set: { odometerKm: reading }, $unset: { runKm: 1 } } : { $set: { odometerKm: reading, runKm: run } },
    { session }
  );
  if (next) {
    const nextRun = runKilometers(reading, next.odometerKm);
    await ExpenseM.updateOne(
      { _id: next._id },
      nextRun == null
        ? { $set: { previousOdometerKm: reading }, $unset: { runKm: 1 } }
        : { $set: { previousOdometerKm: reading, runKm: nextRun } },
      { session }
    );
    if (expense.vehicleId) {
      const later = await nextFuelFill(session, {
        _id: next._id,
        vehicleId: expense.vehicleId,
        timestamp: next.timestamp,
      });
      if (!later) {
        await VehicleM.updateOne(
          { _id: expense.vehicleId },
          nextRun == null ? { $unset: { lastRunKm: 1 } } : { $set: { lastRunKm: nextRun } },
          { session }
        );
      }
    }
    return;
  }
  if (expense.vehicleId) {
    await VehicleM.updateOne(
      { _id: expense.vehicleId },
      run == null
        ? { $set: { odometerKm: reading }, $unset: { lastRunKm: 1 } }
        : { $set: { odometerKm: reading, lastRunKm: run } },
      { session }
    );
  }
}

/**
 * Guard for drivers whose history predates the ledger.
 *
 * Before the ledger, wallet balances and expenses lived only on the Driver and
 * Expense records. If we recorded a first ledger entry for such a driver, the
 * migration script would then see "already has ledger entries" and skip them,
 * permanently losing their earlier history. So until the migration has run we
 * refuse to change their account at all. A brand-new driver (zero balance, no
 * wallet transactions, no expenses) is fine.
 */
async function assertLedgerReady(driver: { _id: unknown; walletBalance?: number }, session: mongoose.ClientSession) {
  if (await LedgerM.exists({ driverId: driver._id }).session(session)) return;
  const hasLegacyHistory =
    (driver.walletBalance ?? 0) !== 0 ||
    !!(await WalletTransactionM.exists({ driverId: driver._id }).session(session)) ||
    !!(await ExpenseM.exists({ driverId: driver._id }).session(session));
  if (hasLegacyHistory) {
    throw new LedgerError(
      409,
      "LEDGER_MIGRATION_REQUIRED",
      "This account is being upgraded to the new expense ledger and cannot be changed yet. " +
        "An administrator needs to run scripts/migrate-expense-ledger.mjs. Nothing was changed."
    );
  }
}

async function inTransaction<T>(fn: (session: mongoose.ClientSession) => Promise<T>): Promise<T> {
  const session = await mongoose.startSession();
  try {
    let result!: T;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

// ---------------------------------------------------------------------------
// DTOs (plain, JSON-safe shapes shared with the UI)
// ---------------------------------------------------------------------------

export interface LedgerEntryDTO {
  id: string;
  driverId: string;
  driverName: string;
  type: LedgerEntryType;
  amount: number;
  balanceEffect: number;
  balanceAfter: number;
  expenseId: string | null;
  performedByName: string;
  performedByRole: string;
  note: string | null;
  isAdditionalAdvance: boolean;
  excessAmount: number;
  timestamp: string;
}

export interface ExpenseDTO {
  id: string;
  driverId: string;
  driverName: string;
  amount: number;
  category: string;
  description: string;
  /** Date the money was spent (YYYY-MM-DD semantics, stored 00:00 UTC). */
  expenseDate: string;
  submittedAt: string;
  status: "pending" | "approved" | "rejected";
  reviewedByName: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  excessAmount: number;
  balanceAfterApproval: number | null;
  /** Taken from the wallet at submission (refunded if rejected); false for legacy rows. */
  deductedOnSubmit: boolean;
  /** Wallet balance right after this expense was deducted, whenever that happened. */
  walletBalanceAfter: number | null;
  location: { lat: number; lng: number } | null;
  locationAccuracy: number | null;
  /** "captured", or why there is no location. Legacy rows always had one. */
  locationStatus: "captured" | "denied" | "unavailable";
  locationCapturedAt: string | null;
  receiptUrl: string;
  /** False only when the driver submitted without a bill photo (a petrol fill). */
  hasReceipt?: boolean;
  /** Odometer at a petrol fill, and the kilometers driven since the previous reading. */
  odometerKm: number | null;
  previousOdometerKm: number | null;
  runKm: number | null;
  vehicleId: string | null;
  vehicleRegistration: string | null;
}

export interface AccountRow extends AccountFigures {
  driverId: string;
  userId: string | null;
  name: string;
  email: string;
  status: string;
  advanceCount: number;
  submittedCount: number;
  pendingCount: number;
  approvedCount: number;
  rejectedCount: number;
  lastActivityAt: string | null;
  /** The cached wallet balance on the Driver document. */
  cachedBalance: number;
  /** True when the cached balance disagrees with the ledger (needs reconcile). */
  drifted: boolean;
}

export interface AccountTotals {
  driverCount: number;
  totalAdvance: number;
  totalSubmitted: number;
  totalApproved: number;
  totalPending: number;
  totalRejected: number;
  pendingCount: number;
  /** Sum of unspent advances across drivers who are in credit. */
  totalRemaining: number;
  /** Sum of outstanding amounts payable to overdrawn drivers. */
  totalExcess: number;
  overdrawnCount: number;
  /** advances - approved, across everyone (remaining - excess). */
  netBalance: number;
  driftedCount: number;
}

/** Spend grouped by employee and expense type. Rejected amounts stay separate so cards can ignore them. */
export interface CategorySpend {
  driverId: string;
  category: string;
  pending: number;
  approved: number;
  rejected: number;
  pendingCount: number;
  approvedCount: number;
  rejectedCount: number;
}

export const receiptUrlFor = (expenseId: string) =>
  `/api/income-expense/expenses/${expenseId}/receipt`;

/** An Expense as returned by `listExpenses` (lean, driver and reviewer populated). */
interface ExpenseRow {
  _id: unknown;
  driverId: { _id: unknown; userId?: { name?: string } | null } | null;
  amount: number;
  category: string;
  description?: string;
  note?: string;
  expenseDate?: Date;
  timestamp: Date;
  status: "pending" | "approved" | "rejected";
  adminApprovalBy?: { name?: string } | null;
  reviewedAt?: Date;
  rejectionReason?: string;
  excessAmount?: number;
  walletBalanceAfter?: number;
  deductedOnSubmit?: boolean;
  location?: { lat?: number; lng?: number } | null;
  locationAccuracy?: number;
  locationStatus?: "captured" | "denied" | "unavailable";
  locationCapturedAt?: Date;
  hasReceipt?: boolean;
  odometerKm?: number;
  previousOdometerKm?: number;
  runKm?: number;
  vehicleId?: unknown;
  vehicleRegistration?: string;
}

/** A LedgerEntry as read from the database (lean) or just created. */
interface LedgerRow {
  _id: unknown;
  driverId: unknown;
  driverName?: string;
  type: LedgerEntryType;
  amount: number;
  balanceEffect: number;
  balanceAfter: number;
  expenseId?: unknown;
  performedByName?: string;
  performedByRole?: string;
  note?: string;
  isAdditionalAdvance?: boolean;
  excessAmount?: number;
  timestamp: Date;
}

/** A Driver with its user populated, as read by `getAccountSummaries`. */
interface DriverRow {
  _id: unknown;
  userId?: { _id?: unknown; name?: string; email?: string } | null;
  status: string;
  walletBalance?: number;
}

function toExpenseDTO(e: ExpenseRow): ExpenseDTO {
  const driverUser = e.driverId?.userId;
  const lat = e.location?.lat;
  const lng = e.location?.lng;
  const location =
    typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng)
      ? { lat, lng }
      : null;
  return {
    id: String(e._id),
    driverId: String(e.driverId?._id),
    driverName: driverUser?.name ?? "Deleted driver",
    amount: e.amount,
    category: e.category,
    // Rows created before `description` existed carry their text in `note`.
    description: e.description ?? e.note ?? "",
    expenseDate: new Date(e.expenseDate ?? e.timestamp).toISOString(),
    submittedAt: new Date(e.timestamp).toISOString(),
    status: e.status,
    reviewedByName: e.status !== "pending" ? e.adminApprovalBy?.name ?? null : null,
    reviewedAt: e.status !== "pending" && e.reviewedAt ? new Date(e.reviewedAt).toISOString() : null,
    rejectionReason: e.rejectionReason ?? null,
    excessAmount: e.excessAmount ?? 0,
    balanceAfterApproval: e.status === "approved" ? e.walletBalanceAfter ?? null : null,
    deductedOnSubmit: !!e.deductedOnSubmit,
    walletBalanceAfter: e.walletBalanceAfter ?? null,
    location,
    locationAccuracy: location && typeof e.locationAccuracy === "number" ? e.locationAccuracy : null,
    locationStatus: location ? "captured" : e.locationStatus === "denied" ? "denied" : "unavailable",
    locationCapturedAt: location && e.locationCapturedAt ? new Date(e.locationCapturedAt).toISOString() : null,
    receiptUrl: receiptUrlFor(String(e._id)),
    hasReceipt: e.hasReceipt !== false,
    odometerKm: typeof e.odometerKm === "number" ? e.odometerKm : null,
    previousOdometerKm: typeof e.previousOdometerKm === "number" ? e.previousOdometerKm : null,
    runKm: typeof e.runKm === "number" ? e.runKm : null,
    vehicleId: e.vehicleId ? String(e.vehicleId) : null,
    vehicleRegistration: e.vehicleRegistration ?? null,
  };
}

function toLedgerDTO(l: LedgerRow): LedgerEntryDTO {
  return {
    id: String(l._id),
    driverId: String(l.driverId),
    driverName: l.driverName ?? "Unknown driver",
    type: l.type,
    amount: l.amount,
    balanceEffect: l.balanceEffect,
    balanceAfter: l.balanceAfter,
    expenseId: l.expenseId ? String(l.expenseId) : null,
    performedByName: l.performedByName ?? "System",
    performedByRole: l.performedByRole ?? "",
    note: l.note ?? null,
    isAdditionalAdvance: !!l.isAdditionalAdvance,
    excessAmount: l.excessAmount ?? 0,
    timestamp: new Date(l.timestamp).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export interface AllocateAdvanceInput {
  driverId: unknown;
  amount: unknown;
  note?: unknown;
  /** Makes a retried/double-clicked request a no-op instead of a second advance. */
  idempotencyKey?: unknown;
  actor: Actor;
}

export async function allocateAdvance(input: AllocateAdvanceInput) {
  const driverId = toObjectId(input.driverId, "driver");
  const amount = parseAmount(input.amount);
  if (amount === null) {
    throw new LedgerError(400, "INVALID_AMOUNT", "Enter a valid positive amount.");
  }
  const note = cleanText(input.note, 500);
  const idempotencyKey = cleanText(input.idempotencyKey, 100);
  const scope = companyScopeFor(input.actor);

  try {
    return await inTransaction(async (session) => {
      const driver = await DriverM.findById(driverId).populate("userId", "name").session(session);
      if (!driver || (scope && String(driver.companyId) !== scope)) {
        throw new LedgerError(404, "DRIVER_NOT_FOUND", "Driver not found.");
      }
      await assertLedgerReady(driver, session);
      const priorAdvances = await LedgerM.countDocuments({ driverId, type: "advance" }).session(session);

      const updated = await DriverM.findOneAndUpdate({ _id: driverId }, adjustBalance(amount), {
        returnDocument: 'after',
        session,
        updatePipeline: true,
      });

      const [entry] = await LedgerM.create(
        [
          {
            driverId,
            companyId: driver.companyId,
            type: "advance",
            amount,
            balanceEffect: balanceEffectFor("advance", amount),
            balanceAfter: updated.walletBalance,
            driverName: driver.userId?.name,
            performedBy: new mongoose.Types.ObjectId(input.actor.id),
            performedByName: input.actor.name,
            performedByRole: input.actor.role,
            note,
            isAdditionalAdvance: priorAdvances > 0,
            idempotencyKey,
            timestamp: new Date(),
          },
        ],
        { session }
      );
      return { entry: toLedgerDTO(entry), balance: updated.walletBalance as number, duplicate: false };
    });
  } catch (e) {
    if (idempotencyKey && isDuplicateKey(e)) {
      // The earlier request already succeeded; report it instead of failing.
      const existing = await LedgerM.findOne({ idempotencyKey }).lean();
      if (existing && String(existing.driverId) === String(driverId)) {
        const driver = await DriverM.findById(driverId).lean();
        return { entry: toLedgerDTO(existing), balance: (driver?.walletBalance ?? 0) as number, duplicate: true };
      }
    }
    throw e;
  }
}

/**
 * After an entry is corrected or removed, replay this driver's ledger in order
 * so `balanceAfter` and the cached wallet match the remaining effects.
 */
async function recomputeDriverBalance(driverId: mongoose.Types.ObjectId, session: mongoose.ClientSession) {
  const entries = await LedgerM.find({ driverId }).sort({ timestamp: 1, _id: 1 }).session(session);
  let running = 0;
  for (const entry of entries) {
    running = round2(running + (entry.balanceEffect ?? 0));
    if (round2(entry.balanceAfter ?? 0) !== running) {
      await LedgerM.updateOne({ _id: entry._id }, { $set: { balanceAfter: running } }, { session });
    }
  }
  await DriverM.updateOne({ _id: driverId }, { $set: { walletBalance: running } }, { session });
  return running;
}

function assertCompany(companyId: unknown, scope: string | null) {
  if (scope && String(companyId) !== scope) {
    throw new LedgerError(404, "ENTRY_NOT_FOUND", "That record was not found.");
  }
}

export async function updateAdvance(input: { entryId: unknown; amount?: unknown; note?: unknown; actor: Actor }) {
  const entryId = toObjectId(input.entryId, "entry");
  const scope = companyScopeFor(input.actor);
  let amount: number | undefined;
  if (input.amount !== undefined) {
    const parsed = parseAmount(input.amount);
    if (parsed === null) throw new LedgerError(400, "INVALID_AMOUNT", "Enter a valid positive amount.");
    amount = parsed;
  }
  const note = input.note === undefined ? undefined : (cleanText(input.note, 500) ?? "");

  return inTransaction(async (session) => {
    const entry = await LedgerM.findById(entryId).session(session);
    if (!entry || entry.type !== "advance") {
      throw new LedgerError(404, "ENTRY_NOT_FOUND", "Money added entry not found.");
    }
    assertCompany(entry.companyId, scope);
    const $set: Record<string, unknown> = {};
    if (amount !== undefined) {
      $set.amount = amount;
      $set.balanceEffect = balanceEffectFor("advance", amount);
    }
    if (note !== undefined) $set.note = note || undefined;
    if (Object.keys($set).length > 0) {
      await LedgerM.updateOne({ _id: entryId }, { $set }, { session });
    }
    const balance = await recomputeDriverBalance(entry.driverId, session);
    const fresh = await LedgerM.findById(entryId).session(session);
    return { entry: toLedgerDTO(fresh), balance };
  });
}

export async function deleteAdvance(input: { entryId: unknown; actor: Actor }) {
  const entryId = toObjectId(input.entryId, "entry");
  const scope = companyScopeFor(input.actor);
  return inTransaction(async (session) => {
    const entry = await LedgerM.findById(entryId).session(session);
    if (!entry || entry.type !== "advance") {
      throw new LedgerError(404, "ENTRY_NOT_FOUND", "Money added entry not found.");
    }
    assertCompany(entry.companyId, scope);
    const amount = entry.amount as number;
    const driverName = entry.driverName as string | undefined;
    await LedgerM.deleteOne({ _id: entryId }).session(session);
    const balance = await recomputeDriverBalance(entry.driverId, session);
    return { amount, driverName: driverName ?? "the employee", balance };
  });
}

export async function updateExpense(input: {
  expenseId: unknown;
  amount?: unknown;
  category?: unknown;
  description?: unknown;
  /** Present when staff correct the odometer on a petrol expense. */
  odometerKm?: unknown;
  vehicleId?: unknown;
  actor: Actor;
}) {
  const expenseId = toObjectId(input.expenseId, "expense");
  const scope = companyScopeFor(input.actor);
  let amount: number | undefined;
  if (input.amount !== undefined) {
    const parsed = parseAmount(input.amount);
    if (parsed === null) throw new LedgerError(400, "INVALID_AMOUNT", "Enter a valid positive amount.");
    amount = parsed;
  }
  let requestedCategory: string | undefined;
  if (input.category !== undefined && input.category !== "") {
    if (typeof input.category !== "string") throw new LedgerError(400, "INVALID_CATEGORY", "Choose an expense category.");
    requestedCategory = input.category;
  }
  const description = input.description === undefined ? undefined : (cleanText(input.description, 500) ?? "");

  const target = await ExpenseM.findById(expenseId).select("companyId category").lean();
  if (!target) throw new LedgerError(404, "EXPENSE_NOT_FOUND", "Expense not found.");
  assertCompany(target.companyId, scope);
  let category: string | undefined;
  if (requestedCategory && requestedCategory !== target.category) {
    const type = await findExpenseType(target.companyId, requestedCategory);
    if (!type) throw new LedgerError(400, "INVALID_CATEGORY", "Choose an expense category.");
    category = type.code;
  }

  return inTransaction(async (session) => {
    const expense = await ExpenseM.findById(expenseId).session(session);
    if (!expense) throw new LedgerError(404, "EXPENSE_NOT_FOUND", "Expense not found.");
    assertCompany(expense.companyId, scope);

    const $set: Record<string, unknown> = {};
    if (category) $set.category = category;
    if (description !== undefined) $set.description = description || undefined;
    if (amount !== undefined) $set.amount = amount;
    if (Object.keys($set).length > 0) {
      await ExpenseM.updateOne({ _id: expenseId }, { $set }, { session });
    }

    if (amount !== undefined) {
      const entries = await LedgerM.find({ expenseId }).session(session);
      for (const entry of entries) {
        const effect = balanceEffectFor(entry.type, amount, expense.deductedOnSubmit === true);
        await LedgerM.updateOne(
          { _id: entry._id },
          { $set: { amount, balanceEffect: effect } },
          { session }
        );
      }
    }

    const nextCategory = category ?? (expense.category as string);
    if (expense.category === "Fuel" && nextCategory !== "Fuel") {
      await rollbackVehicleOdometer(session, expense);
      await ExpenseM.updateOne(
        { _id: expenseId },
        { $unset: { odometerKm: 1, previousOdometerKm: 1, runKm: 1, vehicleId: 1, vehicleRegistration: 1 } },
        { session }
      );
    } else if (nextCategory === "Fuel" && input.odometerKm !== undefined) {
      const reading = parseOdometer(input.odometerKm);
      if (reading === null) throw new LedgerError(400, "INVALID_ODOMETER", "Enter the odometer in kilometers.");
      if (expense.category === "Fuel") {
        if (reading !== expense.odometerKm) await reviseFuelReading(session, expense, reading);
      } else {
        const vehicleId = typeof input.vehicleId === "string" ? input.vehicleId : undefined;
        const stamp = await stampFuelOdometer(session, {
          driverId: expense.driverId,
          companyId: expense.companyId,
          odometerKm: reading,
          vehicleId,
        });
        await ExpenseM.updateOne({ _id: expenseId }, { $set: stamp }, { session });
      }
    } else if (nextCategory === "Fuel" && expense.category !== "Fuel") {
      throw new LedgerError(400, "ODOMETER_REQUIRED", "Enter the odometer reading for this petrol fill.");
    }

    const balance = await recomputeDriverBalance(expense.driverId, session);
    if (amount !== undefined) {
      const moving = await LedgerM.findOne({ expenseId, balanceEffect: { $ne: 0 } })
        .sort({ timestamp: 1, _id: 1 })
        .session(session);
      if (moving) {
        await ExpenseM.updateOne({ _id: expenseId }, { $set: { walletBalanceAfter: moving.balanceAfter } }, { session });
      }
    }
    return { balance, amount: amount ?? (expense.amount as number) };
  });
}

export async function deleteExpense(input: { expenseId: unknown; actor: Actor }) {
  const expenseId = toObjectId(input.expenseId, "expense");
  const scope = companyScopeFor(input.actor);
  return inTransaction(async (session) => {
    const expense = await ExpenseM.findById(expenseId)
      .select("companyId driverId amount vehicleId odometerKm previousOdometerKm timestamp")
      .session(session);
    if (!expense) throw new LedgerError(404, "EXPENSE_NOT_FOUND", "Expense not found.");
    assertCompany(expense.companyId, scope);
    await LedgerM.deleteMany({ expenseId }).session(session);
    await ExpenseM.deleteOne({ _id: expenseId }).session(session);
    await rollbackVehicleOdometer(session, expense);
    const balance = await recomputeDriverBalance(expense.driverId, session);
    return { amount: expense.amount as number, balance };
  });
}

export interface SubmitExpenseInput {
  /** The driver's User id (from the session) - never taken from the request body. */
  userId: string;
  userName: string;
  amount: unknown;
  category: unknown;
  description: unknown;
  expenseDate: unknown;
  photoDataUrl: unknown;
  latitude: unknown;
  longitude: unknown;
  accuracy?: unknown;
  /** Per-attempt id from the client; a resend with the same id returns the original. */
  clientRequestId?: unknown;
  /** Required for a Fuel expense: the odometer at the pump, in kilometers. */
  odometerKm?: unknown;
  /** Vehicle the expense is for, when its type asks for one. */
  vehicleId?: unknown;
  /** Why there is no fix: "denied" (permission refused) or "unavailable". */
  locationStatus?: unknown;
  /** Epoch ms when the phone took the fix (at the bill photo when there is one). */
  locationTakenAt?: unknown;
}

/**
 * A usable GPS fix from the request, or null when the phone sent none.
 * Coordinates that are present but impossible are refused rather than dropped.
 */
function parseLocationFix(input: SubmitExpenseInput): { lat: number; lng: number; at?: Date } | null {
  const lat = input.latitude;
  const lng = input.longitude;
  if (lat == null && lng == null) return null;
  if (
    typeof lat !== "number" || typeof lng !== "number" ||
    !Number.isFinite(lat) || !Number.isFinite(lng) ||
    Math.abs(lat) > 90 || Math.abs(lng) > 180 ||
    (lat === 0 && lng === 0)
  ) {
    throw new LedgerError(400, "INVALID_LOCATION", "The location from the phone is not valid. Try again.");
  }
  let at: Date | undefined;
  if (typeof input.locationTakenAt === "number" && Number.isFinite(input.locationTakenAt)) {
    const t = new Date(input.locationTakenAt);
    // A phone clock far off is ignored rather than trusted.
    if (Math.abs(Date.now() - t.getTime()) < 2 * 24 * 60 * 60 * 1000) at = t;
  }
  return { lat, lng, at };
}

/** Vehicle details for a non-fuel expense whose type takes a vehicle. */
async function attachVehicle(
  session: mongoose.ClientSession,
  companyId: mongoose.Types.ObjectId,
  type: ExpenseTypeDTO,
  vehicleId: string | undefined
): Promise<{ vehicleId: mongoose.Types.ObjectId; vehicleRegistration?: string } | null> {
  if (type.vehicle === "none") return null;
  if (!vehicleId) {
    if (type.vehicle === "required") {
      throw new LedgerError(400, "VEHICLE_REQUIRED", `Choose the vehicle for this ${type.name} expense.`);
    }
    return null;
  }
  if (!mongoose.Types.ObjectId.isValid(vehicleId)) throw new LedgerError(400, "INVALID_VEHICLE", "Choose a vehicle.");
  const vehicle = await VehicleM.findById(vehicleId).select("companyId registration vehicleModel").session(session).lean();
  if (!vehicle || String(vehicle.companyId) !== String(companyId)) {
    throw new LedgerError(404, "VEHICLE_NOT_FOUND", "That vehicle is not in this company.");
  }
  return {
    vehicleId: vehicle._id,
    vehicleRegistration: vehicle.vehicleModel?.trim() || vehicle.registration,
  };
}

export interface SubmitExpenseResult {
  id: string;
  status: "pending" | "approved" | "rejected";
  amount: number;
  /** Driver balance after this expense was deducted. */
  balance: number;
  /** Portion not covered by the balance the driver had before submitting. */
  excessAmount: number;
  /** True when this was a resend of an expense that was already recorded. */
  duplicate: boolean;
  /** Kilometers since the previous odometer reading, for a petrol fill. */
  runKm?: number | null;
  odometerKm?: number | null;
  vehicleRegistration?: string | null;
  locationStatus?: "captured" | "denied" | "unavailable";
}

const sha256Hex = (s: string) => createHash("sha256").update(s).digest("hex");

/**
 * Record a new expense and deduct it from the driver's wallet in the same
 * transaction. It is never refused for exceeding the balance: the balance just
 * goes negative. It stays `pending` until HR approves (no further change) or
 * rejects it (refunded).
 */
export async function submitExpense(input: SubmitExpenseInput): Promise<SubmitExpenseResult> {
  const amount = parseAmount(input.amount);
  if (amount === null) throw new LedgerError(400, "INVALID_AMOUNT", "Enter a valid positive amount.");

  const userId = toObjectId(input.userId, "user");
  const driverRef = await DriverM.findOne({ userId }).select("_id companyId").lean();
  if (!driverRef) throw new LedgerError(404, "DRIVER_NOT_FOUND", "Driver profile not found.");

  const category = input.category == null || input.category === "" ? "Other" : input.category;
  const type = typeof category === "string" ? await findExpenseType(driverRef.companyId, category) : null;
  if (!type || !type.active) {
    throw new LedgerError(400, "INVALID_CATEGORY", "Choose an expense type from the list.");
  }

  const description = cleanText(input.description, 500);
  if (type.requiresDescription && !description) {
    throw new LedgerError(400, "DESCRIPTION_REQUIRED", `Say what this ${type.name} expense was for.`);
  }

  const expenseDate = parseExpenseDate(input.expenseDate);
  if (!expenseDate) {
    throw new LedgerError(400, "INVALID_DATE", "Enter a valid expense date that is not in the future.");
  }

  const photoSent = input.photoDataUrl != null && input.photoDataUrl !== "";
  const receipt = photoSent ? parseReceiptDataUrl(input.photoDataUrl) : null;
  if (photoSent && !receipt) {
    throw new LedgerError(400, "RECEIPT_REQUIRED", "Attach a clear photo of the bill or receipt (JPEG, PNG or WebP, up to 5 MB).");
  }
  if (!receipt && type.requiresReceipt) {
    throw new LedgerError(400, "RECEIPT_REQUIRED", "Attach a clear photo of the bill or receipt (JPEG, PNG or WebP, up to 5 MB).");
  }

  const fix = parseLocationFix(input);
  const accuracy = fix && typeof input.accuracy === "number" && Number.isFinite(input.accuracy) && input.accuracy >= 0
    ? input.accuracy
    : undefined;

  let odometerKm: number | undefined;
  const vehicleId =
    type.vehicle !== "none" && typeof input.vehicleId === "string" && input.vehicleId.trim()
      ? input.vehicleId.trim()
      : undefined;
  if (type.tracksOdometer) {
    const parsed = parseOdometer(input.odometerKm);
    if (parsed === null) {
      throw new LedgerError(400, "ODOMETER_REQUIRED", "Enter the odometer reading in kilometers for this fuel fill.");
    }
    odometerKm = parsed;
  }

  const submissionKey = expenseSubmissionKey(
    input.clientRequestId,
    { amount, category: type.code, receiptBase64: receipt?.base64 ?? "" },
    sha256Hex
  );

  const findPrevious = async (): Promise<SubmitExpenseResult | null> => {
    const prev = await ExpenseM.findOne({ driverId: driverRef._id, submissionKey })
      .select("amount status walletBalanceAfter excessAmount runKm odometerKm vehicleRegistration locationStatus")
      .lean();
    if (!prev) return null;
    return {
      id: String(prev._id),
      status: prev.status,
      amount: prev.amount,
      balance: round2(prev.walletBalanceAfter ?? 0),
      excessAmount: prev.excessAmount ?? 0,
      duplicate: true,
      runKm: asKm(prev.runKm),
      odometerKm: asKm(prev.odometerKm),
      vehicleRegistration: prev.vehicleRegistration ?? null,
      locationStatus: prev.locationStatus ?? "captured",
    };
  };

  // The common retry case, answered without opening a transaction.
  const earlier = await findPrevious();
  if (earlier) return earlier;
  // The unique (driverId, submissionKey) index is what stops two concurrent
  // requests both deducting; make sure it exists before relying on it.
  await ExpenseM.init();

  try {
    return await inTransaction(async (session) => {
      const current = await DriverM.findById(driverRef._id).session(session);
      if (!current) throw new LedgerError(404, "DRIVER_NOT_FOUND", "Driver profile not found.");
      await assertLedgerReady(current, session);

      const driver = await DriverM.findOneAndUpdate({ _id: current._id }, adjustBalance(-amount), {
        returnDocument: "after",
        session,
        updatePipeline: true,
      });
      const balanceAfter = round2(driver.walletBalance ?? 0);
      const excess = computeExcess(round2(balanceAfter + amount), amount);

      const now = new Date();
      const fuel =
        type.tracksOdometer && odometerKm != null
          ? await stampFuelOdometer(session, {
              driverId: driver._id,
              companyId: driver.companyId,
              odometerKm,
              vehicleId,
            })
          : null;
      const vehicle = fuel ? null : await attachVehicle(session, driver.companyId, type, vehicleId);
      const [expense] = await ExpenseM.create(
        [
          {
            driverId: driver._id,
            companyId: driver.companyId,
            amount,
            category: type.code,
            description: description || undefined,
            expenseDate,
            ...(receipt ? { photoUrl: `data:${receipt.mime};base64,${receipt.base64}` } : {}),
            hasReceipt: !!receipt,
            ...(fix
              ? {
                  location: { lat: fix.lat, lng: fix.lng },
                  locationAccuracy: accuracy,
                  locationStatus: "captured",
                  locationCapturedAt: fix.at ?? now,
                }
              : { locationStatus: input.locationStatus === "denied" ? "denied" : "unavailable" }),
            ...(vehicle ?? {}),
            timestamp: now,
            status: "pending",
            deductedOnSubmit: true,
            walletBalanceAfter: balanceAfter,
            excessAmount: excess,
            submissionKey,
            ...(fuel ?? {}),
          },
        ],
        { session }
      );

      await LedgerM.create(
        [
          {
            driverId: driver._id,
            companyId: driver.companyId,
            type: "expense_submitted",
            amount,
            balanceEffect: balanceEffectFor("expense_submitted", amount, true),
            balanceAfter,
            expenseId: expense._id,
            driverName: input.userName,
            performedBy: userId,
            performedByName: input.userName,
            performedByRole: "driver",
            excessAmount: excess,
            timestamp: now,
          },
        ],
        { session }
      );

      return {
        id: String(expense._id),
        status: "pending" as const,
        amount,
        balance: balanceAfter,
        excessAmount: excess,
        duplicate: false,
        runKm: fuel?.runKm ?? null,
        odometerKm: fuel?.odometerKm ?? null,
        vehicleRegistration: fuel?.vehicleRegistration ?? vehicle?.vehicleRegistration ?? null,
        locationStatus: fix ? ("captured" as const) : input.locationStatus === "denied" ? ("denied" as const) : ("unavailable" as const),
      };
    });
  } catch (e) {
    // A concurrent identical request won the race; its transaction did the deduction.
    if (isDuplicateKey(e)) {
      const winner = await findPrevious();
      if (winner) return winner;
    }
    throw e;
  }
}

export interface ReviewExpenseInput {
  expenseId: unknown;
  decision: unknown; // "approve" | "reject"
  /** Required for rejections. */
  reason?: unknown;
  /** Must be true to approve an expense that exceeds the driver's available balance. */
  confirmExcess?: unknown;
  actor: Actor;
}

export async function reviewExpense(input: ReviewExpenseInput) {
  const expenseId = toObjectId(input.expenseId, "expense");
  if (input.decision !== "approve" && input.decision !== "reject") {
    throw new LedgerError(400, "INVALID_DECISION", "Decision must be 'approve' or 'reject'.");
  }
  const approve = input.decision === "approve";
  const reason = cleanText(input.reason, 500);
  if (!approve && (!reason || reason.length < 3)) {
    throw new LedgerError(400, "REASON_REQUIRED", "A reason is required to reject an expense.");
  }
  const scope = companyScopeFor(input.actor);
  const actorId = new mongoose.Types.ObjectId(input.actor.id);

  return inTransaction(async (session) => {
    const now = new Date();

    // Claim the expense. The `status: pending` condition makes this atomic, so
    // two reviewers (or a double-click) can never both act on the same expense.
    const claimed = await ExpenseM.findOneAndUpdate(
      { _id: expenseId, status: "pending", ...(scope ? { companyId: new mongoose.Types.ObjectId(scope) } : {}) },
      {
        $set: {
          status: approve ? "approved" : "rejected",
          adminApprovalBy: actorId,
          reviewedAt: now,
          ...(approve ? {} : { rejectionReason: reason }),
        },
      },
      { returnDocument: 'after', session }
    ).select("-photoUrl");

    if (!claimed) {
      const current = await ExpenseM.findOne({
        _id: expenseId,
        ...(scope ? { companyId: new mongoose.Types.ObjectId(scope) } : {}),
      })
        .select("status")
        .session(session);
      if (!current) throw new LedgerError(404, "EXPENSE_NOT_FOUND", "Expense not found.");
      throw new LedgerError(409, "ALREADY_REVIEWED", `This expense was already ${current.status}.`, {
        status: current.status,
      });
    }

    // Refuse (and roll back the claim) if this driver's older history is not migrated yet.
    const current = await DriverM.findById(claimed.driverId).select("walletBalance").session(session);
    if (current) await assertLedgerReady(current, session);

    // Already deducted on submit: approving changes nothing, rejecting refunds.
    // Legacy expenses: approving deducts, rejecting changes nothing.
    const deducted = claimed.deductedOnSubmit === true;
    const type: LedgerEntryType = approve ? "expense_approved" : "expense_rejected";
    const effect = balanceEffectFor(type, claimed.amount, deducted);

    const driver =
      effect !== 0
        ? await DriverM.findOneAndUpdate({ _id: claimed.driverId }, adjustBalance(effect), {
            returnDocument: "after",
            session,
            updatePipeline: true,
          }).populate("userId", "name")
        : await DriverM.findById(claimed.driverId).populate("userId", "name").session(session);
    if (!driver) throw new LedgerError(404, "DRIVER_NOT_FOUND", "Driver not found.");

    const balanceAfter = round2(driver.walletBalance ?? 0);
    let excess = 0;

    if (approve && deducted) {
      // Any excess was taken (and recorded) when the driver submitted.
      excess = claimed.excessAmount ?? 0;
    } else if (approve) {
      const balanceBefore = round2(balanceAfter + claimed.amount);
      excess = computeExcess(balanceBefore, claimed.amount);
      if (excess > 0 && input.confirmExcess !== true) {
        // Throwing aborts the transaction: the claim and balance change roll back.
        throw new LedgerError(
          409,
          "EXCESS_CONFIRMATION_REQUIRED",
          "This expense exceeds the driver's available balance. Confirm to approve the excess.",
          { balanceBefore, amount: claimed.amount, excessAmount: excess, balanceAfter }
        );
      }
      await ExpenseM.updateOne(
        { _id: expenseId },
        { $set: { excessAmount: excess, walletBalanceAfter: balanceAfter } },
        { session }
      );
    }

    const [entry] = await LedgerM.create(
      [
        {
          driverId: claimed.driverId,
          companyId: claimed.companyId,
          type,
          amount: claimed.amount,
          balanceEffect: effect,
          balanceAfter,
          expenseId,
          driverName: driver.userId?.name,
          performedBy: actorId,
          performedByName: input.actor.name,
          performedByRole: input.actor.role,
          note: approve ? undefined : reason,
          excessAmount: approve ? excess : undefined,
          timestamp: now,
        },
      ],
      { session }
    );

    return {
      expenseId: String(expenseId),
      status: claimed.status as "approved" | "rejected",
      excessAmount: excess,
      balance: balanceAfter,
      /** Signed change this decision made to the balance (refund > 0, legacy approval < 0). */
      balanceChange: effect,
      entry: toLedgerDTO(entry),
    };
  });
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

interface AccountFilter {
  /** Restrict to one company (null/undefined = all companies, super admin only). */
  companyId?: string | null;
  driverId?: string;
}

const DRIFT_TOLERANCE = 0.005;

/** Per-driver accounts, computed from the ledger and expense records. */
export async function getAccountSummaries(filter: AccountFilter): Promise<{
  drivers: AccountRow[];
  totals: AccountTotals;
  categories: CategorySpend[];
}> {
  const driverMatch: Record<string, unknown> = {};
  const rowMatch: Record<string, unknown> = {};
  if (filter.companyId) {
    const cid = new mongoose.Types.ObjectId(filter.companyId);
    driverMatch.companyId = cid;
    rowMatch.companyId = cid;
  }
  if (filter.driverId) {
    const did = new mongoose.Types.ObjectId(filter.driverId);
    driverMatch._id = did;
    rowMatch.driverId = did;
  }

  const [drivers, ledgerAgg, expenseAgg, categoryAgg] = await Promise.all([
    DriverM.find(driverMatch).populate("userId", "name email").lean(),
    LedgerM.aggregate([
      { $match: rowMatch },
      {
        $group: {
          _id: { driverId: "$driverId", type: "$type" },
          amount: { $sum: "$amount" },
          count: { $sum: 1 },
          last: { $max: "$timestamp" },
        },
      },
    ]),
    ExpenseM.aggregate([
      { $match: rowMatch },
      {
        $group: {
          _id: { driverId: "$driverId", status: "$status" },
          amount: { $sum: "$amount" },
          deductedAmount: { $sum: { $cond: [{ $eq: ["$deductedOnSubmit", true] }, "$amount", 0] } },
          count: { $sum: 1 },
        },
      },
    ]),
    ExpenseM.aggregate([
      { $match: rowMatch },
      {
        $group: {
          _id: { driverId: "$driverId", category: "$category" },
          pending: { $sum: { $cond: [{ $eq: ["$status", "pending"] }, "$amount", 0] } },
          approved: { $sum: { $cond: [{ $eq: ["$status", "approved"] }, "$amount", 0] } },
          rejected: { $sum: { $cond: [{ $eq: ["$status", "rejected"] }, "$amount", 0] } },
          pendingCount: { $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] } },
          approvedCount: { $sum: { $cond: [{ $eq: ["$status", "approved"] }, 1, 0] } },
          rejectedCount: { $sum: { $cond: [{ $eq: ["$status", "rejected"] }, 1, 0] } },
        },
      },
    ]),
  ]);

  type Bucket = { amount: number; count: number; deductedAmount?: number };
  const ledger = new Map<string, { byType: Record<string, Bucket>; last: Date | null }>();
  for (const r of ledgerAgg) {
    const id = String(r._id.driverId);
    const slot = ledger.get(id) ?? { byType: {}, last: null };
    slot.byType[r._id.type] = { amount: r.amount, count: r.count };
    if (!slot.last || r.last > slot.last) slot.last = r.last;
    ledger.set(id, slot);
  }
  const expenses = new Map<string, Record<string, Bucket>>();
  for (const r of expenseAgg) {
    const id = String(r._id.driverId);
    const slot = expenses.get(id) ?? {};
    slot[r._id.status] = { amount: r.amount, count: r.count, deductedAmount: r.deductedAmount };
    expenses.set(id, slot);
  }

  const rows: AccountRow[] = (drivers as DriverRow[]).map((d) => {
    const id = String(d._id);
    const l = ledger.get(id);
    const e = expenses.get(id) ?? {};
    const sum = (o: Record<string, Bucket> | undefined, k: string) => o?.[k]?.amount ?? 0;
    const figures = buildAccountFigures({
      totalAdvance: sum(l?.byType, "advance"),
      totalApproved: sum(l?.byType, "expense_approved"),
      totalSubmitted: sum(e, "pending") + sum(e, "approved") + sum(e, "rejected"),
      totalPending: sum(e, "pending"),
      totalRejected: sum(e, "rejected"),
      totalPendingDeducted: e.pending?.deductedAmount ?? 0,
    });
    const cachedBalance = round2(d.walletBalance ?? 0);
    return {
      ...figures,
      driverId: id,
      userId: d.userId?._id ? String(d.userId._id) : null,
      name: d.userId?.name ?? "Unknown",
      email: d.userId?.email ?? "",
      status: d.status,
      advanceCount: l?.byType.advance?.count ?? 0,
      submittedCount: (e.pending?.count ?? 0) + (e.approved?.count ?? 0) + (e.rejected?.count ?? 0),
      pendingCount: e.pending?.count ?? 0,
      approvedCount: e.approved?.count ?? 0,
      rejectedCount: e.rejected?.count ?? 0,
      lastActivityAt: l?.last ? new Date(l.last).toISOString() : null,
      cachedBalance,
      drifted: Math.abs(cachedBalance - figures.balance) > DRIFT_TOLERANCE,
    };
  });
  rows.sort((a, b) => a.name.localeCompare(b.name));

  const totals = rows.reduce<AccountTotals>(
    (t, r) => ({
      driverCount: t.driverCount + 1,
      totalAdvance: t.totalAdvance + r.totalAdvance,
      totalSubmitted: t.totalSubmitted + r.totalSubmitted,
      totalApproved: t.totalApproved + r.totalApproved,
      totalPending: t.totalPending + r.totalPending,
      totalRejected: t.totalRejected + r.totalRejected,
      pendingCount: t.pendingCount + r.pendingCount,
      totalRemaining: t.totalRemaining + r.remainingBalance,
      totalExcess: t.totalExcess + r.excessAmount,
      overdrawnCount: t.overdrawnCount + (r.excessAmount > 0 ? 1 : 0),
      netBalance: t.netBalance + r.balance,
      driftedCount: t.driftedCount + (r.drifted ? 1 : 0),
    }),
    {
      driverCount: 0, totalAdvance: 0, totalSubmitted: 0, totalApproved: 0, totalPending: 0,
      totalRejected: 0, pendingCount: 0, totalRemaining: 0, totalExcess: 0, overdrawnCount: 0,
      netBalance: 0, driftedCount: 0,
    }
  );
  for (const k of Object.keys(totals) as (keyof AccountTotals)[]) {
    if (k.startsWith("total") || k === "netBalance") totals[k] = round2(totals[k]);
  }

  const categories: CategorySpend[] = categoryAgg.map((r: { _id: { driverId: unknown; category?: string }; pending?: number; approved?: number; rejected?: number; pendingCount?: number; approvedCount?: number; rejectedCount?: number }) => ({
    driverId: String(r._id.driverId),
    category: r._id.category || "Other",
    pending: round2(r.pending ?? 0),
    approved: round2(r.approved ?? 0),
    rejected: round2(r.rejected ?? 0),
    pendingCount: r.pendingCount ?? 0,
    approvedCount: r.approvedCount ?? 0,
    rejectedCount: r.rejectedCount ?? 0,
  }));

  return { drivers: rows, totals, categories };
}

export async function getDriverAccount(driverId: string): Promise<AccountRow | null> {
  const { drivers } = await getAccountSummaries({ driverId });
  return drivers[0] ?? null;
}

export interface PageOpts {
  page?: number;
  limit?: number;
}
function pageOf(opts: PageOpts) {
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 25), 1), 100);
  const page = Math.max(Math.trunc(opts.page ?? 1), 1);
  return { limit, page, skip: (page - 1) * limit };
}

export interface LedgerQuery extends PageOpts {
  companyId?: string | null;
  driverId?: string;
  type?: LedgerEntryType;
  from?: Date;
  to?: Date;
}

export async function listLedger(q: LedgerQuery) {
  const { limit, page, skip } = pageOf(q);
  const match: Record<string, unknown> = {};
  if (q.companyId) match.companyId = new mongoose.Types.ObjectId(q.companyId);
  if (q.driverId) match.driverId = new mongoose.Types.ObjectId(q.driverId);
  if (q.type) match.type = q.type;
  if (q.from || q.to) {
    match.timestamp = {
      ...(q.from ? { $gte: q.from } : {}),
      ...(q.to ? { $lte: q.to } : {}),
    };
  }
  const [rows, total] = await Promise.all([
    // _id tiebreak keeps order stable for entries written in the same millisecond.
    LedgerM.find(match).sort({ timestamp: -1, _id: -1 }).skip(skip).limit(limit).lean(),
    LedgerM.countDocuments(match),
  ]);
  return { items: rows.map(toLedgerDTO), total, page, limit };
}

/** Money added to a driver's wallet: advances, and refunds of rejected expenses. */
export async function listWalletCredits(driverId: string, limit = 50): Promise<LedgerEntryDTO[]> {
  const rows = await LedgerM.find({
    driverId: new mongoose.Types.ObjectId(driverId),
    $or: [{ type: "advance" }, { type: "expense_rejected", balanceEffect: { $gt: 0 } }],
  })
    .sort({ timestamp: -1, _id: -1 })
    .limit(Math.min(Math.max(Math.trunc(limit), 1), 200))
    .lean();
  return rows.map(toLedgerDTO);
}

/** One expense, only if it belongs to this driver. */
export async function getDriverExpense(driverId: string, expenseId: string): Promise<ExpenseDTO | null> {
  if (!mongoose.Types.ObjectId.isValid(expenseId)) return null;
  const row = await ExpenseM.findOne({
    _id: new mongoose.Types.ObjectId(expenseId),
    driverId: new mongoose.Types.ObjectId(driverId),
  })
    .select("-photoUrl")
    .populate({ path: "driverId", select: "userId", populate: { path: "userId", select: "name" } })
    .populate("adminApprovalBy", "name")
    .lean();
  return row ? toExpenseDTO(row as ExpenseRow) : null;
}

export interface ExpenseQuery extends PageOpts {
  companyId?: string | null;
  driverId?: string;
  status?: "pending" | "approved" | "rejected";
  category?: string;
}

export async function listExpenses(q: ExpenseQuery) {
  const { limit, page, skip } = pageOf(q);
  const match: Record<string, unknown> = {};
  if (q.companyId) match.companyId = new mongoose.Types.ObjectId(q.companyId);
  if (q.driverId) match.driverId = new mongoose.Types.ObjectId(q.driverId);
  if (q.status) match.status = q.status;
  if (q.category) match.category = q.category;
  const [rows, total] = await Promise.all([
    ExpenseM.find(match)
      .select("-photoUrl") // receipts can be megabytes each; fetched on demand
      .sort({ timestamp: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .populate({ path: "driverId", select: "userId", populate: { path: "userId", select: "name" } })
      .populate("adminApprovalBy", "name")
      .lean(),
    ExpenseM.countDocuments(match),
  ]);
  return { items: rows.map(toExpenseDTO), total, page, limit };
}
