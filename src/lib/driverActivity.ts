/**
 * The driver's wallet as a single, newest-first list of transactions, the way a
 * payments app shows it: every expense is a debit, every advance and every
 * refund of a rejected expense is a credit. Pure, so it is unit-tested
 * (driverActivity.test.ts) and shared by the dashboard and history pages.
 */
import type { ExpenseDTO, LedgerEntryDTO } from "./expenseLedger";

export type ActivityKind = "expense" | "advance" | "refund";

export interface ActivityItem {
  key: string;
  kind: ActivityKind;
  direction: "debit" | "credit";
  /** Always positive; `direction` carries the sign. */
  amount: number;
  at: string;
  title: string;
  subtitle: string;
  /** Wallet balance right after this transaction, when it is known. */
  balanceAfter: number | null;
  expense?: ExpenseDTO;
  note?: string | null;
}

export type ActivityFilter = "all" | "expenses" | "credits" | "pending";

export const ACTIVITY_FILTERS: { key: ActivityFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "expenses", label: "Expenses" },
  { key: "credits", label: "Money added" },
  { key: "pending", label: "Awaiting approval" },
];

export function isActivityFilter(v: unknown): v is ActivityFilter {
  return typeof v === "string" && ACTIVITY_FILTERS.some((f) => f.key === v);
}

export function buildActivity(
  expenses: ExpenseDTO[],
  credits: LedgerEntryDTO[],
  filter: ActivityFilter = "all"
): ActivityItem[] {
  const items: ActivityItem[] = [];

  if (filter !== "credits") {
    for (const e of expenses) {
      if (filter === "pending" && e.status !== "pending") continue;
      items.push({
        key: `e:${e.id}`,
        kind: "expense",
        direction: "debit",
        amount: e.amount,
        at: e.submittedAt,
        title: e.description || e.category,
        subtitle: e.runKm != null ? `${e.category} · ${e.runKm.toLocaleString("en-IN", { maximumFractionDigits: 1 })} km` : e.category,
        balanceAfter: e.walletBalanceAfter,
        expense: e,
      });
    }
  }

  if (filter === "all" || filter === "credits") {
    for (const c of credits) {
      const refund = c.type === "expense_rejected";
      items.push({
        key: `l:${c.id}`,
        kind: refund ? "refund" : "advance",
        direction: "credit",
        amount: c.amount,
        at: c.timestamp,
        title: refund ? "Refund — expense rejected" : "Money added by HR",
        subtitle: refund ? c.note ?? "Rejected expense" : `By ${c.performedByName}`,
        balanceAfter: c.balanceAfter,
        note: c.note,
      });
    }
  }

  return items.sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || a.key.localeCompare(b.key));
}

/** Groups already-sorted items under a day label ("Today", "Yesterday", "12 Oct 2026") in `timeZone`. */
export function groupByDay(
  items: ActivityItem[],
  now: Date = new Date(),
  timeZone = "Asia/Kolkata"
): { label: string; items: ActivityItem[] }[] {
  const dayKey = (d: Date) => d.toLocaleDateString("en-CA", { timeZone });
  const today = dayKey(now);
  const yesterday = dayKey(new Date(now.getTime() - 86_400_000));
  const groups: { label: string; items: ActivityItem[] }[] = [];
  let currentKey = "";
  for (const item of items) {
    const d = new Date(item.at);
    const k = dayKey(d);
    if (k !== currentKey) {
      currentKey = k;
      const label =
        k === today
          ? "Today"
          : k === yesterday
            ? "Yesterday"
            : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone });
      groups.push({ label, items: [] });
    }
    groups[groups.length - 1].items.push(item);
  }
  return groups;
}
