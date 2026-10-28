import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import { walletForEmployee } from "@/lib/deviceWallet";
import ToggleLog from "@/models/ToggleLog";

// POST — called by the Android app (authenticated via X-API-Key)
// This mirrors the Express backend's /api/status endpoint so either server URL works.
export async function POST(req: Request) {
  try {
    const apiKey = req.headers.get("x-api-key");
    const expectedKey = process.env.API_KEY;
    if (expectedKey && apiKey !== expectedKey) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { deviceId, employeeName, status, timestamp } = body;

    if (!deviceId || !status) {
      return NextResponse.json(
        { error: "Missing required fields: deviceId, status" },
        { status: 400 }
      );
    }

    const normalizedStatus = String(status).toUpperCase();
    const allowed = [
      "ON",
      "OFF",
      "PERMISSION_DENIED",
      "PERMISSION_RESTORED",
      "ADMIN_DISABLED",
      "ADMIN_ENABLED",
      // Shift boundaries from the device's own Shift switch.
      "SHIFT_ON",
      "SHIFT_OFF",
      // Location lost / regained mid-shift. The Android app has always sent these;
      // without them here the server answered 400 and the phone re-queued each one forever.
      "LOCATION_DISABLED",
      "LOCATION_RESTORED",
    ];
    if (!allowed.includes(normalizedStatus)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    await connectToDatabase();

    const toggleLog = await ToggleLog.create({
      deviceId,
      employeeName: employeeName || "Unknown",
      status: normalizedStatus,
      reason: body.reason,
      timestamp: timestamp ? new Date(Number(timestamp)) : new Date(),
    });

    console.log(`🔌 Toggle ${normalizedStatus} | ${employeeName} | ${deviceId}`);
    let wallet = null;
    try {
      if (typeof employeeName === "string" && employeeName.trim()) {
        wallet = await walletForEmployee(employeeName);
      }
    } catch (error) {
      console.error("Wallet lookup during status sync failed:", error);
    }
    return NextResponse.json({ success: true, id: toggleLog._id, wallet }, { status: 201 });
  } catch (error) {
    console.error("Failed to save toggle log:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
