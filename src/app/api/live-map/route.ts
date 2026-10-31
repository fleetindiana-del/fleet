import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/db";
import Expense from "@/models/Expense";
import { receiptUrlFor } from "@/lib/expenseLedger";
import type { MapExpense } from "@/lib/expenseMap";
import mongoose from "mongoose";

export const dynamic = "force-dynamic";

/** Enough to cover the fleet without shipping receipt photos in the map payload. */
const LIMIT = 2000;

const ExpenseM = Expense as mongoose.Model<any>;

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readDriver(value: unknown): { driverId: string; driverName: string } {
  if (!value || typeof value !== "object") return { driverId: "", driverName: "Unknown driver" };
  const driver = value as { _id?: unknown; userId?: { name?: string } | null };
  const rawName = driver.userId?.name;
  const name = typeof rawName === "string" ? rawName.trim() : "";
  return {
    driverId: driver._id == null ? "" : String(driver._id),
    driverName: name || "Unknown driver",
  };
}

/**
 * GET /api/live-map
 * Every expense that has a GPS fix, newest first. One row per expense — not
 * one row per driver — so a place with several fills lists all of them.
 * Receipt images are not included; the client loads them from the receipt URL.
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.companyId && session?.user?.role !== "super_admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await connectToDatabase();

    const query: Record<string, unknown> = {
      "location.lat": { $type: "number" },
      "location.lng": { $type: "number" },
    };
    if (session.user.role !== "super_admin") {
      query.companyId = new mongoose.Types.ObjectId(session.user.companyId!);
    }

    const [rows, total] = await Promise.all([
      ExpenseM.find(query)
        .select(
          "amount category description note timestamp location locationAccuracy walletBalanceAfter status driverId hasReceipt odometerKm previousOdometerKm runKm vehicleRegistration"
        )
        .sort({ timestamp: -1, _id: -1 })
        .limit(LIMIT)
        .populate({ path: "driverId", select: "userId", populate: { path: "userId", select: "name" } })
        .lean(),
      ExpenseM.countDocuments(query),
    ]);

    const expenses: MapExpense[] = [];
    for (const row of rows) {
      const lat = asNumber(row.location?.lat);
      const lng = asNumber(row.location?.lng);
      if (lat == null || lng == null || Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
      const driver = readDriver(row.driverId);
      const id = String(row._id);
      expenses.push({
        id,
        amount: row.amount,
        category: row.category || "Other",
        description: row.description || row.note || "",
        status: row.status,
        timestamp: new Date(row.timestamp).toISOString(),
        location: { lat, lng },
        locationAccuracy: asNumber(row.locationAccuracy),
        walletBalanceAfter: asNumber(row.walletBalanceAfter),
        driverName: driver.driverName,
        driverId: driver.driverId || undefined,
        // Unset on older rows, which may still have a photo. Explicit false means there is no receipt.
        hasReceipt: row.hasReceipt !== false,
        receiptUrl: receiptUrlFor(id),
        odometerKm: asNumber(row.odometerKm),
        previousOdometerKm: asNumber(row.previousOdometerKm),
        runKm: asNumber(row.runKm),
        vehicleRegistration: row.vehicleRegistration || null,
      });
    }

    return NextResponse.json({ expenses, total });
  } catch (error) {
    console.error("Failed to fetch expense map:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
