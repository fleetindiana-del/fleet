import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/db";
import Contact from "@/models/Contact";
import MergedContact from "@/models/MergedContact";
import { normalizeContactName, normalizePhoneDigits, phoneKeyOf } from "@/lib/contactNormalize";
import { maybeTriggerAutoMerge } from "@/lib/contactMerge";

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

type RawContactInput = {
  deviceId?: string;
  phoneNumber?: string;
  employeeName?: string;
  contactName?: string;
  timestamp?: string | number;
};

export async function POST(req: Request) {
  try {
    const apiKey = req.headers.get("x-api-key");
    const expectedKey = process.env.API_KEY;
    if (expectedKey && apiKey !== expectedKey) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { contacts } = body;

    if (!Array.isArray(contacts)) {
      return NextResponse.json(
        { error: "Expected an array of contacts" },
        { status: 400 }
      );
    }

    await connectToDatabase();

    // Use bulkWrite for efficient upserts. nameKey/phoneKey are stamped here
    // (not via a schema hook, which bulkWrite bypasses) so the merge job can
    // cluster contacts via indexed lookups instead of scanning+normalizing
    // the whole collection on every run.
    const bulkOps = (contacts as RawContactInput[]).map((contact) => {
      const contactName = contact.contactName || "Unknown";
      return {
        updateOne: {
          filter: {
            deviceId: contact.deviceId,
            phoneNumber: contact.phoneNumber,
          },
          update: {
            $set: {
              employeeName: contact.employeeName || "Unknown",
              contactName,
              nameKey: normalizeContactName(contactName),
              phoneKey: phoneKeyOf(contact.phoneNumber),
              timestamp: contact.timestamp ? new Date(Number(contact.timestamp)) : new Date(),
              syncedAt: new Date(),
            },
          },
          upsert: true,
        },
      };
    });

    if (bulkOps.length > 0) {
      await Contact.bulkWrite(bulkOps);
    }

    console.log(`🔌 Synced ${contacts.length} contacts`);

    // Fire-and-forget: keeps the Contact Bank's consolidated view fresh
    // without making every device's sync wait on a full merge pass.
    maybeTriggerAutoMerge();

    return NextResponse.json({ success: true, count: contacts.length }, { status: 201 });
  } catch (error) {
    console.error("Failed to sync contacts:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

type MergedContactLean = {
  _id: unknown;
  contactName: string;
  phoneNumbers?: string[];
  sources?: Array<{ employeeName?: string; deviceId?: string; phoneNumber?: string }>;
  sourceCount?: number;
  lastSyncedAt?: Date;
};

/**
 * GET — the Contact Bank dashboard page. Reads the pre-merged, indexed
 * MergedContact collection (rebuilt by src/lib/contactMerge.ts) instead of
 * scanning and merging the raw per-device Contact collection on every
 * request, and returns one page at a time so the response stays small and
 * fast no matter how large the contact list grows.
 */
export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || session.user.role === "driver") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
    const limit = Math.min(Math.max(parseInt(searchParams.get("limit") ?? "50", 10) || 50, 1), 100);
    const q = (searchParams.get("q") ?? "").trim();

    await connectToDatabase();

    const filter: Record<string, unknown> = {};
    if (q) {
      const nameQ = normalizeContactName(q);
      const digitsQ = normalizePhoneDigits(q);
      const or: Record<string, unknown>[] = [];
      if (nameQ) {
        or.push({ nameKey: new RegExp(escapeRegex(nameQ)) });
        or.push({ contactName: new RegExp(escapeRegex(q), "i") });
        or.push({ "sources.employeeName": new RegExp(escapeRegex(q), "i") });
      }
      if (digitsQ) {
        or.push({ phoneKeys: new RegExp(escapeRegex(digitsQ)) });
      }
      if (or.length > 0) filter.$or = or;
    }

    const [rows, total] = await Promise.all([
      MergedContact.find(filter)
        .sort({ lastSyncedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .select("contactName phoneNumbers sources sourceCount lastSyncedAt")
        .lean<MergedContactLean[]>(),
      MergedContact.countDocuments(filter),
    ]);

    return NextResponse.json({
      rows: rows.map((r) => ({
        id: String(r._id),
        contactName: r.contactName,
        phoneNumbers: r.phoneNumbers ?? [],
        sources: (r.sources ?? []).map((s) => ({
          employeeName: s.employeeName || "Unknown",
          deviceId: s.deviceId || "",
          phoneNumber: s.phoneNumber || "",
        })),
        sourceCount: r.sourceCount ?? r.sources?.length ?? 0,
        lastSyncedAt: r.lastSyncedAt ? new Date(r.lastSyncedAt).toISOString() : null,
      })),
      total,
      page,
      limit,
    });
  } catch (error) {
    console.error("Failed to fetch contacts:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
