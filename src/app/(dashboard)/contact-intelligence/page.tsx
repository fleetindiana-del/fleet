"use client";

import { useEffect, useState, useMemo } from "react";
import { format } from "date-fns";
import {
  BrainCircuit,
  ShieldCheck,
  PhoneCall,
  AlertCircle,
  CheckCircle2,
  Send,
  Loader2,
  RefreshCw,
  Activity,
  PhoneIncoming,
  PhoneOutgoing,
  PhoneMissed,
  Clock,
  ChevronDown,
  ChevronUp,
  User,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Tab = "botlog" | "identified" | "unknown" | "compliance";

// ── Status config ────────────────────────────────────────────────────────────
const STATUS_CONFIG: Record<string, { label: string; color: string; dot: string }> = {
  done: {
    label: "Done",
    color: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    dot: "bg-emerald-400",
  },
  awaiting_category: {
    label: "Awaiting Category",
    color: "bg-sky-500/15 text-sky-300 border-sky-500/30",
    dot: "bg-sky-400",
  },
  awaiting_name: {
    label: "Awaiting Name",
    color: "bg-purple-500/15 text-purple-300 border-purple-500/30",
    dot: "bg-purple-400",
  },
  needs_category: {
    label: "Needs Category",
    color: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    dot: "bg-amber-400",
  },
  threshold_reached: {
    label: "Threshold Reached",
    color: "bg-rose-500/15 text-rose-400 border-rose-500/30",
    dot: "bg-rose-500",
  },
  tracking: {
    label: "Tracking",
    color: "bg-slate-500/15 text-slate-400 border-slate-500/30",
    dot: "bg-slate-500",
  },
};

const CATEGORY_COLORS: Record<string, string> = {
  personal: "bg-purple-500/15 text-purple-300 border-purple-500/30",
  staff: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  "Existing Client": "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  "New Client": "bg-amber-500/15 text-amber-300 border-amber-500/30",
  courier: "bg-slate-500/15 text-slate-300 border-slate-500/30",
  // legacy (pre-rename) so old records still get a color
  Family: "bg-purple-500/15 text-purple-300 border-purple-500/30",
  Colleague: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  Other: "bg-slate-500/15 text-slate-300 border-slate-500/30",
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.tracking;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border",
        cfg.color
      )}
    >
      <span className={cn("w-1.5 h-1.5 rounded-full", cfg.dot)} />
      {cfg.label}
    </span>
  );
}

function ScenarioBadge({ scenario }: { scenario: "A" | "B" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold border",
        scenario === "A"
          ? "bg-indigo-500/15 text-indigo-300 border-indigo-500/30"
          : "bg-orange-500/15 text-orange-300 border-orange-500/30"
      )}
    >
      {scenario === "A" ? "📞 Scenario A" : "⚠️ Scenario B"}
    </span>
  );
}

function CategoryBadge({ category }: { category?: string }) {
  if (!category) return <span className="text-slate-500 text-xs">—</span>;
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border",
        CATEGORY_COLORS[category] ?? "bg-slate-700 text-slate-300 border-slate-600"
      )}
    >
      {category}
    </span>
  );
}

function fmtDuration(s: number) {
  if (!s) return "0s";
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function ContactIntelligencePage() {
  const [tab, setTab] = useState<Tab>("botlog");

  // Bot log state
  const [logs, setLogs] = useState<any[]>([]);
  const [employees, setEmployees] = useState<string[]>([]);
  const [selectedEmployee, setSelectedEmployee] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [logsLoading, setLogsLoading] = useState(true);

  // Other tabs state
  const [dashData, setDashData] = useState<any>(null);
  const [dashLoading, setDashLoading] = useState(false);
  const [reminderLoading, setReminderLoading] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [sendingLogs, setSendingLogs] = useState<Record<string, { loading: boolean; text?: string; error?: boolean }>>({});

  const handleManualSend = async (logData: any) => {
    const key = `${logData.employeeName}-${logData.phoneNumber}`;
    setSendingLogs(prev => ({ ...prev, [key]: { loading: true, text: "Sending..." } }));

    try {
      const res = await fetch("/api/contact-intelligence/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phoneNumber: logData.phoneNumber,
          contactName: logData.contactName,
          employeeName: logData.employeeName,
        }),
      });
      const result = await res.json();
      if (result.success) {
        setSendingLogs(prev => ({ ...prev, [key]: { loading: false, text: result.message || "✅ Sent successfully!" } }));
      } else {
        setSendingLogs(prev => ({ ...prev, [key]: { loading: false, text: "❌ Error: " + result.error, error: true } }));
      }
    } catch (e: any) {
      setSendingLogs(prev => ({ ...prev, [key]: { loading: false, text: "❌ Failed to send", error: true } }));
    }
  };

  const fetchLogs = async (emp?: string) => {
    setLogsLoading(true);
    try {
      const url = new URL("/api/contact-intelligence/log", window.location.origin);
      if (emp && emp !== "ALL") url.searchParams.set("employee", emp);
      const res = await fetch(url.toString());
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs ?? []);
        setEmployees(data.employees ?? []);
      }
    } finally {
      setLogsLoading(false);
    }
  };

  const fetchDashboard = async () => {
    setDashLoading(true);
    try {
      const res = await fetch("/api/contact-intelligence");
      if (res.ok) setDashData(await res.json());
    } finally {
      setDashLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  useEffect(() => {
    if (tab !== "botlog") fetchDashboard();
  }, [tab]);

  const handleEmployeeFilter = (emp: string) => {
    setSelectedEmployee(emp);
    fetchLogs(emp);
  };

  const filteredLogs = useMemo(() => {
    return logs.filter((l) => {
      if (statusFilter !== "ALL" && l.status !== statusFilter) return false;
      return true;
    });
  }, [logs, statusFilter]);

  // Summary counts
  const summary = useMemo(() => {
    const done = logs.filter((l) => l.status === "done").length;
    const pending = logs.filter((l) =>
      ["awaiting_category", "awaiting_name"].includes(l.status)
    ).length;
    const needsAction = logs.filter((l) =>
      ["needs_category", "threshold_reached"].includes(l.status)
    ).length;
    const tracking = logs.filter((l) => l.status === "tracking").length;
    return { done, pending, needsAction, tracking, total: logs.length };
  }, [logs]);

  const sendReminder = async (id: string) => {
    setReminderLoading(id);
    try {
      const res = await fetch("/api/contact-intelligence/remind", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const result = await res.json();
      if (result.success) {
        alert("Reminder sent via Telegram ✅");
        fetchDashboard();
      } else {
        alert(`Failed: ${result.error}`);
      }
    } finally {
      setReminderLoading(null);
    }
  };

  const processNewCalls = async () => {
    setIsProcessing(true);
    try {
      const res = await fetch("/api/contact-intelligence/process");
      const data = await res.json();
      if (res.ok) {
        fetchLogs(selectedEmployee);
        fetchDashboard();
      } else {
        alert(`Error processing calls: ${data.error}`);
      }
    } catch (e) {
      alert("Failed to process calls.");
    } finally {
      setIsProcessing(false);
    }
  };

  const startFresh = async () => {
    if (!confirm("This will:\n• Delete all identified contacts\n• Delete all unknown number trackers\n• Ignore all previous call history\n\nOnly NEW calls from this moment will trigger Telegram messages.\n\nContinue?")) return;
    try {
      const res = await fetch("/api/contact-intelligence/reset-checkpoint", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        alert(`✅ Done! Cleared ${data.deletedIdentified} identified contacts and ${data.deletedTrackers} unknown trackers. The bot will now only send messages for new calls going forward.`);
        fetchLogs(selectedEmployee);
        fetchDashboard();
      } else {
        alert("Failed to reset checkpoint.");
      }
    } catch (e) {
      alert("Failed to reset.");
    }
  };

  const tabs: { id: Tab; label: string; icon: any }[] = [
    { id: "botlog", label: "Bot Activity Log", icon: Activity },
    { id: "identified", label: "Identified Contacts", icon: ShieldCheck },
    { id: "unknown", label: "Unknown Numbers", icon: PhoneCall },
    { id: "compliance", label: "Compliance", icon: AlertCircle },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white flex items-center gap-3">
            <BrainCircuit className="h-8 w-8 text-indigo-400" />
            Contact Intelligence
          </h1>
          <p className="text-slate-400 mt-1 text-sm">
            Bot activity monitoring, contact classification and compliance tracking
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={startFresh}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-rose-600/20 hover:bg-rose-600/40 text-rose-300 border border-rose-600/30 font-medium text-sm transition-all"
          >
            <RefreshCw className="h-4 w-4" />
            Start Fresh
          </button>
          <button
            onClick={processNewCalls}
            disabled={isProcessing}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-sm transition-all disabled:opacity-50"
          >
            {isProcessing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            {isProcessing ? "Processing..." : "Process Now"}
          </button>
          <button
            onClick={() => (tab === "botlog" ? fetchLogs(selectedEmployee) : fetchDashboard())}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm transition-colors"
          >
            <RefreshCw className={cn("h-4 w-4", logsLoading && "animate-spin")} />
            Refresh
          </button>
        </div>
      </div>

      {/* Tab Switcher */}
      <div className="flex gap-1 bg-slate-900 border border-slate-800 rounded-xl p-1.5 overflow-x-auto">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all whitespace-nowrap flex-shrink-0",
              tab === id
                ? "bg-indigo-600 text-white shadow-lg"
                : "text-slate-400 hover:text-white hover:bg-slate-800"
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {/* ─── BOT ACTIVITY LOG TAB ─────────────────────────────────────────── */}
      {tab === "botlog" && (
        <div className="space-y-4">
          {/* Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Total Numbers", value: summary.total, color: "text-white" },
              { label: "Needs Action", value: summary.needsAction, color: "text-rose-400" },
              { label: "In Progress", value: summary.pending, color: "text-sky-400" },
              { label: "Done", value: summary.done, color: "text-emerald-400" },
            ].map(({ label, value, color }) => (
              <Card key={label} className="bg-slate-900 border-slate-800">
                <CardContent className="pt-4 pb-4 px-4">
                  <div className="text-xs text-slate-400 mb-1">{label}</div>
                  <div className={cn("text-2xl font-bold", color)}>{value}</div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Filters */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
            {/* Employee filter */}
            <div>
              <div className="text-xs text-slate-500 mb-2 flex items-center gap-1.5">
                <User className="h-3.5 w-3.5" /> Employee
              </div>
              <div className="flex flex-wrap gap-2">
                {["ALL", ...employees].map((emp) => (
                  <button
                    key={emp}
                    onClick={() => handleEmployeeFilter(emp)}
                    className={cn(
                      "px-3 py-1.5 rounded-full text-xs font-medium transition-colors",
                      selectedEmployee === emp
                        ? "bg-indigo-600 text-white"
                        : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200"
                    )}
                  >
                    {emp === "ALL" ? "All Employees" : emp}
                  </button>
                ))}
              </div>
            </div>

            {/* Status filter */}
            <div>
              <div className="text-xs text-slate-500 mb-2">Status</div>
              <div className="flex flex-wrap gap-2">
                {["ALL", "needs_category", "threshold_reached", "awaiting_name", "awaiting_category", "tracking", "done"].map(
                  (s) => (
                    <button
                      key={s}
                      onClick={() => setStatusFilter(s)}
                      className={cn(
                        "px-3 py-1.5 rounded-full text-xs font-medium transition-colors",
                        statusFilter === s
                          ? "bg-indigo-600 text-white"
                          : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200"
                      )}
                    >
                      {s === "ALL"
                        ? "All"
                        : STATUS_CONFIG[s]?.label ?? s}
                    </button>
                  )
                )}
              </div>
            </div>
          </div>

          {/* Log Table */}
          <Card className="bg-slate-900 border-slate-800">
            <CardContent className="p-0">
              {logsLoading ? (
                <div className="flex items-center justify-center h-48">
                  <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
                </div>
              ) : filteredLogs.length === 0 ? (
                <div className="text-center text-slate-500 py-16 text-sm">
                  No call log data found. Make sure the Android app has synced calls.
                </div>
              ) : (
                <>
                  {/* Desktop */}
                  <div className="hidden lg:block overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-800 bg-slate-950/50">
                          <th className="text-left px-4 py-3 text-slate-400 font-medium">Employee</th>
                          <th className="text-left px-4 py-3 text-slate-400 font-medium">Phone / Contact</th>
                          <th className="text-left px-4 py-3 text-slate-400 font-medium">Scenario</th>
                          <th className="text-left px-4 py-3 text-slate-400 font-medium">Calls</th>
                          <th className="text-left px-4 py-3 text-slate-400 font-medium">Status</th>
                          <th className="text-left px-4 py-3 text-slate-400 font-medium">Category</th>
                          <th className="text-left px-4 py-3 text-slate-400 font-medium">Action Needed</th>
                          <th className="text-left px-4 py-3 text-slate-400 font-medium">Last Call</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredLogs.map((log, i) => {
                          const cfg = STATUS_CONFIG[log.status];
                          const isActionable =
                            log.status === "needs_category" || log.status === "threshold_reached";
                          return (
                            <tr
                              key={i}
                              className={cn(
                                "border-b border-slate-800 hover:bg-slate-800/40 transition-colors",
                                isActionable && "bg-rose-500/5"
                              )}
                            >
                              <td className="px-4 py-3 font-medium text-slate-200">
                                {log.employeeName}
                                {!log.hasTelegram && (
                                  <div className="text-xs text-amber-500 mt-0.5">⚠️ No Telegram</div>
                                )}
                              </td>
                              <td className="px-4 py-3">
                                <div className="font-mono text-slate-300 text-xs">{log.phoneNumber}</div>
                                {log.contactName && (
                                  <div className="text-slate-400 text-xs mt-0.5">{log.contactName}</div>
                                )}
                              </td>
                              <td className="px-4 py-3">
                                <ScenarioBadge scenario={log.scenario} />
                              </td>
                              <td className="px-4 py-3">
                                <div className="text-slate-300 font-bold">
                                  {log.callCount}
                                  {log.scenario === "B" && (
                                    <span className="text-slate-500 font-normal"> / 5</span>
                                  )}
                                </div>
                                <div className="flex items-center gap-2 mt-1">
                                  {log.scenario === "B" && (
                                    <div className="h-1.5 w-16 bg-slate-700 rounded-full overflow-hidden">
                                      <div
                                        className={cn(
                                          "h-full rounded-full",
                                          log.callCount >= 5 ? "bg-rose-500" : "bg-amber-500"
                                        )}
                                        style={{ width: `${Math.min(100, (log.callCount / 5) * 100)}%` }}
                                      />
                                    </div>
                                  )}
                                </div>
                                <div className="flex gap-2 mt-1 text-xs text-slate-500">
                                  <span title="Incoming">↓{log.incomingCount}</span>
                                  <span title="Outgoing">↑{log.outgoingCount}</span>
                                  <span title="Missed">✕{log.missedCount}</span>
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                <StatusBadge status={log.status} />
                              </td>
                              <td className="px-4 py-3">
                                <CategoryBadge category={log.category} />
                              </td>
                              <td className="px-4 py-3 text-xs text-slate-400 max-w-[200px]">
                                {isActionable ? (
                                  <div className="flex flex-col items-start gap-2">
                                    <span className="text-rose-300 leading-tight">{log.actionNeeded}</span>
                                    {log.hasTelegram && (
                                      <div className="mt-1 flex flex-col items-start gap-1">
                                        <button
                                          onClick={() => handleManualSend(log)}
                                          disabled={sendingLogs[`${log.employeeName}-${log.phoneNumber}`]?.loading}
                                          className="flex items-center justify-center gap-1.5 px-3 py-1.5 w-full rounded-md bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-300 font-medium transition-colors disabled:opacity-50"
                                        >
                                          {sendingLogs[`${log.employeeName}-${log.phoneNumber}`]?.loading ? (
                                            <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Sending...</>
                                          ) : (
                                            <><Send className="h-3.5 w-3.5" /> Send via Telegram</>
                                          )}
                                        </button>
                                        {sendingLogs[`${log.employeeName}-${log.phoneNumber}`]?.text && (
                                          <span className={cn(
                                            "text-[11px] font-medium leading-tight",
                                            sendingLogs[`${log.employeeName}-${log.phoneNumber}`]?.error ? "text-rose-400" : "text-emerald-400"
                                          )}>
                                            {sendingLogs[`${log.employeeName}-${log.phoneNumber}`]?.text}
                                          </span>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  log.actionNeeded
                                )}
                              </td>
                              <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                                {log.lastCall
                                  ? format(new Date(log.lastCall), "MMM d, yy HH:mm")
                                  : "—"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile Cards */}
                  <div className="block lg:hidden divide-y divide-slate-800">
                    {filteredLogs.map((log, i) => {
                      const isActionable = log.status === "needs_category" || log.status === "threshold_reached";
                      return (
                        <div key={i} className={cn("p-4 space-y-3", isActionable && "bg-rose-500/5")}>
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <div className="font-semibold text-slate-200">{log.employeeName}</div>
                              <div className="font-mono text-slate-500 text-xs">{log.phoneNumber}</div>
                              {log.contactName && (
                                <div className="text-slate-400 text-xs">{log.contactName}</div>
                              )}
                            </div>
                            <StatusBadge status={log.status} />
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <ScenarioBadge scenario={log.scenario} />
                            <CategoryBadge category={log.category} />
                            <span className="text-xs text-slate-400">
                              {log.callCount} call{log.callCount !== 1 ? "s" : ""}
                              {log.scenario === "B" && ` / 5`}
                            </span>
                          </div>
                          {log.scenario === "B" && (
                            <div className="h-1.5 w-full bg-slate-700 rounded-full overflow-hidden">
                              <div
                                className={cn(
                                  "h-full rounded-full",
                                  log.callCount >= 5 ? "bg-rose-500" : "bg-amber-500"
                                )}
                                style={{ width: `${Math.min(100, (log.callCount / 5) * 100)}%` }}
                              />
                            </div>
                          )}
                          <div className={cn("text-xs flex flex-col gap-2", isActionable ? "text-rose-300" : "text-slate-500")}>
                            {log.actionNeeded}
                            {isActionable && log.hasTelegram && (
                              <div className="mt-1 flex flex-col items-start gap-1">
                                <button
                                  onClick={() => handleManualSend(log)}
                                  disabled={sendingLogs[`${log.employeeName}-${log.phoneNumber}`]?.loading}
                                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-300 font-medium transition-colors disabled:opacity-50"
                                >
                                  {sendingLogs[`${log.employeeName}-${log.phoneNumber}`]?.loading ? (
                                    <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Sending...</>
                                  ) : (
                                    <><Send className="h-3.5 w-3.5" /> Send Telegram</>
                                  )}
                                </button>
                                {sendingLogs[`${log.employeeName}-${log.phoneNumber}`]?.text && (
                                  <span className={cn(
                                    "text-[11px] font-medium leading-tight",
                                    sendingLogs[`${log.employeeName}-${log.phoneNumber}`]?.error ? "text-rose-400" : "text-emerald-400"
                                  )}>
                                    {sendingLogs[`${log.employeeName}-${log.phoneNumber}`]?.text}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                          <div className="text-xs text-slate-600">
                            Last call: {log.lastCall ? format(new Date(log.lastCall), "MMM d, yyyy HH:mm") : "—"}
                            {!log.hasTelegram && (
                              <span className="ml-2 text-amber-500">⚠️ No Telegram linked</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="px-4 py-3 border-t border-slate-800 text-xs text-slate-500">
                    Showing <span className="text-slate-300 font-medium">{filteredLogs.length}</span> of{" "}
                    <span className="text-slate-300 font-medium">{logs.length}</span> entries
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ─── OTHER TABS ───────────────────────────────────────────────────── */}
      {tab !== "botlog" && (
        <Card className="bg-slate-900 border-slate-800">
          <CardContent className="p-0">
            {dashLoading ? (
              <div className="flex items-center justify-center h-48">
                <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
              </div>
            ) : tab === "identified" ? (
              <IdentifiedContactsTab contacts={dashData?.identifiedContacts ?? []} />
            ) : tab === "unknown" ? (
              <UnknownNumbersTab trackers={dashData?.unknownTrackers ?? []} />
            ) : (
              <ComplianceTab
                contacts={dashData?.complianceIssues ?? []}
                onRemind={sendReminder}
                reminderLoading={reminderLoading}
              />
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── Identified Contacts Tab ──────────────────────────────────────────────────

function IdentifiedContactsTab({ contacts }: { contacts: any[] }) {
  if (contacts.length === 0)
    return (
      <div className="text-center text-slate-500 py-16 text-sm">
        No identified contacts yet. Employees will classify them via Telegram.
      </div>
    );
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-800 bg-slate-950/50">
            {["Employee", "Contact Name", "Phone", "Category", "Saved in Phone", "Identified At"].map((h) => (
              <th key={h} className="text-left px-4 py-3 text-slate-400 font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {contacts.map((c: any) => (
            <tr key={c._id} className="border-b border-slate-800 hover:bg-slate-800/40">
              <td className="px-4 py-3 text-slate-300 font-medium">{c.employeeName}</td>
              <td className="px-4 py-3 text-slate-200">{c.contactName || "—"}</td>
              <td className="px-4 py-3 font-mono text-slate-300 text-xs">{c.phoneNumber}</td>
              <td className="px-4 py-3"><CategoryBadge category={c.category} /></td>
              <td className="px-4 py-3">
                {c.savedInPhone ? (
                  <span className="flex items-center gap-1 text-emerald-400 text-xs"><CheckCircle2 className="h-3.5 w-3.5" /> Saved</span>
                ) : (
                  <span className="flex items-center gap-1 text-rose-400 text-xs"><AlertCircle className="h-3.5 w-3.5" /> Not Saved</span>
                )}
              </td>
              <td className="px-4 py-3 text-slate-500 text-xs">
                {c.identifiedAt ? format(new Date(c.identifiedAt), "MMM d, yyyy HH:mm") : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Unknown Numbers Tab ──────────────────────────────────────────────────────

const TRACKER_STATUS_COLORS: Record<string, string> = {
  tracking: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  awaiting_name: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  awaiting_category: "bg-purple-500/15 text-purple-300 border-purple-500/30",
  identified: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
};

function UnknownNumbersTab({ trackers }: { trackers: any[] }) {
  if (trackers.length === 0)
    return <div className="text-center text-slate-500 py-16 text-sm">No unknown numbers with 3+ calls yet.</div>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-800 bg-slate-950/50">
            {["Employee", "Phone", "Call Count", "Status", "First Seen", "Last Seen"].map((h) => (
              <th key={h} className="text-left px-4 py-3 text-slate-400 font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {trackers.map((t: any) => (
            <tr key={t._id} className="border-b border-slate-800 hover:bg-slate-800/40">
              <td className="px-4 py-3 text-slate-300 font-medium">{t.employeeName}</td>
              <td className="px-4 py-3 font-mono text-slate-300 text-xs">{t.phoneNumber}</td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <div className="h-1.5 w-16 bg-slate-700 rounded-full overflow-hidden">
                    <div className={cn("h-full rounded-full", t.callCount >= 5 ? "bg-rose-500" : "bg-amber-500")}
                      style={{ width: `${Math.min(100, (t.callCount / 5) * 100)}%` }} />
                  </div>
                  <span className={cn("font-bold text-xs", t.callCount >= 5 ? "text-rose-400" : "text-slate-300")}>
                    {t.callCount} / 5
                  </span>
                </div>
              </td>
              <td className="px-4 py-3">
                <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border",
                  TRACKER_STATUS_COLORS[t.status] ?? "bg-slate-700 text-slate-300 border-slate-600")}>
                  {t.status.replace(/_/g, " ")}
                </span>
              </td>
              <td className="px-4 py-3 text-slate-500 text-xs">{t.firstSeen ? format(new Date(t.firstSeen), "MMM d, yyyy") : "—"}</td>
              <td className="px-4 py-3 text-slate-500 text-xs">{t.lastSeen ? format(new Date(t.lastSeen), "MMM d, yyyy HH:mm") : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Compliance Tab ───────────────────────────────────────────────────────────

function ComplianceTab({ contacts, onRemind, reminderLoading }: {
  contacts: any[];
  onRemind: (id: string) => void;
  reminderLoading: string | null;
}) {
  if (contacts.length === 0)
    return <div className="text-center text-slate-500 py-16 text-sm">🎉 All identified contacts have been saved in phone. Great compliance!</div>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-800 bg-slate-950/50">
            {["Employee", "Phone", "Name", "Category", "Saved in Phone", "Action"].map((h) => (
              <th key={h} className="text-left px-4 py-3 text-slate-400 font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {contacts.map((c: any) => (
            <tr key={c._id} className="border-b border-slate-800 hover:bg-slate-800/40">
              <td className="px-4 py-3 text-slate-300 font-medium">{c.employeeName}</td>
              <td className="px-4 py-3 font-mono text-slate-300 text-xs">{c.phoneNumber}</td>
              <td className="px-4 py-3 text-slate-200">{c.contactName || "—"}</td>
              <td className="px-4 py-3"><CategoryBadge category={c.category} /></td>
              <td className="px-4 py-3"><span className="flex items-center gap-1 text-rose-400 text-xs"><AlertCircle className="h-3.5 w-3.5" /> ❌ Not Saved</span></td>
              <td className="px-4 py-3">
                <button onClick={() => onRemind(c._id)} disabled={reminderLoading === c._id}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-300 text-xs font-medium transition-colors disabled:opacity-50">
                  {reminderLoading === c._id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                  Send Reminder
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
