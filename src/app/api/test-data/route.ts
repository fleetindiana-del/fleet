import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/db";
import DeviceCallLog from "@/models/DeviceCallLog";
import CallLog from "@/models/CallLog";
import IdentifiedContact from "@/models/IdentifiedContact";
import UnknownNumberTracker from "@/models/UnknownNumberTracker";
import EmployeeTelegram from "@/models/EmployeeTelegram";
import { runContactIntelligence } from "@/lib/contactIntelligence";
import { escapeRegex } from "@/lib/telegramFormat";
import { telegramPublicBaseUrl } from "@/lib/telegram";

/** Phones used only by the Telegram test run. Not real subscribers. */
export const TELEGRAM_TEST_KNOWN_PHONE = "0001110001";
export const TELEGRAM_TEST_UNKNOWN_PHONE = "0001110002";
const TELEGRAM_TEST_DEVICE = "telegram-test";
const TELEGRAM_TEST_KNOWN_NAME = "Telegram Test Client";

async function requireSuperAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "super_admin") return null;
  return session;
}

export async function GET() {
  try {
    const session = await requireSuperAdmin();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await connectToDatabase();

    const employeeNames = await DeviceCallLog.distinct("employeeName");
    const processedEmployeeNames = await CallLog.distinct("employeeName");
    const telegramRows = await EmployeeTelegram.find().select("employeeName telegramChatId").lean() as any[];

    const allNames = Array.from(
      new Set([
        ...employeeNames,
        ...processedEmployeeNames,
        ...telegramRows.map((row) => row.employeeName),
      ])
    ).filter(Boolean) as string[];
    allNames.sort();

    const linkedEmployees = telegramRows
      .filter((row) => row.telegramChatId)
      .map((row) => row.employeeName as string);

    return NextResponse.json({ employees: allNames, linkedEmployees });
  } catch (error) {
    console.error("Failed to fetch employees:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const session = await requireSuperAdmin();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { employeeName } = await req.json();
    if (!employeeName) {
      return NextResponse.json({ error: "Employee name is required" }, { status: 400 });
    }

    await connectToDatabase();

    const [deviceResult, processedResult, identifiedResult, trackerResult] = await Promise.all([
      DeviceCallLog.deleteMany({ employeeName }),
      CallLog.deleteMany({ employeeName }),
      IdentifiedContact.deleteMany({ employeeName }),
      UnknownNumberTracker.deleteMany({ employeeName }),
    ]);

    return NextResponse.json({
      success: true,
      message:
        `Deleted ${deviceResult.deletedCount} raw device logs, ${processedResult.deletedCount} processed call logs, ` +
        `${identifiedResult.deletedCount} identified contacts, and ${trackerResult.deletedCount} unknown-number trackers for ${employeeName}. ` +
        `Telegram can send fresh prompts for this employee.`,
    });
  } catch (error) {
    console.error("Failed to delete employee data:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

/**
 * POST /api/test-data
 * Body: { employeeName }
 *
 * Resets two reserved test numbers and runs both Telegram scenarios against the
 * employee's linked chat. The messages show up in Telegram immediately.
 */
export async function POST(req: Request) {
  try {
    const session = await requireSuperAdmin();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { employeeName } = await req.json();
    if (!employeeName || typeof employeeName !== "string") {
      return NextResponse.json({ error: "Employee name is required" }, { status: 400 });
    }

    await connectToDatabase();

    const employee = await EmployeeTelegram.findOne({
      employeeName: new RegExp(`^${escapeRegex(employeeName.trim())}$`, "i"),
    });
    if (!employee?.telegramChatId) {
      return NextResponse.json(
        {
          error:
            "This employee has no linked Telegram. Open the bot, send /start, then send the phone number saved in Telegram Setup.",
        },
        { status: 422 }
      );
    }

    const name = employee.employeeName;
    const phones = [TELEGRAM_TEST_KNOWN_PHONE, TELEGRAM_TEST_UNKNOWN_PHONE];
    await Promise.all([
      DeviceCallLog.deleteMany({ employeeName: name, phoneNumber: { $in: phones } }),
      IdentifiedContact.deleteMany({ employeeName: name, phoneNumber: { $in: phones } }),
      UnknownNumberTracker.deleteMany({ employeeName: name, phoneNumber: { $in: phones } }),
    ]);

    const now = Date.now();
    await DeviceCallLog.create({
      phoneNumber: TELEGRAM_TEST_KNOWN_PHONE,
      contactName: TELEGRAM_TEST_KNOWN_NAME,
      callType: "INCOMING",
      duration: 30,
      timestamp: new Date(now),
      deviceId: TELEGRAM_TEST_DEVICE,
      employeeName: name,
      syncedAt: new Date(),
    });
    const scenarioA = await runContactIntelligence(
      TELEGRAM_TEST_KNOWN_PHONE,
      TELEGRAM_TEST_KNOWN_NAME,
      name,
      TELEGRAM_TEST_DEVICE
    );

    let scenarioB = { ok: false, step: "NOT_RUN", message: "Scenario B did not run" };
    for (let i = 0; i < 5; i++) {
      await DeviceCallLog.create({
        phoneNumber: TELEGRAM_TEST_UNKNOWN_PHONE,
        contactName: "Unknown",
        callType: "INCOMING",
        duration: i + 1,
        timestamp: new Date(now + (i + 1) * 1000),
        deviceId: TELEGRAM_TEST_DEVICE,
        employeeName: name,
        syncedAt: new Date(),
      });
      scenarioB = await runContactIntelligence(
        TELEGRAM_TEST_UNKNOWN_PHONE,
        undefined,
        name,
        TELEGRAM_TEST_DEVICE
      );
    }

    const ok = scenarioA.ok && scenarioB.step === "NAME_REQUEST_SENT";
    const formHost = telegramPublicBaseUrl();
    return NextResponse.json({
      success: ok,
      scenarioA,
      scenarioB,
      phones: {
        known: TELEGRAM_TEST_KNOWN_PHONE,
        unknown: TELEGRAM_TEST_UNKNOWN_PHONE,
      },
      message: ok
        ? `Sent both prompts to ${name}'s Telegram. Scenario A is ${TELEGRAM_TEST_KNOWN_PHONE} (${TELEGRAM_TEST_KNOWN_NAME}). Scenario B is ${TELEGRAM_TEST_UNKNOWN_PHONE} — tap Enter name or reply to that message. The name form opens ${formHost}.`
        : `Telegram did not accept both prompts. Scenario A: ${scenarioA.message}. Scenario B: ${scenarioB.message}.`,
    }, { status: ok ? 200 : 502 });
  } catch (error) {
    console.error("Failed to run Telegram test data:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
