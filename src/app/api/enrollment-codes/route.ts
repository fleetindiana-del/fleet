import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/db";
import EnrollmentCode from "@/models/EnrollmentCode";
import User from "@/models/User";
import Driver from "@/models/Driver";
import Department from "@/models/Department";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import crypto from "crypto";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function generateCode(): string {
  return crypto.randomBytes(4).toString("hex").toUpperCase();
}

function normalizeCapabilities(raw: unknown) {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>;
    return {
      callMonitoring: Boolean(o.callMonitoring),
      locationTracking: Boolean(o.locationTracking),
      expenseManagement: Boolean(o.expenseManagement),
    };
  }
  // Legacy comma-string / string[] from older UI
  const list = Array.isArray(raw)
    ? raw.map(String)
    : typeof raw === "string"
      ? raw.split(",").map((s) => s.trim()).filter(Boolean)
      : [];
  const lower = list.map((s) => s.toLowerCase());
  return {
    callMonitoring:
      lower.some((s) => s.includes("call")) || lower.length === 0,
    locationTracking: lower.some((s) => s.includes("location") || s.includes("gps")),
    expenseManagement: lower.some((s) => s.includes("expense")),
  };
}

/**
 * Expiry is opt-in. A code with no `expiresAt` stays valid until it is used or
 * revoked — the redeem endpoint already treats a missing date as "never".
 * Returns undefined unless the caller asked for a positive number of hours.
 */
function resolveExpiry(expiresInHours: unknown): Date | undefined {
  if (expiresInHours === null || expiresInHours === undefined || expiresInHours === "") return undefined;
  const hours = Number(expiresInHours);
  if (!Number.isFinite(hours) || hours <= 0) return undefined;
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

function normalizeVehicle(raw: unknown) {
  if (!raw) return undefined;
  if (typeof raw === "string") {
    const registration = raw.trim();
    if (!registration) return undefined;
    return { id: registration, registration };
  }
  if (typeof raw === "object") {
    const o = raw as { id?: string; registration?: string };
    const registration = (o.registration || o.id || "").trim();
    if (!registration) return undefined;
    return { id: o.id || registration, registration };
  }
  return undefined;
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.companyId && session?.user?.role !== "super_admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.user.role !== "admin" && session.user.role !== "super_admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await connectToDatabase();

    const query: Record<string, unknown> = {};
    if (session.user.role !== "super_admin") {
      query.companyId = new mongoose.Types.ObjectId(session.user.companyId!);
    }

    const codes = await EnrollmentCode.find(query)
      .sort({ createdAt: -1 })
      .limit(200)
      .populate("departmentId", "name");
    return NextResponse.json(codes);
  } catch (error) {
    console.error("GET /api/enrollment-codes error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.companyId && session?.user?.role !== "super_admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.user.role !== "admin" && session.user.role !== "super_admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    const {
      employeeId,
      employeeName,
      role = "driver",
      departmentId,
      capabilities,
      vehicle,
      expiresInHours,
      username,
      password,
      email,
      deviceSetupStatus,
    } = body;

    if (!employeeName?.trim()) {
      return NextResponse.json({ error: "Employee name is required" }, { status: 400 });
    }

    // Optional sign-in account. Without it the code still enrols the handset;
    // with it the person can also sign in by hand, which is what lets them
    // re-authenticate on a replacement device without a fresh code.
    const loginUsername = typeof username === "string" ? username.trim() : "";
    const loginPassword = typeof password === "string" ? password : "";
    const wantsLogin = Boolean(loginUsername || loginPassword);

    if (wantsLogin && !loginUsername) {
      return NextResponse.json({ error: "Username is required to set a password" }, { status: 400 });
    }
    if (wantsLogin && !loginPassword) {
      return NextResponse.json({ error: "Password is required to set a username" }, { status: 400 });
    }
    if (wantsLogin && loginPassword.length < 6) {
      return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
    }

    await connectToDatabase();

    const companyId = new mongoose.Types.ObjectId(session.user.companyId!);
    const caps = normalizeCapabilities(capabilities);
    const vehicleObj = normalizeVehicle(vehicle);
    const setupStatus = deviceSetupStatus === "installed" ? "installed" : "pending";

    let departmentObjId: mongoose.Types.ObjectId | undefined;
    if (typeof departmentId === "string" && departmentId.trim()) {
      const department = await Department.findOne({ _id: departmentId, companyId });
      if (!department) {
        return NextResponse.json({ error: "Department not found" }, { status: 400 });
      }
      departmentObjId = department._id;
    }

    // Create the account before minting a code, so a clashing username fails
    // without leaving an orphan code behind.
    let driverId: mongoose.Types.ObjectId | undefined;
    if (wantsLogin) {
      const existingUsername = await User.findOne({ username: loginUsername });
      if (existingUsername) {
        return NextResponse.json({ error: "Username is already taken" }, { status: 400 });
      }

      // The User model requires a unique email; derive one from the username
      // when the admin did not supply a real address.
      const loginEmail =
        (typeof email === "string" && email.trim().toLowerCase()) ||
        `${loginUsername.toLowerCase()}@driver.local`;

      const existingEmail = await User.findOne({ email: loginEmail });
      if (existingEmail) {
        return NextResponse.json({ error: "Email already exists" }, { status: 400 });
      }

      // User.role has no "employee" — both enrolment roles are device users and
      // map to "driver" (the users screen labels it "Employee (Driver)").
      const newUser = await User.create({
        name: employeeName.trim(),
        email: loginEmail,
        username: loginUsername,
        passwordHash: await bcrypt.hash(loginPassword, 10),
        role: "driver",
        companyId,
        departmentId: departmentObjId,
        capabilities: caps,
      });

      const driver = await Driver.create({
        userId: newUser._id,
        companyId,
        walletBalance: 0,
        status: "active",
      });
      driverId = driver._id;
    }

    let code = "";
    for (let i = 0; i < 5; i++) {
      const candidate = generateCode();
      const exists = await EnrollmentCode.findOne({ code: candidate });
      if (!exists) {
        code = candidate;
        break;
      }
    }
    if (!code) {
      return NextResponse.json({ error: "Could not generate unique code" }, { status: 500 });
    }

    const expiresAt = resolveExpiry(expiresInHours);
    const serverUrl = process.env.BACKEND_URL?.trim().replace(/\/$/, "") || "";
    const apiKey = process.env.BACKEND_API_KEY ?? "";

    const enrollmentCode = await EnrollmentCode.create({
      code,
      companyId,
      employeeId: employeeId?.trim() || code,
      employeeName: employeeName.trim(),
      role: role === "employee" ? "employee" : "driver",
      departmentId: departmentObjId,
      capabilities: caps,
      vehicle: vehicleObj,
      serverUrl,
      apiKey,
      expiresAt,
      driverId,
      revoked: false,
      deviceSetupStatus: setupStatus,
    });

    // Shared Mongo is enough — Android redeems against Express which reads the same collection.
    await enrollmentCode.populate("departmentId", "name");
    return NextResponse.json(enrollmentCode, { status: 201 });
  } catch (error) {
    console.error("POST /api/enrollment-codes error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
