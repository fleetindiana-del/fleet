import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { runContactMerge } from "@/lib/contactMerge";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST — admin-triggered "Re-merge now" for the Contact Bank. Runs the same
 * job the device-sync endpoint triggers automatically (see
 * maybeTriggerAutoMerge in src/lib/contactMerge.ts), but on demand and
 * synchronously so the admin gets an immediate, up-to-date result.
 */
export async function POST() {
  try {
    const session = await getServerSession(authOptions);
    if (!session || session.user.role === "driver") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const result = await runContactMerge();
    if (!result.ran) {
      return NextResponse.json(
        { error: "A merge is already in progress. Try again shortly." },
        { status: 409 }
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("Failed to run contact merge:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
