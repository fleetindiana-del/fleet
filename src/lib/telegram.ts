/**
 * Telegram Bot API helper — uses native fetch, no external dependencies.
 * All functions are async and throw on Telegram API errors.
 */

import connectToDatabase from '@/lib/db';
import BotLog from '@/models/BotLog';
import {
  categoryCallbackData,
  remindCallbackData,
  savedCallbackData,
} from '@/lib/telegramFormat';

export type InlineButton = { text: string; callback_data: string };
export type WebAppButton = { text: string; web_app: { url: string } };
export type InlineKeyboard = (InlineButton | WebAppButton)[][];

async function callTelegram(method: string, body: object): Promise<any> {
  const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  if (!BOT_TOKEN) {
    const msg = '[Telegram] TELEGRAM_BOT_TOKEN is not set in environment variables — cannot send any messages.';
    console.warn(msg);
    try {
      await connectToDatabase();
      await BotLog.create({ level: 'error', step: 'TELEGRAM_NO_TOKEN', message: msg });
    } catch { /* ignore */ }
    return null;
  }

  const BASE_URL = `https://api.telegram.org/bot${BOT_TOKEN}`;
  let data: any;
  try {
    const res = await fetch(`${BASE_URL}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    data = await res.json();
  } catch (fetchErr: any) {
    const msg = `[Telegram] Network error calling ${method}: ${fetchErr?.message}`;
    console.error(msg);
    try {
      await connectToDatabase();
      await BotLog.create({ level: 'error', step: 'TELEGRAM_NETWORK_ERROR', message: msg, data: { method, error: fetchErr?.message } });
    } catch { /* ignore */ }
    return null;
  }

  if (!data.ok) {
    const msg = `[Telegram] API error on ${method}: ${data.description ?? JSON.stringify(data)}`;
    console.error(msg, data);
    try {
      await connectToDatabase();
      await BotLog.create({
        level: 'error',
        step: 'TELEGRAM_API_ERROR',
        message: msg,
        data: { method, requestBody: body, telegramResponse: data },
      });
    } catch { /* ignore */ }
  }
  return data;
}

/** Send a plain text message. Returns the sent message object. */
export async function sendMessage(chatId: string | number, text: string): Promise<any> {
  return callTelegram('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML' });
}

/** Send a message with an inline keyboard. Returns the sent message object. */
export async function sendInlineKeyboard(
  chatId: string | number,
  text: string,
  keyboard: InlineKeyboard
): Promise<any> {
  return callTelegram('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: keyboard },
  });
}

/** Send a message asking the user to reply (force_reply). Returns the sent message. */
export async function sendReplyRequest(
  chatId: string | number,
  text: string
): Promise<any> {
  return callTelegram('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    reply_markup: { force_reply: true, selective: true },
  });
}

/** Acknowledge a callback query (removes the spinner on button). */
export async function answerCallbackQuery(
  callbackQueryId: string,
  text?: string
): Promise<any> {
  return callTelegram('answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    text: text ?? '',
  });
}

/** Edit the text of an existing message (e.g. after a button is pressed). */
export async function editMessageText(
  chatId: string | number,
  messageId: number,
  text: string,
  removeKeyboard = true
): Promise<any> {
  return callTelegram('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: 'HTML',
    ...(removeKeyboard ? { reply_markup: { inline_keyboard: [] } } : {}),
  });
}

/** Register a webhook URL with Telegram. */
export async function setWebhook(url: string, secretToken?: string): Promise<any> {
  return callTelegram('setWebhook', {
    url,
    secret_token: secretToken,
    allowed_updates: ['message', 'callback_query'],
  });
}

/**
 * Category keyboard.
 * The employee name is included when the payload fits Telegram's 64-byte limit.
 * Longer names omit it; the webhook then uses the chat the message was sent to.
 * Returns null if a button payload would still be rejected.
 */
export function categoryKeyboard(phoneNumber: string, employeeName: string): InlineKeyboard | null {
  const row = (label: string, category: string) => {
    const data = categoryCallbackData(phoneNumber, employeeName, category);
    return data ? { text: label, callback_data: data } : null;
  };
  const personal = row('👨‍👩‍👧 personal', 'personal');
  const staff = row('🤝 staff', 'staff');
  const existing = row('✅ Existing Client', 'Existing Client');
  const fresh = row('🆕 New Client', 'New Client');
  const courier = row('🔖 courier', 'courier');
  if (!personal || !staff || !existing || !fresh || !courier) return null;
  return [[personal, staff], [existing, fresh], [courier]];
}

/** HTTPS origin Telegram will accept for the Scenario B web app button. */
export function telegramPublicBaseUrl(): string {
  const explicit = (process.env.TELEGRAM_WEBAPP_URL || '').replace(/\/$/, '');
  if (explicit.startsWith('https://')) return explicit;
  const nextAuth = (process.env.NEXTAUTH_URL || '').replace(/\/$/, '');
  if (nextAuth.startsWith('https://')) return nextAuth;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL.replace(/\/$/, '')}`;
  return 'https://fleet-navy.vercel.app';
}

/** Scenario B: "Enter name" button that opens a Web App form (input inside the flow). */
export function nameRequestKeyboard(phoneNumber: string, employeeName: string, chatId: string | number): InlineKeyboard {
  const baseUrl = telegramPublicBaseUrl();
  const url = `${baseUrl}/telegram/enter-name?p=${encodeURIComponent(phoneNumber)}&e=${encodeURIComponent(employeeName)}&c=${encodeURIComponent(String(chatId))}`;
  return [[{ text: '✏️ Enter name', web_app: { url } }]];
}

/** The "save contact" confirmation keyboard. Returns null if the payload is too long. */
export function saveContactKeyboard(phoneNumber: string, employeeName: string): InlineKeyboard | null {
  const saved = savedCallbackData(phoneNumber, employeeName);
  const remind = remindCallbackData(phoneNumber, employeeName);
  if (!saved || !remind) return null;
  return [
    [
      { text: '✅ Saved', callback_data: saved },
      { text: '⏰ Remind Later', callback_data: remind },
    ],
  ];
}
