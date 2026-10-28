import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/db";
import { submitExpense } from "@/lib/expenseLedger";
import { errorResponse, readJson } from "@/lib/incomeExpenseApi";

export const dynamic = "force-dynamic";

/**
 * POST /api/driver/expenses
 *   { amount, category, description, expenseDate: "YYYY-MM-DD", photoBase64,
 *     latitude, longitude, accuracy?, clientRequestId?,
 *     odometerKm?, vehicleId? }  // required when category is Fuel
 *
 * Drivers only; the driver is always the signed-in user, never taken from the
 * body. The amount is deducted from the wallet immediately (the balance may go
 * negative) and the expense waits as PENDING for HR/admin review; a rejection
 * refunds it (see reviewExpense).
 *
 * Resending the same `clientRequestId` returns the original expense with
 * `duplicate: true` and status 200 instead of deducting twice.
 */
export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || session.user.role !== "driver") {
      return NextResponse.json({ error: "Unauthorized. Strict Driver Access." }, { status: 401 });
    }

    const body = await readJson(req);
    await connectToDatabase();

    const result = await submitExpense({
      userId: session.user.id,
      userName: session.user.name || session.user.email || "Driver",
      amount: body.amount,
      category: body.category,
      description: body.description,
      expenseDate: body.expenseDate,
      photoDataUrl: body.photoBase64,
      latitude: body.latitude,
      longitude: body.longitude,
      accuracy: body.accuracy,
      clientRequestId: body.clientRequestId,
      odometerKm: body.odometerKm,
      vehicleId: body.vehicleId,
    });

    return NextResponse.json(result, { status: result.duplicate ? 200 : 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
