/**
 * Pure business rules for the Income & Expense module.
 *
 * Nothing in here touches the database, Next.js or React, so every rule that
 * decides how money moves can be unit-tested in isolation
 * (see expenseMath.test.ts) and shared by the API routes, the server-rendered
 * driver pages and the admin UI.
 *
 * Accounting model
 * ----------------
 *   balance = advances - APPROVED expenses - PENDING expenses deducted on submit
 *
 * Expenses are deducted from the wallet the moment the driver submits them
 * (`deductedOnSubmit`), so the driver can keep spending against the remaining
 * amount; HR then approves (no further change) or rejects (the amount is
 * refunded). A submission is never refused for exceeding the balance.
 *
 * Expenses submitted before this rule existed were not deducted on submit;
 * they keep the old behaviour (deducted on approval, nothing on rejection), so
 * no migration is needed and every ledger entry keeps its recorded effect.
 *
 * A negative balance means the driver has spent more than they were advanced.
 * Policy: that excess is an outstanding amount PAYABLE TO THE DRIVER by the
 * company, and is cleared by the next advance allocation.
 */

export const EXPENSE_CATEGORIES = [
  "Fuel",
  "Toll",
  "Food",
  "Parking",
  "Maintenance",
  "Other",
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

/** Roles that may allocate advances and approve/reject expenses. */
export const STAFF_ROLES = ["super_admin", "admin", "hr"] as const;

export function canManageIncomeExpense(role?: string | null): boolean {
  return !!role && (STAFF_ROLES as readonly string[]).includes(role);
}

/** Sanity ceiling (1 crore) so a typo cannot create an absurd ledger entry. */
export const MAX_AMOUNT = 10_000_000;

/** Receipt images are compressed client-side; this is a server-side backstop. */
export const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;

/** How far back a driver may date an expense. */
export const MAX_EXPENSE_AGE_DAYS = 366;

/** Round to 2 decimal places (paise), avoiding 0.1 + 0.2 style float noise. */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Validate a money amount from untrusted input. Returns the amount rounded to
 * paise, or null if it is not a finite positive number within the ceiling.
 * Numeric strings are rejected on purpose: the clients send JSON numbers.
 */
export function parseAmount(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const rounded = round2(value);
  if (rounded <= 0 || rounded > MAX_AMOUNT) return null;
  return rounded;
}

/**
 * The part of `amount` that is NOT covered by the driver's available balance.
 * Only a positive balance can cover spending; if the driver is already
 * overdrawn, the whole amount is new excess.
 *
 *   balance 5000, amount 10000 -> 5000
 *   balance 3000, amount 2000  -> 0
 *   balance -500, amount 200   -> 200
 */
export function computeExcess(balanceBefore: number, amount: number): number {
  const available = Math.max(0, balanceBefore);
  return round2(Math.max(0, amount - available));
}

export interface AccountTotalsInput {
  /** Sum of all advance allocations (ledger). */
  totalAdvance: number;
  /** Sum of all approved expenses (ledger). */
  totalApproved: number;
  /** Sum of every expense ever submitted, any status. */
  totalSubmitted: number;
  totalPending: number;
  totalRejected: number;
  /** Part of `totalPending` already taken from the wallet when it was submitted. */
  totalPendingDeducted?: number;
}

export interface AccountFigures extends AccountTotalsInput {
  /** advance - approved - pending deducted. Negative when the driver is overdrawn. */
  balance: number;
  /** Unspent advance (balance, floored at 0). */
  remainingBalance: number;
  /** Outstanding amount payable to the driver (negative balance, as a positive number). */
  excessAmount: number;
  /** Balance if every pending expense were approved. */
  balanceIfPendingApproved: number;
}

export function buildAccountFigures(input: AccountTotalsInput): AccountFigures {
  const totalAdvance = round2(input.totalAdvance);
  const totalApproved = round2(input.totalApproved);
  const totalPendingDeducted = round2(input.totalPendingDeducted ?? 0);
  const balance = round2(totalAdvance - totalApproved - totalPendingDeducted);
  return {
    totalAdvance,
    totalApproved,
    totalSubmitted: round2(input.totalSubmitted),
    totalPending: round2(input.totalPending),
    totalRejected: round2(input.totalRejected),
    totalPendingDeducted,
    balance,
    remainingBalance: Math.max(0, balance),
    excessAmount: Math.max(0, round2(-balance)),
    balanceIfPendingApproved: round2(balance - (input.totalPending - totalPendingDeducted)),
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Parse a calendar date ("YYYY-MM-DD") into a Date at 00:00 UTC.
 *
 * Rejects malformed or impossible dates (2026-02-31), dates in the future and
 * dates older than MAX_EXPENSE_AGE_DAYS. "Future" tolerates one extra day so
 * a driver in a timezone ahead of UTC (IST) is not rejected for entering their
 * own local "today".
 */
export function parseExpenseDate(value: unknown, now: Date = new Date()): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== m - 1 ||
    date.getUTCDate() !== d
  ) {
    return null;
  }
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (date.getTime() > todayUtc + DAY_MS) return null;
  if (date.getTime() < todayUtc - MAX_EXPENSE_AGE_DAYS * DAY_MS) return null;
  return date;
}

const RECEIPT_MIME = ["image/jpeg", "image/png", "image/webp"] as const;
export type ReceiptMime = (typeof RECEIPT_MIME)[number];

/**
 * Validate a receipt data URL and return its parts. Only raster image types
 * are accepted: the bytes are later served back from our own origin, so an
 * `text/html` or `image/svg+xml` payload would be stored XSS.
 */
export function parseReceiptDataUrl(
  value: unknown
): { mime: ReceiptMime; base64: string; bytes: number } | null {
  if (typeof value !== "string") return null;
  const comma = value.indexOf(",");
  if (comma < 0 || comma > 40) return null;
  const header = value.slice(0, comma);
  const m = /^data:(image\/(?:jpeg|png|webp));base64$/.exec(header);
  if (!m) return null;
  const base64 = value.slice(comma + 1);
  if (base64.length === 0 || base64.length % 4 !== 0) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return null;
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  const bytes = (base64.length / 4) * 3 - padding;
  if (bytes > MAX_RECEIPT_BYTES) return null;
  return { mime: m[1] as ReceiptMime, base64, bytes };
}

/** Same allow-list check for already-stored data URLs when serving them. */
export function isServableReceiptMime(mime: string): mime is ReceiptMime {
  return (RECEIPT_MIME as readonly string[]).includes(mime);
}

export type LedgerEntryType =
  | "advance"
  | "expense_submitted"
  | "expense_approved"
  | "expense_rejected";

export const LEDGER_ENTRY_TYPES: LedgerEntryType[] = [
  "advance",
  "expense_submitted",
  "expense_approved",
  "expense_rejected",
];

/**
 * Signed effect an entry has on the driver's balance. `deductedOnSubmit` is the
 * expense's own flag: it moves the deduction from approval to submission and
 * turns a rejection into a refund.
 */
export function balanceEffectFor(type: LedgerEntryType, amount: number, deductedOnSubmit = false): number {
  switch (type) {
    case "advance":
      return round2(amount);
    case "expense_submitted":
      return deductedOnSubmit ? round2(-amount) : 0;
    case "expense_approved":
      return deductedOnSubmit ? 0 : round2(-amount);
    case "expense_rejected":
      return deductedOnSubmit ? round2(amount) : 0;
    default:
      return 0;
  }
}

/**
 * Key that makes a repeated expense submission a no-op. The client sends a
 * per-attempt id; without one, an identical receipt + amount + category is
 * treated as the same submission (an exact resend can only be a retry).
 */
/** Sanity ceiling so a mistyped odometer cannot store an absurd reading. */
export const MAX_ODOMETER_KM = 10_000_000;

/**
 * A vehicle odometer reading in kilometers. Accepts a JSON number or a numeric
 * string, rounded to 0.1 km. Returns null when the value is missing or absurd.
 */
export function parseOdometer(value: unknown): number | null {
  let n = value;
  if (typeof n === "string") {
    const trimmed = n.trim();
    if (!trimmed) return null;
    n = Number(trimmed);
  }
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  const rounded = Math.round((n + Number.EPSILON) * 10) / 10;
  if (rounded < 0 || rounded > MAX_ODOMETER_KM) return null;
  return rounded;
}

/**
 * Kilometers driven between two odometer readings. Null when there is no
 * earlier reading, or the new reading does not move forward.
 */
export function runKilometers(previous: number | null | undefined, current: number): number | null {
  if (typeof previous !== "number" || !Number.isFinite(previous) || !Number.isFinite(current)) return null;
  const run = Math.round((current - previous) * 10) / 10;
  return run > 0 ? run : null;
}

export function expenseSubmissionKey(
  clientRequestId: unknown,
  fingerprint: { amount: number; category: string; receiptBase64: string },
  sha256Hex: (s: string) => string
): string {
  if (typeof clientRequestId === "string" && /^[A-Za-z0-9_-]{8,100}$/.test(clientRequestId)) {
    return `c:${clientRequestId}`;
  }
  return `h:${sha256Hex(`${fingerprint.amount}|${fingerprint.category}|${fingerprint.receiptBase64}`)}`;
}
