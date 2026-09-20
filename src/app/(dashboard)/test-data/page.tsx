"use client";

import { useState, useEffect } from "react";
import { Trash2, AlertCircle, Loader2, CheckCircle2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function TestDataPage() {
  const [employees, setEmployees] = useState<string[]>([]);
  const [linkedEmployees, setLinkedEmployees] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedEmployee, setSelectedEmployee] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [running, setRunning] = useState(false);
  const [isLocalHost, setIsLocalHost] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    fetchEmployees();
    setIsLocalHost(window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
  }, []);

  const fetchEmployees = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/test-data");
      const data = await res.json();
      if (res.ok && data.employees) {
        setEmployees(data.employees);
        setLinkedEmployees(data.linkedEmployees ?? []);
      } else {
        setMessage({ type: "error", text: data.error || "Failed to load employees" });
      }
    } catch (error) {
      console.error(error);
      setMessage({ type: "error", text: "Network error loading employees" });
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedEmployee) return;

    if (!confirm(`Delete ALL call logs, identified contacts, and Telegram trackers for "${selectedEmployee}"? The bot can send fresh prompts afterwards. This cannot be undone.`)) {
      return;
    }

    try {
      setDeleting(true);
      setMessage(null);
      
      const res = await fetch("/api/test-data", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeName: selectedEmployee }),
      });
      
      const data = await res.json();
      
      if (res.ok && data.success) {
        setMessage({ type: "success", text: data.message });
        // Instead of removing from list, we keep it but it will have 0 logs if checked. 
        // Or we could re-fetch assuming logs are gone. Let's re-fetch.
        fetchEmployees();
        setSelectedEmployee("");
      } else {
        setMessage({ type: "error", text: data.error || "Failed to delete" });
      }
    } catch (error) {
      console.error(error);
      setMessage({ type: "error", text: "Network error during deletion" });
    } finally {
      setDeleting(false);
    }
  };

  const linked = new Set(linkedEmployees.map((name) => name.toLowerCase()));
  const selectedIsLinked = linked.has(selectedEmployee.toLowerCase());

  const handleRunTelegram = async () => {
    if (!selectedEmployee) return;
    if (!selectedIsLinked) {
      setMessage({
        type: "error",
        text: "Link this employee in Telegram Setup first, then send /start and their phone number to the bot.",
      });
      return;
    }
    if (!confirm(`Send Scenario A and Scenario B test messages to ${selectedEmployee}'s Telegram now?`)) {
      return;
    }

    try {
      setRunning(true);
      setMessage(null);
      const res = await fetch("/api/test-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeName: selectedEmployee }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setMessage({ type: "success", text: data.message });
      } else {
        setMessage({ type: "error", text: data.message || data.error || "Telegram test failed" });
      }
    } catch (error) {
      console.error(error);
      setMessage({ type: "error", text: "Network error while sending the Telegram test" });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white mb-1">
            Manage Test Data
          </h1>
          <p className="text-slate-400">
            Clear an employee so Telegram can send again, or push both scenarios into their chat.
          </p>
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
        <div className="p-6 border-b border-slate-800 bg-slate-800/50">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Trash2 className="w-5 h-5 text-red-400" />
            Delete Employee Call Logs
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Delete also clears identified contacts and unknown-number trackers, so the bot is not stuck on an old prompt. Run both scenarios only for an employee marked Telegram linked. It sends two test numbers into that chat: 0001110001 (known contact) and 0001110002 (unknown, 5 calls).
          </p>
        </div>

        <div className="p-6">
          {message && (
            <div className={`p-4 rounded-lg mb-6 flex items-start gap-3 ${
              message.type === "success" 
                ? "bg-green-500/10 border border-green-500/20 text-green-400" 
                : "bg-red-500/10 border border-red-500/20 text-red-400"
            }`}>
              {message.type === "success" ? (
                <CheckCircle2 className="w-5 h-5 flex-shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
              )}
              <div className="text-sm">{message.text}</div>
            </div>
          )}

          {loading ? (
            <div className="flex items-center gap-2 text-slate-400">
              <Loader2 className="w-5 h-5 animate-spin" />
              Loading employees...
            </div>
          ) : employees.length === 0 ? (
            <div className="text-slate-400 py-4">No employees found.</div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Select Employee
                </label>
                <select
                  value={selectedEmployee}
                  onChange={(e) => setSelectedEmployee(e.target.value)}
                  className="w-full max-w-sm bg-slate-950 border border-slate-800 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="" disabled>-- Select an employee --</option>
                  {employees.map((emp) => (
                    <option key={emp} value={emp}>
                      {emp}{linked.has(emp.toLowerCase()) ? " — Telegram linked" : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div className="pt-4 border-t border-slate-800 flex flex-wrap gap-3">
                <Button
                  variant="secondary"
                  disabled={!selectedEmployee || !selectedIsLinked || running || deleting}
                  onClick={handleRunTelegram}
                  className="flex items-center gap-2"
                >
                  {running ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Sending to Telegram...
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4" />
                      Run both scenarios in Telegram
                    </>
                  )}
                </Button>
                <Button
                  variant="destructive"
                  disabled={!selectedEmployee || deleting || running}
                  onClick={handleDelete}
                  className="flex items-center gap-2"
                >
                  {deleting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Deleting...
                    </>
                  ) : (
                    <>
                      <Trash2 className="w-4 h-4" />
                      Delete All Data for '{selectedEmployee || '...'}'
                    </>
                  )}
                </Button>
              </div>
              {isLocalHost && (
                <p className="text-xs text-amber-400">
                  Telegram cannot call localhost. Run this button on the deployed site so the chat buttons update the same database the bot uses.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
