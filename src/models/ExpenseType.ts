import mongoose, { Schema } from "mongoose";

export interface IExpenseType {
  _id: mongoose.Types.ObjectId;
  companyId: mongoose.Types.ObjectId;
  /** Stored on each Expense as `category`. Fixed once created. */
  code: string;
  name: string;
  requiresReceipt: boolean;
  requiresDescription: boolean;
  vehicle: "none" | "optional" | "required";
  /** Built-in Fuel only. */
  tracksOdometer: boolean;
  active: boolean;
  isSystem: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

const ExpenseTypeSchema = new Schema(
  {
    companyId: { type: Schema.Types.ObjectId, ref: "Company", required: true },
    code: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true, maxlength: 40 },
    requiresReceipt: { type: Boolean, default: true },
    requiresDescription: { type: Boolean, default: false },
    vehicle: { type: String, enum: ["none", "optional", "required"], default: "none" },
    tracksOdometer: { type: Boolean, default: false },
    active: { type: Boolean, default: true },
    isSystem: { type: Boolean, default: false },
    sortOrder: { type: Number, default: 100 },
  },
  { timestamps: true, collection: "expensetypes" }
);

ExpenseTypeSchema.index({ companyId: 1, code: 1 }, { unique: true });

export default mongoose.models.ExpenseType ||
  mongoose.model<IExpenseType>("ExpenseType", ExpenseTypeSchema);
