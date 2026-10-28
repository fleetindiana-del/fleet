import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import { walletForEmployee } from "@/lib/deviceWallet";

export const dynamic = "force-dynamic";

function authorized(req: Request): boolean {
  const expected = process.env.API_KEY;
  if (!expected) return true;
  return req.headers.get("x-api-key") === expected;
}

/** GET /api/device/wallet?employeeName=Vedant — balance for the handset that syncs as that employee. */
export async function GET(req: Request) {
  try {
    if (!authorized(req)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const employeeName = new URL(req.url).searchParams.get("employeeName")?.trim() ?? "";
    if (!employeeName) {
      return NextResponse.json({ error: "employeeName is required" }, { status: 400 });
    }
    await connectToDatabase();
    const wallet = await walletForEmployee(employeeName);
    if (!wallet) {
      return NextResponse.json({ error: "No wallet for that employee" }, { status: 404 });
    }
    return NextResponse.json(wallet);
  } catch (error) {
    console.error("GET /api/device/wallet error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
