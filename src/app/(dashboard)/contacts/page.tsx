import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import connectToDatabase from "@/lib/db";
import Contact from "@/models/Contact";
import MergedContact from "@/models/MergedContact";
import { runContactMerge } from "@/lib/contactMerge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ContactsTableClient, type MergedContactRow } from "./ContactsTableClient";

type MergedContactLean = {
  _id: unknown;
  contactName: string;
  phoneNumbers?: string[];
  sources?: Array<{ employeeName?: string; deviceId?: string; phoneNumber?: string }>;
  sourceCount?: number;
  lastSyncedAt?: Date;
};

async function getContacts() {
  await connectToDatabase();

  const rawCount = await Contact.estimatedDocumentCount();
  let total = await MergedContact.countDocuments();

  // Contacts should appear merged by default: if the merge job has never run
  // for this data (fresh sync, no admin has clicked "Re-merge now" yet), run
  // it inline instead of showing an empty Contact Bank until someone notices
  // and clicks a button. Ongoing freshness after this is handled by
  // maybeTriggerAutoMerge on every device sync (see src/lib/contactMerge.ts).
  if (total === 0 && rawCount > 0) {
    await runContactMerge();
    total = await MergedContact.countDocuments();
  }

  const rows = await MergedContact.find()
    .sort({ contactName: 1 })
    .select("contactName phoneNumbers sources sourceCount lastSyncedAt")
    .lean<MergedContactLean[]>();

  const mapped: MergedContactRow[] = rows.map((r) => ({
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
  }));

  return { rows: mapped, rawCount };
}

export default async function ContactsPage() {
  const session = await getServerSession(authOptions);

  if (!session || session.user.role === "driver") {
    redirect("/login");
  }

  const { rows, rawCount } = await getContacts();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight text-white">Contact Bank</h1>
      </div>

      <Card className="bg-slate-900 border-slate-800">
        <CardHeader>
          <CardTitle className="text-lg text-slate-200">Synced Contacts</CardTitle>
        </CardHeader>
        <CardContent>
          {rawCount === 0 ? (
            <div className="rounded-md border border-slate-800 bg-slate-900 px-4 py-10 text-center text-slate-500 text-sm">
              No contacts found. Have employees turn ON call monitoring to sync contacts.
            </div>
          ) : (
            <ContactsTableClient contacts={rows} rawCount={rawCount} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
