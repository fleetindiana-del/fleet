import { NextResponse } from "next/server";
import mongoose from "mongoose";
import connectToDatabase from "@/lib/db";
import Driver, { type IDriver } from "@/models/Driver";
import Expense, { type IExpense } from "@/models/Expense";
import { companyScopeFor, type Actor } from "@/lib/expenseLedger";
import { driverFromDeviceToken } from "@/lib/deviceDriverAuth";
import { canManageIncomeExpense, isServableReceiptMime } from "@/lib/expenseMath";
import { errorResponse, getSessionActor } from "@/lib/incomeExpenseApi";

export const dynamic = "force-dynamic";

/**
 * GET /api/income-expense/expenses/:id/receipt
 * Streams the stored bill/receipt image. Allowed for HR/admin of the same
 * company and for the driver who submitted the expense (website session or the
 * phone's device token); anyone else gets 404
 * (not 403) so expense ids cannot be probed.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor: Actor = await getSessionActor().catch(async (e) => {
      const device = await driverFromDeviceToken(req);
      if (!device) throw e;
      return { id: device.userId, name: device.userName, role: "driver" };
    });
    const { id } = await params;
    const notFound = () => NextResponse.json({ error: "Receipt not found" }, { status: 404 });
    if (!mongoose.Types.ObjectId.isValid(id)) return notFound();

    await connectToDatabase();
    const expense = await (Expense as mongoose.Model<IExpense>)
      .findById(id)
      .select("photoUrl companyId driverId")
      .lean();
    if (!expense?.photoUrl) return notFound();

    let allowed = false;
    if (canManageIncomeExpense(actor.role)) {
      const scope = companyScopeFor(actor);
      allowed = !scope || String(expense.companyId) === scope;
    } else if (actor.role === "driver") {
      const driver = await (Driver as mongoose.Model<IDriver>).findOne({ userId: actor.id }).select("_id").lean();
      allowed = !!driver && String(driver._id) === String(expense.driverId);
    }
    if (!allowed) return notFound();

    const m = /^data:([a-z]+\/[a-z0-9.+-]+);base64,/i.exec(expense.photoUrl);
    if (!m || !isServableReceiptMime(m[1].toLowerCase())) {
      return NextResponse.json({ error: "Unsupported receipt format" }, { status: 415 });
    }
    const bytes = Buffer.from(expense.photoUrl.slice(m[0].length), "base64");

    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": m[1].toLowerCase(),
        "Content-Length": String(bytes.length),
        "Cache-Control": "private, max-age=3600",
        // Driver-supplied bytes served from our origin: never let them be sniffed or run as a page.
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Content-Disposition": "inline",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
