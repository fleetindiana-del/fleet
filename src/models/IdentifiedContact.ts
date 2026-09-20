import mongoose, { Schema, Document } from 'mongoose';
import { phoneKeyOf } from '@/lib/contactNormalize';

export type ContactCategory =
  | 'personal'
  | 'staff'
  | 'Existing Client'
  | 'New Client'
  | 'courier'
  | 'Family'
  | 'Colleague'
  | 'Other';

export interface IIdentifiedContact extends Document {
  phoneNumber: string;
  employeeName: string;
  deviceId: string;
  contactName?: string;
  category?: ContactCategory;
  savedInPhone: boolean;
  remindLater: boolean;
  telegramChatId?: string;
  /** Last 10 digits of phoneNumber. Unique with employeeKey so formatted numbers collapse. */
  phoneKey?: string;
  /** Lowercase employeeName, paired with phoneKey. */
  employeeKey?: string;
  identifiedAt?: Date;
  /** When we first sent the "classify this contact" Telegram message; no repeat until category is set. */
  categoryRequestSentAt?: Date;
  /** When we last sent a "confirm you've saved" reminder; used to avoid spam. */
  lastReminderSentAt?: Date;
}

const IdentifiedContactSchema = new Schema(
  {
    phoneNumber: { type: String, required: true, trim: true },
    employeeName: { type: String, required: true },
    deviceId: { type: String, default: '' },
    contactName: { type: String },
    category: {
      type: String,
      // Keep as string but restrict to known UI categories used across the dashboard.
      enum: [
        'personal',
        'staff',
        'Existing Client',
        'New Client',
        'courier',
        'Family',
        'Colleague',
        'Other',
      ],
    },
    savedInPhone: { type: Boolean, default: false },
    remindLater: { type: Boolean, default: false },
    telegramChatId: { type: String },
    phoneKey: { type: String },
    employeeKey: { type: String },
    identifiedAt: { type: Date },
    categoryRequestSentAt: { type: Date },
    lastReminderSentAt: { type: Date },
  },
  { timestamps: true }
);

// One record per (phone number, employee) pair
IdentifiedContactSchema.index({ phoneNumber: 1, employeeName: 1 }, { unique: true });
IdentifiedContactSchema.index({ phoneKey: 1, employeeKey: 1 }, { unique: true });
IdentifiedContactSchema.index({ employeeName: 1 });

function stampIdentityKeys(phoneNumber: unknown, employeeName: unknown) {
  return {
    ...(phoneNumber ? { phoneKey: phoneKeyOf(phoneNumber) } : {}),
    ...(typeof employeeName === 'string' && employeeName ? { employeeKey: employeeName.toLowerCase() } : {}),
  };
}

IdentifiedContactSchema.pre('save', function () {
  Object.assign(this, stampIdentityKeys(this.phoneNumber, this.employeeName));
});

IdentifiedContactSchema.pre('findOneAndUpdate', function () {
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

export default mongoose.models.IdentifiedContact ||
  mongoose.model<IIdentifiedContact>('IdentifiedContact', IdentifiedContactSchema);
