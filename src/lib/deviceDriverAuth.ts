import mongoose from "mongoose";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/db";
import User from "@/models/User";
import Driver from "@/models/Driver";

export type DeviceDriver = { userId: string; userName: string };

/**
 * The phone signs in with a device token, not a website session. Expense
 * submission still goes through the same ledger as the driver page on the web.
 */
export async function driverFromDeviceToken(req: Request): Promise<DeviceDriver | null> {
  const header = req.headers.get("authorization") || "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;

  await connectToDatabase();
  const enrollment = await mongoose.connection.collection("deviceenrollments").findOne({
    deviceToken: token,
    revoked: { $ne: true },
  });
  if (!enrollment) return null;

  let user = null;
  const employeeId = enrollment.employeeId ? String(enrollment.employeeId) : "";
  if (employeeId && mongoose.isValidObjectId(employeeId)) {
    user = await User.findById(employeeId);
  }
  const driverId = enrollment.driverId ? String(enrollment.driverId) : "";
  if (!user && driverId && mongoose.isValidObjectId(driverId)) {
    const driver = await Driver.findById(driverId).select("userId");
    if (driver?.userId) user = await User.findById(driver.userId);
  }
  if (!user || String(user.role || "").toLowerCase() !== "driver") return null;
  if (user.capabilities && user.capabilities.expenseManagement === false) return null;

  return { userId: String(user._id), userName: user.name || "Driver" };
}

/** The driver behind a website driver session, else behind the phone's device token. */
export async function signedInDriver(req: Request): Promise<DeviceDriver | null> {
  const session = await getServerSession(authOptions);
  if (session?.user?.role === "driver" && session.user.id) {
    return { userId: session.user.id, userName: session.user.name || session.user.email || "Driver" };
  }
  return driverFromDeviceToken(req);
}
