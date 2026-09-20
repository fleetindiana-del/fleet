import mongoose, { Schema, Document } from 'mongoose';

export interface ICallLog extends Document {
  driverId: mongoose.Types.ObjectId;
  phoneNumber: string;
  callType: 'INCOMING' | 'OUTGOING' | 'MISSED' | 'UNKNOWN';
  duration: number;
  timestamp: Date;
  syncedAt: Date;
  companyId: mongoose.Types.ObjectId;
  employeeName?: string;
  contactName?: string;
  /** Set when contact intelligence has claimed this row, so overlapping processors cannot count it twice. */
  intelligenceClaimedAt?: Date;
}

const CallLogSchema = new Schema(
  {
    driverId: { type: Schema.Types.ObjectId, ref: 'Driver', required: true },
    phoneNumber: { type: String, required: true },
    callType: { type: String, enum: ['INCOMING', 'OUTGOING', 'MISSED', 'UNKNOWN'], required: true },
    duration: { type: Number, required: true },
    timestamp: { type: Date, required: true },
    syncedAt: { type: Date, required: true },
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
    employeeName: { type: String },
    contactName: { type: String },
    intelligenceClaimedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Compound index to prevent duplicates
CallLogSchema.index({ phoneNumber: 1, timestamp: 1, duration: 1 }, { unique: true });
CallLogSchema.index({ employeeName: 1, intelligenceClaimedAt: 1 });

export default mongoose.models.CallLog || mongoose.model<ICallLog>('CallLog', CallLogSchema);
