import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/db";
import { submitExpense } from "@/lib/expenseLedger";
import { errorResponse, readJson } from "@/lib/incomeExpenseApi";
import { driverFromDeviceToken } from "@/lib/deviceDriverAuth";

export const dynamic = "force-dynamic";

/**
 * POST /api/driver/expenses
 *   { amount, category, description, expenseDate: "YYYY-MM-DD", photoBase64,
 *     latitude?, longitude?, accuracy?, locationTakenAt?, locationStatus?,
 *     clientRequestId?, odometerKm?, vehicleId? }
 *
 * `category` is an Expense Type Master code; that type decides which of the
 * receipt, description, vehicle and odometer are required. Without a GPS fix
 * the expense is still saved, with `locationStatus` "denied" or "unavailable".
 *
 * Drivers only (web session or the phone's device token); the driver is
 * always the signed-in user, never taken from the body. The amount is deducted from the wallet immediately (the balance may go
 * negative) and the expense waits as PENDING for HR/admin review; a rejection
 * refunds it (see reviewExpense).
 *
 * Resending the same `clientRequestId` returns the original expense with
 * `duplicate: true` and status 200 instead of deducting twice.
 */
export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    const device = session?.user?.role === "driver" ? null : await driverFromDeviceToken(req);
    const userId = session?.user?.role === "driver" ? session.user.id : device?.userId;
    const userName =
      session?.user?.role === "driver"
        ? session.user.name || session.user.email || "Driver"
        : device?.userName;
    if (!userId || !userName) {
      return NextResponse.json({ error: "Unauthorized. Strict Driver Access." }, { status: 401 });
    }

    const body = await readJson(req);
    await connectToDatabase();

    const result = await submitExpense({
      userId,
      userName,
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
      locationStatus: body.locationStatus,
      locationTakenAt: body.locationTakenAt,
    });

    return NextResponse.json(result, { status: result.duplicate ? 200 : 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
