/** Display helpers shared by the admin dashboard and the driver portal. */

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** ₹5,000.00 / -₹5,000.00 (the minus sign leads, as in a ledger). */
export function formatINR(amount: number | null | undefined): string {
  const n = typeof amount === "number" && Number.isFinite(amount) ? amount : 0;
  return inr.format(n);
}

const kmFmt = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 });

/** 12,450 km. A missing reading renders as an em dash. */
export function formatKm(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${kmFmt.format(value)} km`;
}

/**
 * Format a date-only value (expense date). It is stored as 00:00 UTC, so it
 * must be rendered in UTC or it would slip a day in negative-offset timezones.
 */
export function formatDateOnly(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Format an event timestamp in the viewer's local time. */
export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const LEDGER_TYPE_LABEL: Record<string, string> = {
  advance: "Advance",
  expense_submitted: "Expense submitted",
  expense_approved: "Expense approved",
  expense_rejected: "Expense rejected",
};
