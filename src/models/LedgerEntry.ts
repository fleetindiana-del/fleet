import mongoose, { Schema, Document } from "mongoose";
import { LEDGER_ENTRY_TYPES, type LedgerEntryType } from "@/lib/expenseMath";

/**
 * Append-only record of everything that happens to a driver's account.
 *
 * Every advance, expense submission, approval and rejection is one entry, with
 * who did it and when. The driver's balance is the sum of `balanceEffect` over
 * their entries. Staff can correct or remove an entry from the expenses page;
 * that rewrites the row and rebuilds every later balance snapshot.
 */
export interface ILedgerEntry extends Document {
  driverId: mongoose.Types.ObjectId;
  companyId: mongoose.Types.ObjectId;
  type: LedgerEntryType;
  /** Always positive. The sign of the effect lives in `balanceEffect`. */
  amount: number;
  /** Signed change to the driver's balance: +advance, -approved, 0 otherwise. */
  balanceEffect: number;
  /** Driver balance immediately after this entry was applied. */
  balanceAfter: number;
  expenseId?: mongoose.Types.ObjectId;
  /** Snapshot, so history stays readable if the driver is renamed or deleted. */
  driverName?: string;
  /** The user responsible: HR/admin for advances and decisions, the driver for submissions. */
  performedBy?: mongoose.Types.ObjectId;
  /** Name/role snapshots, so history stays readable if the user is renamed or deleted. */
  performedByName?: string;
  performedByRole?: string;
  /** Advance note, or the rejection reason. */
  note?: string;
  /** Advance: true when the driver had earlier advances (an additional allocation). */
  isAdditionalAdvance?: boolean;
  /** Approval: portion of the amount that exceeded the driver's available balance. */
  excessAmount?: number;
  /** Client-supplied key making a retried advance request a no-op. */
  idempotencyKey?: string;
  timestamp: Date;
}

const LedgerEntrySchema = new Schema(
  {
    driverId: { type: Schema.Types.ObjectId, ref: "Driver", required: true },
    companyId: { type: Schema.Types.ObjectId, ref: "Company", required: true },
    type: { type: String, enum: LEDGER_ENTRY_TYPES, required: true },
    amount: { type: Number, required: true, min: 0 },
    balanceEffect: { type: Number, required: true },
    balanceAfter: { type: Number, required: true },
    expenseId: { type: Schema.Types.ObjectId, ref: "Expense" },
    driverName: { type: String },
    performedBy: { type: Schema.Types.ObjectId, ref: "User" },
    performedByName: { type: String },
    performedByRole: { type: String },
    note: { type: String },
    isAdditionalAdvance: { type: Boolean },
    excessAmount: { type: Number },
    idempotencyKey: { type: String },
    timestamp: { type: Date, default: Date.now, required: true },
  },
  { timestamps: true }
);

LedgerEntrySchema.index({ driverId: 1, timestamp: -1 });
LedgerEntrySchema.index({ companyId: 1, timestamp: -1 });
LedgerEntrySchema.index({ expenseId: 1 });
// Partial (not sparse) so entries without a key never collide with each other.
LedgerEntrySchema.index(
  { idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: "string" } } }
);

export default (mongoose.models.LedgerEntry as mongoose.Model<ILedgerEntry>) ||
  mongoose.model<ILedgerEntry>("LedgerEntry", LedgerEntrySchema);
