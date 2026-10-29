import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/db";
import Driver from "@/models/Driver";
import Vehicle from "@/models/Vehicle";
import { getDriverAccount, listExpenses } from "@/lib/expenseLedger";
import { listExpenseTypes } from "@/lib/expenseTypes";
import { driverFromDeviceToken } from "@/lib/deviceDriverAuth";

export const dynamic = "force-dynamic";

/**
 * GET /api/driver/me/summary
 * Used by Android Custom Tab companion and driver session context.
 * Returns the authenticated driver's account and recent expenses.
 *
 * `walletBalance`, `driverId` and `recentExpenses[*]._id/amount/category/status/
 * timestamp/walletBalanceAfter` keep their original names for existing clients;
 * `account` and the extra expense fields are additive.
 */
export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    const device = session?.user?.role === "driver" ? null : await driverFromDeviceToken(req);
    const userId = session?.user?.role === "driver" ? session.user.id : device?.userId;
    if (!userId) {
      return NextResponse.json({ error: "Forbidden. Driver access only." }, { status: 403 });
    }

    await connectToDatabase();

    const driver = await Driver.findOne({ userId }).lean();
    if (!driver) {
      return NextResponse.json({ error: "Driver profile not found" }, { status: 404 });
    }
    const driverId = String(driver._id);

    const [account, recent, vehicles, expenseTypes] = await Promise.all([
      getDriverAccount(driverId),
      listExpenses({ driverId, limit: 10 }),
      Vehicle.find({ companyId: driver.companyId, status: "active" })
        .select("registration make vehicleModel odometerKm")
        .sort({ vehicleModel: 1, registration: 1 })
        .lean(),
      listExpenseTypes(driver.companyId, { activeOnly: true }),
    ]);

    return NextResponse.json({
      walletBalance: account?.balance ?? driver.walletBalance,
      driverId: driver._id,
      account: account && {
        totalAdvance: account.totalAdvance,
        totalSubmitted: account.totalSubmitted,
        totalApproved: account.totalApproved,
        totalPending: account.totalPending,
        totalRejected: account.totalRejected,
        balance: account.balance,
        excessAmount: account.excessAmount,
      },
      vehicles: vehicles.map((v) => ({
        id: String(v._id),
        registration: v.registration,
        make: v.make ?? null,
        model: v.vehicleModel ?? null,
        odometerKm: typeof v.odometerKm === "number" ? v.odometerKm : null,
      })),
      expenseTypes: expenseTypes.map((t) => ({
        code: t.code,
        name: t.name,
        requiresReceipt: t.requiresReceipt,
        requiresDescription: t.requiresDescription,
        vehicle: t.vehicle,
        tracksOdometer: t.tracksOdometer,
      })),
      recentExpenses: recent.items.map((e) => ({
        _id: e.id,
        amount: e.amount,
        category: e.category,
        description: e.description,
        expenseDate: e.expenseDate,
        status: e.status,
        rejectionReason: e.rejectionReason,
        timestamp: e.submittedAt,
        walletBalanceAfter: e.walletBalanceAfter ?? undefined,
        deductedOnSubmit: e.deductedOnSubmit,
      })),
    });
  } catch (error) {
    console.error("GET /api/driver/me/summary error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
