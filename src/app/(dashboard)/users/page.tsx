"use client";

import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UserPlus, Loader2, Edit2, Trash2, ShieldAlert, Wallet, Plus, X, Users, Sparkles } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

/** What the Android app may do once this user signs in on a handset. */
type Capabilities = {
  callMonitoring: boolean;
  locationTracking: boolean;
  expenseManagement: boolean;
  shifts: boolean;
};

const DEFAULT_CAPABILITIES: Capabilities = {
  callMonitoring: true,
  locationTracking: false,
  expenseManagement: false,
  shifts: false,
};

const CAPABILITY_LABELS: Array<{ key: keyof Capabilities; label: string; hint: string }> = [
  { key: "shifts", label: "Shifts", hint: "Works scheduled shifts with GPS monitoring" },
  { key: "expenseManagement", label: "Expenses", hint: "Submit expense claims and wallet" },
  { key: "locationTracking", label: "Location tracking", hint: "Record GPS routes on shift" },
  { key: "callMonitoring", label: "Call monitoring", hint: "Sync call logs and contacts" },
];

/**
 * Device capabilities picker. These used to be chosen per enrollment code; they
 * now live on the user, because a driver signs in with their own credentials and
 * there is no code to carry them.
 */
function CapabilityPicker({
  value,
  onChange,
  disabled,
}: {
  value: Capabilities;
  onChange: (next: Capabilities) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
        Device access
      </label>
      <div className="space-y-2 rounded-lg border border-slate-700/80 bg-slate-950/50 p-3">
        {CAPABILITY_LABELS.map(({ key, label, hint }) => (
          <label
            key={key}
            className={`flex items-start gap-3 ${disabled ? "opacity-50" : "cursor-pointer"}`}
          >
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 accent-indigo-500"
              checked={value[key]}
              disabled={disabled}
              onChange={(e) => onChange({ ...value, [key]: e.target.checked })}
            />
            <span className="leading-tight">
              <span className="block text-sm text-white">{label}</span>
              <span className="block text-xs text-slate-500">{hint}</span>
            </span>
          </label>
        ))}
        {disabled && (
          <p className="text-xs text-slate-500">
            Only driver and employee accounts sign in on a device.
          </p>
        )}
      </div>
    </div>
  );
}

export default function UsersPage() {
  const [users, setUsers] = useState<any[]>([]);
  const [departments, setDepartments] = useState<Array<{ _id: string; name: string }>>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [formData, setFormData] = useState({ name: "", email: "", username: "", password: "", role: "driver", departmentId: "" });
  const [capabilities, setCapabilities] = useState<Capabilities>(DEFAULT_CAPABILITIES);
  const [isCreating, setIsCreating] = useState(false);

  // Edit / Delete states
  const [editingUser, setEditingUser] = useState<any | null>(null);
  const [editFormData, setEditFormData] = useState({ name: "", email: "", username: "", password: "", role: "", departmentId: "" });
  const [editCapabilities, setEditCapabilities] = useState<Capabilities>(DEFAULT_CAPABILITIES);
  const [isUpdating, setIsUpdating] = useState(false);
  
  const [deletingUser, setDeletingUser] = useState<any | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Top-up Modal states
  const [topUpUser, setTopUpUser] = useState<any | null>(null);
  const [topUpAmount, setTopUpAmount] = useState("");
  const [topUpNote, setTopUpNote] = useState("");
  const [isSubmittingTopUp, setIsSubmittingTopUp] = useState(false);
  const [topUpError, setTopUpError] = useState("");

  useEffect(() => {
    fetchUsers();
    fetchDepartments();
  }, []);

  const fetchUsers = async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/users");
      if (res.ok) {
        const data = await res.json();
        setUsers(data);
      }
    } catch (error) {
    } finally {
      setIsLoading(false);
    }
  };

  const fetchDepartments = async () => {
    try {
      const res = await fetch("/api/departments", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setDepartments(Array.isArray(data) ? data : []);
    } catch (e) {
      // ignore
    }
  };

  const createUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsCreating(true);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...formData, capabilities }),
      });
      if (res.ok) {
        fetchUsers();
        setFormData({ name: "", email: "", username: "", password: "", role: "driver", departmentId: "" });
        setCapabilities(DEFAULT_CAPABILITIES);
      } else {
        const data = await res.json();
        alert(data.error || "Failed to create user");
      }
    } catch (error) {
      console.error(error);
    } finally {
      setIsCreating(false);
    }
  };

  const openEditModal = (user: any) => {
    setEditingUser(user);
    setEditFormData({ 
      name: user.name, 
      email: user.email, 
      username: user.username || "", 
      password: "", 
      role: user.role,
      departmentId: user.departmentId || user.department?._id || "",
    });
    // Users created before this field existed have no capabilities. Show them as
    // all-off, which is what the login endpoint will actually grant — not the
    // create-form default, which would misrepresent the device's real access.
    setEditCapabilities({
      callMonitoring: Boolean(user.capabilities?.callMonitoring),
      locationTracking: Boolean(user.capabilities?.locationTracking),
      expenseManagement: Boolean(user.capabilities?.expenseManagement),
      // Users saved before `shifts` existed: shifts rode on location tracking.
      shifts: user.capabilities?.shifts === undefined
        ? Boolean(user.capabilities?.locationTracking)
        : Boolean(user.capabilities.shifts),
    });
  };

  const updateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsUpdating(true);
    try {
      const res = await fetch("/api/users", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          _id: editingUser._id,
          ...editFormData,
          capabilities: editCapabilities,
        }),
      });
      if (res.ok) {
        setEditingUser(null);
        fetchUsers();
      } else {
        const data = await res.json();
        alert(data.error || "Failed to update user");
      }
    } catch (error) {
      console.error(error);
    } finally {
      setIsUpdating(false);
    }
  };

  const deleteUser = async () => {
    if (!deletingUser) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/users?id=${deletingUser._id}`, {
        method: "DELETE"
      });
      if (res.ok) {
        setDeletingUser(null);
        fetchUsers();
      } else {
         const data = await res.json();
         alert(data.error || "Failed to delete user");
      }
    } catch (error) {
       console.error(error);
    } finally {
       setIsDeleting(false);
    }
  };

  const openTopUpModal = (user: any) => {
    setTopUpUser(user);
    setTopUpAmount("");
    setTopUpNote("");
    setTopUpError("");
  };

  const handleTopUp = async () => {
    const amount = parseFloat(topUpAmount);
    if (!topUpUser || !topUpUser.driverId || isNaN(amount) || amount <= 0) {
      setTopUpError("Please enter a valid positive amount.");
      return;
    }
    setIsSubmittingTopUp(true);
    setTopUpError("");
    try {
      const res = await fetch("/api/drivers/topup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ driverId: topUpUser.driverId, amount, note: topUpNote || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Top-up failed");

      setUsers(prev => prev.map(u => 
        u._id === topUpUser._id ? { ...u, walletBalance: data.newBalance } : u
      ));
      setTopUpUser(null);
    } catch (err: any) {
      setTopUpError(err.message);
    } finally {
      setIsSubmittingTopUp(false);
    }
  };


  return (
    <div className="space-y-8 relative min-h-[calc(100vh-8rem)]">
      {/* Ambient background glow */}
      <div className="absolute top-0 right-[20%] w-[500px] h-[500px] bg-indigo-500/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 left-[10%] w-[400px] h-[400px] bg-fuchsia-500/5 rounded-full blur-[100px] pointer-events-none" />

      <div className="flex justify-between items-center relative z-10">
        <div>
          <h1 className="text-4xl font-extrabold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-white to-slate-400 flex items-center gap-3">
            <Users className="w-8 h-8 text-indigo-400" />
            User Management
          </h1>
          <p className="text-slate-400 mt-2">Manage your team members and their wallet balances.</p>
        </div>
      </div>

      <div className="grid gap-8 xl:grid-cols-4 relative z-10">
        {/* Create User Form */}
        <Card className="xl:col-span-1 bg-slate-900/60 backdrop-blur-xl border-slate-800/60 shadow-2xl h-fit overflow-hidden relative">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-500 to-fuchsia-500" />
          <CardContent className="pt-8">
            <div className="flex items-center gap-2 mb-6">
              <Sparkles className="w-5 h-5 text-fuchsia-400" />
              <h2 className="text-xl font-bold text-white tracking-tight">Add Team Member</h2>
            </div>
            
            <form onSubmit={createUser} className="space-y-5">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Full Name</label>
                <Input required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="h-11 bg-slate-950/50 border-slate-700/80 text-white focus:ring-fuchsia-500/50" placeholder="John Doe" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Username <span className="text-slate-500 opacity-60">(Opt)</span></label>
                <Input value={formData.username} onChange={e => setFormData({...formData, username: e.target.value})} className="h-11 bg-slate-950/50 border-slate-700/80 text-white focus:ring-fuchsia-500/50" placeholder="@johndoe123" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Email</label>
                <Input required type="email" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} className="h-11 bg-slate-950/50 border-slate-700/80 text-white focus:ring-fuchsia-500/50" placeholder="john@company.com" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Password</label>
                <Input required type="password" value={formData.password} onChange={e => setFormData({...formData, password: e.target.value})} className="h-11 bg-slate-950/50 border-slate-700/80 text-white focus:ring-fuchsia-500/50" placeholder="••••••••" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Role</label>
                <Select value={formData.role} onValueChange={v => setFormData({...formData, role: v})}>
                  <SelectTrigger className="h-11 bg-slate-950/50 border-slate-700/80 text-white focus:ring-fuchsia-500/50">
                    <SelectValue placeholder="Select a role" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-900 border-slate-800">
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="hr">HR</SelectItem>
                    <SelectItem value="driver">Employee (Driver)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  Department <span className="text-slate-500 opacity-60">(Opt)</span>
                </label>
                <Select
                  value={formData.departmentId || "__none__"}
                  onValueChange={(v) => setFormData({ ...formData, departmentId: v === "__none__" ? "" : v })}
                >
                  <SelectTrigger className="h-11 bg-slate-950/50 border-slate-700/80 text-white focus:ring-fuchsia-500/50">
                    <SelectValue placeholder="Select a department" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-900 border-slate-800">
                    <SelectItem value="__none__">No department</SelectItem>
                    {departments.map((d) => (
                      <SelectItem key={d._id} value={d._id}>
                        {d.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <CapabilityPicker
                value={capabilities}
                onChange={setCapabilities}
                disabled={formData.role !== "driver" && formData.role !== "employee"}
              />
              <Button type="submit" disabled={isCreating} className="w-full h-12 bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white font-bold shadow-lg shadow-indigo-500/25 transition-all">
                {isCreating ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <UserPlus className="mr-2 h-5 w-5" />}
                Add Employee
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* User List */}
        <Card className="xl:col-span-3 bg-slate-900/60 backdrop-blur-xl border-slate-800/60 shadow-2xl overflow-hidden rounded-2xl">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-slate-900/80 backdrop-blur-md">
                <TableRow className="border-slate-800 hover:bg-transparent">
                  <TableHead className="text-slate-400 font-semibold tracking-wider text-xs uppercase py-4">Name</TableHead>
                  <TableHead className="text-slate-400 font-semibold tracking-wider text-xs uppercase py-4">Auth Details</TableHead>
                  <TableHead className="text-slate-400 font-semibold tracking-wider text-xs uppercase py-4">Role</TableHead>
                  <TableHead className="text-slate-400 font-semibold tracking-wider text-xs uppercase py-4">Department</TableHead>
                  <TableHead className="text-slate-400 font-semibold tracking-wider text-xs uppercase py-4">Wallet Balance</TableHead>
                  <TableHead className="text-slate-400 font-semibold tracking-wider text-xs uppercase text-right py-4">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={6} className="h-48 text-center">
                      <Loader2 className="h-8 w-8 animate-spin mx-auto text-indigo-500 mb-2" />
                      <p className="text-sm text-slate-500">Loading your team...</p>
                    </TableCell>
                  </TableRow>
                ) : users.map(user => (
                  <TableRow key={user._id} className="border-slate-800/60 hover:bg-slate-800/30 transition-colors group">
                    <TableCell className="font-semibold text-slate-200 whitespace-nowrap py-4">
                      {user.name}
                    </TableCell>
                    <TableCell className="py-4">
                      {user.username && <span className="font-medium text-indigo-300 block mb-0.5">@{user.username}</span>}
                      <span className="text-xs text-slate-400">{user.email}</span>
                    </TableCell>
                    <TableCell className="py-4">
                      <Badge variant="outline" className={`border ${
                        user.role === 'admin' 
                          ? "border-amber-500/30 text-amber-400 bg-amber-500/10" 
                          : "border-indigo-500/30 text-indigo-400 bg-indigo-500/10"
                      }`}>
                        {user.role}
                      </Badge>
                    </TableCell>
                    <TableCell className="py-4">
                      <span className="text-slate-300">{user.department?.name || "—"}</span>
                    </TableCell>
                    <TableCell className="py-4">
                      {user.role === "driver" ? (
                        <div className="flex items-center gap-2">
                          <Wallet className="w-4 h-4 text-slate-500" />
                          <span className={`font-mono font-bold text-lg tracking-tight ${user.walletBalance > 0 ? "text-emerald-400" : "text-slate-500"}`}>
                            ₹{(user.walletBalance || 0).toFixed(2)}
                          </span>
                        </div>
                      ) : (
                        <span className="text-slate-600 text-sm italic opacity-50">Not applicable</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right py-4">
                       <div className="flex justify-end items-center gap-2 opacity-80 group-hover:opacity-100 transition-opacity">
                          {user.role === "driver" && user.driverId && (
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              className="bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 hover:text-emerald-300 border border-emerald-500/20 whitespace-nowrap h-9 px-4 rounded-full transition-all hover:scale-105"
                              onClick={() => openTopUpModal(user)}
                            >
                              <Plus className="w-4 h-4 mr-1.5" /> Add Funds
                            </Button>
                          )}
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-9 w-9 text-slate-400 hover:bg-indigo-500/10 hover:text-indigo-400 rounded-full transition-colors"
                            onClick={() => openEditModal(user)}
                            title="Edit User"
                          >
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-9 w-9 text-slate-400 hover:bg-rose-500/10 hover:text-rose-400 rounded-full transition-colors"
                            onClick={() => setDeletingUser(user)}
                            title="Delete User"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                       </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      </div>

      {/* Top-Up Modal inline (z-50) */}
      {topUpUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4 h-screen w-screen absolute top-0 left-0">
          <div className="bg-slate-900 border border-slate-700/50 rounded-3xl p-6 w-full max-w-sm shadow-2xl space-y-5 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/10 rounded-full blur-3xl" />
            
            <div className="flex items-center justify-between pointer-events-auto relative z-10">
              <div>
                <h2 className="text-xl font-extrabold text-white tracking-tight">Add Balance</h2>
                <p className="text-sm text-slate-400 mt-0.5 font-medium">{topUpUser.name}</p>
              </div>
              <button
                type="button"
                onClick={() => setTopUpUser(null)}
                className="p-2.5 rounded-full hover:bg-slate-800 text-slate-400 cursor-pointer pointer-events-auto transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-slate-950/50 border border-slate-800/60 rounded-2xl p-4 flex items-center gap-4 relative z-10">
              <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center shrink-0">
                <Wallet className="w-5 h-5 text-emerald-400" />
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Current Balance</p>
                <p className="text-2xl font-black text-white mt-0.5">
                  ₹{(topUpUser.walletBalance || 0).toFixed(2)}
                </p>
              </div>
            </div>

            <div className="space-y-4 pointer-events-auto relative z-10">
              <div className="space-y-2">
                <Label className="text-slate-300 font-semibold">Amount to Add (₹)</Label>
                <Input
                  type="number"
                  placeholder="e.g. 500"
                  value={topUpAmount}
                  onChange={e => setTopUpAmount(e.target.value)}
                  className="h-14 text-2xl font-bold bg-slate-950/80 border-slate-700 text-emerald-400 placeholder:text-slate-600 focus:ring-emerald-500/50"
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label className="text-slate-300 font-semibold">Note <span className="text-slate-500 opacity-60">(optional)</span></Label>
                <Input
                  placeholder="e.g. Weekly allowance..."
                  value={topUpNote}
                  onChange={e => setTopUpNote(e.target.value)}
                  className="h-12 bg-slate-950/80 border-slate-700 text-slate-200 placeholder:text-slate-600 focus:ring-emerald-500/50"
                />
              </div>
            </div>

            {topUpAmount && !isNaN(parseFloat(topUpAmount)) && parseFloat(topUpAmount) > 0 && (
              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3 text-sm text-emerald-400 font-medium relative z-10">
                New balance will be: <span className="font-bold text-white ml-1">
                  ₹{((topUpUser.walletBalance || 0) + parseFloat(topUpAmount)).toFixed(2)}
                </span>
              </div>
            )}

            {topUpError && (
               <div className="bg-rose-500/10 border border-rose-500/20 rounded-xl p-3 text-sm text-rose-400 font-medium relative z-10">
                {topUpError}
              </div>
            )}

            <div className="flex gap-3 pt-2 pointer-events-auto relative z-10">
              <Button
                variant="ghost"
                type="button"
                className="flex-1 border border-slate-700 hover:bg-slate-800 text-slate-300 h-12 rounded-xl"
                onClick={() => setTopUpUser(null)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                className="flex-1 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white font-bold h-12 rounded-xl shadow-lg shadow-emerald-500/20 transition-all border-none"
                onClick={handleTopUp}
                disabled={isSubmittingTopUp}
              >
                {isSubmittingTopUp ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : <Plus className="w-5 h-5 mr-1.5" />}
                Add ₹{topUpAmount || "0"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      <Dialog open={!!editingUser} onOpenChange={(open) => !open && setEditingUser(null)}>
        <DialogContent className="bg-slate-900 border-slate-800 text-slate-100 sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
            <DialogDescription className="text-slate-400">
              Make changes to {editFormData.name}&apos;s profile here.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={updateUser} className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-300">Full Name</label>
              <Input required value={editFormData.name} onChange={e => setEditFormData({...editFormData, name: e.target.value})} className="bg-slate-950 border-slate-700 text-white" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-300">Username</label>
              <Input value={editFormData.username} onChange={e => setEditFormData({...editFormData, username: e.target.value})} className="bg-slate-950 border-slate-700 text-white" placeholder="Optional" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-300">Email</label>
              <Input required type="email" value={editFormData.email} onChange={e => setEditFormData({...editFormData, email: e.target.value})} className="bg-slate-950 border-slate-700 text-white" />
            </div>
            <div className="space-y-2">
               <label className="text-sm font-medium text-slate-300">New Password (Optional)</label>
               <Input type="password" value={editFormData.password} onChange={e => setEditFormData({...editFormData, password: e.target.value})} className="bg-slate-950 border-slate-700 text-white" placeholder="Leave blank to keep current" />
               <p className="text-xs text-slate-500">The phone asks for this name and password the next time the app is opened.</p>
            </div>
            <div className="space-y-2">
               <label className="text-sm font-medium text-slate-300">Role</label>
               <Select value={editFormData.role} onValueChange={v => setEditFormData({...editFormData, role: v})}>
                 <SelectTrigger className="bg-slate-950 border-slate-700 text-white">
                   <SelectValue placeholder="Select a role" />
                 </SelectTrigger>
                 <SelectContent className="bg-slate-900 border-slate-800">
                   <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="hr">HR</SelectItem>
                   <SelectItem value="driver">Employee (Driver)</SelectItem>
                 </SelectContent>
               </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-300">Department</label>
              <Select
                value={editFormData.departmentId || "__none__"}
                onValueChange={(v) => setEditFormData({ ...editFormData, departmentId: v === "__none__" ? "" : v })}
              >
                <SelectTrigger className="bg-slate-950 border-slate-700 text-white">
                  <SelectValue placeholder="Select a department" />
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-800">
                  <SelectItem value="__none__">No department</SelectItem>
                  {departments.map((d) => (
                    <SelectItem key={d._id} value={d._id}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <CapabilityPicker
              value={editCapabilities}
              onChange={setEditCapabilities}
              disabled={editFormData.role !== "driver" && editFormData.role !== "employee"}
            />
            <DialogFooter className="pt-4">
              <Button type="button" variant="ghost" onClick={() => setEditingUser(null)} className="hover:bg-slate-800 text-slate-300">Cancel</Button>
              <Button type="submit" disabled={isUpdating} className="bg-indigo-600 hover:bg-indigo-700">
                 {isUpdating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                 Save Changes
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Modal */}
      <Dialog open={!!deletingUser} onOpenChange={(open) => !open && setDeletingUser(null)}>
        <DialogContent className="bg-slate-900 border-rose-500/20 text-slate-100 sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle className="flex items-center text-rose-500">
              <ShieldAlert className="w-5 h-5 mr-2" /> Delete User
            </DialogTitle>
            <DialogDescription className="text-slate-400 pt-2 pb-4">
               Are you completely sure you want to delete <strong className="text-slate-200">{deletingUser?.name}</strong>? 
               <br/><br/>
               If they are an employee, their ongoing portal access will be permanently revoked. However, for auditing purposes, their historical Expenses and Call Logs will remain safely stored. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
             <Button variant="outline" onClick={() => setDeletingUser(null)} className="border-slate-700 hover:bg-slate-800 text-slate-300">Cancel</Button>
             <Button variant="destructive" onClick={deleteUser} disabled={isDeleting} className="bg-rose-600 hover:bg-rose-700">
                {isDeleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Delete user"}
             </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
