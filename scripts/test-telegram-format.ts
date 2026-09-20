import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import {
  CATEGORY_CODES,
  categoryCallbackData,
  escapeHtml,
  parseCallbackData,
  remindCallbackData,
  savedCallbackData,
  shouldSendSaveReminder,
} from "../src/lib/telegramFormat.ts";
import { verifyTelegramInitData } from "../src/lib/telegramWebApp.ts";

const COOLDOWN = 24 * 60 * 60 * 1000;

test("escapes Telegram HTML", () => {
  assert.equal(escapeHtml(`A & B <tag>`), "A &amp; B &lt;tag&gt;");
});

test("category callbacks stay within 64 bytes and round-trip", () => {
  const phone = "+91 98765 43210";
  const employee = "Mohammed Abdul Rahman";
  for (const category of Object.keys(CATEGORY_CODES)) {
    const data = categoryCallbackData(phone, employee, category);
    assert.ok(data, `missing callback for ${category}`);
    assert.ok(new TextEncoder().encode(data!).length <= 64, data);
    const parsed = parseCallbackData(data!);
    assert.equal(parsed.type, "category");
    if (parsed.type === "category") {
      assert.equal(parsed.phoneNumber, phone);
      assert.equal(parsed.category, category);
      assert.equal(parsed.employeeName, employee);
    }
  }
});

test("long employee names fall back to a chat-scoped callback", () => {
  const phone = "9876543210";
  const employee = "A".repeat(80);
  const data = categoryCallbackData(phone, employee, "Existing Client");
  assert.ok(data);
  assert.ok(new TextEncoder().encode(data!).length <= 64);
  const parsed = parseCallbackData(data!);
  assert.equal(parsed.type, "category");
  if (parsed.type === "category") {
    assert.equal(parsed.employeeName, undefined);
    assert.equal(parsed.category, "Existing Client");
    assert.equal(parsed.phoneNumber, phone);
  }
});

test("legacy in-flight callbacks still parse", () => {
  const legacy = `cat:${encodeURIComponent("9876543210")}:${encodeURIComponent("Tony")}:${encodeURIComponent("Existing Client")}`;
  const parsed = parseCallbackData(legacy);
  assert.equal(parsed.type, "category");
  if (parsed.type === "category") {
    assert.equal(parsed.legacy, true);
    assert.equal(parsed.employeeName, "Tony");
    assert.equal(parsed.category, "Existing Client");
  }

  const saved = parseCallbackData(`saved:${encodeURIComponent("9876543210")}:${encodeURIComponent("Tony")}`);
  assert.equal(saved.type, "saved");
  if (saved.type === "saved") assert.equal(saved.employeeName, "Tony");

  const remind = parseCallbackData(`remind:${encodeURIComponent("999")}:${encodeURIComponent("Tony:Sales")}`);
  assert.equal(remind.type, "remind");
  if (remind.type === "remind") assert.equal(remind.employeeName, "Tony:Sales");
});

test("save and remind callbacks stay within 64 bytes", () => {
  for (const build of [savedCallbackData, remindCallbackData]) {
    const normal = build("9876543210", "Tony");
    const long = build("9876543210", "A".repeat(80));
    assert.ok(normal && new TextEncoder().encode(normal).length <= 64);
    assert.ok(long && new TextEncoder().encode(long).length <= 64);
    assert.equal(parseCallbackData(long!).type === "saved" || parseCallbackData(long!).type === "remind", true);
  }
});

test("remind later fires on the next appearance, then cooldown applies", () => {
  const now = 1_000_000_000_000;
  assert.equal(
    shouldSendSaveReminder({
      savedInPhone: false,
      remindLater: true,
      lastReminderSentAt: now,
      now: now + 1000,
      cooldownMs: COOLDOWN,
      hasChat: true,
    }),
    "remind_later_once"
  );
  assert.equal(
    shouldSendSaveReminder({
      savedInPhone: true,
      remindLater: true,
      lastReminderSentAt: null,
      now,
      cooldownMs: COOLDOWN,
      hasChat: true,
    }),
    "skip"
  );
  assert.equal(
    shouldSendSaveReminder({
      savedInPhone: false,
      remindLater: false,
      lastReminderSentAt: now,
      now: now + 60_000,
      cooldownMs: COOLDOWN,
      hasChat: true,
    }),
    "skip"
  );
  assert.equal(
    shouldSendSaveReminder({
      savedInPhone: false,
      remindLater: false,
      lastReminderSentAt: now - COOLDOWN - 1,
      now,
      cooldownMs: COOLDOWN,
      hasChat: true,
    }),
    "cooldown_elapsed"
  );
  assert.equal(
    shouldSendSaveReminder({
      savedInPhone: false,
      remindLater: false,
      lastReminderSentAt: null,
      now,
      cooldownMs: COOLDOWN,
      hasChat: false,
    }),
    "skip"
  );
});

function signInitData(fields: Record<string, string>, botToken: string): string {
  const dataCheckString = Object.entries(fields)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = createHmac("sha256", secret).update(dataCheckString).digest("hex");
  const params = new URLSearchParams(fields);
  params.set("hash", hash);
  return params.toString();
}

test("accepts a signed Telegram web app payload for that chat", () => {
  const token = "test-bot-token";
  const now = 1_700_000_000_000;
  const initData = signInitData(
    {
      auth_date: String(Math.floor(now / 1000)),
      user: JSON.stringify({ id: 1754252605, first_name: "Test" }),
    },
    token
  );
  const verified = verifyTelegramInitData(initData, token, now);
  assert.equal(verified?.userId, "1754252605");
  assert.equal(verifyTelegramInitData(initData + "x", token, now), null);
  assert.equal(verifyTelegramInitData(initData, "other-token", now), null);
});
