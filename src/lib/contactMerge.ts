import crypto from "crypto";
import connectToDatabase from "@/lib/db";
import Contact from "@/models/Contact";
import MergedContact from "@/models/MergedContact";
import MergeState from "@/models/MergeState";
import {
  normalizeContactName,
  normalizePhoneDigits,
  phoneKeyOf,
} from "@/lib/contactNormalize";

const LOCK_ID = "contacts";
// "Unknown" is the ingest fallback for a missing contact name (see
// src/app/api/contacts/route.ts) — thousands of unrelated contacts can carry
// it, so it must never be treated as a shared identity for merge purposes.
const UNMERGEABLE_NAME_KEY = "unknown";
const STALE_LOCK_MS = 15 * 60 * 1000; // crash recovery: reclaim a lock nothing released
export const AUTO_MERGE_INTERVAL_MS = 10 * 60 * 1000;
const BULK_WRITE_BATCH = 1000;

type RawContact = {
  _id: unknown;
  employeeName?: string;
  deviceId?: string;
  contactName?: string;
  phoneNumber?: string;
  nameKey?: string;
  phoneKey?: string;
  syncedAt?: Date;
};

type MergedContactBulkOp = {
  updateOne: {
    filter: { clusterKey: string };
    update: { $set: Record<string, unknown> };
    upsert: true;
  };
};

type ContactKeyBackfillOp = {
  updateOne: {
    filter: { _id: unknown };
    update: { $set: { nameKey: string; phoneKey: string } };
  };
};

// Union-Find over array indices: contacts sharing a normalized name OR a
// normalized phone number end up in the same connected component, and
// merging is transitive (A~B via phone, B~C via name => A, B, C all merge).
class DisjointSet {
  private parent: Int32Array;
  constructor(n: number) {
    this.parent = new Int32Array(n);
    for (let i = 0; i < n; i++) this.parent[i] = i;
  }
  find(x: number): number {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]];
      x = this.parent[x];
    }
    return x;
  }
  union(a: number, b: number) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[ra] = rb;
  }
}

async function acquireLock(): Promise<boolean> {
  await MergeState.updateOne(
    { _id: LOCK_ID },
    { $setOnInsert: { isRunning: false } },
    { upsert: true }
  );

  const claimed = await MergeState.findOneAndUpdate(
    { _id: LOCK_ID, isRunning: { $ne: true } },
    { $set: { isRunning: true, startedAt: new Date() } },
    { new: true }
  );
  if (claimed) return true;

  const stale = await MergeState.findOneAndUpdate(
    {
      _id: LOCK_ID,
      isRunning: true,
      startedAt: { $lt: new Date(Date.now() - STALE_LOCK_MS) },
    },
    { $set: { isRunning: true, startedAt: new Date() } },
    { new: true }
  );
  return Boolean(stale);
}

async function releaseLock(clusterCount: number, durationMs: number) {
  await MergeState.updateOne(
    { _id: LOCK_ID },
    {
      $set: {
        isRunning: false,
        lastRunAt: new Date(),
        lastRunDurationMs: durationMs,
        lastRunClusterCount: clusterCount,
      },
    }
  );
}

// Most common original-cased spelling wins; ties break on length (usually
// the more complete name, e.g. "Ravi Kumar" over "Ravi").
function pickCanonicalName(names: string[]): string {
  const counts = new Map<string, number>();
  for (const n of names) {
    const trimmed = n.trim();
    if (!trimmed || trimmed.toLowerCase() === "unknown") continue;
    counts.set(trimmed, (counts.get(trimmed) ?? 0) + 1);
  }
  let best = "";
  let bestScore = -1;
  for (const [name, count] of counts) {
    const score = count * 1000 + name.length;
    if (score > bestScore) {
      best = name;
      bestScore = score;
    }
  }
  return best || names.find((n) => n.trim())?.trim() || "Unknown";
}

/**
 * Rebuilds the MergedContact collection from every raw Contact record: one
 * cluster per connected component of "same name" / "same phone" edges, with
 * every phone number and every contributing employee/device retained. Uses
 * an upsert-by-clusterKey + mark-and-sweep delete so clusters that didn't
 * change between runs are untouched writes, not full rewrites.
 */
export async function runContactMerge(): Promise<{
  ran: boolean;
  clusters?: number;
  rawContacts?: number;
  tookMs?: number;
}> {
  await connectToDatabase();

  const gotLock = await acquireLock();
  if (!gotLock) return { ran: false };

  const startedAt = Date.now();
  try {
    const raw = (await Contact.find()
      .select("employeeName deviceId contactName phoneNumber nameKey phoneKey syncedAt")
      .lean()) as unknown as RawContact[];

    const n = raw.length;
    const dsu = new DisjointSet(n);
    const byName = new Map<string, number>();
    const byPhone = new Map<string, number>();
    // Records synced before nameKey/phoneKey existed on the schema have them
    // blank; backfill those in the same pass so future runs (and the
    // tags/bulk lookup, which relies on phoneKey being indexed) don't need a
    // separate migration to catch up.
    const keyBackfillOps: ContactKeyBackfillOp[] = [];

    for (let i = 0; i < n; i++) {
      const nk = raw[i].nameKey || normalizeContactName(raw[i].contactName);
      const pk = raw[i].phoneKey || phoneKeyOf(raw[i].phoneNumber);

      if (!raw[i].nameKey || !raw[i].phoneKey) {
        keyBackfillOps.push({
          updateOne: {
            filter: { _id: raw[i]._id },
            update: { $set: { nameKey: nk, phoneKey: pk } },
          },
        });
      }

      if (nk && nk !== UNMERGEABLE_NAME_KEY) {
        const first = byName.get(nk);
        if (first === undefined) byName.set(nk, i);
        else dsu.union(i, first);
      }
      if (pk) {
        const first = byPhone.get(pk);
        if (first === undefined) byPhone.set(pk, i);
        else dsu.union(i, first);
      }
    }

    for (let i = 0; i < keyBackfillOps.length; i += BULK_WRITE_BATCH) {
      const batch = keyBackfillOps.slice(i, i + BULK_WRITE_BATCH);
      if (batch.length > 0) await Contact.bulkWrite(batch, { ordered: false });
    }

    const clusters = new Map<number, number[]>();
    for (let i = 0; i < n; i++) {
      const root = dsu.find(i);
      const arr = clusters.get(root);
      if (arr) arr.push(i);
      else clusters.set(root, [i]);
    }

    const mergeRunId = `${startedAt}-${crypto.randomBytes(4).toString("hex")}`;
    const ops: MergedContactBulkOp[] = [];

    for (const idxs of clusters.values()) {
      const items = idxs.map((i) => raw[i]);

      const ids = items.map((it) => String(it._id)).sort();
      const clusterKey = crypto.createHash("sha1").update(ids.join(",")).digest("hex");

      const contactName = pickCanonicalName(items.map((it) => it.contactName || ""));
      const nameKey = normalizeContactName(contactName);

      const phoneByKey = new Map<string, string>();
      for (const it of items) {
        const pk = it.phoneKey || phoneKeyOf(it.phoneNumber);
        if (!pk) continue;
        const existing = phoneByKey.get(pk);
        // Prefer the most complete rendering (e.g. +91… over a bare 10-digit number).
        if (!existing || normalizePhoneDigits(it.phoneNumber).length > normalizePhoneDigits(existing).length) {
          phoneByKey.set(pk, it.phoneNumber || "");
        }
      }
      const phoneNumbers = [...phoneByKey.values()].filter(Boolean);
      const phoneKeys = [...phoneByKey.keys()];

      const sources = items
        .map((it) => ({
          employeeName: it.employeeName || "Unknown",
          deviceId: it.deviceId || "",
          phoneNumber: it.phoneNumber || "",
          syncedAt: it.syncedAt,
        }))
        .sort((a, b) => a.employeeName.localeCompare(b.employeeName));

      let lastSyncedAt: Date | undefined;
      for (const it of items) {
        if (it.syncedAt && (!lastSyncedAt || it.syncedAt > lastSyncedAt)) lastSyncedAt = it.syncedAt;
      }

      ops.push({
        updateOne: {
          filter: { clusterKey },
          update: {
            $set: {
              clusterKey,
              contactName,
              nameKey,
              phoneNumbers,
              phoneKeys,
              sources,
              sourceCount: sources.length,
              lastSyncedAt,
              mergeRunId,
            },
          },
          upsert: true,
        },
      });
    }

    for (let i = 0; i < ops.length; i += BULK_WRITE_BATCH) {
      const batch = ops.slice(i, i + BULK_WRITE_BATCH);
      if (batch.length > 0) await MergedContact.bulkWrite(batch, { ordered: false });
    }

    // Mark-and-sweep: any cluster not touched by this run had its members
    // re-grouped elsewhere and is now stale.
    await MergedContact.deleteMany({ mergeRunId: { $ne: mergeRunId } });

    const tookMs = Date.now() - startedAt;
    await releaseLock(clusters.size, tookMs);
    return { ran: true, clusters: clusters.size, rawContacts: n, tookMs };
  } catch (err) {
    await releaseLock(-1, Date.now() - startedAt);
    throw err;
  }
}

let autoMergeInFlight = false;

/**
 * Fire-and-forget trigger for the device-sync endpoint: only starts a merge
 * if the last completed run is stale, and never throws — a hiccup here must
 * not fail the caller's contact sync.
 */
export function maybeTriggerAutoMerge() {
  if (autoMergeInFlight) return;
  autoMergeInFlight = true;

  (async () => {
    try {
      await connectToDatabase();
      const state = await MergeState.findById(LOCK_ID).lean<{ lastRunAt?: Date } | null>();
      const last = state?.lastRunAt ? new Date(state.lastRunAt).getTime() : 0;
      if (Date.now() - last < AUTO_MERGE_INTERVAL_MS) return;
      await runContactMerge();
    } catch (err) {
      console.error("Auto contact merge failed:", err);
    } finally {
      autoMergeInFlight = false;
    }
  })();
}
