import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { runContactIntelligence } from "@/lib/contactIntelligence";

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || session.user.role === "driver") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { phoneNumber, contactName, employeeName, deviceId } = body;

    if (!phoneNumber || !employeeName) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const knownName =
      contactName && contactName !== "Unknown" && contactName !== "" ? contactName : undefined;

    // Do not count this as another call. Scenario B manual send may raise a
    // stuck tracker up to the threshold once so the prompt can go out.
    const outcome = await runContactIntelligence(
      phoneNumber,
      knownName,
      employeeName,
      deviceId || "",
      { countAsNewCall: false, ensureAtThreshold: !knownName }
    );

    if (!outcome.ok) {
      return NextResponse.json(
        { success: false, error: outcome.message, step: outcome.step },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      message: outcome.message,
      step: outcome.step,
    });
  } catch (error: any) {
    console.error("Manual send error:", error);
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}
