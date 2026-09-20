import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import IdentifiedContact from "@/models/IdentifiedContact";
import UnknownNumberTracker from "@/models/UnknownNumberTracker";
import EmployeeTelegram from "@/models/EmployeeTelegram";
import { syncEmployeeDeviceData } from "@/lib/employeeCallSync";
import {
  answerCallbackQuery,
  editMessageText,
  sendInlineKeyboard,
  categoryKeyboard,
  saveContactKeyboard,
  sendMessage,
} from "@/lib/telegram";
import { escapeHtml, escapeRegex, parseCallbackData } from "@/lib/telegramFormat";

export const maxDuration = 60;

function isValidRequest(req: Request): boolean {
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expectedSecret) return true; // If no secret configured, allow (for local dev)
  
  const providedSecret = req.headers.get("x-telegram-bot-api-secret-token");
  if (providedSecret !== expectedSecret) {
    console.warn("[Webhook Auth] Telegram secret token mismatch.");
    return false;
  }
  return true;
}

/**
 * After an employee links Telegram to their device number, rebuild that device's
 * contact records from its call logs and start sending any prompts that never went out.
 */
async function processPendingForEmployee(employeeName: string) {
  try {
    const result = await syncEmployeeDeviceData(employeeName, 12);
    console.log(
      `[PostRegistration] Synced "${result.employeeName}": ${result.numbers} numbers, ${result.calls} calls, ${result.promptsSent} prompts sent, ${result.promptsRemaining} still queued`
    );
  } catch (err) {
    console.error("[PostRegistration] Error:", err);
  }
}

export async function POST(req: Request) {
  if (!isValidRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let update: any;
  try {
    update = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad Request" }, { status: 400 });
  }

  try {
    await connectToDatabase();

    if (update.callback_query) {
      await handleCallbackQuery(update.callback_query);
      return NextResponse.json({ ok: true });
    }

    if (update.message) {
      await handleMessage(update.message);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[Telegram Webhook] Error:", err);
    const callbackId = update?.callback_query?.id;
    if (callbackId) {
      await answerCallbackQuery(callbackId, "Could not save that. Please try again.").catch(() => {});
    }
    return NextResponse.json({ ok: true });
  }
}

// ── Callback Query Handler ─────────────────────────────────────────────────

const ALLOWED_CATEGORIES = new Set([
  "personal",
  "staff",
  "Existing Client",
  "New Client",
  "courier",
  "Family",
  "Colleague",
  "Other",
]);

function employeeNameQuery(employeeName: string) {
  return new RegExp(`^${escapeRegex(employeeName)}$`, "i");
}

async function resolveEmployeeName(chatId: number, legacyName?: string): Promise<string | null> {
  const linked = await EmployeeTelegram.findOne({ telegramChatId: String(chatId) }).lean() as any;
  if (linked?.employeeName) {
    if (legacyName && linked.employeeName.toLowerCase() !== legacyName.toLowerCase()) {
      return null;
    }
    // Prefer the name embedded in the button so we update the call-log record,
    // which can differ in casing from the Telegram setup row.
    return legacyName || linked.employeeName;
  }
  return legacyName ?? null;
}

async function handleCallbackQuery(query: any) {
  const data: string = query.data ?? "";
  const chatId: number = query.message?.chat?.id;
  const messageId: number = query.message?.message_id;
  const callbackId: string = query.id;
  const parsed = parseCallbackData(data);

  if (parsed.type === "category") {
    if (!ALLOWED_CATEGORIES.has(parsed.category)) {
      await answerCallbackQuery(callbackId, "Unknown category");
      return;
    }

    const employeeName = await resolveEmployeeName(chatId, parsed.employeeName);
    if (!employeeName) {
      await answerCallbackQuery(callbackId, "This chat is not linked to that employee");
      return;
    }

    const phoneNumber = parsed.phoneNumber;
    const category = parsed.category;
    const nameQuery = employeeNameQuery(employeeName);

    let contact = await IdentifiedContact.findOne({ phoneNumber, employeeName: nameQuery });
    if (!contact) {
      contact = await IdentifiedContact.create({
        phoneNumber,
        employeeName,
        category,
        identifiedAt: new Date(),
        telegramChatId: String(chatId),
      });
    } else {
      contact.category = category as any;
      contact.identifiedAt = new Date();
      contact.telegramChatId = String(chatId);
      await contact.save();
    }

    await UnknownNumberTracker.updateOne(
      { phoneNumber, employeeName: nameQuery },
      { $set: { status: "identified" } }
    );

    await answerCallbackQuery(callbackId, `Category saved: ${category}`);

    const displayName =
      contact.contactName && contact.contactName !== phoneNumber
        ? contact.contactName
        : null;
    const nameLine = displayName ? `Name: <b>${escapeHtml(displayName)}</b>\n` : "";
    if (chatId && messageId) {
      await editMessageText(
        chatId,
        messageId,
        `✅ <b>Contact Classified</b>\n\n${nameLine}Category: <b>${escapeHtml(category)}</b>\nNumber: <code>${escapeHtml(phoneNumber)}</code>`
      );
    }

    const confirmLine = displayName
      ? `Name: <b>${escapeHtml(displayName)}</b>\nNumber: <code>${escapeHtml(phoneNumber)}</code>`
      : `Number: <code>${escapeHtml(phoneNumber)}</code>`;
    const saveText =
      `✅ Contact classified.\n\n` +
      `Confirm once you've saved this contact in your phone?\n\n` +
      confirmLine;

    const keyboard = saveContactKeyboard(phoneNumber, contact.employeeName);
    if (keyboard) {
      await sendInlineKeyboard(chatId, saveText, keyboard);
    }
    return;
  }

  if (parsed.type === "saved") {
    const employeeName = await resolveEmployeeName(chatId, parsed.employeeName);
    if (!employeeName) {
      await answerCallbackQuery(callbackId, "This chat is not linked to that employee");
      return;
    }

    await IdentifiedContact.updateOne(
      { phoneNumber: parsed.phoneNumber, employeeName: employeeNameQuery(employeeName) },
      { $set: { savedInPhone: true, remindLater: false } }
    );
    await answerCallbackQuery(callbackId, "Great! Contact saved ✅");
    if (chatId && messageId) {
      await editMessageText(chatId, messageId, `✅ Perfect! Contact has been saved in your phone.`);
    }
    return;
  }

  if (parsed.type === "remind") {
    const employeeName = await resolveEmployeeName(chatId, parsed.employeeName);
    if (!employeeName) {
      await answerCallbackQuery(callbackId, "This chat is not linked to that employee");
      return;
    }

    await IdentifiedContact.updateOne(
      { phoneNumber: parsed.phoneNumber, employeeName: employeeNameQuery(employeeName) },
      { $set: { remindLater: true } }
    );
    await answerCallbackQuery(callbackId, "We'll remind you next time this number appears ⏰");
    if (chatId && messageId) {
      await editMessageText(
        chatId,
        messageId,
        `⏰ Reminder set. We'll remind you next time this number appears.`
      );
    }
    return;
  }

  await answerCallbackQuery(callbackId);
}

// ── Message Handler ────────────────────────────────────────────────────────

async function handleMessage(message: any) {
  const chatId: number = message.chat?.id;
  const text: string = (message.text ?? "").trim();
  const replyToMessageId: number | undefined = message.reply_to_message?.message_id;

  // ── 1. /start command — begin self-registration ────────────────────────
  if (text === "/start") {
    const existing = await EmployeeTelegram.findOne({ telegramChatId: String(chatId) });
    if (existing) {
      await sendMessage(
        chatId,
        `👋 Welcome back, <b>${escapeHtml(existing.employeeName)}</b>!\n\nYou are already registered in the system.\n\nYour Telegram is connected to the call log intelligence system.`
      );
      return;
    }

    await sendMessage(
      chatId,
      `👋 <b>Welcome to the Call Log System</b>\n\n` +
        `To register, please send your <b>employee phone number</b> used in the call logs app.\n\n` +
        `Example:\n<code>9876543210</code>`
    );
    return;
  }

  // ── 2. Reply-based contact name identification ─────────────────────────
  if (replyToMessageId) {
    const tracker = await UnknownNumberTracker.findOneAndUpdate(
      {
        telegramMessageId: replyToMessageId,
        status: "awaiting_name",
      },
      { $set: { status: "awaiting_category" } },
      { new: true }
    );

    if (tracker) {
      const { phoneNumber, employeeName } = tracker;
      const contactName = text.slice(0, 120).trim();
      if (!contactName) {
        tracker.status = "awaiting_name";
        await tracker.save();
        await sendMessage(chatId, `Please reply with the contact's name.`);
        return;
      }

      const contact = await IdentifiedContact.findOneAndUpdate(
        { phoneNumber, employeeName },
        {
          $set: { contactName, telegramChatId: String(chatId), deviceId: tracker.deviceId },
          $setOnInsert: { phoneNumber, employeeName },
        },
        { upsert: true, new: true }
      );

      const keyboard = categoryKeyboard(phoneNumber, employeeName);
      const categoryText =
        `✅ <b>Name saved!</b>\n\n` +
        `Name: <b>${escapeHtml(contactName)}</b>\n` +
        `Number: <code>${escapeHtml(phoneNumber)}</code>\n\n` +
        `Please select the category:`;

      const sent = keyboard
        ? await sendInlineKeyboard(chatId, categoryText, keyboard)
        : null;

      if (sent?.ok === true) {
        contact.categoryRequestSentAt = new Date();
        await contact.save();
      } else {
        await sendMessage(
          chatId,
          `Name saved. The category buttons could not be delivered just now — they will be sent again shortly.`
        );
      }
      return;
    }
    // Fall through to phone registration check
  }

  // ── 3. Phone number — self-registration verification ───────────────────
  const digitsOnly = text.replace(/[\s\-\+]/g, "");
  const isPhoneNumber = /^\d{10,13}$/.test(digitsOnly);

  if (isPhoneNumber) {
    const alreadyLinked = await EmployeeTelegram.findOne({ telegramChatId: String(chatId) });
    if (alreadyLinked) {
      await sendMessage(
        chatId,
        `✅ You are already registered as <b>${escapeHtml(alreadyLinked.employeeName)}</b>.`
      );
      return;
    }

    const last10 = digitsOnly.slice(-10);

    const employee = await EmployeeTelegram.findOne({
      $or: [
        { phoneNumber: digitsOnly },
        { phoneNumber: last10 },
        { phoneNumber: { $regex: `${last10}$` } },
      ],
      telegramChatId: null,
    });

    if (!employee) {
      const taken = await EmployeeTelegram.findOne({
        $or: [
          { phoneNumber: digitsOnly },
          { phoneNumber: last10 },
          { phoneNumber: { $regex: `${last10}$` } },
        ],
        telegramChatId: { $ne: null },
      });

      if (taken) {
        await sendMessage(
          chatId,
          `⚠️ This phone number is already linked to another Telegram account.\n\nPlease contact the administrator.`
        );
      } else {
        await sendMessage(
          chatId,
          `❌ <b>This phone number is not registered in the system.</b>\n\nPlease contact the administrator to be added.`
        );
      }
      return;
    }

    employee.telegramChatId = String(chatId);
    employee.registeredAt = new Date();
    await employee.save();

    await sendMessage(
      chatId,
      `✅ <b>Registration successful!</b>\n\n` +
        `Employee: <b>${escapeHtml(employee.employeeName)}</b>\n` +
        `Telegram connected successfully.\n\n` +
        `You will now receive contact classification requests from the call log system.`
    );

    // Immediately process all pending contacts that were waiting for Telegram to be linked
    await processPendingForEmployee(employee.employeeName);
    return;
  }

  // ── 4. Unknown message (only respond to unregistered users) ──────────────
  const isRegistered = await EmployeeTelegram.findOne({ telegramChatId: String(chatId) });
  if (!isRegistered) {
    await sendMessage(
      chatId,
      `❓ I didn't understand that.\n\nSend <code>/start</code> to begin registration.`
    );
  }
}
