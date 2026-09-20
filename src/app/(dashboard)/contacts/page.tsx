import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import connectToDatabase from "@/lib/db";
import Contact from "@/models/Contact";
import MergedContact from "@/models/MergedContact";
import { runContactMerge } from "@/lib/contactMerge";
import { Contact as ContactIcon, Users } from "lucide-react";
import { ContactsTableClient, type MergedContactRow } from "./ContactsTableClient";
import { AnimatedNumber } from "./AnimatedNumber";

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
      <div className="animate-in fade-in slide-in-from-bottom-1 flex items-center gap-3 duration-300">
        <span className="relative flex h-11 w-11 shrink-0 items-center justify-center">
          <span
            aria-hidden
            className="animate-breathe absolute inset-0 rounded-2xl bg-linear-to-br from-indigo-500 to-violet-600 blur-md"
          />
          <span className="relative flex h-11 w-11 items-center justify-center rounded-2xl bg-linear-to-br from-indigo-500 to-violet-600 text-white shadow-lg shadow-indigo-500/25">
            <ContactIcon className="h-5 w-5" />
          </span>
        </span>
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">Contact Bank</h1>
          <p className="flex items-center gap-1.5 text-sm text-slate-400">
            <Users className="h-3.5 w-3.5" />
            <AnimatedNumber value={rows.length} className="tabular-nums" /> unified contact
            {rows.length === 1 ? "" : "s"} synced from every employee device
          </p>
        </div>
      </div>

      {rawCount === 0 ? (
        <div className="animate-in fade-in zoom-in-95 rounded-2xl border border-dashed border-slate-800 bg-slate-900/60 px-4 py-14 text-center duration-300">
          <ContactIcon className="mx-auto h-8 w-8 text-slate-700" />
          <p className="mt-3 text-sm text-slate-400">
            No contacts found. Have employees turn ON call monitoring to sync contacts.
          </p>
        </div>
      ) : (
        <ContactsTableClient contacts={rows} rawCount={rawCount} />
      )}
    </div>
  );
}
