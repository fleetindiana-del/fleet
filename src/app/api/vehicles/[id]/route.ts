import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/db";
import Vehicle from "@/models/Vehicle";
import { parseOdometer } from "@/lib/expenseMath";

export const dynamic = "force-dynamic";

function isAdmin(role?: string) {
  return role === "admin" || role === "super_admin";
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await getServerSession(authOptions);
    if (!isAdmin(session?.user?.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await connectToDatabase();

    const existing = await Vehicle.findById(id);
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (
      session!.user.role !== "super_admin" &&
      existing.companyId.toString() !== session!.user.companyId
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    const update: Record<string, unknown> = { ...body };
    if (body.model !== undefined && body.vehicleModel === undefined) {
      update.vehicleModel = body.model;
      delete update.model;
    }
    let unset: Record<string, 1> | null = null;
    if (body.odometerKm !== undefined) {
      delete update.odometerKm;
      if (body.odometerKm === null || body.odometerKm === "") {
        unset = { odometerKm: 1, lastRunKm: 1 };
      } else {
        const parsed = parseOdometer(body.odometerKm);
        if (parsed === null) {
          return NextResponse.json({ error: "Enter the odometer in kilometers." }, { status: 400 });
        }
        if (parsed !== existing.odometerKm) {
          update.odometerKm = parsed;
          unset = { lastRunKm: 1 };
        }
      }
    }
    const vehicle = await Vehicle.findByIdAndUpdate(
      id,
      unset ? { ...(Object.keys(update).length ? { $set: update } : {}), $unset: unset } : update,
      { new: true }
    );
    return NextResponse.json({ ...vehicle!.toObject(), model: vehicle!.vehicleModel });
  } catch (error) {
    console.error("PUT /api/vehicles/[id] error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await getServerSession(authOptions);
    if (!isAdmin(session?.user?.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await connectToDatabase();

    const vehicle = await Vehicle.findById(id);
    if (!vehicle) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (
      session!.user.role !== "super_admin" &&
      vehicle.companyId.toString() !== session!.user.companyId
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await Vehicle.findByIdAndDelete(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/vehicles/[id] error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
