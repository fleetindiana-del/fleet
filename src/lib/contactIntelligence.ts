/**
 * Contact Intelligence Engine
 * Called after every call log is saved from the Android app.
 *
 * Decision tree:
 * 1. Check IdentifiedContact — if fully identified (name + category) → reminder only
 * 2. Check Contact (phone contacts) — if number is saved in phone:
 *    a. If IdentifiedContact exists but has no category → send category keyboard
 *    b. If no IdentifiedContact → create one (use contactName from phone), send category keyboard
 * 3. If not in phone contacts:
 *    a. Upsert UnknownNumberTracker, increment callCount (new calls only)
 *    b. If callCount reaches threshold (5) and status is 'tracking' → send name request
 * 4. Smart reminder: if IdentifiedContact exists but savedInPhone=false → send reminder (once per cooldown,
 *    or once on the next call after "Remind Later")
 */

import connectToDatabase from '@/lib/db';
import Contact from '@/models/Contact';
import IdentifiedContact from '@/models/IdentifiedContact';
import UnknownNumberTracker from '@/models/UnknownNumberTracker';
import EmployeeTelegram from '@/models/EmployeeTelegram';
import BotLog from '@/models/BotLog';
import {
  sendInlineKeyboard,
  categoryKeyboard,
  saveContactKeyboard,
  nameRequestKeyboard,
} from '@/lib/telegram';
import { escapeHtml, escapeRegex, shouldSendSaveReminder } from '@/lib/telegramFormat';

const CALL_THRESHOLD = 5;
/** Cooldown for "save contact in phone" reminders after the contact is fully classified. */
const CATEGORY_REQUEST_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const STALE_PROMPT_MS = 2 * 24 * 60 * 60 * 1000;

export type IntelligenceOptions = {
  /**
   * True for a real new call (increments Scenario B).
   * False for retries, manual sends, and post-registration catch-up.
   */
  countAsNewCall?: boolean;
  /** Manual send: if still tracking below the threshold, raise it once so the prompt can go out. */
  ensureAtThreshold?: boolean;
};

export type IntelligenceResult = {
  ok: boolean;
  step: string;
  message: string;
};

function result(ok: boolean, step: string, message: string): IntelligenceResult {
  return { ok, step, message };
}

function h(value: unknown): string {
  return escapeHtml(String(value ?? ''));
}

async function log(
  level: 'info' | 'warn' | 'error' | 'success',
  step: string,
  message: string,
  data?: Record<string, any>,
  employeeName?: string,
  phoneNumber?: string
) {
  try {
    console.log(`[BotLog][${level.toUpperCase()}][${step}] ${message}`, data ?? '');
    await BotLog.create({ level, step, message, data: data ?? null, employeeName, phoneNumber });
  } catch {
    // Never let logging break the pipeline
  }
}

async function chatIdForEmployee(employeeName: string): Promise<string | null> {
  const empTelegram = await EmployeeTelegram.findOne({
    employeeName: new RegExp(`^${escapeRegex(employeeName)}$`, 'i'),
  }).lean() as any;
  const chatId = empTelegram?.telegramChatId;
  return chatId ? String(chatId) : null;
}

export async function runContactIntelligence(
  phoneNumber: string,
  contactName: string | undefined,
  employeeName: string,
  deviceId: string,
  options?: IntelligenceOptions
): Promise<IntelligenceResult> {
  const countAsNewCall = options?.countAsNewCall !== false;

  try {
    await connectToDatabase();

    // Keep one record per number even when call logs and Telegram Setup spell the name differently.
    const prior = await IdentifiedContact.findOne({
      phoneNumber,
      employeeName: new RegExp(`^${escapeRegex(employeeName)}$`, 'i'),
    }).select('employeeName').lean() as { employeeName?: string } | null
      || await UnknownNumberTracker.findOne({
        phoneNumber,
        employeeName: new RegExp(`^${escapeRegex(employeeName)}$`, 'i'),
      }).select('employeeName').lean() as { employeeName?: string } | null;
    if (prior?.employeeName) {
      employeeName = prior.employeeName;
    }

    await log('info', 'START', `Intelligence triggered`, { phoneNumber, contactName, employeeName, deviceId, countAsNewCall }, employeeName, phoneNumber);

    const empTelegram = await EmployeeTelegram.findOne({
      employeeName: new RegExp(`^${escapeRegex(employeeName)}$`, 'i'),
    }).lean() as any;
    const chatId: string | null = empTelegram?.telegramChatId ? String(empTelegram.telegramChatId) : null;

    await log(
      empTelegram ? (chatId ? 'success' : 'warn') : 'error',
      'LOOKUP_EMPLOYEE',
      empTelegram
        ? chatId
          ? `Employee "${employeeName}" found with chatId ${chatId}`
          : `Employee "${employeeName}" found in DB but Telegram NOT linked yet (no chatId) — employee must open bot and send /start + phone number`
        : `Employee "${employeeName}" NOT in EmployeeTelegram table — admin must add their phone number in Telegram Setup page first`,
      { empTelegramRecord: empTelegram ?? null },
      employeeName,
      phoneNumber
    );

    const identified = await IdentifiedContact.findOne({ phoneNumber, employeeName });

    if (identified?.contactName && identified?.category) {
      await UnknownNumberTracker.updateOne(
        { phoneNumber, employeeName, status: { $ne: 'identified' } },
        { $set: { status: 'identified' } }
      );
      await log('info', 'SKIP_FULLY_DONE', `Contact already fully classified — name: "${identified.contactName}", category: "${identified.category}"`, undefined, employeeName, phoneNumber);
      const reminded = await maybeSendSaveReminder(identified, chatId, phoneNumber, employeeName);
      if (reminded === 'sent') {
        return result(true, 'REMINDER_SENT', 'Save-to-phone reminder sent');
      }
      if (reminded === 'failed') {
        return result(false, 'REMINDER_FAILED', 'Save-to-phone reminder failed');
      }
      return result(true, 'SKIP_FULLY_DONE', 'Contact already fully classified');
    }

    const isKnownContact = !!contactName && contactName !== 'Unknown';
    let phoneContactName = contactName;

    if (!isKnownContact) {
      const phoneContact = await Contact.findOne({ deviceId, phoneNumber }).lean() as any;
      if (phoneContact?.contactName) {
        phoneContactName = phoneContact.contactName;
        await log('info', 'CONTACT_DB_FALLBACK', `Found contact in DB: "${phoneContact.contactName}"`, undefined, employeeName, phoneNumber);
      }
    }

    if (phoneContactName && phoneContactName !== 'Unknown') {
      const name = phoneContactName;
      await log('info', 'SCENARIO_A', `Scenario A — known contact: "${name}"`, undefined, employeeName, phoneNumber);

      await UnknownNumberTracker.updateOne(
        { phoneNumber, employeeName, status: { $in: ['tracking', 'awaiting_name'] } },
        { $set: { status: 'awaiting_category' } }
      );

      if (!identified) {
        await IdentifiedContact.create({
          phoneNumber,
          employeeName,
          deviceId,
          contactName: name,
          telegramChatId: chatId ?? undefined,
        });
        await log('info', 'IDENTIFIED_CREATED', `Created IdentifiedContact for "${name}"`, undefined, employeeName, phoneNumber);
      } else {
        const setFields: Record<string, unknown> = {};
        if (!identified.contactName) setFields.contactName = name;
        if (chatId && !identified.telegramChatId) setFields.telegramChatId = chatId;
        if (deviceId && !identified.deviceId) setFields.deviceId = deviceId;
        if (Object.keys(setFields).length > 0) {
          await IdentifiedContact.updateOne({ phoneNumber, employeeName }, { $set: setFields });
        }
      }

      if (!chatId) {
        await log('warn', 'NO_CHATID', `Cannot send Telegram — employee "${employeeName}" has no linked Telegram chatId. They need to open the bot, send /start, then send their 10-digit phone number.`, undefined, employeeName, phoneNumber);
        return result(false, 'NO_CHATID', `Employee "${employeeName}" has no linked Telegram`);
      }

      const claimed = await IdentifiedContact.findOneAndUpdate(
        {
          phoneNumber,
          employeeName,
          contactName: { $exists: true, $nin: [null, ''] },
          category: null,
          categoryRequestSentAt: null,
        },
        { $set: { categoryRequestSentAt: new Date(), telegramChatId: chatId } },
        { new: true }
      );

      if (!claimed) {
        await log(
          'info',
          'SKIP_CATEGORY_ALREADY_SENT',
          `Category Telegram already sent for "${name}" — not sending again until category is chosen`,
          undefined,
          employeeName,
          phoneNumber
        );
        return result(true, 'CATEGORY_ALREADY_SENT', 'Category prompt already sent');
      }

      await log('info', 'SENDING_CATEGORY', `Sending category keyboard to chatId ${chatId} for "${name}"`, undefined, employeeName, phoneNumber);
      const sentResult = await sendCategoryRequest(chatId, name, phoneNumber, employeeName);
      if (sentResult?.ok === true) {
        await log('success', 'MESSAGE_SENT', `Category keyboard sent successfully`, { telegramResult: sentResult }, employeeName, phoneNumber);
        return result(true, 'CATEGORY_SENT', 'Category keyboard sent');
      }

      await IdentifiedContact.updateOne({ phoneNumber, employeeName }, { $unset: { categoryRequestSentAt: 1 } });
      await log(
        'error',
        'MESSAGE_SEND_FAILED',
        `Category keyboard failed — cleared claim for retry`,
        { telegramResult: sentResult },
        employeeName,
        phoneNumber
      );
      return result(false, 'CATEGORY_FAILED', 'Category keyboard failed to send');
    }

    await log('info', 'SCENARIO_B', `Scenario B — unknown number (not in phone contacts)`, undefined, employeeName, phoneNumber);

    const now = new Date();
    let tracker: any;

    if (countAsNewCall) {
      tracker = await UnknownNumberTracker.findOneAndUpdate(
        { phoneNumber, employeeName },
        {
          $inc: { callCount: 1 },
          $set: { lastSeen: now },
          $setOnInsert: { firstSeen: now, status: 'tracking', deviceId },
        },
        { upsert: true, new: true }
      );
    } else {
      tracker = await UnknownNumberTracker.findOne({ phoneNumber, employeeName });
      if (!tracker && options?.ensureAtThreshold) {
        tracker = await UnknownNumberTracker.create({
          phoneNumber,
          employeeName,
          deviceId,
          callCount: CALL_THRESHOLD,
          firstSeen: now,
          lastSeen: now,
          status: 'tracking',
        });
      }
    }

    if (!tracker) {
      await log('info', 'NO_TRACKER', `No tracker to retry for ${phoneNumber}`, undefined, employeeName, phoneNumber);
      return result(false, 'NO_TRACKER', 'No unknown-number tracker to send');
    }

    if (
      options?.ensureAtThreshold &&
      tracker.status === 'tracking' &&
      tracker.callCount < CALL_THRESHOLD
    ) {
      tracker.callCount = CALL_THRESHOLD;
      tracker.lastSeen = now;
      await tracker.save();
    }

    await log('info', 'TRACKER_UPDATED', `Call count: ${tracker.callCount}/${CALL_THRESHOLD}, status: "${tracker.status}"`, { tracker: { callCount: tracker.callCount, status: tracker.status } }, employeeName, phoneNumber);

    if (tracker.callCount >= CALL_THRESHOLD && chatId) {
      if (tracker.status === 'tracking') {
        const transitioned = await UnknownNumberTracker.findOneAndUpdate(
          { _id: tracker._id, status: 'tracking', callCount: { $gte: CALL_THRESHOLD } },
          { $set: { status: 'awaiting_name', nameRequestSentAt: new Date() } },
          { new: true }
        );

        if (!transitioned) {
          await log(
            'info',
            'SKIP_NAME_THRESHOLD_RACE',
            `Threshold already handled by another request for ${phoneNumber}`,
            undefined,
            employeeName,
            phoneNumber
          );
          return result(true, 'NAME_REQUEST_ALREADY_SENT', 'Name request already in progress');
        }

        await log(
          'info',
          'THRESHOLD_REACHED',
          `Threshold of ${CALL_THRESHOLD} calls reached — sending name request to chatId ${chatId}`,
          undefined,
          employeeName,
          phoneNumber
        );
        const sentResult = await sendNameRequest(chatId, phoneNumber, employeeName, transitioned.callCount);
        const messageId = sentResult?.result?.message_id;

        if (sentResult?.ok === true) {
          if (messageId != null) {
            await UnknownNumberTracker.updateOne({ _id: tracker._id }, { $set: { telegramMessageId: messageId } });
          }
          await log(
            'success',
            'NAME_REQUEST_SENT',
            `Name request sent — messageId: ${messageId}`,
            { telegramResult: sentResult },
            employeeName,
            phoneNumber
          );
          return result(true, 'NAME_REQUEST_SENT', 'Name request sent');
        }

        await UnknownNumberTracker.updateOne(
          { _id: tracker._id },
          { $set: { status: 'tracking' }, $unset: { nameRequestSentAt: 1 } }
        );
        await log(
          'error',
          'NAME_REQUEST_FAILED',
          `Failed to send Telegram name request (ok=${sentResult?.ok}) — reverted to tracking for retry`,
          { telegramResult: sentResult },
          employeeName,
          phoneNumber
        );
        return result(false, 'NAME_REQUEST_FAILED', 'Name request failed to send');
      }

      if (
        tracker.status === 'awaiting_name' &&
        !tracker.telegramMessageId &&
        !tracker.nameRequestSentAt
      ) {
        const claimed = await UnknownNumberTracker.findOneAndUpdate(
          {
            _id: tracker._id,
            status: 'awaiting_name',
            nameRequestSentAt: null,
            telegramMessageId: null,
          },
          { $set: { nameRequestSentAt: new Date() } },
          { new: true }
        );
        if (!claimed) {
          return result(true, 'NAME_REQUEST_ALREADY_SENT', 'Name request already in progress');
        }

        await log(
          'info',
          'NAME_REQUEST_RETRY',
          `Retrying name request (never successfully sent) for ${phoneNumber}`,
          undefined,
          employeeName,
          phoneNumber
        );
        const sentResult = await sendNameRequest(chatId, phoneNumber, employeeName, tracker.callCount ?? CALL_THRESHOLD);
        if (sentResult?.ok === true) {
          const setFields: Record<string, unknown> = {};
          if (sentResult?.result?.message_id != null) {
            setFields.telegramMessageId = sentResult.result.message_id;
          }
          if (Object.keys(setFields).length > 0) {
            await UnknownNumberTracker.updateOne({ _id: tracker._id }, { $set: setFields });
          }
          await log('success', 'NAME_REQUEST_RETRY_SENT', `Name request sent on retry`, { telegramResult: sentResult }, employeeName, phoneNumber);
          return result(true, 'NAME_REQUEST_SENT', 'Name request sent');
        }

        await UnknownNumberTracker.updateOne({ _id: tracker._id }, { $unset: { nameRequestSentAt: 1 } });
        return result(false, 'NAME_REQUEST_FAILED', 'Name request retry failed');
      }

      if (tracker.status === 'awaiting_name' && (tracker.telegramMessageId || tracker.nameRequestSentAt)) {
        return result(true, 'NAME_REQUEST_ALREADY_SENT', 'Name request already sent');
      }
    } else if (tracker.status === 'tracking' && tracker.callCount >= CALL_THRESHOLD && !chatId) {
      await log('warn', 'THRESHOLD_NO_CHATID', `5 calls reached but employee "${employeeName}" has no Telegram linked — cannot send name request`, undefined, employeeName, phoneNumber);
      return result(false, 'NO_CHATID', `Employee "${employeeName}" has no linked Telegram`);
    } else if (tracker.status !== 'tracking' && tracker.status !== 'awaiting_name' && tracker.status !== 'awaiting_category') {
      if (identified) {
        const reminded = await maybeSendSaveReminder(identified, chatId, phoneNumber, employeeName);
        if (reminded === 'sent') return result(true, 'REMINDER_SENT', 'Save-to-phone reminder sent');
        if (reminded === 'failed') return result(false, 'REMINDER_FAILED', 'Save-to-phone reminder failed');
      }
    } else {
      await log('info', 'TRACKING', `Tracking ${tracker.callCount}/${CALL_THRESHOLD} calls — no action yet`, undefined, employeeName, phoneNumber);
      return result(true, 'TRACKING', `Tracking ${tracker.callCount}/${CALL_THRESHOLD} calls`);
    }

    return result(true, 'TRACKING', `Tracking ${tracker.callCount}/${CALL_THRESHOLD} calls`);
  } catch (err: any) {
    console.error('[ContactIntelligence] Error:', err);
    try {
      await BotLog.create({
        level: 'error',
        step: 'UNHANDLED_ERROR',
        message: err?.message ?? 'Unknown error in contactIntelligence',
        data: { stack: err?.stack },
        employeeName,
        phoneNumber,
      });
    } catch { /* ignore */ }
    return result(false, 'UNHANDLED_ERROR', err?.message ?? 'Unknown error in contact intelligence');
  }
}

async function maybeSendSaveReminder(
  identified: any,
  chatId: string | null,
  phoneNumber: string,
  employeeName: string
): Promise<'sent' | 'failed' | 'skipped'> {
  const decision = shouldSendSaveReminder({
    savedInPhone: !!identified.savedInPhone,
    remindLater: !!identified.remindLater,
    lastReminderSentAt: identified.lastReminderSentAt ? new Date(identified.lastReminderSentAt).getTime() : null,
    now: Date.now(),
    cooldownMs: CATEGORY_REQUEST_COOLDOWN_MS,
    hasChat: !!chatId,
  });
  if (decision === 'skip' || !chatId) return 'skipped';

  if (decision === 'remind_later_once') {
    const claimed = await IdentifiedContact.findOneAndUpdate(
      { phoneNumber, employeeName, remindLater: true, savedInPhone: false },
      { $set: { remindLater: false, lastReminderSentAt: new Date() } }
    );
    if (!claimed) return 'skipped';
    await log('info', 'REMINDER', `Sending save-to-phone reminder (remind later)`, undefined, employeeName, phoneNumber);
    const sentResult = await sendSmartReminder(chatId, phoneNumber, employeeName, identified.contactName ?? null, identified.category ?? '');
    if (sentResult?.ok === true) return 'sent';
    await IdentifiedContact.updateOne(
      { phoneNumber, employeeName },
      { $set: { remindLater: true }, $unset: { lastReminderSentAt: 1 } }
    );
    return 'failed';
  }

  const cutoff = new Date(Date.now() - CATEGORY_REQUEST_COOLDOWN_MS);
  const claimed = await IdentifiedContact.findOneAndUpdate(
    {
      phoneNumber,
      employeeName,
      savedInPhone: false,
      remindLater: { $ne: true },
      $or: [{ lastReminderSentAt: null }, { lastReminderSentAt: { $lte: cutoff } }],
    },
    { $set: { lastReminderSentAt: new Date() } }
  );
  if (!claimed) return 'skipped';

  await log('info', 'REMINDER', `Sending save-to-phone reminder`, undefined, employeeName, phoneNumber);
  const sentResult = await sendSmartReminder(chatId, phoneNumber, employeeName, identified.contactName ?? null, identified.category ?? '');
  if (sentResult?.ok === true) return 'sent';

  const previous = claimed.lastReminderSentAt;
  if (previous) {
    await IdentifiedContact.updateOne({ phoneNumber, employeeName }, { $set: { lastReminderSentAt: previous } });
  } else {
    await IdentifiedContact.updateOne({ phoneNumber, employeeName }, { $unset: { lastReminderSentAt: 1 } });
  }
  return 'failed';
}

async function sendCategoryRequest(
  chatId: string,
  contactName: string,
  phoneNumber: string,
  employeeName: string
) {
  const keyboard = categoryKeyboard(phoneNumber, employeeName);
  if (!keyboard) {
    return { ok: false, description: 'Category keyboard payload exceeds Telegram limits' };
  }

  const text =
    `📞 <b>Scenario A — Please classify this contact</b>\n\n` +
    `Employee: <b>${h(employeeName)}</b>\n` +
    `Contact Name: <b>${h(contactName)}</b>\n` +
    `Number: <code>${h(phoneNumber)}</code>\n\n` +
    `Who is this person?`;

  return sendInlineKeyboard(chatId, text, keyboard);
}

async function sendNameRequest(
  chatId: string,
  phoneNumber: string,
  employeeName: string,
  callCount: number
) {
  const keyboard = nameRequestKeyboard(phoneNumber, employeeName, chatId);
  const text =
    `⚠️ <b>Scenario B — Contact Identification Needed</b>\n\n` +
    `Employee: <b>${h(employeeName)}</b>\n` +
    `Number: <code>${h(phoneNumber)}</code>\n` +
    `Call Count: <b>${callCount}</b>\n\n` +
    `This number has appeared <b>${callCount} times</b> in call logs.\n\n` +
    `Tap the button below to enter the contact name, or reply to this message with the name.`;

  return sendInlineKeyboard(chatId, text, keyboard);
}

async function sendSmartReminder(
  chatId: string,
  phoneNumber: string,
  employeeName: string,
  contactName: string | null,
  _category: string
) {
  const keyboard = saveContactKeyboard(phoneNumber, employeeName);
  if (!keyboard) {
    return { ok: false, description: 'Save-contact keyboard payload exceeds Telegram limits' };
  }
  const displayName = contactName && contactName !== phoneNumber ? contactName : null;
  const detailLine = displayName
    ? `Name: <b>${h(displayName)}</b>\nNumber: <code>${h(phoneNumber)}</code>`
    : `Number: <code>${h(phoneNumber)}</code>`;
  const text =
    `Confirm once you've saved this contact in your phone?\n\n` +
    detailLine;

  return sendInlineKeyboard(chatId, text, keyboard);
}

/**
 * Daily 8 AM job.
 * - Scenario A/B: send prompts that never went out, and resend only if the last
 *   successful prompt is older than 2 days and still unresolved.
 * - Save reminder: at most once per cooldown, and only when Telegram accepts the message.
 */
export async function runDailyPendingReminders(): Promise<{ category: number; nameRequest: number; saveReminder: number }> {
  await connectToDatabase();
  const counts = { category: 0, nameRequest: 0, saveReminder: 0 };
  const now = new Date();
  const twoDaysAgo = new Date(Date.now() - STALE_PROMPT_MS);
  const reminderCutoff = new Date(Date.now() - CATEGORY_REQUEST_COOLDOWN_MS);

  const linkedEmployees = await EmployeeTelegram.find({
    telegramChatId: { $exists: true, $nin: [null, ''] },
  }).lean() as any[];
  const chatByEmployee = new Map<string, string>();
  for (const emp of linkedEmployees) {
    if (emp.employeeName && emp.telegramChatId) {
      chatByEmployee.set(String(emp.employeeName).toLowerCase(), String(emp.telegramChatId));
    }
  }

  const nameFilters = linkedEmployees
    .filter((emp) => emp.employeeName && emp.telegramChatId)
    .map((emp) => ({ employeeName: new RegExp(`^${escapeRegex(String(emp.employeeName))}$`, 'i') }));
  if (nameFilters.length === 0) return counts;

  const pendingCategory = await IdentifiedContact.find({
    $and: [
      { $or: nameFilters },
      { contactName: { $exists: true, $nin: [null, ''] } },
      { $or: [{ category: null }, { category: { $exists: false } }] },
      { $or: [{ categoryRequestSentAt: null }, { categoryRequestSentAt: { $lte: twoDaysAgo } }] },
    ],
  }).limit(20).lean() as any[];

  for (const c of pendingCategory) {
    try {
      const chatId = c.telegramChatId || chatByEmployee.get(String(c.employeeName).toLowerCase());
      if (!chatId) continue;

      const previousSentAt = c.categoryRequestSentAt ?? null;
      const claimed = await IdentifiedContact.findOneAndUpdate(
        {
          _id: c._id,
          $or: [{ category: null }, { category: { $exists: false } }],
          ...(previousSentAt
            ? { categoryRequestSentAt: previousSentAt }
            : { categoryRequestSentAt: null }),
        },
        { $set: { categoryRequestSentAt: now, telegramChatId: chatId } }
      );
      if (!claimed) continue;

      const sentResult = await sendCategoryRequest(chatId, c.contactName, c.phoneNumber, c.employeeName);
      if (sentResult?.ok === true) {
        counts.category++;
        continue;
      }

      if (previousSentAt) {
        await IdentifiedContact.updateOne({ _id: c._id }, { $set: { categoryRequestSentAt: previousSentAt } });
      } else {
        await IdentifiedContact.updateOne({ _id: c._id }, { $unset: { categoryRequestSentAt: 1 } });
      }
    } catch (err) {
      console.error(`[DailyReminder] Category send failed for ${c.phoneNumber}:`, err);
    }
  }

  const pendingName = await UnknownNumberTracker.find({
    $and: [
      { $or: nameFilters },
      { status: 'awaiting_name' },
      { $or: [{ nameRequestSentAt: null }, { nameRequestSentAt: { $lte: twoDaysAgo } }] },
    ],
  }).limit(15).lean() as any[];

  for (const t of pendingName) {
    try {
      const chatId = chatByEmployee.get(String(t.employeeName).toLowerCase());
      if (!chatId) continue;

      const previousSentAt = t.nameRequestSentAt ?? null;
      const claimed = await UnknownNumberTracker.findOneAndUpdate(
        {
          _id: t._id,
          status: 'awaiting_name',
          ...(previousSentAt ? { nameRequestSentAt: previousSentAt } : { nameRequestSentAt: null }),
        },
        { $set: { nameRequestSentAt: now } }
      );
      if (!claimed) continue;

      const sentResult = await sendNameRequest(chatId, t.phoneNumber, t.employeeName, t.callCount ?? CALL_THRESHOLD);
      if (sentResult?.ok === true) {
        if (sentResult?.result?.message_id != null) {
          await UnknownNumberTracker.updateOne(
            { _id: t._id },
            { $set: { telegramMessageId: sentResult.result.message_id } }
          );
        }
        counts.nameRequest++;
        continue;
      }

      if (previousSentAt) {
        await UnknownNumberTracker.updateOne({ _id: t._id }, { $set: { nameRequestSentAt: previousSentAt } });
      } else {
        await UnknownNumberTracker.updateOne({ _id: t._id }, { $unset: { nameRequestSentAt: 1 } });
      }
    } catch (err) {
      console.error(`[DailyReminder] Name request send failed for ${t.phoneNumber}:`, err);
    }
  }

  const pendingSave = await IdentifiedContact.find({
    $and: [
      { $or: nameFilters },
      { contactName: { $exists: true, $ne: null } },
      { category: { $exists: true, $ne: null } },
      { savedInPhone: false },
      { remindLater: { $ne: true } },
      { $or: [{ lastReminderSentAt: null }, { lastReminderSentAt: { $lte: reminderCutoff } }] },
    ],
  }).limit(10).lean() as any[];

  for (const c of pendingSave) {
    try {
      const chatId = c.telegramChatId || chatByEmployee.get(String(c.employeeName).toLowerCase());
      if (!chatId) continue;

      const reminded = await maybeSendSaveReminder(
        { ...c, telegramChatId: chatId },
        chatId,
        c.phoneNumber,
        c.employeeName
      );
      if (reminded === 'sent') counts.saveReminder++;
    } catch (err) {
      console.error(`[DailyReminder] Save reminder failed for ${c.phoneNumber}:`, err);
    }
  }

    return counts;
}

/**
 * Resend prompts that never left, for one employee.
 * Called after a live call so a failed Telegram send retries without the dashboard being open.
 * Does not increment Scenario B call counts.
 */
export async function retryUnsentPrompts(employeeName: string): Promise<void> {
  if (!employeeName) return;
  try {
    await connectToDatabase();
    const nameQuery = new RegExp(`^${escapeRegex(employeeName)}$`, 'i');

    const pendingA = await IdentifiedContact.find({
      employeeName: nameQuery,
      contactName: { $exists: true, $nin: [null, ''] },
      categoryRequestSentAt: null,
      $or: [{ category: null }, { category: { $exists: false } }],
    }).lean() as any[];

    for (const contact of pendingA) {
      await runContactIntelligence(
        contact.phoneNumber,
        contact.contactName,
        contact.employeeName,
        contact.deviceId || '',
        { countAsNewCall: false }
      );
    }

    const pendingB = await UnknownNumberTracker.find({
      employeeName: nameQuery,
      $or: [
        { status: 'tracking', callCount: { $gte: CALL_THRESHOLD } },
        { status: 'awaiting_name', telegramMessageId: null, nameRequestSentAt: null },
      ],
    }).lean() as any[];

    for (const tracker of pendingB) {
      await runContactIntelligence(
        tracker.phoneNumber,
        undefined,
        tracker.employeeName,
        tracker.deviceId || '',
        { countAsNewCall: false }
      );
    }
  } catch (err) {
    console.error('[retryUnsentPrompts]', err);
  }
}
