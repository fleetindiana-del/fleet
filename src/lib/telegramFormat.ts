/**
 * Pure Telegram payload helpers.
 * Kept free of database imports so the callback format and reminder rules can be tested
 * without standing up Mongo.
 */

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Short codes keep callback_data under Telegram's 64-byte limit. */
export const CATEGORY_CODES = {
  personal: "p",
  staff: "s",
  "Existing Client": "e",
  "New Client": "n",
  courier: "c",
} as const;

const CODE_TO_CATEGORY: Record<string, string> = {
  p: "personal",
  s: "staff",
  e: "Existing Client",
  n: "New Client",
  c: "courier",
};

export const TELEGRAM_CATEGORIES = Object.keys(CATEGORY_CODES);

const CALLBACK_DATA_MAX_BYTES = 64;

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Returns null when the payload would be rejected by Telegram. */
export function categoryCallbackData(
  phoneNumber: string,
  employeeName: string,
  category: string
): string | null {
  const code = CATEGORY_CODES[category as keyof typeof CATEGORY_CODES];
  if (!code) return null;
  const withEmployee = `cat:${encodeURIComponent(phoneNumber)}:${encodeURIComponent(employeeName)}:${code}`;
  if (byteLength(withEmployee) <= CALLBACK_DATA_MAX_BYTES) return withEmployee;
  const short = `cat:${encodeURIComponent(phoneNumber)}:${code}`;
  return byteLength(short) <= CALLBACK_DATA_MAX_BYTES ? short : null;
}

export function savedCallbackData(phoneNumber: string, employeeName: string): string | null {
  const withEmployee = `saved:${encodeURIComponent(phoneNumber)}:${encodeURIComponent(employeeName)}`;
  if (byteLength(withEmployee) <= CALLBACK_DATA_MAX_BYTES) return withEmployee;
  const short = `saved:${encodeURIComponent(phoneNumber)}`;
  return byteLength(short) <= CALLBACK_DATA_MAX_BYTES ? short : null;
}

export function remindCallbackData(phoneNumber: string, employeeName: string): string | null {
  const withEmployee = `remind:${encodeURIComponent(phoneNumber)}:${encodeURIComponent(employeeName)}`;
  if (byteLength(withEmployee) <= CALLBACK_DATA_MAX_BYTES) return withEmployee;
  const short = `remind:${encodeURIComponent(phoneNumber)}`;
  return byteLength(short) <= CALLBACK_DATA_MAX_BYTES ? short : null;
}

export type ParsedCallback =
  | {
      type: "category";
      phoneNumber: string;
      category: string;
      employeeName?: string;
      legacy: boolean;
    }
  | {
      type: "saved";
      phoneNumber: string;
      employeeName?: string;
      legacy: boolean;
    }
  | {
      type: "remind";
      phoneNumber: string;
      employeeName?: string;
      legacy: boolean;
    }
  | { type: "unknown" };

/**
 * Supports the current short payload and in-flight messages that still use
 * `cat:<phone>:<employee>:<category>`.
 */
export function parseCallbackData(data: string): ParsedCallback {
  if (data.startsWith("cat:")) {
    const parts = data.split(":");
    if (parts.length === 3 && CODE_TO_CATEGORY[parts[2]]) {
      return {
        type: "category",
        phoneNumber: safeDecode(parts[1]),
        category: CODE_TO_CATEGORY[parts[2]],
        legacy: false,
      };
    }
    if (parts.length === 4 && CODE_TO_CATEGORY[parts[3]]) {
      return {
        type: "category",
        phoneNumber: safeDecode(parts[1]),
        employeeName: safeDecode(parts[2]),
        category: CODE_TO_CATEGORY[parts[3]],
        legacy: false,
      };
    }
    if (parts.length >= 4) {
      const [, phonePart, empPart, ...catParts] = parts;
      const category = safeDecode(catParts.join(":"));
      if (!category) return { type: "unknown" };
      return {
        type: "category",
        phoneNumber: safeDecode(phonePart),
        employeeName: safeDecode(empPart),
        category,
        legacy: true,
      };
    }
  }

  if (data.startsWith("saved:")) {
    const parts = data.split(":");
    if (parts.length === 2) {
      return { type: "saved", phoneNumber: safeDecode(parts[1]), legacy: false };
    }
    if (parts.length >= 3) {
      return {
        type: "saved",
        phoneNumber: safeDecode(parts[1]),
        employeeName: safeDecode(parts.slice(2).join(":")),
        legacy: true,
      };
    }
  }

  if (data.startsWith("remind:")) {
    const parts = data.split(":");
    if (parts.length === 2) {
      return { type: "remind", phoneNumber: safeDecode(parts[1]), legacy: false };
    }
    if (parts.length >= 3) {
      return {
        type: "remind",
        phoneNumber: safeDecode(parts[1]),
        employeeName: safeDecode(parts.slice(2).join(":")),
        legacy: true,
      };
    }
  }

  return { type: "unknown" };
}

export type SaveReminderDecision = "remind_later_once" | "cooldown_elapsed" | "skip";

/**
 * "Remind Later" means the next appearance of the number, not "never again".
 * Otherwise a classified contact is reminded at most once per cooldown.
 */
export function shouldSendSaveReminder(args: {
  savedInPhone: boolean;
  remindLater: boolean;
  lastReminderSentAt: number | null;
  now: number;
  cooldownMs: number;
  hasChat: boolean;
}): SaveReminderDecision {
  if (!args.hasChat || args.savedInPhone) return "skip";
  if (args.remindLater) return "remind_later_once";
  const last = args.lastReminderSentAt ?? 0;
  if (args.now - last < args.cooldownMs) return "skip";
  return "cooldown_elapsed";
}
