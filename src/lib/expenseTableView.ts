import { formatDateOnly, formatINR, formatKm } from "./incomeExpenseFormat.ts";

/** Wall-clock zone for expense times. Matches the shift timezone default. */
export const EXPENSE_TIME_ZONE = "Asia/Kolkata";

/** One expense or money-added row, with the raw values the table sorts and searches. */
export interface ExpenseTableRow {
  key: string;
  at: string;
  driverId: string;
  driverName: string;
  category: string;
  title: string;
  /** Absolute amount. Sorting uses this, so ₹1,300 stays after ₹200. */
  amount: number;
  status: "pending" | "approved" | "rejected" | "advance";
  balanceAfter: number | null;
  /** UTC calendar day of an expense date. Null for money added, which uses the local day of `at`. */
  expenseDay: string | null;
  vehicle: string | null;
  odometerKm: number | null;
  previousOdometerKm: number | null;
  runKm: number | null;
  approver: string | null;
  note: string | null;
}

export type ExpenseSortKey =
  | "employee"
  | "type"
  | "details"
  | "date"
  | "time"
  | "status"
  | "amount"
  | "balance"
  | "vehicle"
  | "odometer"
  | "approver";

export type SortDir = "asc" | "desc";

export interface ExpenseTableQuery {
  /** Null shows every employee. An empty list shows nobody, unless unassigned rows are included. */
  driverIds: string[] | null;
  includeUnassigned: boolean;
  rosterIds: string[];
  status: "all" | ExpenseTableRow["status"];
  category: string;
  /** Inclusive YYYY-MM-DD bounds. Empty means that side is open. */
  from: string;
  to: string;
  /** Inclusive HH:mm bounds in `timeZone`. An inverted range matches nothing. */
  fromTime: string;
  toTime: string;
  search: string;
  /** IANA zone used for recorded times. Expense dates stay on their UTC calendar day. */
  timeZone?: string;
}

export interface CapsuleCounts {
  expenseCount: number;
  expenseAmount: number;
  approvedCount: number;
  pendingCount: number;
  rejectedCount: number;
}

export const EMPTY_COUNTS: CapsuleCounts = {
  expenseCount: 0,
  expenseAmount: 0,
  approvedCount: 0,
  pendingCount: 0,
  rejectedCount: 0,
};

/** UTC day of a stored expense date, matching the date shown in the table. */
export function expenseDayFromIso(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function zoneOf(timeZone?: string) {
  return timeZone?.trim() || EXPENSE_TIME_ZONE;
}

/** Calendar day and minutes after midnight in the application's timezone. */
export function zonedClock(iso: string, timeZone = EXPENSE_TIME_ZONE): { day: string; minutes: number } | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zoneOf(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  let hour = Number(pick("hour"));
  if (hour === 24) hour = 0;
  const minute = Number(pick("minute"));
  if (!pick("year") || !pick("month") || !pick("day") || Number.isNaN(hour) || Number.isNaN(minute)) return null;
  return { day: `${pick("year")}-${pick("month")}-${pick("day")}`, minutes: hour * 60 + minute };
}

/** Calendar day of a timestamp in the application's timezone. */
export function localDateKey(iso: string, timeZone = EXPENSE_TIME_ZONE): string {
  return zonedClock(iso, timeZone)?.day ?? "";
}

/** Minutes after midnight in the application's timezone, so time-of-day sort ignores the calendar date. */
export function minutesOfDay(iso: string, timeZone = EXPENSE_TIME_ZONE): number | null {
  return zonedClock(iso, timeZone)?.minutes ?? null;
}

/** The calendar day the table shows for this row. */
export function displayDay(row: Pick<ExpenseTableRow, "expenseDay" | "at">, timeZone = EXPENSE_TIME_ZONE): string {
  if (row.expenseDay) return row.expenseDay;
  return localDateKey(row.at, timeZone);
}

function parseClock(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

export function inTimeWindow(minutes: number | null, fromTime: string, toTime: string): boolean {
  if (!fromTime && !toTime) return true;
  const from = fromTime ? parseClock(fromTime) : null;
  const to = toTime ? parseClock(toTime) : null;
  if (from == null && to == null) return true;
  if (minutes == null) return false;
  if (from != null && to != null && from > to) return false;
  if (from != null && minutes < from) return false;
  if (to != null && minutes > to) return false;
  return true;
}

function searchBlob(row: ExpenseTableRow, timeZone: string): string {
  const day = displayDay(row, timeZone);
  const recorded = new Date(row.at);
  const time = Number.isNaN(recorded.getTime())
    ? ""
    : recorded.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone });
  const recordedLabel = Number.isNaN(recorded.getTime())
    ? ""
    : recorded.toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZone,
      });
  const statusText =
    row.status === "pending"
      ? "pending to be approved"
      : row.status === "advance"
        ? "advance money added"
        : row.status;
  return [
    row.driverName,
    row.category,
    row.title,
    row.note ?? "",
    statusText,
    row.approver ?? "",
    row.vehicle ?? "",
    row.odometerKm ?? "",
    row.odometerKm != null ? formatKm(row.odometerKm) : "",
    row.previousOdometerKm ?? "",
    row.runKm ?? "",
    row.runKm != null ? formatKm(row.runKm) : "",
    row.amount,
    formatINR(row.amount),
    row.balanceAfter ?? "",
    row.balanceAfter != null ? formatINR(row.balanceAfter) : "",
    day,
    day ? formatDateOnly(`${day}T00:00:00.000Z`) : "",
    time,
    recordedLabel,
  ]
    .join(" ")
    .toLowerCase();
}

function driverVisible(row: ExpenseTableRow, query: ExpenseTableQuery): boolean {
  if (query.driverIds === null) return true;
  if (query.driverIds.includes(row.driverId)) return true;
  return query.includeUnassigned && !query.rosterIds.includes(row.driverId);
}

export function rowMatches(row: ExpenseTableRow, query: ExpenseTableQuery): boolean {
  const timeZone = zoneOf(query.timeZone);
  if (!driverVisible(row, query)) return false;
  if (query.status !== "all" && row.status !== query.status) return false;
  if (query.category && row.category !== query.category) return false;
  const day = displayDay(row, timeZone);
  if (query.from && (!day || day < query.from)) return false;
  if (query.to && (!day || day > query.to)) return false;
  if (!inTimeWindow(minutesOfDay(row.at, timeZone), query.fromTime, query.toTime)) return false;
  const tokens = query.search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length > 0) {
    const blob = searchBlob(row, timeZone);
    if (!tokens.every((token) => blob.includes(token))) return false;
  }
  return true;
}

function sortValue(row: ExpenseTableRow, key: ExpenseSortKey, timeZone: string): string | number | null {
  switch (key) {
    case "employee":
      return row.driverName.trim() || null;
    case "type":
      return row.category.trim() || null;
    case "details":
      return row.title.trim() || null;
    case "date":
      return displayDay(row, timeZone) || null;
    case "time":
      return minutesOfDay(row.at, timeZone);
    case "status":
      return row.status;
    case "amount":
      return Number.isFinite(row.amount) ? row.amount : null;
    case "balance":
      return row.balanceAfter;
    case "vehicle":
      return row.vehicle?.trim() || null;
    case "odometer":
      return row.odometerKm;
    case "approver":
      return row.approver?.trim() || null;
  }
}

function compareRows(a: ExpenseTableRow, b: ExpenseTableRow, key: ExpenseSortKey, dir: SortDir, timeZone: string): number {
  const av = sortValue(a, key, timeZone);
  const bv = sortValue(b, key, timeZone);
  const aEmpty = av == null || av === "";
  const bEmpty = bv == null || bv === "";
  if (aEmpty || bEmpty) {
    if (aEmpty && bEmpty) return a.key.localeCompare(b.key);
    return aEmpty ? 1 : -1;
  }
  const cmp =
    typeof av === "number" && typeof bv === "number"
      ? av - bv
      : String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: "base" });
  if (cmp !== 0) return dir === "asc" ? cmp : -cmp;
  if (key === "date") {
    const at = Date.parse(a.at) - Date.parse(b.at);
    if (at !== 0) return dir === "asc" ? at : -at;
  }
  if (key === "time") {
    const day = displayDay(a, timeZone).localeCompare(displayDay(b, timeZone));
    if (day !== 0) return dir === "asc" ? day : -day;
  }
  return a.key.localeCompare(b.key);
}

export function applyExpenseTable<T extends ExpenseTableRow>(
  rows: T[],
  query: ExpenseTableQuery,
  sort: { key: ExpenseSortKey; dir: SortDir }
): T[] {
  const timeZone = zoneOf(query.timeZone);
  return rows
    .filter((row) => rowMatches(row, query))
    .sort((a, b) => compareRows(a, b, sort.key, sort.dir, timeZone));
}

export function countsFromAccount(row: {
  submittedCount: number;
  totalSubmitted: number;
  approvedCount: number;
  pendingCount: number;
  rejectedCount: number;
}): CapsuleCounts {
  return {
    expenseCount: row.submittedCount,
    expenseAmount: row.totalSubmitted,
    approvedCount: row.approvedCount,
    pendingCount: row.pendingCount,
    rejectedCount: row.rejectedCount,
  };
}

export function countsFromSpend(
  rows: {
    pending: number;
    approved: number;
    rejected: number;
    pendingCount: number;
    approvedCount: number;
    rejectedCount: number;
  }[]
): CapsuleCounts {
  const totals = rows.reduce<CapsuleCounts>(
    (acc, row) => ({
      expenseCount: acc.expenseCount + row.pendingCount + row.approvedCount + row.rejectedCount,
      expenseAmount: acc.expenseAmount + row.pending + row.approved + row.rejected,
      approvedCount: acc.approvedCount + row.approvedCount,
      pendingCount: acc.pendingCount + row.pendingCount,
      rejectedCount: acc.rejectedCount + row.rejectedCount,
    }),
    { ...EMPTY_COUNTS }
  );
  totals.expenseAmount = Math.round(totals.expenseAmount * 100) / 100;
  return totals;
}

export function addCounts(a: CapsuleCounts, b: CapsuleCounts): CapsuleCounts {
  return {
    expenseCount: a.expenseCount + b.expenseCount,
    expenseAmount: Math.round((a.expenseAmount + b.expenseAmount) * 100) / 100,
    approvedCount: a.approvedCount + b.approvedCount,
    pendingCount: a.pendingCount + b.pendingCount,
    rejectedCount: a.rejectedCount + b.rejectedCount,
  };
}
