import mongoose, { Schema, Document } from 'mongoose';
import { phoneKeyOf } from '@/lib/contactNormalize';

export type TrackerStatus = 'tracking' | 'awaiting_name' | 'awaiting_category' | 'identified';

export interface IUnknownNumberTracker extends Document {
  phoneNumber: string;
  employeeName: string;
  deviceId: string;
  callCount: number;
  firstSeen: Date;
  lastSeen: Date;
  telegramMessageId?: number;
  /** Set when a name-request Telegram was successfully sent — prevents duplicate sends. */
  nameRequestSentAt?: Date;
  /** Last 10 digits of phoneNumber. Unique with employeeKey so formatted numbers collapse. */
  phoneKey?: string;
  /** Lowercase employeeName, paired with phoneKey. */
  employeeKey?: string;
  status: TrackerStatus;
}

const UnknownNumberTrackerSchema = new Schema(
  {
    phoneNumber: { type: String, required: true, trim: true },
    employeeName: { type: String, required: true },
    deviceId: { type: String, default: '' },
    callCount: { type: Number, default: 1 },
    firstSeen: { type: Date, required: true },
    lastSeen: { type: Date, required: true },
    telegramMessageId: { type: Number },
    nameRequestSentAt: { type: Date },
    phoneKey: { type: String },
    employeeKey: { type: String },
    status: {
      type: String,
      enum: ['tracking', 'awaiting_name', 'awaiting_category', 'identified'],
      default: 'tracking',
    },
  },
  { timestamps: true }
);

// One tracker per (phone number, employee) pair
UnknownNumberTrackerSchema.index({ phoneNumber: 1, employeeName: 1 }, { unique: true });
UnknownNumberTrackerSchema.index({ phoneKey: 1, employeeKey: 1 }, { unique: true });
UnknownNumberTrackerSchema.index({ employeeName: 1 });
UnknownNumberTrackerSchema.index({ callCount: -1 });

function stampIdentityKeys(phoneNumber: unknown, employeeName: unknown) {
  return {
    ...(phoneNumber ? { phoneKey: phoneKeyOf(phoneNumber) } : {}),
    ...(typeof employeeName === 'string' && employeeName ? { employeeKey: employeeName.toLowerCase() } : {}),
  };
}

UnknownNumberTrackerSchema.pre('save', function () {
  Object.assign(this, stampIdentityKeys(this.phoneNumber, this.employeeName));
});

UnknownNumberTrackerSchema.pre('findOneAndUpdate', function () {
  const update: any = this.getUpdate() ?? {};
  if (Array.isArray(update)) return;
  const filter: any = this.getFilter() ?? {};
  const phone = update.$set?.phoneNumber || update.$setOnInsert?.phoneNumber || filter.phoneNumber;
  const employee = update.$set?.employeeName || update.$setOnInsert?.employeeName || filter.employeeName;
  const keys = stampIdentityKeys(phone, employee);
  if (Object.keys(keys).length === 0) return;
  update.$set = { ...(update.$set || {}), ...keys };
  this.setUpdate(update);
});

export default mongoose.models.UnknownNumberTracker ||
  mongoose.model<IUnknownNumberTracker>('UnknownNumberTracker', UnknownNumberTrackerSchema);
