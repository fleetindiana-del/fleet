import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/db";
import Driver from "@/models/Driver";
import LocationSession from "@/models/LocationSession";
import Expense from "@/models/Expense";
import CallLog from "@/models/CallLog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, Navigation, CreditCard, Banknote, PhoneCall } from "lucide-react";
import { redirect } from "next/navigation";
import mongoose from "mongoose";

async function getDashboardStats(companyId: string) {
  await connectToDatabase();
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const compId = new mongoose.Types.ObjectId(companyId);

  const [activeDrivers, tripsToday, expensesToday, allDrivers, callsToday] = await Promise.all([
    Driver.countDocuments({ companyId: compId, status: "active" }),
    LocationSession.countDocuments({ companyId: companyId, startedAt: { $gte: today } }),
    Expense.aggregate([
      { $match: { companyId: compId, timestamp: { $gte: today }, status: "approved" } },
      { $group: { _id: null, total: { $sum: "$amount" } } }
    ]),
    Driver.aggregate([
      { $match: { companyId: compId } },
      { $group: { _id: null, totalWallet: { $sum: "$walletBalance" } } }
    ]),
    CallLog.countDocuments({ companyId: compId, timestamp: { $gte: today } })
  ]);

  return {
    activeDrivers,
    tripsToday,
    expensesToday: expensesToday[0]?.total || 0,
    walletTotal: allDrivers[0]?.totalWallet || 0,
    callsToday
  };
}

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);

  // HR staff work from Income & Expense; the fleet-wide overview is not their landing page.
  if (session?.user?.role === "hr") {
    redirect("/expenses");
  }
  
  // Super admin might not have a strict companyId assigned, so we handle it optionally or restrict for now.
  if (!session?.user?.companyId) {
    return (
      <div className="flex h-full items-center justify-center text-slate-400">
        <div>Please assign a company to your admin account to view dashboard stats.</div>
      </div>
    );
  }

  const stats = await getDashboardStats(session.user.companyId);

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight text-white mb-8">Dashboard Overview</h1>
      
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-5">
        <Card className="bg-slate-900 border-slate-800 text-slate-100 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-400">Active Drivers</CardTitle>
            <Users className="h-4 w-4 text-indigo-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.activeDrivers}</div>
            <p className="text-xs text-slate-500 mt-1">Currently assigned & active</p>
          </CardContent>
        </Card>

        <Card className="bg-slate-900 border-slate-800 text-slate-100 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-400">Total Trips Today</CardTitle>
            <Navigation className="h-4 w-4 text-emerald-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.tripsToday}</div>
            <p className="text-xs text-slate-500 mt-1">Started after midnight</p>
          </CardContent>
        </Card>

        <Card className="bg-slate-900 border-slate-800 text-slate-100 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-400">Total Expenses Today</CardTitle>
            <CreditCard className="h-4 w-4 text-rose-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${stats.expensesToday.toFixed(2)}</div>
            <p className="text-xs text-slate-500 mt-1">Approved expenses today</p>
          </CardContent>
        </Card>

        <Card className="bg-slate-900 border-slate-800 text-slate-100 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-400">Remaining Wallet Total</CardTitle>
            <Banknote className="h-4 w-4 text-amber-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${stats.walletTotal.toFixed(2)}</div>
            <p className="text-xs text-slate-500 mt-1">Sum of all driver wallets</p>
          </CardContent>
        </Card>

        <Card className="bg-slate-900 border-slate-800 text-slate-100 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-400">Total Calls Today</CardTitle>
            <PhoneCall className="h-4 w-4 text-cyan-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.callsToday}</div>
            <p className="text-xs text-slate-500 mt-1">Logged from mobile apps</p>
          </CardContent>
        </Card>
      </div>

      {/* Additional dashboard sections like charts would go here */}
      <div className="mt-8 grid gap-6 md:grid-cols-2">
        <Card className="bg-slate-900 border-slate-800 h-96 flex items-center justify-center text-slate-500">
          Trip Analytics Chart Placeholder
        </Card>
        <Card className="bg-slate-900 border-slate-800 h-96 flex items-center justify-center text-slate-500">
          Expense Analytics Chart Placeholder
        </Card>
      </div>
    </div>
  );
}
