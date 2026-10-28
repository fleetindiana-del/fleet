import mongoose, { Schema, Document } from 'mongoose';

export interface IMergedContactSource {
  employeeName: string;
  deviceId: string;
  phoneNumber: string;
  /** Name this employee saved on their device for this number. */
  contactName: string;
  syncedAt?: Date;
}

/**
 * The consolidated, de-duplicated view the Contact Bank page reads. Built by
 * src/lib/contactMerge.ts from the raw per-device `Contact` collection: every
 * raw contact that shares a normalized name OR a normalized phone number with
 * another ends up in the same cluster here, with every phone number, the name
 * each employee saved it under, and every contributing employee/device retained
 * (see IMergedContactSource) so nothing is dropped by the merge.
 */
export interface IMergedContact extends Document {
  clusterKey: string;
  contactName: string;
  nameKey: string;
  phoneNumbers: string[];
  phoneKeys: string[];
  sources: IMergedContactSource[];
  sourceCount: number;
  lastSyncedAt?: Date;
  mergeRunId: string;
  createdAt: Date;
  updatedAt: Date;
}

const MergedContactSchema = new Schema(
  {
    // Stable hash of the raw Contact _ids that make up this cluster — lets the
    // merge job upsert unchanged clusters as no-ops instead of rewriting the
    // whole collection on every run.
    clusterKey: { type: String, required: true, unique: true },
    contactName: { type: String, required: true },
    nameKey: { type: String, default: '' },
    phoneNumbers: { type: [String], default: [] },
    phoneKeys: { type: [String], default: [] },
    sources: [
      {
        _id: false,
        employeeName: { type: String, default: 'Unknown' },
        deviceId: { type: String, default: '' },
        phoneNumber: { type: String, default: '' },
        contactName: { type: String, default: '' },
        syncedAt: { type: Date },
      },
    ],
    sourceCount: { type: Number, default: 0 },
    lastSyncedAt: { type: Date },
    // Generation tag for the "mark and sweep" rebuild: any doc whose
    // mergeRunId doesn't match the latest run is a stale cluster and gets
    // deleted at the end of that run.
    mergeRunId: { type: String, required: true, index: true },
  },
  { timestamps: true }
);

MergedContactSchema.index({ nameKey: 1 });
MergedContactSchema.index({ phoneKeys: 1 });
MergedContactSchema.index({ lastSyncedAt: -1 });

// Re-register in dev so a schema change (like remembering the name each
// employee saved) is not stuck behind the model compiled on first import.
// Next keeps that compiled model for the life of the process, and mongoose
// would otherwise drop the new field on write.
if (process.env.NODE_ENV === "development" && mongoose.models.MergedContact) {
  mongoose.deleteModel("MergedContact");
}

export default mongoose.models.MergedContact ||
  mongoose.model<IMergedContact>('MergedContact', MergedContactSchema);
