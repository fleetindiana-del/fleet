import { NextResponse } from "next/server";
import mongoose from "mongoose";
import Company from "@/models/Company";
import { LedgerError } from "@/lib/expenseLedger";
import { errorResponse, readJson, withStaff } from "@/lib/incomeExpenseApi";
import {
  ExpenseTypeError,
  createExpenseType,
  deleteExpenseType,
  listExpenseTypes,
  updateExpenseType,
} from "@/lib/expenseTypes";

export const dynamic = "force-dynamic";

function typeErrors(e: unknown): NextResponse {
  if (e instanceof ExpenseTypeError) return NextResponse.json({ error: e.message }, { status: e.status });
  return errorResponse(e);
}

/** A super admin works on the company they pick; everyone else on their own. */
function companyFor(scope: string | null, requested: unknown): string {
  if (scope) return scope;
  if (typeof requested === "string" && mongoose.Types.ObjectId.isValid(requested)) return requested;
  throw new LedgerError(400, "COMPANY_REQUIRED", "Choose a company.");
}

/**
 * GET /api/expense-types?companyId=
 * The company's expense types (built-ins are created on first read). A super
 * admin without a company also gets the company list to choose from.
 */
export async function GET(req: Request) {
  return withStaff(async (_actor, scope) => {
    const requested = new URL(req.url).searchParams.get("companyId");
    let companies: { id: string; name: string }[] | undefined;
    let companyId = scope ?? (requested && mongoose.Types.ObjectId.isValid(requested) ? requested : null);
    if (!scope) {
      const rows = await (Company as mongoose.Model<{ name?: string }>).find({}).select("name").sort({ name: 1 }).lean();
      companies = rows.map((c) => ({ id: String(c._id), name: c.name || "Company" }));
      companyId ??= companies[0]?.id ?? null;
    }
    if (!companyId) return NextResponse.json({ companyId: null, companies: companies ?? [], types: [] });
    try {
      const types = await listExpenseTypes(companyId);
      return NextResponse.json({ companyId, companies, types });
    } catch (e) {
      return typeErrors(e);
    }
  });
}

/** POST { name, requiresReceipt?, requiresDescription?, vehicle?, sortOrder?, companyId? } */
export async function POST(req: Request) {
  return withStaff(async (_actor, scope) => {
    const body = await readJson(req);
    try {
      const type = await createExpenseType(companyFor(scope, body.companyId), body);
      return NextResponse.json(type, { status: 201 });
    } catch (e) {
      return typeErrors(e);
    }
  });
}

/** PUT { id, name?, requiresReceipt?, requiresDescription?, vehicle?, active?, sortOrder? } */
export async function PUT(req: Request) {
  return withStaff(async (_actor, scope) => {
    const body = await readJson(req);
    try {
      const type = await updateExpenseType(scope, body.id, body);
      return NextResponse.json(type);
    } catch (e) {
      return typeErrors(e);
    }
  });
}

/** DELETE ?id=  Built-in or already-used types are switched off instead. */
export async function DELETE(req: Request) {
  return withStaff(async (_actor, scope) => {
    try {
      const result = await deleteExpenseType(scope, new URL(req.url).searchParams.get("id"));
      return NextResponse.json(result);
    } catch (e) {
      return typeErrors(e);
    }
  });
}
