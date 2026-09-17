import mongoose, { Schema, Document } from 'mongoose';

/**
 * Singleton doc (one row, _id "contacts") tracking the contact-merge job.
 * `isRunning` is flipped atomically via findOneAndUpdate so concurrent
 * serverless invocations can't both kick off a merge pass at once.
 */
export interface IMergeState extends Document {
  isRunning: boolean;
  startedAt?: Date;
  lastRunAt?: Date;
  lastRunDurationMs?: number;
  lastRunClusterCount?: number;
}

const MergeStateSchema = new Schema({
  _id: { type: String, required: true },
  isRunning: { type: Boolean, default: false },
  startedAt: { type: Date },
  lastRunAt: { type: Date },
  lastRunDurationMs: { type: Number },
  lastRunClusterCount: { type: Number },
});

export default mongoose.models.MergeState ||
  mongoose.model<IMergeState>('MergeState', MergeStateSchema);
