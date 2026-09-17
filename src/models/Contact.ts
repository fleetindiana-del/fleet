import mongoose, { Schema, Document } from 'mongoose';

export interface IContact extends Document {
  deviceId: string;
  employeeName: string;
  contactName: string;
  phoneNumber: string;
  // Indexed merge keys, stamped at write time (see src/lib/contactNormalize.ts)
  // so the merge job can cluster records via index lookups instead of
  // recomputing/scanning normalized values across the whole collection.
  nameKey: string;
  phoneKey: string;
  timestamp: Date;
  syncedAt: Date;
}

const ContactSchema = new Schema(
  {
    deviceId: { type: String, required: true },
    employeeName: { type: String, default: 'Unknown' },
    contactName: { type: String, required: true },
    phoneNumber: { type: String, required: true },
    nameKey: { type: String, default: '' },
    phoneKey: { type: String, default: '' },
    timestamp: { type: Date, required: true },
    syncedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

ContactSchema.index({ deviceId: 1, phoneNumber: 1 }, { unique: true });
ContactSchema.index({ employeeName: 1 });
ContactSchema.index({ phoneKey: 1 });
ContactSchema.index({ nameKey: 1 });

export default mongoose.models.Contact || mongoose.model<IContact>('Contact', ContactSchema);
