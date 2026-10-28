import { NextResponse } from "next/server";
import { deleteExpense, updateExpense } from "@/lib/expenseLedger";
import { readJson, withStaff } from "@/lib/incomeExpenseApi";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** PATCH /api/income-expense/expenses/:id — correct amount, category, description, or odometer. */
export async function PATCH(req: Request, { params }: Ctx) {
  return withStaff(async (actor) => {
    const { id } = await params;
    const body = await readJson(req);
    const result = await updateExpense({
      expenseId: id,
      amount: body.amount,
      category: body.category,
      description: body.description,
      odometerKm: body.odometerKm,
      vehicleId: body.vehicleId,
      actor,
    });
    return NextResponse.json({ success: true, ...result });
  });
}

/** DELETE /api/income-expense/expenses/:id — remove the expense and its ledger rows. */
export async function DELETE(_req: Request, { params }: Ctx) {
  return withStaff(async (actor) => {
    const { id } = await params;
    const result = await deleteExpense({ expenseId: id, actor });
    return NextResponse.json({ success: true, ...result });
  });
}
