/** Shared plumbing for the Income & Expense API routes. */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import mongoose from "mongoose";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/db";
import { LedgerError, companyScopeFor, type Actor } from "@/lib/expenseLedger";
import { canManageIncomeExpense, LEDGER_ENTRY_TYPES, type LedgerEntryType } from "@/lib/expenseMath";

export function errorResponse(e: unknown): NextResponse {
  if (e instanceof LedgerError) {
    return NextResponse.json(
      { error: e.message, code: e.code, ...(e.details ? { details: e.details } : {}) },
      { status: e.status }
    );
  }
  // Never leak driver/DB internals to the client; the full error goes to the server log.
  console.error("[income-expense]", e);
  return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
}

export async function getSessionActor(): Promise<Actor> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) throw new LedgerError(401, "UNAUTHENTICATED", "Please sign in.");
  return {
    id: session.user.id,
    name: session.user.name || session.user.email || "Unknown",
    role: session.user.role,
    companyId: session.user.companyId,
  };
}

/**
 * Run a handler for HR/admin users only. Connects to the database, resolves the
 * tenant scope (null = super admin, all companies) and converts any thrown
 * LedgerError into the matching JSON response.
 */
export async function withStaff(
  handler: (actor: Actor, scope: string | null) => Promise<NextResponse>
): Promise<NextResponse> {
  try {
    const actor = await getSessionActor();
    if (!canManageIncomeExpense(actor.role)) {
      throw new LedgerError(403, "FORBIDDEN", "You do not have permission to manage income and expenses.");
    }
    const scope = companyScopeFor(actor);
    await connectToDatabase();
    return await handler(actor, scope);
  } catch (e) {
    return errorResponse(e);
  }
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    if (body && typeof body === "object" && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch {
    /* fall through */
  }
  throw new LedgerError(400, "INVALID_BODY", "Request body must be a JSON object.");
}

export function optionalObjectId(value: string | null, what: string): string | undefined {
  if (!value) return undefined;
  if (!mongoose.Types.ObjectId.isValid(value)) throw new LedgerError(400, "INVALID_ID", `Invalid ${what}.`);
  return value;
}

export function optionalDate(value: string | null, what: string): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new LedgerError(400, "INVALID_DATE", `Invalid ${what}.`);
  return d;
}

export function optionalLedgerType(value: string | null): LedgerEntryType | undefined {
  if (!value) return undefined;
  if (!(LEDGER_ENTRY_TYPES as string[]).includes(value)) {
    throw new LedgerError(400, "INVALID_TYPE", "Unknown transaction type.");
  }
  return value as LedgerEntryType;
}

/** Categories are Expense Type Master codes, so any short code is a valid filter. */
export function optionalExpenseCategory(value: string | null): string | undefined {
  if (!value) return undefined;
  const code = value.trim();
  if (!code || code.length > 60) {
    throw new LedgerError(400, "INVALID_CATEGORY", "Unknown expense category.");
  }
  return code;
}

export function optionalExpenseStatus(value: string | null) {
  if (!value || value === "all") return undefined;
  if (!["pending", "approved", "rejected"].includes(value)) {
    throw new LedgerError(400, "INVALID_STATUS", "Unknown expense status.");
  }
  return value as "pending" | "approved" | "rejected";
}

export function intParam(value: string | null, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
