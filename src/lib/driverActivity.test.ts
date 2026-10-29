import { test } from "node:test";
import assert from "node:assert/strict";
import { buildActivity, groupByDay } from "./driverActivity.ts";
import type { ExpenseDTO, LedgerEntryDTO } from "./expenseLedger.ts";

function expense(id: string, amount: number, at: string, over: Partial<ExpenseDTO> = {}): ExpenseDTO {
  return {
    id, driverId: "d1", driverName: "Asha", amount, category: "Fuel", description: `Diesel ${id}`,
    expenseDate: at, submittedAt: at, status: "pending", reviewedByName: null, reviewedAt: null,
    rejectionReason: null, excessAmount: 0, balanceAfterApproval: null, deductedOnSubmit: true,
    walletBalanceAfter: null, location: null, locationAccuracy: null, locationStatus: "unavailable",
    locationCapturedAt: null, receiptUrl: `/r/${id}`,
    odometerKm: null, previousOdometerKm: null, runKm: null, vehicleId: null, vehicleRegistration: null, ...over,
  };
}

function credit(id: string, type: "advance" | "expense_rejected", amount: number, at: string, balanceAfter: number): LedgerEntryDTO {
  return {
    id, driverId: "d1", driverName: "Asha", type, amount, balanceEffect: amount, balanceAfter,
    expenseId: null, performedByName: "Priya (HR)", performedByRole: "hr", note: type === "advance" ? null : "Unclear bill",
    isAdditionalAdvance: false, excessAmount: 0, timestamp: at,
  };
}

const ADV = credit("a1", "advance", 5000, "2026-10-18T04:00:00Z", 5000);
const E1 = expense("e1", 1200, "2026-10-18T06:00:00Z", { walletBalanceAfter: 3800 });
const E2 = expense("e2", 4000, "2026-10-19T06:00:00Z", { walletBalanceAfter: -200 });

test("the requirements example reads newest first with running balances", () => {
  const items = buildActivity([E2, E1], [ADV]);
  assert.deepEqual(
    items.map((i) => [i.kind, i.direction, i.amount, i.balanceAfter]),
    [
      ["expense", "debit", 4000, -200],
      ["expense", "debit", 1200, 3800],
      ["advance", "credit", 5000, 5000],
    ]
  );
});

test("a rejected expense stays as a debit and its refund appears as a credit", () => {
  const rejected = expense("e3", 300, "2026-10-19T07:00:00Z", { status: "rejected", walletBalanceAfter: -500 });
  const refund = credit("r1", "expense_rejected", 300, "2026-10-19T09:00:00Z", -200);
  const items = buildActivity([rejected], [refund]);
  assert.equal(items[0].kind, "refund");
  assert.equal(items[0].subtitle, "Unclear bill");
  assert.equal(items[1].expense?.status, "rejected");
});

test("filters", () => {
  const approved = expense("e4", 50, "2026-10-17T06:00:00Z", { status: "approved" });
  assert.equal(buildActivity([E1, approved], [ADV], "credits").length, 1);
  assert.deepEqual(buildActivity([E1, approved], [ADV], "expenses").map((i) => i.key), ["e:e1", "e:e4"]);
  assert.deepEqual(buildActivity([E1, approved], [ADV], "pending").map((i) => i.key), ["e:e1"]);
});

test("groupByDay labels days in India time", () => {
  const now = new Date("2026-10-19T10:00:00Z");
  // 2026-10-18T20:00Z is already 19 Oct in IST.
  const late = expense("e5", 10, "2026-10-18T20:00:00Z");
  const groups = groupByDay(buildActivity([E2, late, E1], [ADV]), now);
  assert.deepEqual(groups.map((g) => [g.label, g.items.length]), [["Today", 2], ["Yesterday", 2]]);
});
