import connectToDatabase from '@/lib/db';
import CallLog from '@/models/CallLog';
import IdentifiedContact from '@/models/IdentifiedContact';
import UnknownNumberTracker from '@/models/UnknownNumberTracker';
import EmployeeTelegram from '@/models/EmployeeTelegram';
import { runContactIntelligence } from '@/lib/contactIntelligence';
import { escapeRegex } from '@/lib/telegramFormat';
import { phoneKeyOf } from '@/lib/contactNormalize';

const CALL_THRESHOLD = 5;
const TRACKER_RANK: Record<string, number> = {
  identified: 4,
  awaiting_category: 3,
  awaiting_name: 2,
  tracking: 1,
};

export type EmployeeSyncResult = {
  employeeName: string;
  linked: boolean;
  numbers: number;
  calls: number;
  contactsWritten: number;
  trackersWritten: number;
  duplicatesRemoved: number;
  claimed: number;
  promptsSent: number;
  promptsRemaining: number;
};

type PhoneGroup = {
  phoneNumber: string;
  callCount: number;
  knownName?: string;
  deviceId: string;
  firstSeen: Date;
  lastSeen: Date;
};

function identityKey(phone: string): string {
  return phoneKeyOf(phone) || String(phone || '').trim().toLowerCase();
}

function isDialable(phone: string): boolean {
  return phoneKeyOf(phone).length >= 6;
}

function nameQuery(employeeName: string) {
  return new RegExp(`^${escapeRegex(employeeName)}$`, 'i');
}

function knownContactName(names: unknown): string | undefined {
  if (!Array.isArray(names)) return undefined;
  const found = names.find((n) => typeof n === 'string' && n.trim() !== '' && n !== 'Unknown');
  return typeof found === 'string' ? found : undefined;
}

function pickKeeper<T extends { employeeName?: string; category?: string; contactName?: string; status?: string }>(
  rows: T[],
  canonical: string
): T | undefined {
  if (rows.length === 0) return undefined;
  return [...rows].sort((a, b) => {
    const score = (row: T) =>
      (row.category ? 8 : 0) +
      (TRACKER_RANK[row.status || ''] || 0) +
      (row.contactName ? 2 : 0) +
      (row.employeeName === canonical ? 1 : 0);
    return score(b) - score(a);
  })[0];
}

function nextTrackerStatus(existing: string | undefined, hasName: boolean, hasCategory: boolean): string {
  if (hasCategory || existing === 'identified') return 'identified';
  if (hasName) return 'awaiting_category';
  if (existing === 'awaiting_name' || existing === 'awaiting_category') return existing;
  return 'tracking';
}

async function loadPhoneGroups(employeeName: string): Promise<PhoneGroup[]> {
  const query = nameQuery(employeeName);
  const rows = await CallLog.aggregate([
    { $match: { employeeName: query, phoneNumber: { $nin: [null, ''] } } },
    {
      $project: {
        phoneNumber: 1,
        contactName: 1,
        timestamp: 1,
        duration: 1,
        deviceId: { $literal: '' },
      },
    },
    {
      $unionWith: {
        coll: 'devicecalllogs',
        pipeline: [
          { $match: { employeeName: query, phoneNumber: { $nin: [null, ''] } } },
          {
            $project: {
              phoneNumber: 1,
              contactName: 1,
              timestamp: 1,
              duration: 1,
              deviceId: { $ifNull: ['$deviceId', ''] },
            },
          },
        ],
      },
    },
    {
      $group: {
        _id: {
          phoneNumber: '$phoneNumber',
          timestamp: '$timestamp',
          duration: '$duration',
        },
        contactName: { $last: '$contactName' },
        deviceId: { $max: '$deviceId' },
      },
    },
    {
      $group: {
        _id: '$_id.phoneNumber',
        callCount: { $sum: 1 },
        names: { $addToSet: '$contactName' },
        deviceId: { $max: '$deviceId' },
        firstSeen: { $min: '$_id.timestamp' },
        lastSeen: { $max: '$_id.timestamp' },
      },
    },
  ]);

  return rows
    .filter((row) => row._id)
    .map((row) => ({
      phoneNumber: String(row._id),
      callCount: row.callCount,
      knownName: knownContactName(row.names),
      deviceId: row.deviceId || '',
      firstSeen: row.firstSeen ? new Date(row.firstSeen) : new Date(),
      lastSeen: row.lastSeen ? new Date(row.lastSeen) : new Date(),
    }));
}

/** Same subscriber number written with a country code or spaces is one contact. */
function mergeByPhoneKey(groups: PhoneGroup[]): PhoneGroup[] {
  const merged = new Map<string, PhoneGroup>();
  for (const group of groups) {
    const key = identityKey(group.phoneNumber);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...group });
      continue;
    }
    existing.callCount += group.callCount;
    if (!existing.knownName && group.knownName) existing.knownName = group.knownName;
    if (group.deviceId && !existing.deviceId) existing.deviceId = group.deviceId;
    if (group.firstSeen < existing.firstSeen) existing.firstSeen = group.firstSeen;
    if (group.lastSeen > existing.lastSeen) existing.lastSeen = group.lastSeen;
  }
  return [...merged.values()];
}

async function backfillIdentityKeys(model: { find: Function; findOne: Function; updateOne: Function; deleteOne: Function }, employeeName: string) {
  const missing = await model
    .find({
      employeeName: nameQuery(employeeName),
      $or: [
        { phoneKey: null },
        { phoneKey: { $exists: false } },
        { employeeKey: null },
        { employeeKey: { $exists: false } },
      ],
    })
    .select('_id phoneNumber employeeName')
    .lean();

  for (const row of missing as any[]) {
    const phoneKey = phoneKeyOf(row.phoneNumber);
    const employeeKey = String(row.employeeName || employeeName).toLowerCase();
    const clash = await model
      .findOne({ phoneKey, employeeKey, _id: { $ne: row._id } })
      .select('_id')
      .lean();
    if (clash) {
      await model.deleteOne({ _id: row._id });
      continue;
    }
    await model.updateOne({ _id: row._id }, { $set: { phoneKey, employeeKey } });
  }
}

/**
 * Make one linked employee's contact records match that device's call logs.
 * Counts are written from the logs, not incremented, so a second run cannot double them.
 * A Telegram prompt is sent only when that number has never successfully been asked.
 */
export async function syncEmployeeDeviceData(
  employeeName: string,
  maxSends = 12
): Promise<EmployeeSyncResult> {
  await connectToDatabase();
  await CallLog.collection
    .createIndex({ employeeName: 1, intelligenceClaimedAt: 1 }, { name: 'employee_sync' })
    .catch(() => undefined);

  const employee = await EmployeeTelegram.findOne({ employeeName: nameQuery(employeeName) }).lean() as {
    employeeName?: string;
    telegramChatId?: string | null;
  } | null;
  const canonical = employee?.employeeName || employeeName;
  const chatId = employee?.telegramChatId ? String(employee.telegramChatId) : null;
  const query = nameQuery(canonical);

  await Promise.all([
    backfillIdentityKeys(IdentifiedContact, canonical),
    backfillIdentityKeys(UnknownNumberTracker, canonical),
  ]);

  const [rawGroups, identifiedRows, trackerRows] = await Promise.all([
    loadPhoneGroups(canonical),
    IdentifiedContact.find({ employeeName: query }).lean() as Promise<any[]>,
    UnknownNumberTracker.find({ employeeName: query }).lean() as Promise<any[]>,
  ]);
  const groups = mergeByPhoneKey(rawGroups).filter((group) => isDialable(group.phoneNumber));
  const employeeKey = canonical.toLowerCase();

  const identifiedByPhone = new Map<string, any[]>();
  for (const row of identifiedRows) {
    const key = row.phoneKey || identityKey(row.phoneNumber);
    const list = identifiedByPhone.get(key) || [];
    list.push(row);
    identifiedByPhone.set(key, list);
  }
  const trackersByPhone = new Map<string, any[]>();
  for (const row of trackerRows) {
    const key = row.phoneKey || identityKey(row.phoneNumber);
    const list = trackersByPhone.get(key) || [];
    list.push(row);
    trackersByPhone.set(key, list);
  }

  const contactOps: any[] = [];
  const trackerOps: any[] = [];
  const contactDeleteIds: unknown[] = [];
  const trackerDeleteIds: unknown[] = [];
  let contactsWritten = 0;
  let trackersWritten = 0;

  for (const group of groups) {
    const key = identityKey(group.phoneNumber);
    const identifiedList = identifiedByPhone.get(key) || [];
    const trackerList = trackersByPhone.get(key) || [];
    const identified = pickKeeper(identifiedList, canonical);
    const tracker = pickKeeper(trackerList, canonical);
    for (const extra of identifiedList) {
      if (identified && String(extra._id) !== String(identified._id)) contactDeleteIds.push(extra._id);
    }
    for (const extra of trackerList) {
      if (tracker && String(extra._id) !== String(tracker._id)) trackerDeleteIds.push(extra._id);
    }

    const effectiveName = identified?.contactName || group.knownName;
    const hasCategory = !!identified?.category;

    if (effectiveName) {
      const setFields: Record<string, unknown> = {
        employeeName: canonical,
        employeeKey,
        phoneKey: key,
      };
      if (!identified?.contactName) setFields.contactName = effectiveName;
      if (chatId) setFields.telegramChatId = chatId;
      if (group.deviceId && !identified?.deviceId) setFields.deviceId = group.deviceId;

      if (identified) {
        contactOps.push({ updateOne: { filter: { _id: identified._id }, update: { $set: setFields } } });
      } else {
        contactOps.push({
          insertOne: {
            document: {
              phoneNumber: group.phoneNumber,
              employeeName: canonical,
              employeeKey,
              phoneKey: key,
              deviceId: group.deviceId || '',
              contactName: effectiveName,
              telegramChatId: chatId || undefined,
              savedInPhone: false,
              remindLater: false,
            },
          },
        });
      }
      contactsWritten++;
    }

    const shouldTrack = !effectiveName || !!tracker;
    if (shouldTrack && !effectiveName) {
      const preserved = trackerList.find((row) => row.nameRequestSentAt) || tracker;
      const status = nextTrackerStatus(preserved?.status, false, hasCategory);
      const setFields: Record<string, unknown> = {
        employeeName: canonical,
        employeeKey,
        phoneKey: key,
        callCount: group.callCount,
        lastSeen: group.lastSeen,
        status,
      };
      if (group.deviceId && !tracker?.deviceId) setFields.deviceId = group.deviceId;
      if (!tracker?.firstSeen) setFields.firstSeen = group.firstSeen;

      if (tracker) {
        trackerOps.push({ updateOne: { filter: { _id: tracker._id }, update: { $set: setFields } } });
      } else {
        trackerOps.push({
          insertOne: {
            document: {
              phoneNumber: group.phoneNumber,
              employeeName: canonical,
              employeeKey,
              phoneKey: key,
              deviceId: group.deviceId || '',
              callCount: group.callCount,
              firstSeen: group.firstSeen,
              lastSeen: group.lastSeen,
              status,
              ...(preserved?.nameRequestSentAt ? { nameRequestSentAt: preserved.nameRequestSentAt } : {}),
              ...(preserved?.telegramMessageId != null ? { telegramMessageId: preserved.telegramMessageId } : {}),
            },
          },
        });
      }
      trackersWritten++;
    } else if (tracker && effectiveName) {
      trackerOps.push({
        updateOne: {
          filter: { _id: tracker._id },
          update: {
            $set: {
              employeeName: canonical,
              employeeKey,
              phoneKey: key,
              callCount: group.callCount,
              lastSeen: group.lastSeen,
              status: nextTrackerStatus(tracker.status, true, hasCategory),
            },
          },
        },
      });
      trackersWritten++;
    }
  }

  if (contactDeleteIds.length > 0) {
    await IdentifiedContact.deleteMany({ _id: { $in: contactDeleteIds } });
  }
  if (trackerDeleteIds.length > 0) {
    await UnknownNumberTracker.deleteMany({ _id: { $in: trackerDeleteIds } });
  }
  if (contactOps.length > 0) await IdentifiedContact.bulkWrite(contactOps, { ordered: false });
  if (trackerOps.length > 0) await UnknownNumberTracker.bulkWrite(trackerOps, { ordered: false });

  if (chatId) {
    await IdentifiedContact.updateMany(
      { employeeName: query, telegramChatId: { $ne: chatId } },
      { $set: { telegramChatId: chatId } }
    );
  }

  const claimed = await CallLog.updateMany(
    { employeeName: query, intelligenceClaimedAt: null },
    { $set: { intelligenceClaimedAt: new Date() } }
  );

  const prompts = chatId
    ? await sendPendingPrompts(canonical, maxSends)
    : { sent: 0, remaining: 0 };

  return {
    employeeName: canonical,
    linked: !!chatId,
    numbers: groups.length,
    calls: groups.reduce((sum, group) => sum + group.callCount, 0),
    contactsWritten,
    trackersWritten,
    duplicatesRemoved: contactDeleteIds.length + trackerDeleteIds.length,
    claimed: claimed.modifiedCount ?? 0,
    promptsSent: prompts.sent,
    promptsRemaining: prompts.remaining,
  };
}

async function sendPendingPrompts(
  employeeName: string,
  maxSends: number
): Promise<{ sent: number; remaining: number }> {
  const query = nameQuery(employeeName);
  let sent = 0;
  const budget = Math.max(0, maxSends);

  const pendingContacts = await IdentifiedContact.find({
    employeeName: query,
    contactName: { $exists: true, $nin: [null, ''] },
    categoryRequestSentAt: null,
    $or: [{ category: null }, { category: { $exists: false } }],
  })
    .limit(budget)
    .lean() as any[];

  for (const contact of pendingContacts) {
    try {
      const outcome = await runContactIntelligence(
        contact.phoneNumber,
        contact.contactName,
        contact.employeeName,
        contact.deviceId || '',
        { countAsNewCall: false }
      );
      if (outcome.ok && outcome.step === 'CATEGORY_SENT') sent++;
      await new Promise((resolve) => setTimeout(resolve, 80));
    } catch (err) {
      console.error(`[EmployeeSync] Category prompt failed for ${contact.phoneNumber}:`, err);
    }
  }

  const nameBudget = budget - pendingContacts.length;
  if (nameBudget > 0) {
    const pendingTrackers = await UnknownNumberTracker.find({
      employeeName: query,
      $or: [
        { status: 'tracking', callCount: { $gte: CALL_THRESHOLD } },
        { status: 'awaiting_name', telegramMessageId: null, nameRequestSentAt: null },
      ],
    })
      .limit(nameBudget)
      .lean() as any[];

    for (const tracker of pendingTrackers) {
      try {
        const outcome = await runContactIntelligence(
          tracker.phoneNumber,
          undefined,
          tracker.employeeName,
          tracker.deviceId || '',
          { countAsNewCall: false }
        );
        if (outcome.ok && outcome.step === 'NAME_REQUEST_SENT') sent++;
        await new Promise((resolve) => setTimeout(resolve, 80));
      } catch (err) {
        console.error(`[EmployeeSync] Name prompt failed for ${tracker.phoneNumber}:`, err);
      }
    }
  }

  const [remainingContacts, remainingTrackers] = await Promise.all([
    IdentifiedContact.countDocuments({
      employeeName: query,
      contactName: { $exists: true, $nin: [null, ''] },
      categoryRequestSentAt: null,
      $or: [{ category: null }, { category: { $exists: false } }],
    }),
    UnknownNumberTracker.countDocuments({
      employeeName: query,
      $or: [
        { status: 'tracking', callCount: { $gte: CALL_THRESHOLD } },
        { status: 'awaiting_name', telegramMessageId: null, nameRequestSentAt: null },
      ],
    }),
  ]);

  return { sent, remaining: remainingContacts + remainingTrackers };
}

/** Reconcile every employee whose Telegram is already linked to their device number. */
export async function syncLinkedEmployees(maxSendsPerEmployee = 8): Promise<EmployeeSyncResult[]> {
  await connectToDatabase();
  const linked = await EmployeeTelegram.find({
    telegramChatId: { $nin: [null, ''] },
  })
    .select('employeeName')
    .lean() as Array<{ employeeName?: string }>;

  const results: EmployeeSyncResult[] = [];
  for (const employee of linked) {
    if (!employee.employeeName) continue;
    const unclaimed = await CallLog.exists({
      employeeName: nameQuery(employee.employeeName),
      intelligenceClaimedAt: null,
    });
    if (unclaimed) {
      results.push(await syncEmployeeDeviceData(employee.employeeName, maxSendsPerEmployee));
      continue;
    }
    const prompts = await sendPendingPrompts(employee.employeeName, maxSendsPerEmployee);
    if (prompts.sent > 0 || prompts.remaining > 0) {
      results.push({
        employeeName: employee.employeeName,
        linked: true,
        numbers: 0,
        calls: 0,
        contactsWritten: 0,
        trackersWritten: 0,
        duplicatesRemoved: 0,
        claimed: 0,
        promptsSent: prompts.sent,
        promptsRemaining: prompts.remaining,
      });
    }
  }
  return results;
}
