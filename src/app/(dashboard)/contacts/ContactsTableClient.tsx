"use client";

import { memo, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { format, formatDistanceToNow } from "date-fns";
import {
  Check,
  ChevronDown,
  Copy,
  Loader2,
  Phone,
  RefreshCw,
  Sparkles,
  User as UserIcon,
  UserSearch,
} from "lucide-react";

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
import { ContactInsights } from "./ContactInsights";

// Rows rendered at a time in the results table. The list can run into the
// thousands (one Contact Bank had 12k+ merged contacts) — mounting all of
// them as DOM rows at once is what made the page lag, so only this many are
// ever in the DOM; scrolling near the bottom grows the window by another
// chunk (see the IntersectionObserver sentinel below).
const ROW_CHUNK = 60;

export type MergedContactRow = {
  id: string;
  contactName: string;
  phoneNumbers: string[];
  sources: Array<{ employeeName: string; deviceId: string; phoneNumber: string }>;
  sourceCount: number;
  lastSyncedAt: string | null;
};

const AVATAR_PALETTE = [
  "#6366f1", // indigo
  "#059669", // emerald
  "#d97706", // amber
  "#e11d48", // rose
  "#0891b2", // cyan
  "#7c3aed", // violet
];

/** Deterministic accent per contact name, so the same person always gets the
 * same avatar color across renders/filters instead of a random flicker. */
function nameColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Wraps the first case-insensitive match of `query` inside `text` in a glow
 * mark — the table's visible proof that a search hit is *why* a row is there. */
function highlightText(text: string, query: string): ReactNode {
  const q = query.trim();
  if (!q) return text;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="animate-in zoom-in-95 rounded bg-amber-400/25 px-0.5 text-amber-200 duration-200">
        {text.slice(idx, idx + q.length)}
      </mark>
      {text.slice(idx + q.length)}
    </>
  );
}

/** Same idea for phone numbers, but matched on digits only (the search box
 * ignores formatting) while still highlighting the original punctuated text. */
function highlightPhone(phone: string, phoneQuery: string): ReactNode {
  const q = normalizePhoneDigits(phoneQuery);
  if (!q) return phone;
  const digitPositions: number[] = [];
  for (let i = 0; i < phone.length; i++) if (/\d/.test(phone[i])) digitPositions.push(i);
  const normalized = digitPositions.map((i) => phone[i]).join("");
  const start = normalized.indexOf(q);
  if (start === -1) return phone;
  const from = digitPositions[start];
  const to = digitPositions[start + q.length - 1] + 1;
  return (
    <>
      {phone.slice(0, from)}
      <mark className="animate-in zoom-in-95 rounded bg-amber-400/25 px-0.5 text-amber-200 duration-200">
        {phone.slice(from, to)}
      </mark>
      {phone.slice(to)}
    </>
  );
}

/** Small filled-dot cluster standing in for the raw "N devices" count — a
 * glance-able confidence read instead of another number to parse. */
function DeviceDots({ count, color }: { count: number; color: string }) {
  if (count <= 1) return null;
  const shown = Math.min(count, 4);
  return (
    <span className="inline-flex items-center gap-0.5 align-middle">
      {Array.from({ length: shown }).map((_, i) => (
        <span
          key={i}
          style={{ background: color, animationDelay: `${i * 60}ms` }}
          className="animate-in zoom-in-50 h-1.5 w-1.5 rounded-full fill-mode-both duration-300"
        />
      ))}
      {count > shown && <span className="ml-0.5 text-[10px] text-slate-500">+{count - shown}</span>}
    </span>
  );
}

function CopyPhoneButton({ phone, phoneQuery }: { phone: string; phoneQuery: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(phone);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1400);
        } catch {
          /* clipboard unavailable — silently ignore */
        }
      }}
      title="Copy phone number"
      className="group/copy -mx-1 inline-flex items-center gap-1.5 rounded px-1 py-0.5 transition-colors duration-150 hover:bg-slate-800"
    >
      <span>{highlightPhone(phone, phoneQuery)}</span>
      {copied ? (
        <span className="animate-in zoom-in-50 flex items-center gap-0.5 text-[10px] font-semibold text-emerald-400 duration-200">
          <Check className="h-3 w-3" />
          copied
        </span>
      ) : (
        <Copy className="h-3 w-3 shrink-0 text-slate-600 opacity-0 transition-opacity duration-150 group-hover/copy:opacity-100" />
      )}
    </button>
  );
}

/** "2h ago" beats a raw timestamp for scanning a long list; the full date
 * still lives in the title tooltip and a live dot marks anything from the
 * last hour so genuinely fresh syncs stand out at a glance. */
function LastSynced({ iso, now }: { iso: string | null; now: number }) {
  if (!iso) return <span className="text-slate-600">-</span>;
  const date = new Date(iso);
  const isFresh = now - date.getTime() < 60 * 60 * 1000;
  return (
    <span className="inline-flex items-center gap-1.5" title={format(date, "MMM d, yyyy HH:mm")}>
      {isFresh && (
        <span className="relative flex h-1.5 w-1.5 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
        </span>
      )}
      <span className={isFresh ? "font-medium text-emerald-400" : undefined}>
        {formatDistanceToNow(date, { addSuffix: true })}
      </span>
    </span>
  );
}

/**
 * Memoized so an unrelated state change elsewhere (merge banner, insights
 * toggle, filter chip hover) doesn't force React to re-diff every visible
 * row — it only re-renders a row when that row's own data, or the active
 * search text, changes.
 */
const ContactRow = memo(function ContactRow({
  contact,
  nameQuery,
  phoneQuery,
  now,
}: {
  contact: MergedContactRow;
  nameQuery: string;
  phoneQuery: string;
  now: number;
}) {
  const color = nameColor(contact.contactName || contact.id);
  return (
    <TableRow className="group animate-in fade-in slide-in-from-left-1 border-slate-800 duration-300 fill-mode-both hover:bg-slate-800/50">
      <TableCell
        className="border-l-2 font-medium text-slate-300 align-top transition-[border-color] duration-200 group-hover:border-l-4"
        style={{ borderLeftColor: `${color}55` }}
      >
        <div className="space-y-1.5">
          {contact.sources.map((s, si) => (
            <div key={`${s.deviceId}-${si}`}>
              {s.employeeName || "—"}
              <br />
              <span className="text-xs text-slate-500 font-mono">{s.deviceId}</span>
            </div>
          ))}
        </div>
      </TableCell>
      <TableCell className="text-slate-300 align-top">
        <div className="flex items-center gap-2">
          <span
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ring-2 ring-white/10 transition-transform duration-200 group-hover:scale-110"
            style={{ background: color }}
          >
            {initialsOf(contact.contactName || "?")}
          </span>
          <span>
            {highlightText(contact.contactName || "—", nameQuery)}
            {contact.sourceCount > 1 ? (
              <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-indigo-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-300">
                {contact.sourceCount} devices
                <DeviceDots count={contact.sourceCount} color={color} />
              </span>
            ) : null}
          </span>
        </div>
      </TableCell>
      <TableCell className="text-slate-300 font-mono align-top">
        <div className="space-y-1">
          {contact.phoneNumbers.length === 0 ? (
            <span className="text-slate-600">—</span>
          ) : (
            contact.phoneNumbers.map((p) => (
              <CopyPhoneButton key={p} phone={p} phoneQuery={phoneQuery} />
            ))
          )}
        </div>
      </TableCell>
      <TableCell className="text-slate-400 text-sm align-top">
        <LastSynced iso={contact.lastSyncedAt} now={now} />
      </TableCell>
    </TableRow>
  );
});

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
  const [showInsights, setShowInsights] = useState(false);
  // Captured once rather than read fresh per row — enough to mark "synced in
  // the last hour" without every row computing its own impure Date.now().
  const [now] = useState(() => Date.now());

  // Typing re-filters the whole (potentially thousands-long) contact list on
  // every keystroke. Deferring the value lets React keep the input itself
  // snappy and only run that filter once typing settles, instead of blocking
  // each keystroke on the previous filter pass.
  const deferredNameQuery = useDeferredValue(nameQuery);
  const deferredPhoneQuery = useDeferredValue(phoneQuery);

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
    const nameNorm = normalizeContactName(deferredNameQuery);
    const phoneNorm = normalizePhoneDigits(deferredPhoneQuery);

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
  }, [contacts, deferredNameQuery, deferredPhoneQuery, selectedUser]);

  // Only this many rows are mounted at a time — see ROW_CHUNK. Growing the
  // window (instead of re-rendering everything) is what keeps scrolling and
  // filtering smooth on a large Contact Bank.
  const [visibleCount, setVisibleCount] = useState(ROW_CHUNK);
  useEffect(() => {
    setVisibleCount(ROW_CHUNK);
  }, [filtered]);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLTableRowElement | null>(null);
  useEffect(() => {
    const sentinel = sentinelRef.current;
    const root = scrollRef.current;
    if (!sentinel || !root || visibleCount >= filtered.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount((v) => Math.min(filtered.length, v + ROW_CHUNK));
        }
      },
      { root, rootMargin: "300px" }
    );
    io.observe(sentinel);
    return () => io.disconnect();
  }, [visibleCount, filtered.length]);

  const visibleRows = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount]);

  // A one-shot confetti burst around the merge button when it actually finds
  // and folds duplicates — a small, bounded, self-clearing celebration tied
  // to a real outcome rather than decoration that fires every click.
  const [burst, setBurst] = useState<
    { id: number; tx: number; ty: number; r: number; color: string; delay: number }[] | null
  >(null);

  const runMerge = async () => {
    setIsMerging(true);
    setMergeMessage("");
    try {
      const res = await fetch("/api/contacts/merge", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Merge failed");
      setMergeMessage(`Merged ${data.rawContacts} synced entries into ${data.clusters} contacts.`);
      if (data.rawContacts > data.clusters) {
        setBurst(
          Array.from({ length: 14 }, (_, i) => {
            const angle = (i / 14) * Math.PI * 2 + Math.random() * 0.4;
            const distance = 28 + Math.random() * 30;
            return {
              id: i,
              tx: Math.cos(angle) * distance,
              ty: Math.sin(angle) * distance,
              r: Math.round(Math.random() * 360),
              color: AVATAR_PALETTE[i % AVATAR_PALETTE.length],
              delay: Math.round(Math.random() * 80),
            };
          })
        );
        window.setTimeout(() => setBurst(null), 850);
      }
      router.refresh();
    } catch (err) {
      setMergeMessage(err instanceof Error ? err.message : "Merge failed");
    } finally {
      setIsMerging(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Insights — collapsed by default. The stat/contributor computation
          and chart render only happen while this is open, so browsing the
          table doesn't pay for analysis nobody's looking at. */}
      <div className="animate-in fade-in slide-in-from-bottom-1 overflow-hidden rounded-xl border border-slate-800 bg-slate-900 transition-colors duration-300 fill-mode-both hover:border-slate-700">
        <button
          type="button"
          onClick={() => setShowInsights((v) => !v)}
          className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left"
          aria-expanded={showInsights}
        >
          <div className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-indigo-500/15 text-indigo-400">
              <Sparkles className="h-4 w-4" />
            </span>
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-slate-300">Insights</p>
              <p className="text-[11px] text-slate-500">
                Charts & stats for {filtered.length.toLocaleString()} contact{filtered.length === 1 ? "" : "s"}
              </p>
            </div>
          </div>
          <ChevronDown
            className={cn(
              "h-4 w-4 shrink-0 text-slate-500 transition-transform duration-300",
              showInsights ? "-rotate-180" : ""
            )}
          />
        </button>
        {showInsights && (
          <div className="animate-in fade-in slide-in-from-top-1 border-t border-slate-800 p-3 duration-300">
            <ContactInsights contacts={filtered} totalContacts={contacts.length} rawCount={rawCount} />
          </div>
        )}
      </div>

      {/* Search — contact information only (name, phone number) */}
      <div className="animate-in fade-in slide-in-from-bottom-1 rounded-xl border border-slate-800 bg-slate-900 p-3 transition-colors duration-300 fill-mode-both hover:border-slate-700">
        <div className="flex items-center gap-2 mb-2">
          <UserSearch className="h-4 w-4 text-slate-400" />
          <span className="text-xs font-medium text-slate-400">Search</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="group relative">
            <UserIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500 transition-colors duration-200 group-focus-within:text-indigo-400" />
            <Input
              value={nameQuery}
              onChange={(e) => setNameQuery(e.target.value)}
              placeholder="Search by name…"
              className="pl-9 bg-slate-950/40 border-slate-800 text-slate-200 placeholder:text-slate-500 transition-all duration-200 focus-visible:border-indigo-500 focus-visible:ring-4 focus-visible:ring-indigo-500/15"
            />
          </div>
          <div className="group relative">
            <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500 transition-colors duration-200 group-focus-within:text-indigo-400" />
            <Input
              value={phoneQuery}
              onChange={(e) => setPhoneQuery(e.target.value)}
              placeholder="Search by phone number…"
              className="pl-9 bg-slate-950/40 border-slate-800 text-slate-200 placeholder:text-slate-500 transition-all duration-200 focus-visible:border-indigo-500 focus-visible:ring-4 focus-visible:ring-indigo-500/15"
            />
          </div>
        </div>
      </div>

      {/* User Filter — who enrolled/saved the contact, kept separate from search */}
      <div className="animate-in fade-in slide-in-from-bottom-1 rounded-xl border border-slate-800 bg-slate-900 p-3 transition-colors duration-300 fill-mode-both hover:border-slate-700">
        <div className="flex items-center gap-2 mb-2">
          <UserIcon className="h-4 w-4 text-slate-400" />
          <span className="text-xs font-medium text-slate-400">Filter by User</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setSelectedUser("ALL")}
            className={cn(
              "px-3 py-1.5 rounded-full text-xs font-semibold transition-all duration-200 active:scale-95",
              selectedUser === "ALL"
                ? "bg-indigo-600 text-white shadow-lg shadow-indigo-500/25 scale-105"
                : "bg-slate-800 text-slate-400 hover:-translate-y-0.5 hover:bg-slate-700 hover:text-slate-200"
            )}
          >
            All Users
          </button>
          {userNames.map((name, i) => (
            <button
              key={name}
              type="button"
              onClick={() => setSelectedUser(name)}
              style={{
                animationDelay: `${Math.min(i, 24) * 16}ms`,
                ...(selectedUser === name
                  ? { background: nameColor(name), boxShadow: `0 6px 16px -4px ${nameColor(name)}80` }
                  : undefined),
              }}
              className={cn(
                "animate-in fade-in slide-in-from-bottom-1 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-all duration-200 fill-mode-both active:scale-95",
                selectedUser === name
                  ? "scale-105 text-white shadow-lg"
                  : "bg-slate-800 text-slate-400 hover:-translate-y-0.5 hover:bg-slate-700 hover:text-slate-200"
              )}
            >
              <span
                className={cn(
                  "w-1.5 h-1.5 rounded-full transition-colors duration-200",
                  selectedUser === name ? "bg-white" : "bg-slate-600"
                )}
              />
              {name}
            </button>
          ))}
        </div>
      </div>

      {/* Results */}
      <div className="animate-in fade-in slide-in-from-bottom-1 rounded-xl border border-slate-800 bg-slate-900 overflow-hidden duration-300 fill-mode-both">
        <div ref={scrollRef} className="max-h-[65vh] overflow-y-auto">
          <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-slate-800 bg-slate-900/95 backdrop-blur supports-backdrop-filter:bg-slate-900/75 px-3 py-2.5">
            <div className="text-xs text-slate-500 whitespace-nowrap">
              Showing{" "}
              <span className="font-medium text-slate-300 tabular-nums">
                {visibleRows.length.toLocaleString()}
              </span>{" "}
              of <span className="font-medium text-slate-300 tabular-nums">{filtered.length.toLocaleString()}</span>{" "}
              matching · <span className="text-slate-400 tabular-nums">{contacts.length.toLocaleString()}</span> total
              {contacts.length !== rawCount ? (
                <span className="text-slate-600"> ({rawCount.toLocaleString()} synced entries merged)</span>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              {mergeMessage ? (
                <p className="animate-in fade-in slide-in-from-right-1 text-xs text-emerald-400">{mergeMessage}</p>
              ) : null}
              <div className="relative">
                {burst && (
                  <div aria-hidden className="pointer-events-none absolute inset-0">
                    {burst.map((p) => (
                      <span
                        key={p.id}
                        className="confetti-particle absolute left-1/2 top-1/2 h-1.5 w-1.5 rounded-full"
                        style={{
                          background: p.color,
                          animationDelay: `${p.delay}ms`,
                          ["--tx" as string]: `${p.tx}px`,
                          ["--ty" as string]: `${p.ty}px`,
                          ["--r" as string]: `${p.r}deg`,
                        }}
                      />
                    ))}
                  </div>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="group border-slate-700 text-slate-300 bg-transparent transition-all duration-200 hover:bg-slate-800 active:scale-95"
                  onClick={runMerge}
                  disabled={isMerging}
                  title="Force an immediate re-merge (new contacts are merged automatically)"
                >
                  {isMerging ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="w-3.5 h-3.5 transition-transform duration-500 group-hover:rotate-180" />
                  )}
                </Button>
              </div>
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
                    <div className="animate-in fade-in zoom-in-95 flex flex-col items-center gap-1.5 duration-300">
                      <UserSearch className="animate-float-soft h-5 w-5 text-slate-700" />
                      No matching contacts.
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                <>
                  {visibleRows.map((contact) => (
                    <ContactRow
                      key={contact.id}
                      contact={contact}
                      nameQuery={deferredNameQuery}
                      phoneQuery={deferredPhoneQuery}
                      now={now}
                    />
                  ))}
                  {visibleCount < filtered.length && (
                    <TableRow ref={sentinelRef} className="border-none hover:bg-transparent">
                      <TableCell colSpan={4} className="py-3 text-center">
                        <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-500">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          Loading more…
                        </span>
                      </TableCell>
                    </TableRow>
                  )}
                </>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
