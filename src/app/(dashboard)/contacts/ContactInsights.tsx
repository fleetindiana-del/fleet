"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Contact,
  Database,
  GitMerge,
  PhoneOff,
  Smartphone,
  Trophy,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { MergedContactRow } from "./ContactsTableClient";
import { useCountUp } from "./AnimatedNumber";

// Sequential hue for magnitude (Top Contributors bars) — one hue, light -> dark,
// validated for the app's slate-900 dark surface.
const BAR_HUE_TOP = "#818cf8"; // indigo-400 (highest bar)
const BAR_HUE_REST = "#4f46e5"; // indigo-600
// Categorical pair for the composition donut — passes CVD + contrast checks
// against #0f172a (dark, adjacent ΔE 23.6 CVD / 28.1 normal-vision).
const COLOR_MULTI = "#6366f1"; // indigo-500 — contact confirmed across 2+ devices
const COLOR_SINGLE = "#059669"; // emerald-600 — contact seen on one device only

function ChartTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; payload?: { fill?: string } }>;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0];
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800/95 px-3 py-2 text-xs shadow-xl backdrop-blur-sm">
      <p className="font-semibold text-slate-100">{p.name}</p>
      <p className="text-slate-400">
        <span className="font-mono font-semibold text-slate-200">{p.value}</span> contacts
      </p>
    </div>
  );
}

function StatTile({
  icon,
  label,
  value,
  suffix,
  hint,
  accent,
  delay,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  suffix?: string;
  hint?: string;
  accent: string;
  delay: number;
}) {
  const animated = useCountUp(value);
  return (
    <div
      style={{ animationDelay: `${delay}ms` }}
      className="animate-in fade-in slide-in-from-bottom-2 group relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 p-4 transition-all duration-300 fill-mode-both hover:-translate-y-1 hover:border-slate-700 hover:shadow-lg"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full opacity-12 blur-xl transition-opacity duration-300 group-hover:opacity-25"
        style={{ background: accent }}
      />
      <div className="relative flex items-center gap-2 text-xs font-medium text-slate-400">
        <span
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg transition-transform duration-300 group-hover:scale-110"
          style={{ background: `${accent}22`, color: accent }}
        >
          {icon}
        </span>
        {label}
      </div>
      <p className="relative mt-2 text-2xl font-bold tabular-nums text-white">
        {animated.toLocaleString()}
        {suffix}
      </p>
      {hint && <p className="relative mt-0.5 text-[11px] text-slate-500">{hint}</p>}
    </div>
  );
}

export function ContactInsights({
  contacts,
  totalContacts,
  rawCount,
}: {
  contacts: MergedContactRow[];
  totalContacts: number;
  rawCount: number;
}) {
  // Captured once on mount rather than read inline during render — "recently
  // synced" only needs to be accurate to within the page's lifetime, not to
  // the millisecond, and Date.now() isn't a pure value to compute render output from.
  const [now] = useState(() => Date.now());

  const stats = useMemo(() => {
    const count = contacts.length;
    const multiDevice = contacts.filter((c) => c.sourceCount > 1).length;
    const singleDevice = count - multiDevice;
    const noPhone = contacts.filter((c) => c.phoneNumbers.length === 0).length;

    const dayMs = 24 * 60 * 60 * 1000;
    const recentlySynced = contacts.filter(
      (c) => c.lastSyncedAt && now - new Date(c.lastSyncedAt).getTime() < dayMs
    ).length;

    const contributorMap = new Map<string, Set<string>>();
    for (const c of contacts) {
      for (const s of c.sources) {
        const name = s.employeeName || "Unknown";
        if (!contributorMap.has(name)) contributorMap.set(name, new Set());
        contributorMap.get(name)!.add(c.id);
      }
    }
    const contributors = [...contributorMap.entries()]
      .map(([name, ids]) => ({ name, count: ids.size }))
      .sort((a, b) => b.count - a.count);

    const TOP_N = 6;
    const topContributors = contributors.slice(0, TOP_N);
    const otherCount = contributors
      .slice(TOP_N)
      .reduce((sum, c) => sum + c.count, 0);
    const barData = [
      ...topContributors.map((c) => ({ name: c.name, value: c.count })),
      ...(otherCount > 0 ? [{ name: "Other", value: otherCount }] : []),
    ];

    const multiPct = count > 0 ? Math.round((multiDevice / count) * 100) : 0;
    const donutData = [
      { name: "Multi-device", value: multiDevice, color: COLOR_MULTI },
      { name: "Single-device", value: singleDevice, color: COLOR_SINGLE },
    ].filter((d) => d.value > 0);

    return {
      count,
      multiDevice,
      singleDevice,
      noPhone,
      recentlySynced,
      contributors,
      barData,
      donutData,
      multiPct,
      duplicatesMerged: Math.max(0, rawCount - totalContacts),
    };
  }, [contacts, rawCount, totalContacts, now]);

  const isFiltered = contacts.length !== totalContacts;
  const maxBar = Math.max(1, ...stats.barData.map((d) => d.value));
  const topContributor = stats.contributors[0];

  if (totalContacts === 0) return null;

  return (
    <div className="space-y-4">
      {/* KPI tiles */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <StatTile
          icon={<Contact className="h-3.5 w-3.5" />}
          label={isFiltered ? "Matching Contacts" : "Total Contacts"}
          value={stats.count}
          hint={isFiltered ? `of ${totalContacts.toLocaleString()} total` : `from ${rawCount.toLocaleString()} synced entries`}
          accent="#818cf8"
          delay={0}
        />
        <StatTile
          icon={<GitMerge className="h-3.5 w-3.5" />}
          label="Duplicates Merged"
          value={stats.duplicatesMerged}
          hint="entries folded into one contact"
          accent="#059669"
          delay={40}
        />
        <StatTile
          icon={<Smartphone className="h-3.5 w-3.5" />}
          label="Multi-Device"
          value={stats.multiDevice}
          suffix={stats.count > 0 ? ` (${stats.multiPct}%)` : ""}
          hint="confirmed on 2+ devices"
          accent="#6366f1"
          delay={80}
        />
        <StatTile
          icon={<PhoneOff className="h-3.5 w-3.5" />}
          label="Missing Phone"
          value={stats.noPhone}
          hint="no number on record"
          accent="#d97706"
          delay={120}
        />
        <StatTile
          icon={<Users className="h-3.5 w-3.5" />}
          label="Contributors"
          value={stats.contributors.length}
          hint="employees who've synced contacts"
          accent="#22d3ee"
          delay={160}
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-5">
        {/* Top contributors — sequential magnitude ranking */}
        <div className="animate-in fade-in slide-in-from-bottom-2 rounded-2xl border border-slate-800 bg-slate-900 p-4 duration-300 xl:col-span-3">
          <div className="mb-1 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-200">Top Contributors</h3>
            {topContributor && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-400">
                <Trophy className="h-3 w-3" />
                {topContributor.name}
              </span>
            )}
          </div>
          <p className="mb-3 text-[11px] text-slate-500">Contacts synced per employee{isFiltered ? " (filtered)" : ""}</p>
          {stats.barData.length === 0 ? (
            <div className="flex h-55 items-center justify-center text-xs text-slate-600">
              No contributor data yet
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(180, stats.barData.length * 34)}>
              <BarChart
                data={stats.barData}
                layout="vertical"
                margin={{ top: 0, right: 16, bottom: 0, left: 0 }}
                barCategoryGap={10}
              >
                <XAxis type="number" hide domain={[0, maxBar]} />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={110}
                  tick={{ fill: "#94a3b8", fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                />
                <RechartsTooltip content={<ChartTooltip />} cursor={{ fill: "rgba(148,163,184,0.06)" }} />
                <Bar dataKey="value" radius={[0, 6, 6, 0]} animationDuration={800} animationEasing="ease-out">
                  {stats.barData.map((d, i) => (
                    <Cell key={d.name} fill={i === 0 ? BAR_HUE_TOP : BAR_HUE_REST} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Composition donut — categorical, mutually exclusive */}
        <div className="animate-in fade-in slide-in-from-bottom-2 rounded-2xl border border-slate-800 bg-slate-900 p-4 duration-300 xl:col-span-2">
          <h3 className="text-sm font-semibold text-slate-200">Contact Sources</h3>
          <p className="mb-1 text-[11px] text-slate-500">Single- vs multi-device confirmation</p>
          <div className="relative">
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={stats.donutData}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={58}
                  outerRadius={80}
                  paddingAngle={stats.donutData.length > 1 ? 3 : 0}
                  animationDuration={800}
                  animationEasing="ease-out"
                  stroke="#0f172a"
                  strokeWidth={2}
                >
                  {stats.donutData.map((d) => (
                    <Cell key={d.name} fill={d.color} />
                  ))}
                </Pie>
                <RechartsTooltip content={<ChartTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl font-bold tabular-nums text-white">{stats.multiPct}%</span>
              <span className="text-[10px] text-slate-500">multi-device</span>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1">
            {stats.donutData.map((d) => (
              <span key={d.name} className="flex items-center gap-1.5 text-[11px] text-slate-400">
                <span className="h-2 w-2 rounded-full" style={{ background: d.color }} />
                {d.name} · <span className="font-mono text-slate-300">{d.value}</span>
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Freshness strip */}
      {stats.recentlySynced > 0 && (
        <div
          className={cn(
            "animate-in fade-in slide-in-from-bottom-1 flex items-center gap-2 rounded-xl border border-emerald-800/40 bg-emerald-950/20 px-3 py-2 text-xs text-emerald-300 duration-300"
          )}
        >
          <Database className="h-3.5 w-3.5 shrink-0" />
          <span>
            <span className="font-semibold text-emerald-200">{stats.recentlySynced}</span> contact
            {stats.recentlySynced === 1 ? "" : "s"} synced in the last 24 hours
          </span>
        </div>
      )}
    </div>
  );
}
