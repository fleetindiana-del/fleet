import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/db";
import { syncIncomingCalls } from "@/lib/callSync";
import { syncLinkedEmployees } from "@/lib/employeeCallSync";

export const maxDuration = 60;

/**
 * GET /api/contact-intelligence/process
 *
 * Linked devices are reconciled from their call logs first, so counts match the
 * device and are not incremented again. Other devices only circulate new calls.
 *
 * Called automatically by AutoProcessor every 10s and manually from dashboard.
 */
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  const apiKey = req.headers.get("x-api-key");
  const expectedKey = process.env.API_KEY || "change-this-key";

  const hasValidApiKey = apiKey && apiKey === expectedKey;
  const hasValidSession = session && session.user?.role !== "driver";
  const isAuthorized = hasValidApiKey || hasValidSession;

  if (!isAuthorized) {
    let reason: string;
    if (apiKey && apiKey !== expectedKey) {
      reason = "Invalid x-api-key (does not match API_KEY env)";
    } else if (session?.user?.role === "driver") {
      reason = "Session role is 'driver'; only non-driver users can call this endpoint";
    } else if (!apiKey && !session) {
      reason = "Missing x-api-key header and no session. Log in or send x-api-key.";
    } else {
      reason = "No valid x-api-key and no valid non-driver session.";
    }
    console.warn("[contact-intelligence/process] 401:", reason);
    return NextResponse.json({ error: "Unauthorized", message: reason }, { status: 401 });
  }

  try {
    await connectToDatabase();

    const linked = await syncLinkedEmployees(8);
    const sync = await syncIncomingCalls(60);
    const processedCount = linked.reduce((sum, row) => sum + row.promptsSent + row.contactsWritten + row.trackersWritten, 0) + sync.processed;

    return NextResponse.json({
      success: true,
      processedCount,
      linked,
      sync,
    });
  } catch (error) {
    console.error("Failed to process intelligence:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
