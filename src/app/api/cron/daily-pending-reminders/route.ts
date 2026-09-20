import { NextResponse } from "next/server";
import { runDailyPendingReminders } from "@/lib/contactIntelligence";
import { syncIncomingCallsUntilCaughtUp } from "@/lib/callSync";
import { syncLinkedEmployees } from "@/lib/employeeCallSync";

/**
 * GET/POST /api/cron/daily-pending-reminders
 *
 * Scenario A/B: send prompts that never went out, and resend only if the last
 * successful prompt is older than 2 days and still unresolved.
 * Save reminder: at most once per 24h cooldown, and only after Telegram accepts it.
 *
 * Called daily at 8 AM by Vercel Cron. Secure with CRON_SECRET.
 * Single daily run keeps within Vercel Hobby cron limits (1 run/day min interval).
 */
export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const urlSecret = new URL(req.url).searchParams.get("secret");
  const headerSecret = bearer ?? req.headers.get("x-cron-secret") ?? urlSecret;

  if (cronSecret && headerSecret !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const linked = await syncLinkedEmployees(12);
    const sync = await syncIncomingCallsUntilCaughtUp();
    const counts = await runDailyPendingReminders();
    return NextResponse.json({
      success: true,
      linked,
      sync,
      sent: counts,
      message: `Synced ${linked.length} linked device(s) and ${sync.processed} new calls. Sent ${counts.category} category requests, ${counts.nameRequest} name requests, ${counts.saveReminder} save reminders.`,
    });
  } catch (error) {
    console.error("[daily-pending-reminders]", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}

// Vercel Cron sends GET requests by default
export async function POST(req: Request) {
  return GET(req);
}
