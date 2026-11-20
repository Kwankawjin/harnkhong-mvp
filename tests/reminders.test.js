import test from "node:test";
import assert from "node:assert/strict";
import {
  calendarDaysUntil,
  cycleChanges,
  oneTimeReadyAt,
  paymentReminders,
  recentCycleHistory,
  reminderLevel,
} from "../src/reminders.js";

const DAY = 86_400_000;
const at = (base, days) => new Date(Date.parse(base) + days * DAY).toISOString();

function oneTime(overrides = {}) {
  return {
    id: "g1",
    name: "Netflix",
    billing: "one_time",
    ownerId: "owner",
    members: ["owner", "me"],
    capacity: 2,
    revision: 2,
    approvals: { owner: 2, me: 2 },
    adminApprovedRevision: 2,
    costs: { product: 20000, delivery: 0, mode: "seat_v3" },
    history: [
      { revision: 1, at: "2026-11-10T03:00:00.000Z" },
      { revision: 2, at: "2026-11-18T03:00:00.000Z" },
    ],
    paymentReport: null,
    ...overrides,
  };
}

function monthly(payment, start = "2026-11-18T03:00:00.000Z") {
  return {
    id: "m1",
    name: "Spotify",
    billing: "monthly",
    ownerId: "owner",
    members: ["owner", "me"],
    cycles: [
      {
        number: 1,
        start,
        end: at(start, 30),
        status: "confirmed",
        members: ["owner", "me"],
        ownerId: "owner",
        amounts: { owner: 5000, me: 5000 },
        confirmations: { owner: start, me: start },
        payments: payment ? { me: payment } : {},
      },
    ],
  };
}

test("reminder level follows calendar days, not hours", () => {
  const now = new Date(2026, 10, 20, 23, 30);
  assert.equal(calendarDaysUntil(new Date(2026, 10, 21, 0, 10), now), 1);
  assert.equal(reminderLevel(new Date(2026, 10, 20, 8), now), "today");
  assert.equal(reminderLevel(new Date(2026, 10, 21, 8), now), "tomorrow");
  assert.equal(reminderLevel(new Date(2026, 10, 19, 8), now), "overdue");
  assert.equal(reminderLevel(new Date(2026, 10, 25, 8), now), "upcoming");
});

test("a one-time group is due 3 days after its last confirmation", () => {
  const g = oneTime();
  assert.equal(oneTimeReadyAt(g), "2026-11-18T03:00:00.000Z");
  const [reminder] = paymentReminders([g], "me", new Date("2026-11-21T02:00:00.000Z"));
  assert.equal(reminder.dueAt, "2026-11-21T03:00:00.000Z");
  assert.equal(reminder.amount, 10000);
  assert.equal(reminder.level, "today");
});

test("no reminder before the group is ready, for the owner, or once paid", () => {
  const notFull = oneTime({ members: ["owner"], approvals: { owner: 2 } });
  assert.deepEqual(paymentReminders([notFull], "owner"), []);
  assert.deepEqual(paymentReminders([oneTime()], "owner"), []);
  for (const status of ["reported", "verified"]) {
    const paid = oneTime({ paymentReport: { revision: 2, status } });
    assert.deepEqual(paymentReminders([paid], "me"), []);
  }
  // A slip from an older revision does not count as paying the current amount.
  const stale = oneTime({ paymentReport: { revision: 1, status: "verified" } });
  assert.equal(paymentReminders([stale], "me").length, 1);
});

test("a rejected slip brings the reminder back", () => {
  const rejected = oneTime({ paymentReport: { revision: 2, status: "rejected" } });
  const [reminder] = paymentReminders([rejected], "me");
  assert.equal(reminder.rejected, true);
});

test("monthly reminders run from the cycle start and stop after payment", () => {
  const [reminder] = paymentReminders([monthly()], "me", new Date("2026-11-20T03:00:00.000Z"));
  assert.equal(reminder.dueAt, "2026-11-21T03:00:00.000Z");
  assert.equal(reminder.cycle, 1);
  assert.equal(paymentReminders([monthly("reported")], "me").length, 0);
  assert.equal(paymentReminders([monthly("verified")], "me").length, 0);
  assert.equal(paymentReminders([monthly()], "owner").length, 0);
});

test("cycle history keeps only the last 3 days, newest first", () => {
  const now = new Date("2026-11-20T12:00:00.000Z");
  const kept = recentCycleHistory(
    [
      { cycle: 1, event: "started", at: "2026-11-16T12:00:00.000Z" },
      { cycle: 1, event: "confirmed", at: "2026-11-18T12:00:00.000Z" },
      { cycle: 1, event: "paid", at: "2026-11-19T12:00:00.000Z" },
    ],
    now,
  );
  assert.deepEqual(kept.map((e) => e.event), ["paid", "confirmed"]);
});

test("cycle changes record a new cycle and status moves only", () => {
  const before = monthly();
  const after = {
    ...before,
    cycles: [
      { ...before.cycles[0], status: "closed" },
      { ...before.cycles[0], number: 2, status: "awaiting_confirmation" },
    ],
  };
  const now = new Date("2026-12-18T03:00:00.000Z");
  assert.deepEqual(cycleChanges(before, after, now).map((c) => `${c.cycle}:${c.event}`), ["1:closed", "2:started"]);
  assert.deepEqual(cycleChanges(after, after, now), []);
});
