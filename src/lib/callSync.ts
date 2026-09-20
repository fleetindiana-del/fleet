import connectToDatabase from '@/lib/db';
import CallLog from '@/models/CallLog';
import DeviceCallLog from '@/models/DeviceCallLog';
import UnknownNumberTracker from '@/models/UnknownNumberTracker';
import IntelligenceCheckpoint from '@/models/IntelligenceCheckpoint';
import EmployeeTelegram from '@/models/EmployeeTelegram';
import { runContactIntelligence } from '@/lib/contactIntelligence';
import { escapeRegex } from '@/lib/telegramFormat';

let syncIndexReady: Promise<void> | null = null;

function ensureSyncIndex(): Promise<void> {
  if (!syncIndexReady) {
    syncIndexReady = CallLog.collection
      .createIndex({ createdAt: 1, intelligenceClaimedAt: 1 }, { name: 'call_sync_cursor' })
      .then(() => undefined)
      .catch((err) => {
        syncIndexReady = null;
        console.error('[callSync] could not ensure sync index', err);
      });
  }
  return syncIndexReady;
}

/** Newest stored name for a number, matching employee spelling case-insensitively. */
export async function latestKnownCall(
  phoneNumber: string,
  employeeName: string
): Promise<{ contactName?: string; deviceId?: string }> {
  await connectToDatabase();
  const nameQuery = new RegExp(`^${escapeRegex(employeeName)}$`, 'i');
  const [fromCalls, fromDevice] = await Promise.all([
    CallLog.findOne({ phoneNumber, employeeName: nameQuery })
      .sort({ timestamp: -1 })
      .select('contactName')
      .lean() as Promise<{ contactName?: string } | null>,
    DeviceCallLog.findOne({ phoneNumber, employeeName: nameQuery })
      .sort({ timestamp: -1 })
      .select('contactName deviceId')
      .lean() as Promise<{ contactName?: string; deviceId?: string } | null>,
  ]);

  const callName = fromCalls?.contactName;
  const deviceName = fromDevice?.contactName;
  const contactName =
    callName && callName !== 'Unknown' ? callName : deviceName && deviceName !== 'Unknown' ? deviceName : undefined;

  return { contactName, deviceId: fromDevice?.deviceId };
}

const DEFAULT_BATCH = 60;
/** Do not replay months of old calls into Telegram. Sync the recent window, then stay current. */
const MAX_LAG_MS = 48 * 60 * 60 * 1000;

export type CallSyncResult = {
  processed: number;
  fetched: number;
  skippedHistorical: boolean;
  cursor: string;
};

/**
 * Pull newly stored call logs into contact intelligence.
 * Live calls are written straight into CallLog by the phone sync, so this is the
 * circulation step that creates trackers and Telegram prompts.
 * Each call is claimed once, so overlapping dashboard and cron runs cannot double-count.
 */
export async function syncIncomingCalls(batchSize = DEFAULT_BATCH): Promise<CallSyncResult> {
  await connectToDatabase();
  await ensureSyncIndex();

  let checkpoint = await IntelligenceCheckpoint.findOne({ key: 'process_cursor' });
  const now = new Date();
  if (!checkpoint) {
    checkpoint = await IntelligenceCheckpoint.create({
      key: 'process_cursor',
      lastProcessedAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
    });
  }

  let since = new Date(checkpoint.lastProcessedAt);
  let skippedHistorical = false;
  if (now.getTime() - since.getTime() > MAX_LAG_MS) {
    since = new Date(now.getTime() - MAX_LAG_MS);
    skippedHistorical = true;
  }

  const linked = await EmployeeTelegram.find({
    telegramChatId: { $nin: [null, ''] },
  })
    .select('employeeName')
    .lean() as Array<{ employeeName?: string }>;
  const linkedNames = linked
    .filter((row) => row.employeeName)
    .map((row) => ({ employeeName: new RegExp(`^${escapeRegex(String(row.employeeName))}$`, 'i') }));

  const calls = await CallLog.find({
    createdAt: { $gt: since },
    intelligenceClaimedAt: null,
    ...(linkedNames.length > 0 ? { $nor: linkedNames } : {}),
  })
    .sort({ createdAt: 1, _id: 1 })
    .limit(batchSize)
    .select('phoneNumber contactName employeeName deviceId createdAt')
    .lean();

  let processed = 0;
  let lastCreatedAt: Date | null = null;

  for (const call of calls) {
    const row = call as any;
    if (row.createdAt) lastCreatedAt = new Date(row.createdAt);
    if (!row.phoneNumber || !row.employeeName) continue;

    const claimed = await CallLog.findOneAndUpdate(
      { _id: row._id, intelligenceClaimedAt: null },
      { $set: { intelligenceClaimedAt: new Date() } }
    );
    if (!claimed) continue;

    const alreadyWaiting = await UnknownNumberTracker.findOne({
      phoneNumber: row.phoneNumber,
      employeeName: new RegExp(`^${escapeRegex(row.employeeName)}$`, 'i'),
      status: { $in: ['awaiting_name', 'awaiting_category'] },
    })
      .select('_id')
      .lean();
    if (alreadyWaiting) continue;

    const contactName = row.contactName;
    const resolvedName =
      contactName && contactName !== 'Unknown' && contactName !== '' ? contactName : undefined;

    await runContactIntelligence(row.phoneNumber, resolvedName, row.employeeName, row.deviceId || '', {
      countAsNewCall: true,
    });
    processed++;
  }

  const caughtUp = calls.length < batchSize;
  const nextCursor = !caughtUp && lastCreatedAt ? new Date(lastCreatedAt.getTime() - 1) : now;
  await IntelligenceCheckpoint.updateOne(
    { key: 'process_cursor' },
    { lastProcessedAt: nextCursor },
    { upsert: true }
  );

  return {
    processed,
    fetched: calls.length,
    skippedHistorical,
    cursor: nextCursor.toISOString(),
  };
}

/** Drain the recent window. Used by the daily cron so sync does not depend on the dashboard staying open. */
export async function syncIncomingCallsUntilCaughtUp(maxBatches = 8, batchSize = 80): Promise<CallSyncResult> {
  let processed = 0;
  let fetched = 0;
  let skippedHistorical = false;
  let cursor = new Date().toISOString();

  for (let i = 0; i < maxBatches; i++) {
    const batch = await syncIncomingCalls(batchSize);
    processed += batch.processed;
    fetched += batch.fetched;
    skippedHistorical = skippedHistorical || batch.skippedHistorical;
    cursor = batch.cursor;
    if (batch.fetched < batchSize) break;
  }

  return { processed, fetched, skippedHistorical, cursor };
}
