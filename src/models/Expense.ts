import mongoose, { Schema, Document } from 'mongoose';

export type LocationStatus = 'captured' | 'denied' | 'unavailable';

export interface IExpense extends Document {
  driverId: mongoose.Types.ObjectId;
  companyId: mongoose.Types.ObjectId;
  amount: number;
  /** Code of an ExpenseType in the same company. */
  category: string;
  /** What was bought / where the money was spent. Required for new expenses. */
  description?: string;
  /** Legacy free-text note, written before `description` existed. */
  note?: string;
  /** Calendar date the money was spent (00:00 UTC). Legacy rows fall back to `timestamp`. */
  expenseDate?: Date;
  photoUrl: string;
  /** Unset when the driver refused location or the phone had no fix. */
  location?: {
    lat: number;
    lng: number;
  };
  locationAccuracy?: number;
  locationStatus?: LocationStatus;
  /** When the phone took the fix: at the bill photo when there is one. */
  locationCapturedAt?: Date;
  /** When the driver submitted the expense. */
  timestamp: Date;
  status: 'pending' | 'approved' | 'rejected';
  /** The HR/admin user who approved or rejected it. */
  adminApprovalBy?: mongoose.Types.ObjectId;
  reviewedAt?: Date;
  /** Required when status is 'rejected'. */
  rejectionReason?: string;
  /** Approved only: portion of the amount that exceeded the driver's available balance. */
  excessAmount?: number;
  receiptUrl?: string;
  /**
   * Driver balance right after this expense touched the wallet: at submission
   * when `deductedOnSubmit`, otherwise at approval (unset while pending/rejected).
   */
  walletBalanceAfter?: number;
  /** Taken from the wallet when submitted (current rule); legacy rows were deducted on approval. */
  deductedOnSubmit?: boolean;
  /** Idempotency key, unique per driver: a retried or double-tapped submission is a no-op. */
  submissionKey?: string;
  /** Odometer at this petrol fill, in kilometers. */
  odometerKm?: number;
  /** Reading this fill is measured from. Unset on the first reading for a vehicle. */
  previousOdometerKm?: number;
  /** Kilometers driven since `previousOdometerKm`. */
  runKm?: number;
  vehicleId?: mongoose.Types.ObjectId;
  vehicleRegistration?: string;
}

const ExpenseSchema = new Schema(
  {
    driverId: { type: Schema.Types.ObjectId, ref: 'Driver', required: true },
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
    amount: { type: Number, required: true },
    category: { type: String, required: true, trim: true, maxlength: 60 },
    description: { type: String, trim: true, maxlength: 500 },
    note: { type: String },
    expenseDate: { type: Date },
    photoUrl: { type: String }, // base64 data URL; served via the receipt endpoint. Petrol fills may omit it.
    hasReceipt: { type: Boolean },
    location: {
      type: new Schema({ lat: { type: Number, required: true }, lng: { type: Number, required: true } }, { _id: false }),
      required: false,
    },
    locationAccuracy: { type: Number },
    locationStatus: { type: String, enum: ['captured', 'denied', 'unavailable'] },
    locationCapturedAt: { type: Date },
    timestamp: { type: Date, required: true },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    adminApprovalBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
    rejectionReason: { type: String, trim: true, maxlength: 500 },
    excessAmount: { type: Number },
    receiptUrl: { type: String },
    walletBalanceAfter: { type: Number },
    deductedOnSubmit: { type: Boolean },
    submissionKey: { type: String },
    odometerKm: { type: Number, min: 0 },
    previousOdometerKm: { type: Number, min: 0 },
    runKm: { type: Number, min: 0 },
    vehicleId: { type: Schema.Types.ObjectId, ref: 'Vehicle' },
    vehicleRegistration: { type: String, trim: true },
  },
  { timestamps: true }
);

ExpenseSchema.index({ companyId: 1, status: 1, timestamp: -1 });
ExpenseSchema.index({ vehicleId: 1, timestamp: -1 });
ExpenseSchema.index({ driverId: 1, timestamp: -1 });
ExpenseSchema.index(
  { driverId: 1, submissionKey: 1 },
  { unique: true, partialFilterExpression: { submissionKey: { $type: "string" } } }
);

export default mongoose.models.Expense || mongoose.model<IExpense>('Expense', ExpenseSchema);
