import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/db";
import CallLog from "@/models/CallLog"; // eslint-disable-line  
import IdentifiedContact from "@/models/IdentifiedContact";
import UnknownNumberTracker from "@/models/UnknownNumberTracker";
import EmployeeTelegram from "@/models/EmployeeTelegram";
import IntelligenceCheckpoint from "@/models/IntelligenceCheckpoint";
import { phoneKeyOf } from "@/lib/contactNormalize";

/**
 * GET /api/contact-intelligence/log
 *
 * Aggregates ALL unique (employeeName, phoneNumber) pairs from CallLog
 * and computes the intelligence status for each:
 *   - Scenario A: contactName is known (from phone contacts)
 *   - Scenario B: unknown number, tracked by call count
 *
 * Returns a combined status for the Bot Activity Log dashboard.
 */
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role === "driver") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const employeeFilter = searchParams.get("employee");

  await connectToDatabase();

  // ── 1. Aggregate unique (employeeName, phoneNumber) from CallLog and DeviceCallLog ──
  // Load the checkpoint so we only show calls after the last "Start Fresh"
  const checkpoint = await IntelligenceCheckpoint.findOne({ key: "dashboard_cursor" }).lean() as any;
  const since: Date = checkpoint?.lastProcessedAt ?? new Date(0);

  const matchStage: any = { createdAt: { $gt: since } };
  if (employeeFilter && employeeFilter !== "ALL") {
    const escaped = employeeFilter.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    matchStage.employeeName = { $regex: `^${escaped}$`, $options: "i" };
  }

  const aggregated = await CallLog.aggregate([
    { $match: matchStage },
    { $unionWith: { coll: "devicecalllogs", pipeline: [{ $match: matchStage }] } },
    {
      $group: {
        _id: { employeeName: "$employeeName", phoneNumber: "$phoneNumber" },
        callCount: { $sum: 1 },
        // contactName from phone: use "Unknown" as sentinel for unknown contacts
        contactNames: { $addToSet: "$contactName" },
        callTypes: { $push: "$callType" },
        lastCall: { $max: "$timestamp" },
        firstCall: { $min: "$timestamp" },
        deviceId: { $first: "$deviceId" },
        totalDuration: { $sum: "$duration" },
        incomingCount: {
          $sum: { $cond: [{ $eq: ["$callType", "INCOMING"] }, 1, 0] },
        },
        outgoingCount: {
          $sum: { $cond: [{ $eq: ["$callType", "OUTGOING"] }, 1, 0] },
        },
        missedCount: {
          $sum: { $cond: [{ $eq: ["$callType", "MISSED"] }, 1, 0] },
        },
      },
    },
    { $sort: { lastCall: -1 } },
  ]);

  if (aggregated.length === 0) {
    return NextResponse.json({ logs: [], employees: [] });
  }

  const collapsed = collapseCallRows(aggregated);

  // ── 2. Fetch all related records in bulk ──────────────────────────────────
  const allPhones = collapsed.map((r) => r._id.phoneNumber);
  const allEmployees = [...new Set(collapsed.map((r) => r._id.employeeName))];
  const phoneKeys = [...new Set(collapsed.map((r) => phoneKeyOf(r._id.phoneNumber)).filter((key) => key.length >= 6))];
  const phoneMatch = {
    $or: [
      { phoneNumber: { $in: allPhones } },
      { phoneKey: { $in: phoneKeys } },
    ],
  };

  const [identifiedContacts, unknownTrackers, telegramEmployees] = await Promise.all([
    IdentifiedContact.find(phoneMatch).lean(),
    UnknownNumberTracker.find(phoneMatch).lean(),
    EmployeeTelegram.find().select("employeeName telegramChatId").lean(),
  ]);

  const pairKey = (phone: string, employee: string, phoneKey?: string) =>
    `${phoneKey || phoneKeyOf(phone) || String(phone || "").toLowerCase()}|${String(employee || "").toLowerCase()}`;

  // Build lookup maps. Keys ignore capitalisation so "DIPAK muliya" and "Dipak Muliya" are one person.
  const identifiedMap = new Map<string, any>();
  for (const ic of identifiedContacts) {
    identifiedMap.set(pairKey(ic.phoneNumber, ic.employeeName, ic.phoneKey), ic);
  }

  const trackerMap = new Map<string, any>();
  for (const t of unknownTrackers) {
    trackerMap.set(pairKey(t.phoneNumber, t.employeeName, t.phoneKey), t);
  }

  const telegramMap = new Map<string, boolean>();
  for (const te of telegramEmployees as any[]) {
    telegramMap.set(String(te.employeeName || "").toLowerCase(), !!te.telegramChatId);
  }

  // ── 3. Build the log entries ──────────────────────────────────────────────
  const logs = collapsed.map((agg) => {
    const phoneNumber: string = agg._id.phoneNumber;
    const employeeName: string = agg._id.employeeName;
    const key = pairKey(phoneNumber, employeeName);
    const hasTelegram = telegramMap.get(employeeName.toLowerCase()) ?? false;

    const knownName = agg.contactNames.find(
      (n: string) => n && n !== "Unknown" && n !== ""
    );
    const isInPhoneContacts = !!knownName;
    const identified = identifiedMap.get(key);
    const tracker = trackerMap.get(key);

    // ── Determine status ─────────────────────────────────────────────────
    let scenario: "A" | "B";
    let status: string;
    let actionNeeded: string;
    let messageSent: boolean = false;
    let contactName: string = knownName ?? identified?.contactName ?? "";
    let category: string = identified?.category ?? "";

    if (isInPhoneContacts) {
      // Scenario A — Known contact
      scenario = "A";
      if (identified?.category) {
        status = "done";
        actionNeeded = "None — fully classified ✅";
      } else if (identified && !identified.category) {
        const promptSent = !!identified.categoryRequestSentAt;
        status = promptSent ? "awaiting_category" : "needs_category";
        actionNeeded = promptSent
          ? "Awaiting category selection from employee"
          : hasTelegram
            ? "Telegram message should be sent asking for category"
            : "⚠️ No Telegram linked — cannot send";
        messageSent = promptSent;
      } else {
        status = "needs_category";
        actionNeeded = hasTelegram
          ? "Telegram message should be sent asking for category"
          : "⚠️ No Telegram linked — cannot send";
      }
    } else {
      // Scenario B — Unknown contact
      scenario = "B";
      if (identified?.category) {
        status = "done";
        actionNeeded = "None — fully identified and classified ✅";
      } else if (identified?.contactName && !identified?.category) {
        const promptSent = !!identified.categoryRequestSentAt;
        if (promptSent) {
          status = "awaiting_category";
          actionNeeded = "Name received — awaiting category selection";
          messageSent = true;
        } else {
          status = "needs_category";
          actionNeeded = hasTelegram
            ? "Name saved — category Telegram not sent yet (will retry)"
            : "⚠️ Name saved but no Telegram linked — cannot send category";
          messageSent = false;
        }
      } else if (tracker?.status === "awaiting_name") {
        status = "awaiting_name";
        const messageActuallySent = !!(tracker as any)?.telegramMessageId;
        actionNeeded = messageActuallySent
          ? "Telegram sent — waiting for employee to reply with name"
          : "Awaiting name — Telegram may not have been sent (will retry)";
        messageSent = messageActuallySent;
      } else if (agg.callCount >= 5) {
        status = "threshold_reached";
        actionNeeded = hasTelegram
          ? "5 calls reached — Telegram should trigger name request"
          : "⚠️ 5 calls reached but no Telegram linked for this employee";
      } else {
        status = "tracking";
        actionNeeded = `Tracking (${agg.callCount}/5 calls — ${5 - agg.callCount} more to trigger)`;
      }
    }

    return {
      employeeName,
      phoneNumber,
      contactName,
      category,
      scenario,
      status,
      actionNeeded,
      messageSent,
      callCount: agg.callCount,
      totalDuration: agg.totalDuration,
      incomingCount: agg.incomingCount,
      outgoingCount: agg.outgoingCount,
      missedCount: agg.missedCount,
      lastCall: agg.lastCall,
      firstCall: agg.firstCall,
      hasTelegram,
      trackerStatus: tracker?.status ?? null,
      identifiedAt: identified?.identifiedAt ?? null,
      savedInPhone: identified?.savedInPhone ?? false,
    };
  });

  return NextResponse.json({ logs, employees: allEmployees.sort() });
}

function collapseCallRows(rows: any[]) {
  const merged = new Map<string, any>();
  for (const agg of rows) {
    const phoneNumber = String(agg._id?.phoneNumber || "");
    const employeeName = String(agg._id?.employeeName || "");
    const key = `${phoneKeyOf(phoneNumber) || phoneNumber.toLowerCase()}|${employeeName.toLowerCase()}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, {
        ...agg,
        _id: { phoneNumber, employeeName },
        contactNames: [...(agg.contactNames || [])],
      });
      continue;
    }
    existing.callCount += agg.callCount || 0;
    existing.totalDuration = (existing.totalDuration || 0) + (agg.totalDuration || 0);
    existing.incomingCount = (existing.incomingCount || 0) + (agg.incomingCount || 0);
    existing.outgoingCount = (existing.outgoingCount || 0) + (agg.outgoingCount || 0);
    existing.missedCount = (existing.missedCount || 0) + (agg.missedCount || 0);
    existing.contactNames = [...new Set([...(existing.contactNames || []), ...(agg.contactNames || [])])];
    if (!existing.lastCall || (agg.lastCall && agg.lastCall > existing.lastCall)) existing.lastCall = agg.lastCall;
    if (!existing.firstCall || (agg.firstCall && agg.firstCall < existing.firstCall)) existing.firstCall = agg.firstCall;
    if (phoneKeyOf(phoneNumber).length >= 6 && phoneKeyOf(existing._id.phoneNumber).length < 6) {
      existing._id.phoneNumber = phoneNumber;
    }
  }
  return [...merged.values()];
}
