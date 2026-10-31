import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canManageIncomeExpense } from "@/lib/expenseMath";
import { getShiftTimezone } from "@/lib/shiftConfig";
import IncomeExpenseClient from "../income-expense/IncomeExpenseClient";

export const dynamic = "force-dynamic";

export default async function ExpensesPage() {
  const session = await getServerSession(authOptions);

  if (!canManageIncomeExpense(session?.user?.role)) {
    return (
      <div className="flex h-full items-center justify-center text-slate-400">
        You do not have permission to view expenses.
      </div>
    );
  }

  return <IncomeExpenseClient timeZone={getShiftTimezone()} />;
}
