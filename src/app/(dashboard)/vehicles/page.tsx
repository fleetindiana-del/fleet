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
import { Loader2, Plus, Car, X, Pencil, Trash2 } from "lucide-react";
import { formatKm } from "@/lib/incomeExpenseFormat";

interface Vehicle {
  _id: string;
  registration: string;
  make?: string;
  model?: string;
  status: "active" | "inactive";
  odometerKm?: number | null;
  lastRunKm?: number | null;
  createdAt: string;
}

const emptyForm: { registration: string; make: string; model: string; status: "active" | "inactive"; odometer: string } = {
  registration: "",
  make: "",
  model: "",
  status: "active",
  odometer: "",
};

export default function VehiclesPage() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editVehicle, setEditVehicle] = useState<Vehicle | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const fetchVehicles = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/vehicles");
      if (res.ok) setVehicles(await res.json());
    } catch {}
    finally { setIsLoading(false); }
  }, []);

  useEffect(() => { fetchVehicles(); }, [fetchVehicles]);

  const openCreate = () => { setEditVehicle(null); setForm(emptyForm); setError(""); setShowForm(true); };
  const openEdit = (v: Vehicle) => {
    setEditVehicle(v);
    setForm({
      registration: v.registration,
      make: v.make ?? "",
      model: v.model ?? "",
      status: v.status,
      odometer: typeof v.odometerKm === "number" ? String(v.odometerKm) : "",
    });
    setError("");
    setShowForm(true);
  };
  const closeForm = () => setShowForm(false);

  const handleSubmit = async () => {
    if (!form.registration.trim()) { setError("Registration is required"); return; }
    const odometerKm = form.odometer.trim() === "" ? null : Number(form.odometer);
    if (odometerKm !== null && (!Number.isFinite(odometerKm) || odometerKm < 0)) {
      setError("Enter the odometer in kilometers.");
      return;
    }
    setIsSubmitting(true); setError("");
    try {
      const url = editVehicle ? `/api/vehicles/${editVehicle._id}` : "/api/vehicles";
      const method = editVehicle ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          registration: form.registration,
          make: form.make,
          model: form.model,
          status: form.status,
          odometerKm,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      await fetchVehicles();
      closeForm();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this vehicle?")) return;
    try {
      const res = await fetch(`/api/vehicles/${id}`, { method: "DELETE" });
      if (res.ok) setVehicles((prev) => prev.filter((v) => v._id !== id));
    } catch {}
  };

  return (
    <div className="space-y-6">
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-md shadow-2xl space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-white">{editVehicle ? "Edit Vehicle" : "Add Vehicle"}</h2>
              <button onClick={closeForm} className="p-2 rounded-full hover:bg-slate-800 text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-sm text-slate-300">Registration *</label>
                <Input
                  placeholder="e.g. MH12AB1234"
                  value={form.registration}
                  onChange={(e) => setForm((f) => ({ ...f, registration: e.target.value }))}
                  className="bg-slate-950 border-slate-700 text-slate-200 placeholder:text-slate-600"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-sm text-slate-300">Make</label>
                  <Input
                    placeholder="e.g. Toyota"
                    value={form.make}
                    onChange={(e) => setForm((f) => ({ ...f, make: e.target.value }))}
                    className="bg-slate-950 border-slate-700 text-slate-200 placeholder:text-slate-600"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm text-slate-300">Model</label>
                  <Input
                    placeholder="e.g. Innova"
                    value={form.model}
                    onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
                    className="bg-slate-950 border-slate-700 text-slate-200 placeholder:text-slate-600"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-sm text-slate-300">Odometer (km)</label>
                <Input
                  inputMode="decimal"
                  placeholder="e.g. 45210"
                  value={form.odometer}
                  onChange={(e) => setForm((f) => ({ ...f, odometer: e.target.value.replace(/[^\d.]/g, "") }))}
                  className="bg-slate-950 border-slate-700 text-slate-200 placeholder:text-slate-600"
                />
                <p className="text-xs text-slate-500">A petrol expense moves this forward and records the kilometers of that run.</p>
              </div>
              <div className="space-y-1">
                <label className="text-sm text-slate-300">Status</label>
                <select
                  value={form.status}
                  onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as "active" | "inactive" }))}
                  className="w-full h-10 rounded-md bg-slate-950 border border-slate-700 text-slate-200 px-3 text-sm"
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
            </div>

            {error && <p className="text-sm text-rose-400">{error}</p>}

            <div className="flex gap-3">
              <Button variant="outline" className="flex-1 border-slate-600 text-slate-300 bg-transparent" onClick={closeForm}>Cancel</Button>
              <Button className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white" onClick={handleSubmit} disabled={isSubmitting}>
                {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                {editVehicle ? "Save Changes" : "Add Vehicle"}
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">Vehicles</h1>
          <p className="text-slate-400 mt-1">Manage your fleet vehicles and assignments.</p>
        </div>
        <Button className="bg-indigo-600 hover:bg-indigo-700 text-white" onClick={openCreate}>
          <Plus className="w-4 h-4 mr-2" /> Add Vehicle
        </Button>
      </div>

      <Card className="bg-slate-900 border-slate-800 text-slate-100">
        <Table>
          <TableHeader className="bg-slate-950/50">
            <TableRow className="border-slate-800">
              <TableHead className="text-slate-400">Registration</TableHead>
              <TableHead className="text-slate-400">Make / Model</TableHead>
              <TableHead className="text-slate-400">Odometer</TableHead>
              <TableHead className="text-slate-400">Status</TableHead>
              <TableHead className="text-slate-400 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="h-32 text-center">
                  <Loader2 className="h-6 w-6 animate-spin mx-auto text-indigo-500" />
                </TableCell>
              </TableRow>
            ) : vehicles.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-32 text-center">
                  <div className="flex flex-col items-center gap-2 text-slate-500">
                    <Car className="w-8 h-8" />
                    <p>No vehicles yet. Add your first vehicle.</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : vehicles.map((v) => (
              <TableRow key={v._id} className="border-slate-800 hover:bg-slate-800/40">
                <TableCell className="font-mono font-semibold text-white">{v.registration}</TableCell>
                <TableCell className="text-slate-300">{[v.make, v.model].filter(Boolean).join(" ") || <span className="text-slate-600">—</span>}</TableCell>
                <TableCell>
                  <div className="tabular-nums text-slate-100">{formatKm(v.odometerKm)}</div>
                  {typeof v.lastRunKm === "number" && (
                    <div className="text-xs text-emerald-400">Last run {formatKm(v.lastRunKm)}</div>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className={v.status === "active" ? "border-emerald-500/50 text-emerald-400 bg-emerald-500/10" : "border-rose-500/50 text-rose-400 bg-rose-500/10"}>
                    {v.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="outline" className="border-slate-700 text-slate-300 bg-transparent hover:bg-slate-800" onClick={() => openEdit(v)}>
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button size="sm" variant="outline" className="border-rose-700/50 text-rose-400 bg-transparent hover:bg-rose-500/10" onClick={() => handleDelete(v._id)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
