import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/db";
import IdentifiedContact from "@/models/IdentifiedContact";
import EmployeeTelegram from "@/models/EmployeeTelegram";
import { sendInlineKeyboard, saveContactKeyboard } from "@/lib/telegram";
import { escapeHtml, escapeRegex } from "@/lib/telegramFormat";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role === "driver") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  await connectToDatabase();

  const contact = await IdentifiedContact.findById(id);
  if (!contact) return NextResponse.json({ error: "Contact not found" }, { status: 404 });

  let chatId = contact.telegramChatId;
  if (!chatId) {
    const emp = await EmployeeTelegram.findOne({
      employeeName: new RegExp(`^${escapeRegex(contact.employeeName)}$`, "i"),
    }).lean() as { telegramChatId?: string } | null;
    chatId = emp?.telegramChatId || undefined;
  }

  if (!chatId) {
    return NextResponse.json(
      { error: "No Telegram chat ID for this employee" },
      { status: 422 }
    );
  }

  const keyboard = saveContactKeyboard(contact.phoneNumber, contact.employeeName);
  if (!keyboard) {
    return NextResponse.json({ error: "Could not build Telegram keyboard" }, { status: 500 });
  }

  const displayName =
    contact.contactName && contact.contactName !== contact.phoneNumber
      ? contact.contactName
      : null;
  const detailLine = displayName
    ? `Name: <b>${escapeHtml(displayName)}</b>\nNumber: <code>${escapeHtml(contact.phoneNumber)}</code>`
    : `Number: <code>${escapeHtml(contact.phoneNumber)}</code>`;
  const text =
    `Confirm once you've saved this contact in your phone?\n\n` +
    detailLine;

  const sent = await sendInlineKeyboard(chatId, text, keyboard);
  if (!sent?.ok) {
    return NextResponse.json(
      { error: "Telegram did not accept the reminder" },
      { status: 502 }
    );
  }

  contact.telegramChatId = String(chatId);
  contact.remindLater = false;
  contact.lastReminderSentAt = new Date();
  await contact.save();

  return NextResponse.json({ success: true });
}
