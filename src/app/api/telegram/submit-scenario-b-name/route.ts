import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import IdentifiedContact from "@/models/IdentifiedContact";
import UnknownNumberTracker from "@/models/UnknownNumberTracker";
import EmployeeTelegram from "@/models/EmployeeTelegram";
import { sendInlineKeyboard, sendMessage, categoryKeyboard } from "@/lib/telegram";
import { verifyTelegramInitData } from "@/lib/telegramWebApp";
import { escapeHtml, escapeRegex } from "@/lib/telegramFormat";

/**
 * POST /api/telegram/submit-scenario-b-name
 *
 * Called from the Scenario B Web App (Enter name form).
 * Body: { contactName, phoneNumber, employeeName, chatId }
 * Updates IdentifiedContact + tracker and sends the category keyboard to the chat.
 * chatId must be the Telegram account already linked to that employee.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { contactName, phoneNumber, employeeName, chatId, initData } = body;
    const name = typeof contactName === "string" ? contactName.trim().slice(0, 120) : "";
    if (!name || !phoneNumber || !employeeName || !chatId) {
      return NextResponse.json(
        { error: "Missing contactName, phoneNumber, employeeName, or chatId" },
        { status: 400 }
      );
    }

    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (typeof initData === "string" && initData && token) {
      const verified = verifyTelegramInitData(initData, token);
      if (!verified || verified.userId !== String(chatId)) {
        return NextResponse.json(
          { error: "Open this form from the Telegram button in the chat." },
          { status: 403 }
        );
      }
    }

    await connectToDatabase();

    const linked = await EmployeeTelegram.findOne({
      employeeName: new RegExp(`^${escapeRegex(String(employeeName))}$`, "i"),
      telegramChatId: String(chatId),
    }).lean() as { employeeName?: string } | null;
    if (!linked) {
      return NextResponse.json(
        { error: "This Telegram account is not linked to that employee." },
        { status: 403 }
      );
    }

    const tracker = await UnknownNumberTracker.findOneAndUpdate(
      {
        phoneNumber,
        employeeName: new RegExp(`^${escapeRegex(String(employeeName))}$`, "i"),
        status: "awaiting_name",
      },
      { $set: { status: "awaiting_category" } },
      { new: true }
    );
    if (!tracker) {
      return NextResponse.json(
        { error: "No pending name request for this contact, or already submitted." },
        { status: 400 }
      );
    }

    const contact = await IdentifiedContact.findOneAndUpdate(
      { phoneNumber, employeeName: tracker.employeeName },
      {
        $set: {
          contactName: name,
          telegramChatId: String(chatId),
          deviceId: tracker.deviceId ?? "",
        },
        $setOnInsert: { phoneNumber, employeeName: tracker.employeeName },
      },
      { upsert: true, new: true }
    );

    const keyboard = categoryKeyboard(phoneNumber, tracker.employeeName);
    const categoryText =
      `✅ <b>Name saved!</b>\n\n` +
      `Name: <b>${escapeHtml(name)}</b>\n` +
      `Number: <code>${escapeHtml(String(phoneNumber))}</code>\n\n` +
      `Please select the category:`;

    const sent = keyboard
      ? await sendInlineKeyboard(chatId, categoryText, keyboard)
      : null;

    if (sent?.ok === true) {
      contact.categoryRequestSentAt = new Date();
      await contact.save();
      return NextResponse.json({ success: true, categoryPromptSent: true });
    }

    await sendMessage(
      chatId,
      `Name saved. The category buttons could not be delivered just now — they will be sent again shortly.`
    );
    return NextResponse.json({ success: true, categoryPromptSent: false });
  } catch (err) {
    console.error("[submit-scenario-b-name]", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
