/**
 * Wallet snapshot for a handset that syncs with an API key and an employee
 * name, rather than a signed-in driver session.
 */
import mongoose from "mongoose";
import Driver from "@/models/Driver";
import User from "@/models/User";
import { buildActivity } from "@/lib/driverActivity";
import { getDriverAccount, listExpenses, listWalletCredits } from "@/lib/expenseLedger";

const UserM = User as mongoose.Model<any>;
const DriverM = Driver as mongoose.Model<any>;

export interface DeviceWalletTxn {
  title: string;
  subtitle: string;
  amount: number;
  direction: "credit" | "debit";
  at: string;
}

export interface DeviceWallet {
  employeeName: string;
  walletBalance: number;
  totalAdvance: number;
  spent: number;
  pendingCount: number;
  recent: DeviceWalletTxn[];
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The driver whose user name is this employee, ignoring case. */
async function driverForEmployee(employeeName: string) {
  const name = employeeName.trim();
  if (!name || name.length > 120) return null;
  const exact = new RegExp(`^${escapeRegex(name)}$`, "i");
  let users = await UserM.find({ name: exact }).select("_id name").lean();
  if (users.length === 0) {
    const prefix = new RegExp(`^${escapeRegex(name)}\\b`, "i");
    users = await UserM.find({ name: prefix }).select("_id name").limit(5).lean();
    if (users.length !== 1) return null;
  }
  const ids = users.map((user: { _id: unknown }) => user._id);
  return (
    (await DriverM.findOne({ userId: { $in: ids }, status: "active" }).populate("userId", "name").lean()) ||
    (await DriverM.findOne({ userId: { $in: ids } }).populate("userId", "name").lean())
  );
}

/**
 * Balance and recent transactions for the named employee.
 * Null when no driver account uses that name.
 */
export async function walletForEmployee(employeeName: string): Promise<DeviceWallet | null> {
  const driver = await driverForEmployee(employeeName);
  if (!driver) return null;
  const driverId = String(driver._id);
  const [account, expenses, credits] = await Promise.all([
    getDriverAccount(driverId),
    listExpenses({ driverId, limit: 8 }),
    listWalletCredits(driverId, 8),
  ]);
  const recent = buildActivity(expenses.items, credits)
    .slice(0, 8)
    .map((item) => ({
      title: item.title,
      subtitle: item.subtitle,
      amount: item.amount,
      direction: item.direction,
      at: item.at,
    }));
  const name = driver.userId?.name || employeeName.trim();
  return {
    employeeName: name,
    walletBalance: account?.balance ?? driver.walletBalance ?? 0,
    totalAdvance: account?.totalAdvance ?? 0,
    spent: (account?.totalApproved ?? 0) + (account?.totalPending ?? 0),
    pendingCount: account?.pendingCount ?? 0,
    recent,
  };
}
