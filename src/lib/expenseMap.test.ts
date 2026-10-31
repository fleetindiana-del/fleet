import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildExpenseView,
  employeeKey,
  groupExpensesByLocation,
  markersByEmployee,
  pinAnchor,
  type MapExpense,
} from "./expenseMap.ts";

function exp(id: string, lat = 23.02, lng = 72.57, extra: Partial<MapExpense> = {}): MapExpense {
  const { location, ...rest } = extra;
  return {
    amount: 10,
    category: "Fuel",
    description: "",
    status: "pending",
    timestamp: "2026-10-01T00:00:00.000Z",
    locationAccuracy: null,
    walletBalanceAfter: null,
    driverName: "A",
    receiptUrl: `/r/${id}`,
    odometerKm: null,
    previousOdometerKm: null,
    runKm: null,
    vehicleRegistration: null,
    ...rest,
    id,
    location: location ?? { lat, lng },
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

test("employee identity prefers the driver id", () => {
  assert.equal(employeeKey({ driverId: "abc", driverName: "Asha" }), "id:abc");
  assert.equal(employeeKey({ driverId: "  ", driverName: "Asha" }), "name:asha");
  assert.equal(employeeKey({ driverName: "Asha" }), "name:asha");
});

test("shared stops fan pins around the same point and keep every expense", () => {
  assert.equal(pinAnchor(0, 1), undefined);
  const left = pinAnchor(0, 2);
  const right = pinAnchor(1, 2);
  assert.equal(left?.anchorLeft, "calc(-50% + 15px)");
  assert.equal(right?.anchorLeft, "calc(-50% - 15px)");
  assert.equal(left?.anchorTop, "-100%");

  const markers = markersByEmployee([
    exp("a", 23.02251, 72.57141, { driverId: "1", driverName: "Asha", timestamp: "2026-10-02T00:00:00.000Z" }),
    exp("b", 23.022512, 72.571409, { driverId: "2", driverName: "Raj", timestamp: "2026-10-03T00:00:00.000Z" }),
    exp("c", 23.03, 72.58, { driverId: "1", driverName: "Asha", timestamp: "2026-10-01T00:00:00.000Z" }),
    exp("d", 23.02251, 72.57141, { driverId: "1", driverName: "Asha", timestamp: "2026-10-04T00:00:00.000Z" }),
  ]);
  assert.equal(markers.length, 3);
  const shared = markers.filter((marker) => marker.locationExpenses.length === 3);
  assert.equal(shared.length, 2);
  assert.equal(shared[0].position.lat, shared[1].position.lat);
  assert.equal(shared[0].position.lng, shared[1].position.lng);
  assert.notEqual(shared[0].anchorLeft, shared[1].anchorLeft);
  assert.deepEqual(
    shared.flatMap((marker) => marker.expenses.map((expense) => expense.id)).sort(),
    ["a", "b", "d"]
  );
  const asha = shared.find((marker) => marker.employeeKey === "id:1");
  assert.deepEqual(asha?.expenses.map((expense) => expense.id), ["d", "a"]);
  assert.deepEqual(asha?.locationExpenses.map((expense) => expense.id), ["d", "b", "a"]);
  const solo = markers.find((marker) => marker.expenses.some((expense) => expense.id === "c"));
  assert.equal(solo?.anchorLeft, undefined);
  assert.equal(solo?.locationExpenses.length, 1);
});

test("one employee at a stop keeps a single pin", () => {
  const markers = markersByEmployee([
    exp("a", 10, 10, { driverId: "1", timestamp: "2026-10-02T00:00:00.000Z" }),
    exp("b", 10, 10, { driverId: "1", timestamp: "2026-10-03T00:00:00.000Z" }),
  ]);
  assert.equal(markers.length, 1);
  assert.equal(markers[0].anchorLeft, undefined);
  assert.deepEqual(markers[0].expenses.map((expense) => expense.id), ["b", "a"]);
});

test("date, type, and employee filters combine, and colors stay put", () => {
  const day = (n: number, hour = 15) => new Date(2026, 9, n, hour, 0, 0).toISOString();
  const rows = [
    exp("1", 1, 1, { timestamp: day(10), category: "Food", driverId: "d1", driverName: "Asha", amount: 50 }),
    exp("2", 1, 2, { timestamp: day(12), category: "Fuel", driverId: "d2", driverName: "Raj", amount: 200 }),
    exp("3", 1, 3, { timestamp: day(12, 18), category: "Food", driverId: "d1", driverName: "Asha", amount: 80 }),
  ];

  const onThe12th = buildExpenseView(rows, { from: "2026-10-12", to: "2026-10-12" });
  assert.deepEqual(onThe12th.expenses.map((expense) => expense.id), ["3", "2"]);

  const early = exp("early", 1, 1, { timestamp: new Date(2026, 9, 12, 0, 15).toISOString(), driverId: "d1" });
  const late = exp("late", 1, 1, { timestamp: new Date(2026, 9, 12, 23, 45).toISOString(), driverId: "d1" });
  const next = exp("next", 1, 1, { timestamp: new Date(2026, 9, 13, 0, 5).toISOString(), driverId: "d1" });
  assert.deepEqual(
    buildExpenseView([early, late, next], { from: "2026-10-12", to: "2026-10-12" }).expenses.map((e) => e.id).sort(),
    ["early", "late"]
  );
  assert.deepEqual(buildExpenseView([early, next], { from: "2026-10-13" }).expenses.map((e) => e.id), ["next"]);
  assert.deepEqual(buildExpenseView([early, next], { to: "2026-10-12" }).expenses.map((e) => e.id), ["early"]);
  assert.equal(buildExpenseView(rows, { from: "2026-10-20", to: "2026-10-01" }).expenses.length, 0);

  const foodForAsha = buildExpenseView(rows, {
    from: "2026-10-01",
    to: "2026-10-31",
    category: "Food",
    employeeKey: "id:d1",
  });
  assert.deepEqual(foodForAsha.expenses.map((expense) => expense.id), ["3", "1"]);
  assert.deepEqual(foodForAsha.categories, ["Food", "Fuel"]);

  const asha = foodForAsha.summaries.find((summary) => summary.key === "id:d1");
  const raj = foodForAsha.summaries.find((summary) => summary.key === "id:d2");
  assert.equal(asha?.visibleCount, 2);
  assert.equal(asha?.visibleAmount, 130);
  assert.equal(raj?.visibleCount, 0);
  assert.equal(raj?.totalCount, 1);
  assert.equal(raj?.totalAmount, 200);

  const open = buildExpenseView(rows, {});
  for (const row of rows) {
    const key = employeeKey(row);
    assert.equal(foodForAsha.colors.get(key)?.background, open.colors.get(key)?.background);
    assert.notEqual(foodForAsha.colors.get(key)?.background, undefined);
  }
  assert.equal(new Set([...open.colors.values()].map((color) => color.background)).size, open.colors.size);
});

test("sorting works with the other filters", () => {
  const rows = [
    exp("1", 1, 1, { timestamp: "2026-10-10T00:00:00.000Z", category: "Food", driverId: "d1", driverName: "Asha", amount: 50 }),
    exp("2", 1, 2, { timestamp: "2026-10-12T00:00:00.000Z", category: "Fuel", driverId: "d2", driverName: "Raj", amount: 200 }),
    exp("3", 1, 3, { timestamp: "2026-10-11T00:00:00.000Z", category: "Toll", driverId: "d1", driverName: "Asha", amount: 80 }),
  ];
  assert.deepEqual(buildExpenseView(rows, { sort: "date-desc" }).expenses.map((e) => e.id), ["2", "3", "1"]);
  assert.deepEqual(buildExpenseView(rows, { sort: "date-asc" }).expenses.map((e) => e.id), ["1", "3", "2"]);
  assert.deepEqual(buildExpenseView(rows, { sort: "amount-desc" }).expenses.map((e) => e.id), ["2", "3", "1"]);
  assert.deepEqual(buildExpenseView(rows, { sort: "amount-asc" }).expenses.map((e) => e.id), ["1", "3", "2"]);
  assert.deepEqual(buildExpenseView(rows, { sort: "employee-asc" }).expenses.map((e) => e.id), ["3", "1", "2"]);
  assert.deepEqual(buildExpenseView(rows, { sort: "employee-desc" }).expenses.map((e) => e.id), ["2", "3", "1"]);
  assert.deepEqual(buildExpenseView(rows, { sort: "type-asc" }).expenses.map((e) => e.id), ["1", "2", "3"]);
  assert.deepEqual(
    buildExpenseView(rows, { category: "Food", sort: "amount-desc" }).expenses.map((e) => e.id),
    ["1"]
  );
});
