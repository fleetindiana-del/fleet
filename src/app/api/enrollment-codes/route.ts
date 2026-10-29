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
import { revokeDeviceSignIns, usernameAfterRename } from "@/lib/deviceSession";

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
      // Older clients don't send `shifts`; scheduled shifts used to ride on locationTracking.
      shifts: o.shifts === undefined ? Boolean(o.locationTracking) : Boolean(o.shifts),
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
    shifts: lower.some((s) => s.includes("shift")) || lower.some((s) => s.includes("location") || s.includes("gps")),
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
      .populate("departmentId", "name")
      .lean();

    // Attach the linked sign-in username (code -> Driver -> User), so the edit
    // dialog can show and change the person's login. Username only, never the hash.
    const driverIds = codes.map((c) => c.driverId).filter(Boolean);
    const usernameByDriver = new Map<string, string>();
    if (driverIds.length) {
      const drivers = await Driver.find({ _id: { $in: driverIds } }).select("userId").lean();
      const users = await User.find({ _id: { $in: drivers.map((d) => d.userId) } })
        .select("username")
        .lean();
      const usernameByUser = new Map(users.map((u) => [String(u._id), u.username ?? ""]));
      for (const d of drivers) usernameByDriver.set(String(d._id), usernameByUser.get(String(d.userId)) ?? "");
    }
    return NextResponse.json(
      codes.map((c) => ({ ...c, loginUsername: c.driverId ? (usernameByDriver.get(String(c.driverId)) ?? "") : "" }))
    );
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

/**
 * PUT /api/enrollment-codes  { id, ...fields }
 *
 * Edits an existing code: employee, type, department, vehicle, access
 * (capabilities), device setup status, expiry and revoked state.
 *
 * Access is synced to the person's sign-in account when the code has one, because
 * that account is what the phone checks at sign-in — editing the code alone would
 * show "Expenses" on this page while the app still refuses. A username/password
 * sent for a code that has no account yet creates one, like POST does. A new
 * name, username, or password replaces the phone's saved sign-in, so the next
 * time the app opens it asks for the details just saved here.
 */
export async function PUT(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.companyId && session?.user?.role !== "super_admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.user.role !== "admin" && session.user.role !== "super_admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    const { id, employeeId, employeeName, role, departmentId, capabilities, vehicle, deviceSetupStatus, username, password } = body;

    if (typeof id !== "string" || !mongoose.isValidObjectId(id)) {
      return NextResponse.json({ error: "A valid enrollment code id is required" }, { status: 400 });
    }
    if (typeof employeeName !== "string" || !employeeName.trim()) {
      return NextResponse.json({ error: "Employee name is required" }, { status: 400 });
    }

    const loginUsername = typeof username === "string" ? username.trim() : "";
    const loginPassword = typeof password === "string" ? password : "";
    if (loginPassword && !loginUsername) {
      return NextResponse.json({ error: "Username is required to set a password" }, { status: 400 });
    }
    if (loginPassword && loginPassword.length < 6) {
      return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
    }

    await connectToDatabase();

    const query: Record<string, unknown> = { _id: id };
    if (session.user.role !== "super_admin") {
      query.companyId = new mongoose.Types.ObjectId(session.user.companyId!);
    }
    const code = await EnrollmentCode.findOne(query);
    if (!code) {
      return NextResponse.json({ error: "Enrollment code not found" }, { status: 404 });
    }

    const companyId = code.companyId as mongoose.Types.ObjectId;
    const caps = normalizeCapabilities(capabilities);

    let departmentObjId: mongoose.Types.ObjectId | undefined;
    if (typeof departmentId === "string" && departmentId.trim()) {
      const department = await Department.findOne({ _id: departmentId, companyId });
      if (!department) {
        return NextResponse.json({ error: "Department not found" }, { status: 400 });
      }
      departmentObjId = department._id;
    }

    let expiresAt: Date | undefined;
    let clearExpiry = false;
    if ("expiresAt" in body) {
      if (body.expiresAt === null || body.expiresAt === "") {
        clearExpiry = true;
      } else {
        const parsed = new Date(body.expiresAt);
        if (Number.isNaN(parsed.getTime())) {
          return NextResponse.json({ error: "Invalid expiry date" }, { status: 400 });
        }
        expiresAt = parsed;
      }
    }

    // Linked sign-in account (code -> Driver -> User), if this person has one.
    let linkedUser = null;
    if (code.driverId) {
      const driver = await Driver.findById(code.driverId).select("userId").lean();
      if (driver) linkedUser = await User.findById(driver.userId);
    }

    let newDriverId: mongoose.Types.ObjectId | undefined;
    let signInChanged = false;
    if (linkedUser) {
      const previousName = String(linkedUser.name || "");
      const previousUsername = String(linkedUser.username || "");
      const nextName = employeeName.trim();
      const nextUsername = usernameAfterRename({
        previousName,
        previousUsername,
        nextName,
        submittedUsername: loginUsername,
      });

      if (nextUsername && nextUsername !== previousUsername) {
        const taken = await User.findOne({ username: nextUsername, _id: { $ne: linkedUser._id } });
        if (taken) {
          return NextResponse.json({ error: "Username is already taken" }, { status: 400 });
        }
        linkedUser.username = nextUsername;
        signInChanged = true;
      }
      if (loginPassword) {
        linkedUser.passwordHash = await bcrypt.hash(loginPassword, 10);
        signInChanged = true;
      }
      if (nextName !== previousName) {
        linkedUser.name = nextName;
        signInChanged = true;
      }
      linkedUser.departmentId = departmentObjId;
      linkedUser.capabilities = caps;
      await linkedUser.save();
      if (signInChanged) await revokeDeviceSignIns(linkedUser._id);
    } else if (loginUsername || loginPassword) {
      if (!loginUsername || !loginPassword) {
        return NextResponse.json({ error: "Username and password are both required to create a sign-in" }, { status: 400 });
      }
      const existingUsername = await User.findOne({ username: loginUsername });
      if (existingUsername) {
        return NextResponse.json({ error: "Username is already taken" }, { status: 400 });
      }
      const loginEmail =
        (typeof body.email === "string" && body.email.trim().toLowerCase()) ||
        `${loginUsername.toLowerCase()}@driver.local`;
      const existingEmail = await User.findOne({ email: loginEmail });
      if (existingEmail) {
        return NextResponse.json({ error: "Email already exists" }, { status: 400 });
      }
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
      const driver = await Driver.create({ userId: newUser._id, companyId, walletBalance: 0, status: "active" });
      newDriverId = driver._id;
      linkedUser = newUser;
    }

    const $set: Record<string, unknown> = {
      employeeName: employeeName.trim(),
      employeeId: (typeof employeeId === "string" && employeeId.trim()) || code.employeeId || code.code,
      role: role === "employee" ? "employee" : "driver",
      departmentId: departmentObjId,
      vehicle: normalizeVehicle(vehicle),
      capabilities: caps,
      deviceSetupStatus: deviceSetupStatus === "installed" ? "installed" : "pending",
    };
    if (typeof body.revoked === "boolean") $set.revoked = body.revoked;
    if (expiresAt) $set.expiresAt = expiresAt;
    if (newDriverId) $set.driverId = newDriverId;

    const update: Record<string, unknown> = { $set };
    if (clearExpiry) update.$unset = { expiresAt: "" };
    await EnrollmentCode.updateOne({ _id: code._id }, update);

    const updated = await EnrollmentCode.findById(code._id).populate("departmentId", "name").lean();
    return NextResponse.json({ ...updated, loginUsername: linkedUser?.username ?? "" });
  } catch (error) {
    console.error("PUT /api/enrollment-codes error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
