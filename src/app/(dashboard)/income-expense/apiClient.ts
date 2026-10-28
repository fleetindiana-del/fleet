import type { AccountRow, AccountTotals, CategorySpend, ExpenseDTO, LedgerEntryDTO } from "@/lib/expenseLedger";

export type { AccountRow, AccountTotals, CategorySpend, ExpenseDTO, LedgerEntryDTO };

export interface SummaryResponse {
  drivers: AccountRow[];
  totals: AccountTotals;
  categories?: CategorySpend[];
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

/** An error response from the Income & Expense API, with its machine-readable code. */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
      cache: "no-store",
    });
  } catch {
    throw new ApiError("Network error. Check your connection and try again.", 0);
  }
  let body: { error?: string; code?: string; details?: Record<string, unknown> } | null = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON error page */
  }
  if (!res.ok) {
    throw new ApiError(body?.error || `Request failed (${res.status})`, res.status, body?.code, body?.details);
  }
  return body as T;
}

/** A fresh key per "open dialog" makes a retried/double-clicked submit idempotent on the server. */
export function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `k-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Local calendar day boundaries as ISO strings, for the ledger date filter. */
export function startOfLocalDayISO(yyyyMmDd: string): string {
  return new Date(`${yyyyMmDd}T00:00:00`).toISOString();
}
export function endOfLocalDayISO(yyyyMmDd: string): string {
  return new Date(`${yyyyMmDd}T23:59:59.999`).toISOString();
}
