import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addCounts,
  applyExpenseTable,
  countsFromAccount,
  countsFromSpend,
  type ExpenseTableQuery,
  type ExpenseTableRow,
} from "./expenseTableView.ts";

function at(year: number, month: number, day: number, hour: number, minute: number) {
  const monthText = String(month).padStart(2, "0");
  const dayText = String(day).padStart(2, "0");
  const hourText = String(hour).padStart(2, "0");
  const minuteText = String(minute).padStart(2, "0");
  return `${year}-${monthText}-${dayText}T${hourText}:${minuteText}:00+05:30`;
}

function row(extra: Partial<ExpenseTableRow> & Pick<ExpenseTableRow, "key">): ExpenseTableRow {
  return {
    at: at(2026, 10, 1, 12, 0),
    driverId: "v",
    driverName: "Vedant",
    category: "Food",
    title: "Lunch",
    amount: 100,
    status: "pending",
    balanceAfter: 1000,
    expenseDay: "2026-10-01",
    vehicle: null,
    odometerKm: null,
    previousOdometerKm: null,
    runKm: null,
    approver: null,
    note: null,
    ...extra,
  };
}

const openQuery: ExpenseTableQuery = {
  driverIds: null,
  includeUnassigned: false,
  rosterIds: ["v", "j", "d"],
  status: "all",
  category: "",
  from: "",
  to: "",
  fromTime: "",
  toTime: "",
  search: "",
  timeZone: "Asia/Kolkata",
};

test("amount sort is numeric and ignores currency formatting", () => {
  const rows = [
    row({ key: "big", amount: 1300, title: "₹1,300.00 display" }),
    row({ key: "ten", amount: 10 }),
    row({ key: "nine", amount: 9 }),
  ];
  const sorted = applyExpenseTable(rows, openQuery, { key: "amount", dir: "asc" });
  assert.deepEqual(
    sorted.map((item) => item.key),
    ["nine", "ten", "big"]
  );
  const desc = applyExpenseTable(rows, openQuery, { key: "amount", dir: "desc" });
  assert.deepEqual(
    desc.map((item) => item.key),
    ["big", "ten", "nine"]
  );
});

test("time of day sorts independently of the expense date", () => {
  const rows = [
    row({ key: "evening", expenseDay: "2026-10-01", at: at(2026, 10, 1, 18, 5) }),
    row({ key: "morning", expenseDay: "2026-10-29", at: at(2026, 10, 29, 9, 15) }),
  ];
  const byTime = applyExpenseTable(rows, openQuery, { key: "time", dir: "asc" });
  assert.deepEqual(
    byTime.map((item) => item.key),
    ["morning", "evening"]
  );
  const byDate = applyExpenseTable(rows, openQuery, { key: "date", dir: "asc" });
  assert.deepEqual(
    byDate.map((item) => item.key),
    ["evening", "morning"]
  );
});

test("empty odometer and approver stay last in both directions", () => {
  const rows = [
    row({ key: "none" }),
    row({ key: "high", odometerKm: 10, approver: "Zara" }),
    row({ key: "low", odometerKm: 2, approver: "Asha" }),
  ];
  assert.deepEqual(
    applyExpenseTable(rows, openQuery, { key: "odometer", dir: "asc" }).map((item) => item.key),
    ["low", "high", "none"]
  );
  assert.deepEqual(
    applyExpenseTable(rows, openQuery, { key: "odometer", dir: "desc" }).map((item) => item.key),
    ["high", "low", "none"]
  );
  assert.deepEqual(
    applyExpenseTable(rows, openQuery, { key: "approver", dir: "asc" }).map((item) => item.key),
    ["low", "high", "none"]
  );
});

test("names sort alphabetically and status sorts on the status value", () => {
  const rows = [
    row({ key: "z", driverName: "vedant", status: "rejected" }),
    row({ key: "a", driverName: "Asha", status: "approved" }),
    row({ key: "p", driverName: "Jack", status: "pending" }),
  ];
  assert.deepEqual(
    applyExpenseTable(rows, openQuery, { key: "employee", dir: "asc" }).map((item) => item.key),
    ["a", "p", "z"]
  );
  assert.deepEqual(
    applyExpenseTable(rows, openQuery, { key: "status", dir: "asc" }).map((item) => item.key),
    ["a", "p", "z"]
  );
});

test("employee, status, vehicle search, and time sort compose without duplicating rows", () => {
  const rows = [
    row({
      key: "vedant-late",
      driverId: "v",
      status: "pending",
      vehicle: "GJ01AB1234",
      at: at(2026, 10, 29, 18, 0),
      amount: 200,
    }),
    row({
      key: "jack-early",
      driverId: "j",
      driverName: "Jack",
      status: "pending",
      vehicle: "GJ01CD9999",
      category: "Fuel",
      title: "Diesel",
      at: at(2026, 10, 1, 9, 0),
      expenseDay: "2026-10-01",
      amount: 50,
    }),
    row({
      key: "vedant-approved",
      driverId: "v",
      status: "approved",
      vehicle: "GJ01AB1234",
      approver: "Admin",
      at: at(2026, 10, 2, 8, 0),
    }),
    row({
      key: "other-vehicle",
      driverId: "d",
      driverName: "Dipak",
      status: "pending",
      vehicle: "MH02",
      at: at(2026, 10, 3, 7, 0),
    }),
  ];
  const visible = applyExpenseTable(
    rows,
    {
      ...openQuery,
      driverIds: ["v", "j"],
      status: "pending",
      search: "gj01",
    },
    { key: "time", dir: "asc" }
  );
  assert.deepEqual(
    visible.map((item) => item.key),
    ["jack-early", "vedant-late"]
  );
});

test("date and time bounds are inclusive and an inverted range matches nothing", () => {
  const rows = [
    row({ key: "in", expenseDay: "2026-10-29", at: at(2026, 10, 29, 10, 30) }),
    row({ key: "before", expenseDay: "2026-10-28", at: at(2026, 10, 28, 10, 30) }),
    row({ key: "late", expenseDay: "2026-10-29", at: at(2026, 10, 29, 18, 0) }),
  ];
  const ranged = applyExpenseTable(
    rows,
    { ...openQuery, from: "2026-10-29", to: "2026-10-29", fromTime: "10:00", toTime: "11:00" },
    { key: "date", dir: "asc" }
  );
  assert.deepEqual(
    ranged.map((item) => item.key),
    ["in"]
  );
  const inverted = applyExpenseTable(
    rows,
    { ...openQuery, fromTime: "18:00", toTime: "09:00" },
    { key: "time", dir: "asc" }
  );
  assert.equal(inverted.length, 0);
});

test("recorded time uses Asia/Kolkata even when the timestamp is UTC", () => {
  const rows = [row({ key: "ist-morning", at: "2026-10-29T04:30:00.000Z", expenseDay: "2026-10-29" })];
  const matched = applyExpenseTable(
    rows,
    { ...openQuery, fromTime: "10:00", toTime: "10:00" },
    { key: "time", dir: "asc" }
  );
  assert.deepEqual(
    matched.map((item) => item.key),
    ["ist-morning"]
  );
  const missed = applyExpenseTable(
    rows,
    { ...openQuery, timeZone: "UTC", fromTime: "10:00", toTime: "10:00" },
    { key: "time", dir: "asc" }
  );
  assert.equal(missed.length, 0);
});

test("money added uses the local calendar day and unassigned drivers stay separate", () => {
  const rows = [
    row({ key: "advance", driverId: "ghost", driverName: "Deleted driver", status: "advance", expenseDay: null, at: at(2026, 10, 29, 15, 0), category: "Advance" }),
    row({ key: "roster", driverId: "v" }),
  ];
  const others = applyExpenseTable(
    rows,
    { ...openQuery, driverIds: [], includeUnassigned: true, from: "2026-10-29", to: "2026-10-29" },
    { key: "employee", dir: "asc" }
  );
  assert.deepEqual(
    others.map((item) => item.key),
    ["advance"]
  );
});

test("search matches partial amount, approver, and category across words", () => {
  const rows = [
    row({ key: "hit", amount: 1300, category: "Food", approver: "Neha", title: "Dinner" }),
    row({ key: "miss", amount: 40, category: "Fuel", title: "Diesel" }),
  ];
  assert.deepEqual(
    applyExpenseTable(rows, { ...openQuery, search: "1300" }, { key: "amount", dir: "asc" }).map((item) => item.key),
    ["hit"]
  );
  assert.deepEqual(
    applyExpenseTable(rows, { ...openQuery, search: "neha dinner" }, { key: "amount", dir: "asc" }).map((item) => item.key),
    ["hit"]
  );
});

test("capsule counts add roster totals and unassigned category totals", () => {
  const vedant = countsFromAccount({
    submittedCount: 2,
    totalSubmitted: 300,
    approvedCount: 1,
    pendingCount: 1,
    rejectedCount: 0,
  });
  const others = countsFromSpend([
    { pending: 200, approved: 0, rejected: 50, pendingCount: 1, approvedCount: 0, rejectedCount: 1 },
  ]);
  const all = addCounts(vedant, others);
  assert.deepEqual(all, {
    expenseCount: 4,
    expenseAmount: 550,
    approvedCount: 1,
    pendingCount: 2,
    rejectedCount: 1,
  });
});
