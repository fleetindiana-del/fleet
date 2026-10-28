import { NextResponse } from "next/server";
import { deleteAdvance, updateAdvance } from "@/lib/expenseLedger";
import { readJson, withStaff } from "@/lib/incomeExpenseApi";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** PATCH /api/income-expense/ledger/:id — correct a money-added entry. */
export async function PATCH(req: Request, { params }: Ctx) {
  return withStaff(async (actor) => {
    const { id } = await params;
    const body = await readJson(req);
    const result = await updateAdvance({
      entryId: id,
      amount: body.amount,
      note: body.note,
      actor,
    });
    return NextResponse.json({ success: true, ...result });
  });
}

/** DELETE /api/income-expense/ledger/:id — remove a money-added entry and rebuild the balance. */
export async function DELETE(_req: Request, { params }: Ctx) {
  return withStaff(async (actor) => {
    const { id } = await params;
    const result = await deleteAdvance({ entryId: id, actor });
    return NextResponse.json({ success: true, ...result });
  });
}
