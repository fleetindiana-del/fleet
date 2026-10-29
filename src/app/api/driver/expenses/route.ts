import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import Driver from "@/models/Driver";
import { listExpenses, submitExpense } from "@/lib/expenseLedger";
import { errorResponse, readJson } from "@/lib/incomeExpenseApi";
import { signedInDriver } from "@/lib/deviceDriverAuth";

export const dynamic = "force-dynamic";

const STATUSES = ["pending", "approved", "rejected"] as const;

/**
 * GET /api/driver/expenses?page=1&limit=20&status=pending|approved|rejected
 *
 * The signed-in driver's own expense history, newest first, with the review
 * (who approved or rejected it, and when), vehicle, odometer and location.
 * `receiptUrl` serves the bill photo to this same driver.
 */
export async function GET(req: Request) {
  try {
    const driverUser = await signedInDriver(req);
    if (!driverUser) {
      return NextResponse.json({ error: "Unauthorized. Strict Driver Access." }, { status: 401 });
    }
    await connectToDatabase();
    const driver = await Driver.findOne({ userId: driverUser.userId }).select("_id").lean();
    if (!driver) {
      return NextResponse.json({ error: "Driver profile not found" }, { status: 404 });
    }

    const params = new URL(req.url).searchParams;
    const status = STATUSES.find((s) => s === params.get("status"));
    const result = await listExpenses({
      driverId: String(driver._id),
      status,
      page: Number(params.get("page")) || 1,
      limit: Number(params.get("limit")) || 20,
    });
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}

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
    const driverUser = await signedInDriver(req);
    if (!driverUser) {
      return NextResponse.json({ error: "Unauthorized. Strict Driver Access." }, { status: 401 });
    }

    const body = await readJson(req);
    await connectToDatabase();

    const result = await submitExpense({
      userId: driverUser.userId,
      userName: driverUser.userName,
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
