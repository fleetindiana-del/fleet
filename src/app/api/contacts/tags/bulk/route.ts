import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/db";
import Contact from "@/models/Contact";
import mongoose from "mongoose";
import { normalizePhoneNumber } from "@/lib/phone";
import { phoneKeyOf } from "@/lib/contactNormalize";

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.companyId && session?.user?.role !== "super_admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { phoneNumbers } = body as { phoneNumbers: string[] };

    if (!Array.isArray(phoneNumbers) || phoneNumbers.length === 0) {
      return NextResponse.json({ tags: {} });
    }

    await connectToDatabase();

    // Map each normalized number to its original number or just store tags by the normalized number
    // It's best if we return tags mapped by the original number requested, so the frontend can easily look it up.
    
    // Step 1: Normalize all inputs
    const normalizedToOriginal = new Map<string, string[]>();
    const phoneKeys: string[] = [];

    for (const rawPhone of phoneNumbers) {
      const normalized = normalizePhoneNumber(rawPhone);

      // Store mapping from normalized to original so we can map tags back to the exact strings the frontend sent
      if (!normalizedToOriginal.has(normalized)) {
         normalizedToOriginal.set(normalized, []);
      }
      normalizedToOriginal.get(normalized)!.push(rawPhone);

      // We extract the last 10 digits as a robust matching string for the DB query
      // because DB strings might be raw like '7884551235' or '+917884551235'.
      // Contact.phoneKey stores exactly this, indexed, so this is a plain
      // equality lookup rather than a per-number regex scan.
      const last10 = phoneKeyOf(normalized);

      if (last10 && last10.length >= 7) { // Only add sensible lengths
        phoneKeys.push(last10);
      }
    }

    if (phoneKeys.length === 0) {
       return NextResponse.json({ tags: {} });
    }

    // Step 2: Fetch matches from DB for the user's company (unless super_admin testing)
    const baseQuery: any = {
      phoneKey: { $in: phoneKeys }
    };

    // Contacts don't currently have a companyId field on the schema, but they are tied to deviceId or employeeName.
    // If you add tenant isolation for Contacts in the future, you'd add companyId logic here.
    // Right now, the schema `Contact` does not have `companyId`.

    const contacts = await Contact.find(baseQuery).select("phoneNumber contactName employeeName timestamp deviceId").lean();

    // Step 3: Map DB results back to normalized numbers, then back to original requested numbers.
    // Structure: map normalizedPhone -> map contactName -> array of details
    const normalizedTags = new Map<string, Map<string, Array<{ employeeName: string, timestamp?: string, deviceId?: string }>>>();

    for (const c of contacts as any[]) {
       const dbNorm = normalizePhoneNumber(c.phoneNumber);
       // We only care about names that aren't "Unknown" or empty
       const name = c.contactName?.trim();
       if (!name || name === "Unknown") continue;

       if (!normalizedTags.has(dbNorm)) {
          normalizedTags.set(dbNorm, new Map());
       }
       
       const phoneMap = normalizedTags.get(dbNorm)!;
       if (!phoneMap.has(name)) {
         phoneMap.set(name, []);
       }
       
       phoneMap.get(name)!.push({
         employeeName: c.employeeName || "Unknown",
         timestamp: c.timestamp ? new Date(c.timestamp).toISOString() : undefined,
         deviceId: c.deviceId
       });
    }

    // Prepare response object mapping OriginalRequestedNumber -> Array of Tags Objects
    const result: Record<string, any[]> = {};
    
    // Pre-populate empty arrays
    for (const rawPhone of phoneNumbers) {
      result[rawPhone] = [];
    }

    for (const [normalized, originalVariants] of normalizedToOriginal.entries()) {
       const tagsForThisNumber = normalizedTags.get(normalized);
       
       const arr = tagsForThisNumber ? Array.from(tagsForThisNumber.entries()).map(([name, savedBy]) => ({
         name,
         savedBy
       })).sort((a, b) => a.name.localeCompare(b.name)) : [];

       for (const original of originalVariants) {
          result[original] = arr;
       }
    }

    return NextResponse.json({ tags: result });
  } catch (error) {
    console.error("Failed to fetch contact tags in bulk:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
