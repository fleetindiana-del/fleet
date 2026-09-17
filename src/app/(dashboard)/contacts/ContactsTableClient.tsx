"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { Loader2, Phone, RefreshCw, User as UserIcon, UserSearch } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { normalizeContactName, normalizePhoneDigits } from "@/lib/contactNormalize";

export type MergedContactRow = {
  id: string;
  contactName: string;
  phoneNumbers: string[];
  sources: Array<{ employeeName: string; deviceId: string; phoneNumber: string }>;
  sourceCount: number;
  lastSyncedAt: string | null;
};

export function ContactsTableClient({
  contacts,
  rawCount,
}: {
  contacts: MergedContactRow[];
  rawCount: number;
}) {
  const router = useRouter();
  const [nameQuery, setNameQuery] = useState("");
  const [phoneQuery, setPhoneQuery] = useState("");
  const [selectedUser, setSelectedUser] = useState("ALL");
  const [isMerging, setIsMerging] = useState(false);
  const [mergeMessage, setMergeMessage] = useState("");

  // Every employee/device that has ever saved a contact — used only by the
  // User Filter below, never by the name/phone search.
  const userNames = useMemo(() => {
    const set = new Set<string>();
    for (const c of contacts) {
      for (const s of c.sources) {
        if (s.employeeName) set.add(s.employeeName);
      }
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [contacts]);

  // Search = contact information only (name, phone). User Filter = who
  // enrolled/saved the contact. Kept as two independent, AND-ed conditions
  // so neither can leak into the other.
  const filtered = useMemo(() => {
    const nameNorm = normalizeContactName(nameQuery);
    const phoneNorm = normalizePhoneDigits(phoneQuery);

    return contacts.filter((c) => {
      if (selectedUser !== "ALL" && !c.sources.some((s) => s.employeeName === selectedUser)) {
        return false;
      }
      if (nameNorm && !normalizeContactName(c.contactName).includes(nameNorm)) {
        return false;
      }
      if (phoneNorm && !c.phoneNumbers.some((p) => normalizePhoneDigits(p).includes(phoneNorm))) {
        return false;
      }
      return true;
    });
  }, [contacts, nameQuery, phoneQuery, selectedUser]);

  const runMerge = async () => {
    setIsMerging(true);
    setMergeMessage("");
    try {
      const res = await fetch("/api/contacts/merge", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Merge failed");
      setMergeMessage(`Merged ${data.rawContacts} synced entries into ${data.clusters} contacts.`);
      router.refresh();
    } catch (err) {
      setMergeMessage(err instanceof Error ? err.message : "Merge failed");
    } finally {
      setIsMerging(false);
    }
  };

  return (
    <div className="space-y-3">
      {/* Search — contact information only (name, phone number) */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
        <div className="flex items-center gap-2 mb-2">
          <UserSearch className="h-4 w-4 text-slate-400" />
          <span className="text-xs font-medium text-slate-400">Search</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="relative">
            <UserIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <Input
              value={nameQuery}
              onChange={(e) => setNameQuery(e.target.value)}
              placeholder="Search by name…"
              className="pl-9 bg-slate-950/40 border-slate-800 text-slate-200 placeholder:text-slate-500"
            />
          </div>
          <div className="relative">
            <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <Input
              value={phoneQuery}
              onChange={(e) => setPhoneQuery(e.target.value)}
              placeholder="Search by phone number…"
              className="pl-9 bg-slate-950/40 border-slate-800 text-slate-200 placeholder:text-slate-500"
            />
          </div>
        </div>
      </div>

      {/* User Filter — who enrolled/saved the contact, kept separate from search */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
        <div className="flex items-center gap-2 mb-2">
          <UserIcon className="h-4 w-4 text-slate-400" />
          <span className="text-xs font-medium text-slate-400">Filter by User</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setSelectedUser("ALL")}
            className={cn(
              "px-3 py-1.5 rounded-full text-xs font-semibold transition-all duration-200",
              selectedUser === "ALL"
                ? "bg-indigo-600 text-white shadow-lg shadow-indigo-500/25 scale-105"
                : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200"
            )}
          >
            All Users
          </button>
          {userNames.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => setSelectedUser(name)}
              className={cn(
                "px-3 py-1.5 rounded-full text-xs font-semibold transition-all duration-200 flex items-center gap-1.5",
                selectedUser === name
                  ? "bg-indigo-600 text-white shadow-lg shadow-indigo-500/25 scale-105"
                  : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200"
              )}
            >
              <span
                className={cn(
                  "w-1.5 h-1.5 rounded-full",
                  selectedUser === name ? "bg-white" : "bg-slate-600"
                )}
              />
              {name}
            </button>
          ))}
        </div>
      </div>

      {/* Results */}
      <div className="rounded-md border border-slate-800 bg-slate-900 overflow-hidden">
        <div className="max-h-[65vh] overflow-y-auto">
          <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-slate-800 bg-slate-900/95 backdrop-blur supports-backdrop-filter:bg-slate-900/75 px-3 py-2.5">
            <div className="text-xs text-slate-500 whitespace-nowrap">
              Showing <span className="text-slate-300 font-medium">{filtered.length}</span> of{" "}
              <span className="text-slate-300 font-medium">{contacts.length}</span>{" "}
              {contacts.length !== rawCount ? (
                <span className="text-slate-600">({rawCount} synced entries merged)</span>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              {mergeMessage ? <p className="text-xs text-slate-400">{mergeMessage}</p> : null}
              <Button
                variant="outline"
                size="sm"
                className="border-slate-700 text-slate-300 bg-transparent hover:bg-slate-800"
                onClick={runMerge}
                disabled={isMerging}
                title="Force an immediate re-merge (new contacts are merged automatically)"
              >
                {isMerging ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5" />
                )}
              </Button>
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow className="border-slate-800 hover:bg-slate-800/50">
                <TableHead className="text-slate-400">Employee / Device</TableHead>
                <TableHead className="text-slate-400">Contact Name</TableHead>
                <TableHead className="text-slate-400">Phone Number</TableHead>
                <TableHead className="text-slate-400">Last Synced</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow className="border-slate-800 hover:bg-slate-800/50">
                  <TableCell colSpan={4} className="h-24 text-center text-slate-500">
                    No matching contacts.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((contact) => (
                  <TableRow key={contact.id} className="border-slate-800 hover:bg-slate-800/50">
                    <TableCell className="font-medium text-slate-300 align-top">
                      <div className="space-y-1.5">
                        {contact.sources.map((s, i) => (
                          <div key={`${s.deviceId}-${i}`}>
                            {s.employeeName || "—"}
                            <br />
                            <span className="text-xs text-slate-500 font-mono">{s.deviceId}</span>
                          </div>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-slate-300 align-top">
                      {contact.contactName || "—"}
                      {contact.sourceCount > 1 ? (
                        <span className="ml-2 rounded bg-slate-800 px-1.5 py-0.5 text-xs text-slate-400">
                          {contact.sourceCount} devices
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-slate-300 font-mono align-top">
                      <div className="space-y-1">
                        {contact.phoneNumbers.length === 0
                          ? "—"
                          : contact.phoneNumbers.map((p) => <div key={p}>{p}</div>)}
                      </div>
                    </TableCell>
                    <TableCell className="text-slate-400 text-sm align-top">
                      {contact.lastSyncedAt
                        ? format(new Date(contact.lastSyncedAt), "MMM d, yyyy HH:mm")
                        : "-"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
