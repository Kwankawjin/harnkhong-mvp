/**
 * Payment reminders and cycle history, worked out from the real group records.
 *
 * Nothing here is stored as a "notification": a reminder exists only while the money is
 * still owed, so it disappears by itself once the member pays (no repeat after payment).
 */
import { allApproved, shares } from "./domain.js";
import { currentCycle } from "./billing.js";

/** Days a member has to pay once their share is ready to pay. */
export const PAYMENT_GRACE_DAYS = 3;
/** How long cycle history is kept and shown. */
export const HISTORY_KEEP_DAYS = 3;

const DAY = 86_400_000;
const addDays = (at, days) => new Date(Date.parse(at) + days * DAY).toISOString();

/** Calendar days from `now` to `at` in the viewer's time zone (0 = today, 1 = tomorrow, -1 = yesterday). */
export function calendarDaysUntil(at, now = new Date()) {
  const due = new Date(at);
  const today = new Date(now);
  const start = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((start(due) - start(today)) / DAY);
}

/** today | tomorrow | overdue | upcoming */
export function reminderLevel(dueAt, now = new Date()) {
  const days = calendarDaysUntil(dueAt, now);
  if (days < 0) return "overdue";
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return "upcoming";
}

/**
 * When a one-time group became ready to pay: the last change recorded for its current
 * revision (the final confirmation). Null when the group is not ready yet.
 */
export function oneTimeReadyAt(group) {
  if (!allApproved(group)) return null;
  const times = (group.history || [])
    .filter((event) => Number(event.revision) === Number(group.revision) && event.at)
    .map((event) => Date.parse(event.at))
    .filter(Number.isFinite);
  return times.length ? new Date(Math.max(...times)).toISOString() : null;
}

/**
 * Everything this member still has to pay, with its due date. A share drops out of the list
 * as soon as a slip is sent (reported) or verified; a rejected slip puts it back.
 */
export function paymentReminders(groups, userId, now = new Date()) {
  const reminders = [];
  for (const group of groups || []) {
    if (!userId || !group.members?.includes(userId) || group.ownerId === userId) continue;
    if (group.status === "cancelled") continue;
    if (group.billing === "monthly") {
      const cycle = currentCycle(group);
      if (!cycle || cycle.status === "closed" || !cycle.members.includes(userId)) continue;
      const status = cycle.payments?.[userId];
      if (status === "reported" || status === "verified") continue;
      reminders.push({
        id: `pay:${group.id}:c${cycle.number}`,
        groupId: group.id,
        groupName: group.name,
        cycle: cycle.number,
        amount: Number(cycle.amounts?.[userId]) || 0,
        dueAt: addDays(cycle.start, PAYMENT_GRACE_DAYS),
        rejected: status === "rejected",
      });
      continue;
    }
    const report = group.paymentReport;
    if (report && Number(report.revision) === Number(group.revision) && ["reported", "verified"].includes(report.status)) continue;
    const readyAt = oneTimeReadyAt(group);
    if (!readyAt) continue;
    reminders.push({
      id: `pay:${group.id}:r${group.revision}`,
      groupId: group.id,
      groupName: group.name,
      amount: Number(shares(group)[userId]) || 0,
      dueAt: addDays(readyAt, PAYMENT_GRACE_DAYS),
      rejected: report?.status === "rejected",
    });
  }
  return reminders
    .map((reminder) => ({ ...reminder, level: reminderLevel(reminder.dueAt, now) }))
    .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt));
}

/** Cycle history entries still inside the keep window, newest first. */
export function recentCycleHistory(entries, now = new Date()) {
  const cutoff = new Date(now).getTime() - HISTORY_KEEP_DAYS * DAY;
  return [...(entries || [])]
    .filter((entry) => Date.parse(entry.at) >= cutoff)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

/**
 * What changed in a group's cycles between two versions of it: a new cycle started, or a
 * cycle moved to another status. Used to keep demo history the way the database trigger does.
 */
export function cycleChanges(before, after, now = new Date()) {
  const at = new Date(now).toISOString();
  const previous = new Map((before?.cycles || []).map((cycle) => [cycle.number, cycle.status]));
  const changes = [];
  for (const cycle of after?.cycles || []) {
    if (!previous.has(cycle.number)) changes.push({ cycle: cycle.number, event: "started", at });
    else if (previous.get(cycle.number) !== cycle.status) changes.push({ cycle: cycle.number, event: cycle.status, at });
  }
  return changes;
}
