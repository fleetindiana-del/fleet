"use client";

import { useState, useEffect, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2, Plus, QrCode, X, Copy, Check, RefreshCw, Clock, Pencil } from "lucide-react";
import { format } from "date-fns";

interface EnrollmentCode {
  _id: string;
  code: string;
  employeeName?: string;
  employeeId?: string;
  role: "driver" | "employee";
  departmentId?: string | { _id: string; name: string };
  vehicle?: string | { id?: string; registration?: string };
  capabilities?: {
    callMonitoring?: boolean;
    locationTracking?: boolean;
    expenseManagement?: boolean;
    shifts?: boolean;
  } | string[];
  deviceSetupStatus?: "pending" | "installed";
  expiresAt?: string;
  usedAt?: string;
  revoked: boolean;
  createdAt: string;
  driverId?: string;
  /** Sign-in username of the linked account, if this person has one. */
  loginUsername?: string;
}

const defaultForm = {
  employeeName: "",
  employeeId: "",
  role: "driver" as "driver" | "employee",
  departmentId: "",
  vehicle: "",
  username: "",
  password: "",
  callMonitoring: true,
  locationTracking: true,
  expenseManagement: true,
  shifts: true,
  deviceSetupStatus: "pending" as "pending" | "installed",
  // Codes never expire unless the admin opts in.
  setExpiry: false,
  expiresInHours: 48,
};

export default function EnrollmentPage() {
  const [codes, setCodes] = useState<EnrollmentCode[]>([]);
  const [departments, setDepartments] = useState<Array<{ _id: string; name: string }>>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(defaultForm);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const fetchCodes = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/enrollment-codes");
      if (res.ok) setCodes(await res.json());
    } catch {}
    finally { setIsLoading(false); }
  }, []);

  const fetchDepartments = useCallback(async () => {
    try {
      const res = await fetch("/api/departments", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setDepartments(Array.isArray(data) ? data : []);
    } catch {}
  }, []);

  useEffect(() => { fetchCodes(); fetchDepartments(); }, [fetchCodes, fetchDepartments]);

  const handleSubmit = async () => {
    if (!form.employeeName.trim()) {
      setError("Employee name is required");
      return;
    }
    if (form.username.trim() && form.password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }
    if (form.password && !form.username.trim()) {
      setError("Username is required to set a password");
      return;
    }
    setIsSubmitting(true); setError("");
    try {
      const body = {
        employeeName: form.employeeName.trim(),
        employeeId: form.employeeId.trim(),
        role: form.role,
        departmentId: form.departmentId,
        vehicle: form.vehicle.trim(),
        username: form.username.trim(),
        password: form.password,
        // Omitted entirely unless an expiry was asked for — the API reads a
        // missing value as "never expires".
        expiresInHours: form.setExpiry ? form.expiresInHours : null,
        capabilities: {
          callMonitoring: form.callMonitoring,
          locationTracking: form.locationTracking,
          expenseManagement: form.expenseManagement,
          shifts: form.shifts,
        },
        deviceSetupStatus: form.deviceSetupStatus,
      };
      const res = await fetch("/api/enrollment-codes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      await fetchCodes();
      setShowForm(false);
      setForm(defaultForm);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  const copyCode = async (id: string, code: string) => {
    await navigator.clipboard.writeText(code).catch(() => {});
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const getCodeStatus = (c: EnrollmentCode) => {
    if (c.revoked) return { label: "Revoked", cls: "border-slate-600 text-slate-400 bg-slate-500/10" };
    if (c.usedAt) return { label: "Used", cls: "border-emerald-500/50 text-emerald-400 bg-emerald-500/10" };
    if (c.expiresAt && new Date(c.expiresAt) < new Date()) return { label: "Expired", cls: "border-rose-500/50 text-rose-400 bg-rose-500/10" };
    return { label: "Active", cls: "border-indigo-500/50 text-indigo-400 bg-indigo-500/10" };
  };

  // A redeemed code (usedAt set) means the handset actually enrolled, which is
  // stronger evidence than whatever the admin picked when the code was made.
  const getDeviceSetupStatus = (c: EnrollmentCode) => {
    if (c.usedAt || c.deviceSetupStatus === "installed") {
      return { label: "Installed", cls: "border-emerald-500/50 text-emerald-400 bg-emerald-500/10" };
    }
    return { label: "Pending", cls: "border-amber-500/50 text-amber-400 bg-amber-500/10" };
  };

  const departmentName = (c: EnrollmentCode) =>
    typeof c.departmentId === "object" && c.departmentId ? c.departmentId.name : "—";

  const accessLabels = (c: EnrollmentCode) => {
    const caps = c.capabilities;
    if (!caps || Array.isArray(caps)) return [];
    const labels: string[] = [];
    if (caps.shifts ?? caps.locationTracking) labels.push("Shifts");
    if (caps.expenseManagement) labels.push("Expenses");
    if (caps.locationTracking) labels.push("Location Tracking");
    if (caps.callMonitoring) labels.push("Call Logs");
    return labels;
  };

  // ── Edit ────────────────────────────────────────────────────────────────
  const [editing, setEditing] = useState<EnrollmentCode | null>(null);
  const [editForm, setEditForm] = useState(defaultForm);
  const [editExpiryMode, setEditExpiryMode] = useState<"keep" | "never" | "hours">("never");
  const [editRevoked, setEditRevoked] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editError, setEditError] = useState("");

  const capsOf = (c: EnrollmentCode) => {
    const caps = c.capabilities;
    if (caps && !Array.isArray(caps)) {
      return {
        callMonitoring: Boolean(caps.callMonitoring),
        locationTracking: Boolean(caps.locationTracking),
        expenseManagement: Boolean(caps.expenseManagement),
        // Codes saved before `shifts` existed: shifts rode on location tracking.
        shifts: caps.shifts === undefined ? Boolean(caps.locationTracking) : Boolean(caps.shifts),
      };
    }
    const lower = (Array.isArray(caps) ? caps : []).map((s) => String(s).toLowerCase());
    return {
      callMonitoring: lower.some((s) => s.includes("call")) || lower.length === 0,
      locationTracking: lower.some((s) => s.includes("location") || s.includes("gps")),
      expenseManagement: lower.some((s) => s.includes("expense")),
      shifts: lower.some((s) => s.includes("shift")) || lower.some((s) => s.includes("location") || s.includes("gps")),
    };
  };

  const openEdit = (c: EnrollmentCode) => {
    setEditing(c);
    setEditError("");
    setEditRevoked(Boolean(c.revoked));
    setEditExpiryMode(c.expiresAt ? "keep" : "never");
    setEditForm({
      ...defaultForm,
      employeeName: c.employeeName ?? "",
      employeeId: c.employeeId ?? "",
      role: c.role ?? "driver",
      departmentId: typeof c.departmentId === "object" && c.departmentId ? c.departmentId._id : ((c.departmentId as string) ?? ""),
      vehicle: typeof c.vehicle === "string" ? c.vehicle : (c.vehicle?.registration || c.vehicle?.id || ""),
      username: c.loginUsername ?? "",
      password: "",
      ...capsOf(c),
      deviceSetupStatus: c.deviceSetupStatus === "installed" ? "installed" : "pending",
      setExpiry: Boolean(c.expiresAt),
      expiresInHours: 48,
    });
  };

  const handleEditSave = async () => {
    if (!editing) return;
    if (!editForm.employeeName.trim()) {
      setEditError("Employee name is required");
      return;
    }
    if (editForm.password && !editForm.username.trim()) {
      setEditError("Username is required to set a password");
      return;
    }
    if (editForm.password && editForm.password.length < 6) {
      setEditError("Password must be at least 6 characters");
      return;
    }
    if (!editing.loginUsername && editForm.username.trim() && !editForm.password) {
      setEditError("Set a password to create this person's sign-in");
      return;
    }
    setIsSaving(true); setEditError("");
    try {
      const expiresAt =
        editExpiryMode === "never"
          ? null
          : editExpiryMode === "keep"
            ? (editing.expiresAt ?? null)
            : new Date(Date.now() + editForm.expiresInHours * 60 * 60 * 1000).toISOString();
      const res = await fetch("/api/enrollment-codes", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editing._id,
          employeeName: editForm.employeeName.trim(),
          employeeId: editForm.employeeId.trim(),
          role: editForm.role,
          departmentId: editForm.departmentId,
          vehicle: editForm.vehicle.trim(),
          username: editForm.username.trim(),
          password: editForm.password,
          capabilities: {
            callMonitoring: editForm.callMonitoring,
            locationTracking: editForm.locationTracking,
            expenseManagement: editForm.expenseManagement,
            shifts: editForm.shifts,
          },
          deviceSetupStatus: editForm.deviceSetupStatus,
          revoked: editRevoked,
          expiresAt,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      await fetchCodes();
      setEditing(null);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Failed");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-md shadow-2xl space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-white">Generate Enrollment Code</h2>
              <button onClick={() => setShowForm(false)} className="p-2 rounded-full hover:bg-slate-800 text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-sm text-slate-300">Employee Name</label>
                  <Input
                    placeholder="e.g. Ravi Kumar"
                    value={form.employeeName}
                    onChange={(e) => setForm((f) => ({ ...f, employeeName: e.target.value }))}
                    className="bg-slate-950 border-slate-700 text-slate-200 placeholder:text-slate-600"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm text-slate-300">Employee ID</label>
                  <Input
                    placeholder="e.g. EMP001"
                    value={form.employeeId}
                    onChange={(e) => setForm((f) => ({ ...f, employeeId: e.target.value }))}
                    className="bg-slate-950 border-slate-700 text-slate-200 placeholder:text-slate-600"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-sm text-slate-300">Type</label>
                  <select
                    value={form.role}
                    onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as "driver" | "employee" }))}
                    className="w-full h-10 rounded-md bg-slate-950 border border-slate-700 text-slate-200 px-3 text-sm"
                  >
                    <option value="driver">Driver</option>
                    <option value="employee">Staff</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-sm text-slate-300">Department</label>
                  <select
                    value={form.departmentId}
                    onChange={(e) => setForm((f) => ({ ...f, departmentId: e.target.value }))}
                    className="w-full h-10 rounded-md bg-slate-950 border border-slate-700 text-slate-200 px-3 text-sm"
                  >
                    <option value="">No department</option>
                    {departments.map((d) => (
                      <option key={d._id} value={d._id}>{d.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-sm text-slate-300">Vehicle</label>
                <Input
                  placeholder="e.g. MH12AB1234"
                  value={form.vehicle}
                  onChange={(e) => setForm((f) => ({ ...f, vehicle: e.target.value }))}
                  className="bg-slate-950 border-slate-700 text-slate-200 placeholder:text-slate-600"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm text-slate-300">Access / Permissions</label>
                <label className="flex items-center gap-2 text-sm text-slate-200">
                  <input
                    type="checkbox"
                    checked={form.shifts}
                    onChange={(e) => setForm((f) => ({ ...f, shifts: e.target.checked }))}
                  />
                  Shifts
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-200">
                  <input
                    type="checkbox"
                    checked={form.expenseManagement}
                    onChange={(e) => setForm((f) => ({ ...f, expenseManagement: e.target.checked }))}
                  />
                  Expenses
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-200">
                  <input
                    type="checkbox"
                    checked={form.locationTracking}
                    onChange={(e) => setForm((f) => ({ ...f, locationTracking: e.target.checked }))}
                  />
                  Location Tracking
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-200">
                  <input
                    type="checkbox"
                    checked={form.callMonitoring}
                    onChange={(e) => setForm((f) => ({ ...f, callMonitoring: e.target.checked }))}
                  />
                  Call Logs
                </label>
              </div>
              <div className="space-y-1">
                <label className="text-sm text-slate-300">Device Setup Status</label>
                <select
                  value={form.deviceSetupStatus}
                  onChange={(e) => setForm((f) => ({ ...f, deviceSetupStatus: e.target.value as "pending" | "installed" }))}
                  className="w-full h-10 rounded-md bg-slate-950 border border-slate-700 text-slate-200 px-3 text-sm"
                >
                  <option value="pending">Pending — not yet installed</option>
                  <option value="installed">Installed — device configured</option>
                </select>
              </div>
              <div className="space-y-2 pt-1 border-t border-slate-800">
                <label className="text-sm text-slate-300">
                  Sign-in credentials <span className="text-slate-500">(optional)</span>
                </label>
                <p className="text-xs text-slate-500 -mt-1">
                  Creates a login so this person can sign in by hand and re-authenticate on a replacement device.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs text-slate-400">Username</label>
                    <Input
                      autoComplete="off"
                      placeholder="e.g. ravi.kumar"
                      value={form.username}
                      onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                      className="bg-slate-950 border-slate-700 text-slate-200 placeholder:text-slate-600"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-slate-400">Password</label>
                    <Input
                      type="password"
                      autoComplete="new-password"
                      placeholder="min. 6 characters"
                      value={form.password}
                      onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                      className="bg-slate-950 border-slate-700 text-slate-200 placeholder:text-slate-600"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-2 pt-1 border-t border-slate-800">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <label className="text-sm text-slate-300">Expiry</label>
                    <p className="text-xs text-slate-500">
                      {form.setExpiry ? "Code stops working after the set time." : "Code never expires — valid until used or revoked."}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setForm((f) => ({ ...f, setExpiry: !f.setExpiry }))}
                    className={
                      form.setExpiry
                        ? "border-indigo-500/60 text-indigo-300 bg-indigo-500/10 hover:bg-indigo-500/20"
                        : "border-slate-600 text-slate-300 bg-transparent hover:bg-slate-800"
                    }
                  >
                    <Clock className="w-4 h-4 mr-2" />
                    {form.setExpiry ? "Expiry on" : "Set expiry"}
                  </Button>
                </div>
                {form.setExpiry && (
                  <div className="space-y-1">
                    <label className="text-xs text-slate-400">Expires in (hours)</label>
                    <Input
                      type="number"
                      min={1}
                      value={form.expiresInHours}
                      onChange={(e) => setForm((f) => ({ ...f, expiresInHours: parseInt(e.target.value) || 48 }))}
                      className="bg-slate-950 border-slate-700 text-slate-200"
                    />
                  </div>
                )}
              </div>
            </div>

            {error && <p className="text-sm text-rose-400">{error}</p>}

            <div className="flex gap-3">
              <Button variant="outline" className="flex-1 border-slate-600 text-slate-300 bg-transparent" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white" onClick={handleSubmit} disabled={isSubmitting}>
                {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <QrCode className="w-4 h-4 mr-2" />}
                Generate Code
              </Button>
            </div>
          </div>
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-md shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-white">
                Edit Enrollment <span className="font-mono text-indigo-300 tracking-widest">{editing.code}</span>
              </h2>
              <button onClick={() => setEditing(null)} className="p-2 rounded-full hover:bg-slate-800 text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-sm text-slate-300">Employee Name</label>
                  <Input
                    value={editForm.employeeName}
                    onChange={(e) => setEditForm((f) => ({ ...f, employeeName: e.target.value }))}
                    className="bg-slate-950 border-slate-700 text-slate-200 placeholder:text-slate-600"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm text-slate-300">Employee ID</label>
                  <Input
                    value={editForm.employeeId}
                    onChange={(e) => setEditForm((f) => ({ ...f, employeeId: e.target.value }))}
                    className="bg-slate-950 border-slate-700 text-slate-200 placeholder:text-slate-600"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-sm text-slate-300">Type</label>
                  <select
                    value={editForm.role}
                    onChange={(e) => setEditForm((f) => ({ ...f, role: e.target.value as "driver" | "employee" }))}
                    className="w-full h-10 rounded-md bg-slate-950 border border-slate-700 text-slate-200 px-3 text-sm"
                  >
                    <option value="driver">Driver</option>
                    <option value="employee">Staff</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-sm text-slate-300">Department</label>
                  <select
                    value={editForm.departmentId}
                    onChange={(e) => setEditForm((f) => ({ ...f, departmentId: e.target.value }))}
                    className="w-full h-10 rounded-md bg-slate-950 border border-slate-700 text-slate-200 px-3 text-sm"
                  >
                    <option value="">No department</option>
                    {departments.map((d) => (
                      <option key={d._id} value={d._id}>{d.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-sm text-slate-300">Vehicle</label>
                <Input
                  placeholder="e.g. MH12AB1234"
                  value={editForm.vehicle}
                  onChange={(e) => setEditForm((f) => ({ ...f, vehicle: e.target.value }))}
                  className="bg-slate-950 border-slate-700 text-slate-200 placeholder:text-slate-600"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm text-slate-300">Access / Permissions</label>
                <label className="flex items-center gap-2 text-sm text-slate-200">
                  <input
                    type="checkbox"
                    checked={editForm.shifts}
                    onChange={(e) => setEditForm((f) => ({ ...f, shifts: e.target.checked }))}
                  />
                  Shifts
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-200">
                  <input
                    type="checkbox"
                    checked={editForm.expenseManagement}
                    onChange={(e) => setEditForm((f) => ({ ...f, expenseManagement: e.target.checked }))}
                  />
                  Expenses
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-200">
                  <input
                    type="checkbox"
                    checked={editForm.locationTracking}
                    onChange={(e) => setEditForm((f) => ({ ...f, locationTracking: e.target.checked }))}
                  />
                  Location Tracking
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-200">
                  <input
                    type="checkbox"
                    checked={editForm.callMonitoring}
                    onChange={(e) => setEditForm((f) => ({ ...f, callMonitoring: e.target.checked }))}
                  />
                  Call Logs
                </label>
                <p className="text-xs text-slate-500">
                  A new name or password is what the phone asks for the next time the app is opened.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-sm text-slate-300">Device Setup Status</label>
                  <select
                    value={editForm.deviceSetupStatus}
                    onChange={(e) => setEditForm((f) => ({ ...f, deviceSetupStatus: e.target.value as "pending" | "installed" }))}
                    className="w-full h-10 rounded-md bg-slate-950 border border-slate-700 text-slate-200 px-3 text-sm"
                  >
                    <option value="pending">Pending — not yet installed</option>
                    <option value="installed">Installed — device configured</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-sm text-slate-300">Code Status</label>
                  <label className="flex h-10 items-center gap-2 text-sm text-slate-200">
                    <input
                      type="checkbox"
                      checked={editRevoked}
                      onChange={(e) => setEditRevoked(e.target.checked)}
                    />
                    Revoked (can&apos;t enroll)
                  </label>
                </div>
              </div>

              <div className="space-y-2 pt-1 border-t border-slate-800">
                <label className="text-sm text-slate-300">
                  Sign-in credentials{" "}
                  <span className="text-slate-500">({editing.loginUsername ? "this person has an account" : "no account yet — optional"})</span>
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs text-slate-400">Username</label>
                    <Input
                      autoComplete="off"
                      value={editForm.username}
                      onChange={(e) => setEditForm((f) => ({ ...f, username: e.target.value }))}
                      className="bg-slate-950 border-slate-700 text-slate-200 placeholder:text-slate-600"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-slate-400">Password</label>
                    <Input
                      type="password"
                      autoComplete="new-password"
                      placeholder={editing.loginUsername ? "Leave blank to keep" : "min. 6 characters"}
                      value={editForm.password}
                      onChange={(e) => setEditForm((f) => ({ ...f, password: e.target.value }))}
                      className="bg-slate-950 border-slate-700 text-slate-200 placeholder:text-slate-600"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-2 pt-1 border-t border-slate-800">
                <label className="text-sm text-slate-300">Expiry</label>
                <select
                  value={editExpiryMode}
                  onChange={(e) => setEditExpiryMode(e.target.value as "keep" | "never" | "hours")}
                  className="w-full h-10 rounded-md bg-slate-950 border border-slate-700 text-slate-200 px-3 text-sm"
                >
                  {editing.expiresAt && (
                    <option value="keep">Keep current — {format(new Date(editing.expiresAt), "MMM dd, HH:mm")}</option>
                  )}
                  <option value="never">Never expires</option>
                  <option value="hours">Expires in a set number of hours</option>
                </select>
                {editExpiryMode === "hours" && (
                  <div className="space-y-1">
                    <label className="text-xs text-slate-400">Expires in (hours, from saving)</label>
                    <Input
                      type="number"
                      min={1}
                      value={editForm.expiresInHours}
                      onChange={(e) => setEditForm((f) => ({ ...f, expiresInHours: parseInt(e.target.value) || 48 }))}
                      className="bg-slate-950 border-slate-700 text-slate-200"
                    />
                  </div>
                )}
              </div>
            </div>

            {editError && <p className="text-sm text-rose-400">{editError}</p>}

            <div className="flex gap-3">
              <Button variant="outline" className="flex-1 border-slate-600 text-slate-300 bg-transparent" onClick={() => setEditing(null)}>Cancel</Button>
              <Button className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white" onClick={handleEditSave} disabled={isSaving}>
                {isSaving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Check className="w-4 h-4 mr-2" />}
                Save Changes
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">Device Enrollment</h1>
          <p className="text-slate-400 mt-1">Generate one-time codes to enroll driver Android devices.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="border-slate-700 text-slate-300 bg-transparent hover:bg-slate-800" onClick={fetchCodes} disabled={isLoading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? "animate-spin" : ""}`} /> Refresh
          </Button>
          <Button className="bg-indigo-600 hover:bg-indigo-700 text-white" onClick={() => { setError(""); setForm(defaultForm); setShowForm(true); }}>
            <Plus className="w-4 h-4 mr-2" /> New Code
          </Button>
        </div>
      </div>

      <Card className="bg-slate-900 border-slate-800 text-slate-100 overflow-x-auto">
        <Table>
          <TableHeader className="bg-slate-950/50">
            <TableRow className="border-slate-800">
              <TableHead className="text-slate-400">Code</TableHead>
              <TableHead className="text-slate-400">Employee</TableHead>
              <TableHead className="text-slate-400">Type</TableHead>
              <TableHead className="text-slate-400">Department</TableHead>
              <TableHead className="text-slate-400">Access</TableHead>
              <TableHead className="text-slate-400">Vehicle</TableHead>
              <TableHead className="text-slate-400">Device Setup</TableHead>
              <TableHead className="text-slate-400">Status</TableHead>
              <TableHead className="text-slate-400">Expires</TableHead>
              <TableHead className="text-slate-400">Used At</TableHead>
              <TableHead className="text-slate-400">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={11} className="h-32 text-center">
                  <Loader2 className="h-6 w-6 animate-spin mx-auto text-indigo-500" />
                </TableCell>
              </TableRow>
            ) : codes.length === 0 ? (
              <TableRow>
                <TableCell colSpan={11} className="h-32 text-center">
                  <div className="flex flex-col items-center gap-2 text-slate-500">
                    <QrCode className="w-8 h-8" />
                    <p>No enrollment codes yet.</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : codes.map((c) => {
              const { label, cls } = getCodeStatus(c);
              const setup = getDeviceSetupStatus(c);
              const access = accessLabels(c);
              return (
                <TableRow key={c._id} className="border-slate-800 hover:bg-slate-800/40">
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-indigo-300 text-lg tracking-widest">{c.code}</span>
                      <button
                        onClick={() => copyCode(c._id, c.code)}
                        className="text-slate-500 hover:text-slate-300 transition-colors"
                        title="Copy code"
                      >
                        {copiedId === c._id ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                      </button>
                    </div>
                  </TableCell>
                  <TableCell className="text-slate-300">
                    <div>
                      {c.employeeName && <p className="font-medium text-white">{c.employeeName}</p>}
                      {c.employeeId && <p className="text-xs text-slate-500">{c.employeeId}</p>}
                      {!c.employeeName && !c.employeeId && <span className="text-slate-600">—</span>}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={c.role === "driver" ? "border-amber-500/50 text-amber-400 bg-amber-500/10" : "border-cyan-500/50 text-cyan-400 bg-cyan-500/10"}>
                      {c.role === "driver" ? "Driver" : "Staff"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-slate-300 text-sm">
                    {departmentName(c)}
                  </TableCell>
                  <TableCell>
                    {access.length === 0 ? (
                      <span className="text-slate-600">—</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {access.map((a) => (
                          <Badge key={a} variant="outline" className="border-slate-600 text-slate-300 bg-slate-500/10 text-xs">
                            {a}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-slate-400 font-mono text-sm">
                    {typeof c.vehicle === "string"
                      ? c.vehicle
                      : c.vehicle?.registration || c.vehicle?.id || <span className="text-slate-600">—</span>}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={setup.cls}>{setup.label}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={cls}>{label}</Badge>
                  </TableCell>
                  <TableCell className="text-slate-400 text-xs">
                    {c.expiresAt
                      ? format(new Date(c.expiresAt), "MMM dd, HH:mm")
                      : <span className="text-slate-500">Never</span>}
                  </TableCell>
                  <TableCell className="text-slate-400 text-xs">
                    {c.usedAt ? format(new Date(c.usedAt), "MMM dd, HH:mm") : <span className="text-slate-600">—</span>}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-slate-600 text-slate-200 bg-transparent hover:bg-slate-800"
                      onClick={() => openEdit(c)}
                    >
                      <Pencil className="w-3.5 h-3.5 mr-1.5" /> Edit
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
