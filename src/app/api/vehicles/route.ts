import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/db";
import Vehicle from "@/models/Vehicle";
import { parseOdometer } from "@/lib/expenseMath";
import mongoose from "mongoose";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.companyId && session?.user?.role !== "super_admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await connectToDatabase();

    const query: Record<string, unknown> = {};
    if (session.user.role !== "super_admin") {
      query.companyId = new mongoose.Types.ObjectId(session.user.companyId!);
    }

    const vehicles = await Vehicle.find(query).sort({ createdAt: -1 }).lean();
    // Super admin can see every company. The fleet master is the same set of
    // registrations copied per company for drivers, so collapse to one row each.
    const rows =
      session.user.role === "super_admin"
        ? vehicles.filter((vehicle, index, all) => {
            const key = String(vehicle.registration || vehicle._id).trim().toLowerCase();
            return all.findIndex((row) => String(row.registration || row._id).trim().toLowerCase() === key) === index;
          })
        : vehicles;
    return NextResponse.json(rows.map((v) => ({ ...v, model: v.vehicleModel })));
  } catch (error) {
    console.error("GET /api/vehicles error:", error);
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
    const { registration, make, model, vehicleModel, status } = body;
    let odometerKm: number | undefined;
    if (body.odometerKm !== undefined && body.odometerKm !== null && body.odometerKm !== "") {
      const parsed = parseOdometer(body.odometerKm);
      if (parsed === null) {
        return NextResponse.json({ error: "Enter the odometer in kilometers." }, { status: 400 });
      }
      odometerKm = parsed;
    }

    if (!registration) {
      return NextResponse.json({ error: "Registration is required" }, { status: 400 });
    }

    await connectToDatabase();

    const companyId =
      session.user.role === "super_admin" && body.companyId
        ? new mongoose.Types.ObjectId(body.companyId)
        : new mongoose.Types.ObjectId(session.user.companyId!);

    const vehicle = await Vehicle.create({
      companyId,
      registration,
      make,
      vehicleModel: vehicleModel || model,
      status,
      odometerKm,
    });
    return NextResponse.json(
      { ...vehicle.toObject(), model: vehicle.vehicleModel },
      { status: 201 }
    );
  } catch (error) {
    console.error("POST /api/vehicles error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
