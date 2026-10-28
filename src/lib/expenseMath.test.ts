import { test } from "node:test";
import assert from "node:assert/strict";
import {
  balanceEffectFor,
  buildAccountFigures,
  canManageIncomeExpense,
  computeExcess,
  expenseSubmissionKey,
  parseAmount,
  parseExpenseDate,
  parseOdometer,
  parseReceiptDataUrl,
  round2,
  runKilometers,
} from "./expenseMath.ts";

// --- The worked example from the requirements -------------------------------

test("balance table: advance 5000 for drivers A, B and C", () => {
  const a = buildAccountFigures({
    totalAdvance: 5000, totalApproved: 10000, totalSubmitted: 10000, totalPending: 0, totalRejected: 0,
  });
  const b = buildAccountFigures({
    totalAdvance: 5000, totalApproved: 2000, totalSubmitted: 2000, totalPending: 0, totalRejected: 0,
  });
  const c = buildAccountFigures({
    totalAdvance: 5000, totalApproved: 4000, totalSubmitted: 4000, totalPending: 0, totalRejected: 0,
  });

  assert.equal(a.balance, -5000);
  assert.equal(a.excessAmount, 5000);
  assert.equal(a.remainingBalance, 0);

  assert.equal(b.balance, 3000);
  assert.equal(b.excessAmount, 0);
  assert.equal(b.remainingBalance, 3000);

  assert.equal(c.balance, 1000);
  assert.equal(c.excessAmount, 0);
});

test("deduct on submit: 5000 advance, 1200 then 4000 spent leaves -200 while still pending", () => {
  const afterFirst = buildAccountFigures({
    totalAdvance: 5000, totalApproved: 0, totalSubmitted: 1200, totalPending: 1200, totalRejected: 0,
    totalPendingDeducted: 1200,
  });
  assert.equal(afterFirst.balance, 3800);

  const afterSecond = buildAccountFigures({
    totalAdvance: 5000, totalApproved: 0, totalSubmitted: 5200, totalPending: 5200, totalRejected: 0,
    totalPendingDeducted: 5200,
  });
  assert.equal(afterSecond.balance, -200);
  assert.equal(afterSecond.excessAmount, 200);
  assert.equal(afterSecond.remainingBalance, 0);
  // Already deducted, so approving it all changes nothing.
  assert.equal(afterSecond.balanceIfPendingApproved, -200);
  assert.equal(computeExcess(3800, 4000), 200);
});

test("deduct on submit: approval keeps the balance, rejection refunds it", () => {
  const approved = buildAccountFigures({
    totalAdvance: 5000, totalApproved: 1200, totalSubmitted: 1200, totalPending: 0, totalRejected: 0,
    totalPendingDeducted: 0,
  });
  assert.equal(approved.balance, 3800);
  const rejected = buildAccountFigures({
    totalAdvance: 5000, totalApproved: 0, totalSubmitted: 1200, totalPending: 0, totalRejected: 1200,
  });
  assert.equal(rejected.balance, 5000);
});

test("legacy and new pending expenses mix correctly", () => {
  // 3000 pending: 1000 deducted on submit (new) + 2000 legacy awaiting approval.
  const f = buildAccountFigures({
    totalAdvance: 5000, totalApproved: 0, totalSubmitted: 3000, totalPending: 3000, totalRejected: 0,
    totalPendingDeducted: 1000,
  });
  assert.equal(f.balance, 4000);
  assert.equal(f.balanceIfPendingApproved, 2000);
});

test("legacy: pending expenses not deducted on submit do not reduce the balance", () => {
  const f = buildAccountFigures({
    totalAdvance: 5000, totalApproved: 1000, totalSubmitted: 4000, totalPending: 3000, totalRejected: 0,
  });
  assert.equal(f.balance, 4000);
  assert.equal(f.balanceIfPendingApproved, 1000);
});

test("legacy: rejected expenses do not reduce the balance", () => {
  const f = buildAccountFigures({
    totalAdvance: 5000, totalApproved: 0, totalSubmitted: 800, totalPending: 0, totalRejected: 800,
  });
  assert.equal(f.balance, 5000);
});

test("a new advance clears an outstanding excess without losing history", () => {
  // Spent 10000 against a 5000 advance, then HR allocates another 5000.
  const before = buildAccountFigures({
    totalAdvance: 5000, totalApproved: 10000, totalSubmitted: 10000, totalPending: 0, totalRejected: 0,
  });
  const after = buildAccountFigures({
    totalAdvance: 10000, totalApproved: 10000, totalSubmitted: 10000, totalPending: 0, totalRejected: 0,
  });
  assert.equal(before.excessAmount, 5000);
  assert.equal(after.balance, 0);
  assert.equal(after.excessAmount, 0);
  assert.equal(after.totalApproved, 10000); // expense history is intact
});

// --- Excess detection -------------------------------------------------------

test("computeExcess", () => {
  assert.equal(computeExcess(5000, 10000), 5000);
  assert.equal(computeExcess(3000, 2000), 0);
  assert.equal(computeExcess(3000, 3000), 0);
  assert.equal(computeExcess(0, 100), 100);
  // Already overdrawn: the whole amount is new excess.
  assert.equal(computeExcess(-500, 200), 200);
});

// --- Ledger sign rules ------------------------------------------------------

test("legacy expenses: only advances and approvals move the balance", () => {
  assert.equal(balanceEffectFor("advance", 5000), 5000);
  assert.equal(balanceEffectFor("expense_approved", 750.5), -750.5);
  assert.equal(balanceEffectFor("expense_submitted", 750.5), 0);
  assert.equal(balanceEffectFor("expense_rejected", 750.5), 0);
});

test("deducted-on-submit expenses: submit deducts, approve is neutral, reject refunds", () => {
  assert.equal(balanceEffectFor("expense_submitted", 750.5, true), -750.5);
  assert.equal(balanceEffectFor("expense_approved", 750.5, true), 0);
  assert.equal(balanceEffectFor("expense_rejected", 750.5, true), 750.5);
  assert.equal(balanceEffectFor("advance", 100, true), 100);
  // Every expense moves the balance exactly once net (or not at all if rejected).
  const net = (decision: "expense_approved" | "expense_rejected", deducted: boolean) =>
    round2(balanceEffectFor("expense_submitted", 99.99, deducted) + balanceEffectFor(decision, 99.99, deducted));
  assert.equal(net("expense_approved", true), -99.99);
  assert.equal(net("expense_approved", false), -99.99);
  assert.equal(net("expense_rejected", true), 0);
  assert.equal(net("expense_rejected", false), 0);
});

// --- Duplicate submissions --------------------------------------------------

test("expenseSubmissionKey: client id wins, otherwise a stable content fingerprint", () => {
  const fakeHash = (s: string) => `H(${s.length})`;
  const fp = { amount: 1200, category: "Fuel", receiptBase64: "AAAA" };
  assert.equal(expenseSubmissionKey("a1b2c3d4-e5f6", fp, fakeHash), "c:a1b2c3d4-e5f6");
  // Missing or malformed ids fall back to the fingerprint, identically each time.
  for (const bad of [undefined, "", "short", "has spaces in it", 42, "x".repeat(101)]) {
    assert.equal(expenseSubmissionKey(bad, fp, fakeHash), expenseSubmissionKey(undefined, fp, fakeHash));
  }
  assert.notEqual(
    expenseSubmissionKey(undefined, fp, (s) => s),
    expenseSubmissionKey(undefined, { ...fp, amount: 1201 }, (s) => s)
  );
});

// --- Money validation -------------------------------------------------------

test("parseAmount accepts sane amounts and rounds to paise", () => {
  assert.equal(parseAmount(5000), 5000);
  assert.equal(parseAmount(12.345), 12.35);
  assert.equal(parseAmount(0.1 + 0.2), 0.3);
});

test("parseAmount rejects bad input", () => {
  for (const bad of [0, -1, NaN, Infinity, "500", null, undefined, {}, 0.001, 10_000_001]) {
    assert.equal(parseAmount(bad), null, `should reject ${String(bad)}`);
  }
});

test("round2 removes float noise", () => {
  assert.equal(round2(0.1 + 0.2), 0.3);
  assert.equal(round2(1.005), 1.01);
});

// --- Expense dates ----------------------------------------------------------

const NOW = new Date("2026-10-15T09:00:00Z");

test("parseExpenseDate accepts today, yesterday and last month", () => {
  assert.equal(parseExpenseDate("2026-10-15", NOW)?.toISOString(), "2026-10-15T00:00:00.000Z");
  assert.ok(parseExpenseDate("2026-10-14", NOW));
  assert.ok(parseExpenseDate("2026-09-01", NOW));
});

test("parseExpenseDate tolerates a timezone ahead of UTC but not real future dates", () => {
  assert.ok(parseExpenseDate("2026-10-16", NOW)); // IST driver just after midnight
  assert.equal(parseExpenseDate("2026-10-17", NOW), null);
});

test("parseExpenseDate rejects malformed and impossible dates", () => {
  for (const bad of ["", "2026-2-3", "15/10/2026", "2026-02-31", "2026-13-01", 20261015, null]) {
    assert.equal(parseExpenseDate(bad as unknown, NOW), null, `should reject ${String(bad)}`);
  }
});

test("parseExpenseDate rejects dates more than a year old", () => {
  assert.equal(parseExpenseDate("2024-01-01", NOW), null);
});

// --- Receipt images ---------------------------------------------------------

test("parseReceiptDataUrl accepts jpeg/png/webp data URLs", () => {
  const ok = parseReceiptDataUrl("data:image/jpeg;base64,/9j/4AAQSkZJRg==");
  assert.equal(ok?.mime, "image/jpeg");
  assert.equal(ok?.bytes, 10);
  assert.ok(parseReceiptDataUrl("data:image/png;base64,iVBORw0KGgo="));
  assert.ok(parseReceiptDataUrl("data:image/webp;base64,UklGRg=="));
});

test("parseReceiptDataUrl rejects anything that could be served as script", () => {
  for (const bad of [
    "data:text/html;base64,PHNjcmlwdD4=",
    "data:image/svg+xml;base64,PHN2Zz4=",
    "data:image/jpeg;base64,not base64!!",
    "data:image/jpeg;charset=utf-8;base64,AAAA",
    "data:image/jpeg;base64,",
    "https://example.com/receipt.jpg",
    "",
    null,
    42,
  ]) {
    assert.equal(parseReceiptDataUrl(bad as unknown), null, `should reject ${String(bad)}`);
  }
});

test("parseReceiptDataUrl enforces the size cap", () => {
  const huge = "data:image/jpeg;base64," + "A".repeat(8 * 1024 * 1024);
  assert.equal(parseReceiptDataUrl(huge), null);
});

// --- Permissions ------------------------------------------------------------

test("odometer readings are kilometers, and a run is the distance since the last one", () => {
  assert.equal(parseOdometer(12345.64), 12345.6);
  assert.equal(parseOdometer("10000"), 10000);
  assert.equal(parseOdometer(0), 0);
  assert.equal(parseOdometer(-1), null);
  assert.equal(parseOdometer(""), null);
  assert.equal(parseOdometer("abc"), null);

  assert.equal(runKilometers(10000, 10180), 180);
  assert.equal(runKilometers(10000.2, 10000.8), 0.6);
  assert.equal(runKilometers(null, 500), null);
  assert.equal(runKilometers(500, 500), null);
  assert.equal(runKilometers(600, 500), null);
});

test("only HR and administrators can manage advances and approvals", () => {
  assert.equal(canManageIncomeExpense("hr"), true);
  assert.equal(canManageIncomeExpense("admin"), true);
  assert.equal(canManageIncomeExpense("super_admin"), true);
  assert.equal(canManageIncomeExpense("driver"), false);
  assert.equal(canManageIncomeExpense("employee"), false);
  assert.equal(canManageIncomeExpense(undefined), false);
  assert.equal(canManageIncomeExpense(null), false);
});
