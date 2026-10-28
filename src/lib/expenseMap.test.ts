import { test } from "node:test";
import assert from "node:assert/strict";
import { groupExpensesByLocation, type MapExpense } from "./expenseMap.ts";

function exp(id: string, lat: number, lng: number): MapExpense {
  return {
    id,
    amount: 10,
    category: "Fuel",
    description: "",
    status: "pending",
    timestamp: "2026-10-01T00:00:00.000Z",
    location: { lat, lng },
    locationAccuracy: null,
    walletBalanceAfter: null,
    driverName: "A",
    receiptUrl: `/r/${id}`,
    odometerKm: null,
    previousOdometerKm: null,
    runKm: null,
    vehicleRegistration: null,
  };
}

test("every expense is kept, and the same spot shares one pin", () => {
  const groups = groupExpensesByLocation([
    exp("a", 23.02251, 72.57141),
    exp("b", 23.022512, 72.571409),
    exp("c", 23.03, 72.58),
  ]);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].expenses.map((e) => e.id), ["a", "b"]);
  assert.deepEqual(groups[1].expenses.map((e) => e.id), ["c"]);
  assert.equal(groups.reduce((n, g) => n + g.expenses.length, 0), 3);
});

test("an expense without a real location is left off the map", () => {
  assert.equal(groupExpensesByLocation([exp("z", Number.NaN, 1)]).length, 0);
});
