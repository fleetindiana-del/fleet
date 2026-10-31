import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/db";
import User from "@/models/User";
import Driver from "@/models/Driver";
import EnrollmentCode from "@/models/EnrollmentCode";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { revokeDeviceSignIns, usernameAfterRename } from "@/lib/deviceSession";

/**
 * Device capabilities for this user — what the Android app may do once they sign
 * in on a handset. Replaces the per-code capabilities that single-use enrollment
 * codes used to carry (see backend `/api/enrollment/login`).
 *
 * Absent input falls back to the old code-generator default for a driver (call
 * monitoring on, location and expenses off) rather than to nothing, so a driver
 * created through an older client still gets a working app.
 */
/** Blank usernames must be omitted. A unique index treats stored null as a value, so the second account with no username is rejected. */
function blankUsername(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

let usernameIndexReady: Promise<void> | null = null;

async function ensureUsernameIndex() {
  if (!usernameIndexReady) {
    usernameIndexReady = (async () => {
      const coll = User.collection;
      await coll.updateMany(
        { $or: [{ username: null }, { username: "" }] },
        { $unset: { username: "" } }
      );
      const indexes = await coll.indexes();
      const current = indexes.find(
        (index) => index.key && index.key.username === 1 && Object.keys(index.key).length === 1
      );
      if (!current?.sparse) {
        if (current?.name) await coll.dropIndex(current.name);
        await coll.createIndex({ username: 1 }, { unique: true, sparse: true });
      }
    })().catch((error) => {
      usernameIndexReady = null;
      throw error;
    });
  }
  return usernameIndexReady;
}

function normalizeCapabilities(raw: unknown, role?: string) {
  const isDevice = role === "driver" || role === "employee";
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
  return {
    callMonitoring: isDevice,
    locationTracking: false,
    expenseManagement: false,
    shifts: false,
  };
}

export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.companyId && session?.user?.role !== "super_admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await connectToDatabase();
    await ensureUsernameIndex();

    const query: any = {};
    if (session.user.role !== "super_admin") {
      query.companyId = new mongoose.Types.ObjectId(session.user.companyId!);
    }

    const users = await User.aggregate([
      { $match: query },
      { $sort: { createdAt: -1 } },
      {
        $lookup: {
          from: "departments",
          localField: "departmentId",
          foreignField: "_id",
          as: "department",
        },
      },
      { $addFields: { department: { $arrayElemAt: ["$department", 0] } } },
      {
        $lookup: {
          from: "drivers",
          localField: "_id",
          foreignField: "userId",
          as: "driverProfile"
        }
      },
      {
        $addFields: {
          driverProfile: { $arrayElemAt: ["$driverProfile", 0] }
        }
      },
      {
        $project: {
          passwordHash: 0,
        }
      }
    ]);
    
    // Map the shape to explicitly surface the wallet balance at the top level for the UI
    const usersWithWallet = users.map(u => ({
      ...u,
      walletBalance: u.driverProfile?.walletBalance || 0,
      driverId: u.driverProfile?._id || null, // Needed for the topup POST route
    }));

    return NextResponse.json(usersWithWallet);
  } catch (error) {
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.companyId && session?.user?.role !== "super_admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { name, email, username, password, role, departmentId } = body;

    if (!name || !email || !password || !role) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // What a device may do once this user signs in on it. Drivers who sign in
    // with nothing ticked get a working app that records nothing, so default a
    // driver to call monitoring the way enrollment codes did.
    const capabilities = normalizeCapabilities(body.capabilities, role);

    await connectToDatabase();
    await ensureUsernameIndex();

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return NextResponse.json({ error: "Email already exists" }, { status: 400 });
    }

    const signInName = blankUsername(username);
    if (signInName) {
      const existingUsername = await User.findOne({ username: signInName });
      if (existingUsername) {
        return NextResponse.json({ error: "Username is already taken" }, { status: 400 });
      }
    }

    const rawCompanyId =
      (session.user.role === "super_admin" ? body.companyId : null) || session.user.companyId;
    const companyId =
      rawCompanyId && mongoose.isValidObjectId(String(rawCompanyId)) ? String(rawCompanyId) : "";

    const passwordHash = await bcrypt.hash(password, 10);

    const account: Record<string, unknown> = {
      name: String(name).trim(),
      email: String(email).trim(),
      passwordHash,
      role,
      departmentId: departmentId ? new mongoose.Types.ObjectId(departmentId) : undefined,
      capabilities,
    };
    if (signInName) account.username = signInName;
    if (companyId) account.companyId = new mongoose.Types.ObjectId(companyId);

    const newUser = await User.create(account);

    // Automatically create Driver profile if role is driver
    if (role === "driver") {
      await Driver.create({
        userId: newUser._id,
        ...(companyId ? { companyId: new mongoose.Types.ObjectId(companyId) } : {}),
        walletBalance: 0,
        status: "active"
      });
    }

    const userObj = newUser.toObject();
    delete userObj.passwordHash;

    return NextResponse.json(userObj, { status: 201 });
  } catch (error) {
    const duplicate = error as { code?: number; keyPattern?: Record<string, unknown> };
    if (duplicate?.code === 11000) {
      if (duplicate.keyPattern?.email) {
        return NextResponse.json({ error: "Email already exists" }, { status: 400 });
      }
      if (duplicate.keyPattern?.username) {
        return NextResponse.json({ error: "Username is already taken" }, { status: 400 });
      }
    }
    console.error(error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.companyId && session?.user?.role !== "super_admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { _id, name, email, username, password, role, departmentId } = body;

    if (!_id) {
      return NextResponse.json({ error: "User ID is required" }, { status: 400 });
    }

    await connectToDatabase();
    await ensureUsernameIndex();

    const userToUpdate = await User.findById(_id);
    if (!userToUpdate) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Security enforcing tenant isolation boundaries
    if (session.user.role !== "super_admin" && userToUpdate.companyId?.toString() !== session.user.companyId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const previousName = String(userToUpdate.name || "");
    const previousUsername = String(userToUpdate.username || "");
    const previousEmail = String(userToUpdate.email || "");
    let signInChanged = false;

    // Check email collisions
    if (email && email !== userToUpdate.email) {
      const emailCollision = await User.findOne({ email });
      if (emailCollision) return NextResponse.json({ error: "Email is already taken" }, { status: 400 });
      userToUpdate.email = email;
      signInChanged = true;
    }

    const nextName = typeof name === "string" && name.trim() ? name.trim() : previousName;
    const nextUsername = usernameAfterRename({
      previousName,
      previousUsername,
      nextName,
      submittedUsername: username === undefined ? undefined : String(username),
    });

    if (nextUsername !== previousUsername) {
      if (nextUsername) {
        const usernameCollision = await User.findOne({
          username: nextUsername,
          _id: { $ne: userToUpdate._id },
        });
        if (usernameCollision) return NextResponse.json({ error: "Username is already taken" }, { status: 400 });
        userToUpdate.username = nextUsername;
      } else {
        userToUpdate.set("username", undefined);
        userToUpdate.markModified("username");
      }
      signInChanged = true;
    }

    if (nextName && nextName !== previousName) {
      userToUpdate.name = nextName;
      signInChanged = true;
      const driver = await Driver.findOne({ userId: userToUpdate._id }).select("_id");
      if (driver) {
        await EnrollmentCode.updateMany({ driverId: driver._id }, { $set: { employeeName: nextName } });
      }
    }

    // Department assignment is optional; allow clearing with empty string / null
    if (departmentId !== undefined) {
      userToUpdate.departmentId = departmentId
        ? new mongoose.Types.ObjectId(departmentId)
        : undefined;
    }
    
    // Changing role might mean we need to spin up a Driver profile, or handle orphans
    if (role && role !== userToUpdate.role) {
      userToUpdate.role = role;
      if (role === 'driver') {
        const existingDriver = await Driver.findOne({ userId: userToUpdate._id });
        if (!existingDriver) {
           await Driver.create({
            userId: userToUpdate._id,
            companyId: userToUpdate.companyId,
            walletBalance: 0,
            status: "active"
          });
        }
      }
    }

    // Update password optionally. The phone reads this hash on its next sign-in.
    if (password && password.trim() !== '') {
      userToUpdate.passwordHash = await bcrypt.hash(password, 10);
      signInChanged = true;
    }

    // Device capabilities. Only touched when the client actually sends them, so
    // an older edit form that knows nothing about this field cannot silently
    // strip a driver's location tracking on an unrelated save.
    if (body.capabilities !== undefined) {
      userToUpdate.capabilities = normalizeCapabilities(
        body.capabilities,
        role || userToUpdate.role
      );
    }

    await userToUpdate.save();
    if (!blankUsername(userToUpdate.username)) {
      await User.updateOne({ _id: userToUpdate._id }, { $unset: { username: "" } });
    }
    if (signInChanged || previousEmail !== String(userToUpdate.email || "")) {
      await revokeDeviceSignIns(userToUpdate._id);
    }
    return NextResponse.json({ success: true });

  } catch (error) {
    console.error("Failed to update user:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.companyId && session?.user?.role !== "super_admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
       return NextResponse.json({ error: "User ID is required" }, { status: 400 });
    }

    await connectToDatabase();

    const userToDelete = await User.findById(id);
    if (!userToDelete) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (session.user.role !== "super_admin" && userToDelete.companyId?.toString() !== session.user.companyId) {
       return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // If deleting a driver, also clean up the driver profile
    if (userToDelete.role === 'driver') {
       await Driver.deleteOne({ userId: userToDelete._id });
       // Note: Expenses, WalletTransactions, and CallLogs associated with driver ID remain for historical audit logs
    }

    await User.deleteOne({ _id: userToDelete._id });
    return NextResponse.json({ success: true });

  } catch (error) {
    console.error("Failed to delete user:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
