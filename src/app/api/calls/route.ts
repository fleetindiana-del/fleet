import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import DeviceCallLog from "@/models/DeviceCallLog";
import BotLog from "@/models/BotLog";
import { runContactIntelligence, retryUnsentPrompts } from "@/lib/contactIntelligence";
import mongoose from "mongoose";

function normalizeCallType(raw: unknown): string {
  const u = String(raw ?? "").toUpperCase().trim();
  if (["INCOMING", "OUTGOING", "MISSED", "UNKNOWN"].includes(u)) return u;
  return "UNKNOWN";
}

function normalizeTimestamp(raw: unknown): Date {
  if (raw === null || raw === undefined || raw === "") return new Date();
  const n = Number(raw);
  if (Number.isFinite(n)) {
    // Android clients sometimes send unix seconds instead of milliseconds.
    const ms = n < 1e12 ? n * 1000 : n;
    const d = new Date(ms);
    if (!isNaN(d.getTime())) return d;
  }
  const d = new Date(String(raw));
  return isNaN(d.getTime()) ? new Date() : d;
}

// POST — called by the Android app (authenticated via X-API-Key)
export async function POST(req: Request) {
  try {
    const apiKey = req.headers.get("x-api-key");
    const expectedKey = process.env.API_KEY;
    if (expectedKey && apiKey !== expectedKey) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { phoneNumber, contactName, callType, duration, timestamp, deviceId, employeeName } = body;

    const missingFields: string[] = [];
    if (!phoneNumber) missingFields.push("phoneNumber");
    if (!callType) missingFields.push("callType");
    if (!deviceId) missingFields.push("deviceId");

    if (missingFields.length > 0) {
      return NextResponse.json(
        { error: `Missing or empty required fields: ${missingFields.join(", ")}` },
        { status: 400 }
      );
    }

    await connectToDatabase();

    const callLog = await DeviceCallLog.create({
      phoneNumber,
      contactName: contactName || "Unknown",
      callType: normalizeCallType(callType),
      duration: duration || 0,
      timestamp: normalizeTimestamp(timestamp),
      deviceId,
      employeeName: employeeName || "Unknown",
      syncedAt: new Date(),
    });

    console.log(`📞 ${callType} | ${employeeName} | ${phoneNumber} | ${duration}s`);

    // Log call receipt to BotLog for visibility on Vercel
    const resolvedEmployee = employeeName || "Unknown";
    const resolvedContact = contactName && contactName !== "Unknown" ? contactName : undefined;
    BotLog.create({
      level: 'info',
      step: 'CALL_RECEIVED',
      message: `📞 Call received from Android app — ${callType} | ${resolvedEmployee} | ${phoneNumber} | contact: "${resolvedContact ?? 'Unknown'}" | ${duration}s`,
      data: { callType, employeeName: resolvedEmployee, phoneNumber, contactName: resolvedContact ?? null, duration, deviceId },
      employeeName: resolvedEmployee,
      phoneNumber,
    }).catch(() => {});

    // To avoid Vercel freezing the serverless function before the Telegram message sends,
    // we MUST await the contact intelligence process completely.
    try {
      await runContactIntelligence(phoneNumber, resolvedContact, resolvedEmployee, deviceId || "");
      await retryUnsentPrompts(resolvedEmployee);
    } catch (err: any) {
      console.error("[Intelligence] Uncaught error:", err);
      await BotLog.create({
        level: 'error',
        step: 'INTELLIGENCE_UNCAUGHT',
        message: `Uncaught error in intelligence engine: ${err?.message ?? err}`,
        data: { stack: err?.stack },
        employeeName: resolvedEmployee,
        phoneNumber,
      }).catch(() => {});
    }

    return NextResponse.json({ success: true, id: callLog._id }, { status: 201 });
  } catch (error: any) {
    console.error("Failed to save call log:", error);
    // Ignore duplicate key errors gracefully
    if (error.code === 11000) {
      return NextResponse.json({ success: true, message: "Duplicate, skipped" }, { status: 200 });
    }
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
