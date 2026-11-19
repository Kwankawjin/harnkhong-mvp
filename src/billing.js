// Monthly billing cycles for groups and the HarnKhong Plus subscription.
// Every amount is in satang; every date is an ISO string. Functions are pure.
import { assertSatang, seatShares } from "./domain.js";

function fail(code, message) {
  throw Object.assign(new Error(message), { code });
}
const iso = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) fail("invalidDate", "วันที่ไม่ถูกต้อง");
  return date;
};

/** Same day next month; a day the month lacks clamps to its last day (31 Jan → 28/29 Feb). */
export function addMonths(value, months = 1) {
  const date = iso(value);
  const day = date.getUTCDate();
  const next = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1,
    date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds()));
  const last = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(day, last));
  return next.toISOString();
}

// ---------------------------------------------------------------- Group cycles

export const CYCLE_STATUSES = Object.freeze([
  "awaiting_confirmation", // amounts locked, members still confirming
  "confirmed", // everyone in the cycle confirmed: the cycle is complete and will not ask again
  "paid", // every confirmed share has a verified payment
  "closed", // the month ended
]);

export const currentCycle = (group) => group.cycles?.at(-1) ?? null;

// Cycle k runs from anchor + (k-1) months to anchor + k months, so a group started on the 31st
// does not drift to the 28th after February.
function snapshot(group, number, anchor) {
  const start = number === 1 ? anchor : addMonths(anchor, number - 1);
  const amounts = seatShares(group.costs, group.capacity, group.members, group.ownerId);
  return {
    number,
    start,
    end: addMonths(anchor, number),
    status: "awaiting_confirmation",
    members: [...group.members],
    ownerId: group.ownerId,
    costs: { ...group.costs },
    amounts,
    total: Object.values(amounts).reduce((sum, value) => sum + value, 0),
    confirmations: {},
    payments: {},
  };
}

/** The owner starts the first month; people who joined while gathering are all in it. */
export function startFirstCycle(group, actorId, now = new Date()) {
  if (group.billing !== "monthly") fail("notMonthly", "กลุ่มนี้ไม่ใช่แบบรายเดือน");
  if (group.ownerId !== actorId) fail("ownerOnly", "เฉพาะเจ้าของกลุ่มเริ่มรอบได้");
  if (group.cycles?.length) fail("cycleStarted", "กลุ่มเริ่มรอบไปแล้ว");
  if (group.status === "cancelled") fail("cancelledGroup", "กลุ่มนี้ยกเลิกแล้ว");
  const anchor = iso(now).toISOString();
  const cycle = snapshot(group, 1, anchor);
  return { ...group, status: "active", cycleAnchor: anchor, cycles: [cycle] };
}

/** Close every month that has ended and open the next one with the people in the group today. */
export function rollCycles(group, now = new Date()) {
  if (group.billing !== "monthly" || !group.cycles?.length) return group;
  const at = iso(now).toISOString();
  if (group.cycles.at(-1).end > at) return group;
  let cycles = [...group.cycles];
  let guard = 0;
  while (cycles.at(-1).end <= at) {
    if ((guard += 1) > 120) fail("cycleOverflow", "รอบค้างนานเกินไป");
    const last = cycles.at(-1);
    cycles[cycles.length - 1] = { ...last, status: "closed", closedFrom: last.status };
    if (group.status === "cancelled") break;
    cycles.push(snapshot(group, last.number + 1, group.cycleAnchor ?? cycles[0].start));
  }
  return { ...group, cycles };
}

/** One confirmation per person per cycle; a confirmed cycle never asks again. */
export function confirmCycle(group, userId, cycleNumber, now = new Date()) {
  const cycle = currentCycle(group);
  if (!cycle) fail("noCycle", "กลุ่มยังไม่เริ่มรอบ");
  if (cycle.number !== cycleNumber) fail("staleCycle", "รอบนี้ไม่ใช่รอบปัจจุบัน กรุณาดูรอบล่าสุด");
  if (cycle.status === "closed") fail("cycleClosed", "รอบนี้ปิดแล้ว");
  if (!cycle.members.includes(userId))
    fail("notInCycle", "คุณเริ่มจ่ายในรอบถัดไป");
  if (cycle.confirmations[userId]) fail("alreadyConfirmed", "คุณยืนยันรอบนี้แล้ว");
  const confirmations = { ...cycle.confirmations, [userId]: iso(now).toISOString() };
  const complete = cycle.members.every((id) => confirmations[id]);
  const next = { ...cycle, confirmations, status: complete ? "confirmed" : cycle.status };
  return { ...group, cycles: [...group.cycles.slice(0, -1), next] };
}

/** Record a payment state for one member of the current cycle (reported by them, verified by admin). */
export function recordCyclePayment(group, userId, cycleNumber, status, amount) {
  const cycle = currentCycle(group);
  if (!cycle || cycle.number !== cycleNumber) fail("staleCycle", "รอบนี้ไม่ใช่รอบปัจจุบัน");
  if (!cycle.members.includes(userId)) fail("notInCycle", "ไม่ได้อยู่ในรอบนี้");
  if (userId === cycle.ownerId)
    fail("ownerReceivesPayout", "เจ้าของกลุ่มไม่ต้องโอน ระบบจะโอนเงินจากสมาชิกให้หลังหักค่าคอม 2%");
  if (!cycle.confirmations[userId]) fail("confirmFirst", "กรุณายืนยันยอดก่อนชำระ");
  if (!["reported", "verified", "rejected"].includes(status)) fail("invalidStatus", "สถานะไม่ถูกต้อง");
  if (assertSatang(amount) !== cycle.amounts[userId])
    fail("amountMismatch", "ยอดชำระไม่ตรงกับยอดของรอบนี้");
  const payments = { ...cycle.payments, [userId]: status };
  // The owner does not transfer; the cycle is paid once every other member's payment is verified.
  const allPaid = cycle.status === "confirmed" && cycle.members.filter((id) => id !== cycle.ownerId).every((id) => payments[id] === "verified");
  const next = { ...cycle, payments, status: allPaid ? "paid" : cycle.status };
  return { ...group, cycles: [...group.cycles.slice(0, -1), next] };
}

/** A member whose payment was verified confirms they received the product or can use the app. */
export function confirmCycleReceipt(group, userId, cycleNumber, now = new Date()) {
  const cycle = group.cycles?.find((c) => c.number === cycleNumber);
  if (!cycle) fail("noCycle", "ไม่พบรอบนี้");
  if (userId === cycle.ownerId || cycle.payments[userId] !== "verified")
    fail("paymentNotVerified", "ยืนยันรับสินค้าได้หลังแอดมินตรวจการชำระของคุณแล้ว");
  const receipts = { ...(cycle.receipts || {}), [userId]: cycle.receipts?.[userId] || iso(now).toISOString() };
  return { ...group, cycles: group.cycles.map((c) => (c.number === cycleNumber ? { ...c, receipts } : c)) };
}
/** Money of this cycle is released to the owner once every payer is verified and received. */
export const cycleReleased = (cycle) =>
  Boolean(cycle) && cyclePayers(cycle).every((id) => cycle.payments[id] === "verified" && cycle.receipts?.[id]);

export const LAUNCH_PROMO = Object.freeze({ code: "HARN-WITH-JINN", months: 2, limit: 50 });
/** Demo-mode redemption of the launch code; the database enforces the 50-person limit. */
export function redeemPromo(existing, code, now = new Date()) {
  if (String(code || "").trim().toUpperCase() !== LAUNCH_PROMO.code) fail("promoInvalid", "โค้ดไม่ถูกต้อง");
  if (existing) fail("promoAlreadyUsed", "คุณใช้โค้ดนี้ไปแล้ว");
  const at = iso(now).toISOString();
  return { code: LAUNCH_PROMO.code, redeemedAt: at, waiverUntil: addMonths(at, LAUNCH_PROMO.months) };
}
export const commissionWaived = (promo, now = new Date()) =>
  Boolean(promo?.waiverUntil) && promo.waiverUntil > iso(now).toISOString();

/** Who transfers money this cycle: everyone in it except the owner. */
export const cyclePayers = (cycle) => (cycle ? cycle.members.filter((id) => id !== cycle.ownerId) : []);

/** True when this person has nothing to do this cycle because they joined after it started. */
export const waitsForNextCycle = (group, userId) => {
  const cycle = currentCycle(group);
  return Boolean(cycle && group.members.includes(userId) && !cycle.members.includes(userId));
};

// ---------------------------------------------------------------- Plus subscription

export const PLUS_PRICE_SATANG = 4900;
export const PLAN_GROUP_LIMITS = Object.freeze({ free: 2, plus: 5 });

export const emptySubscription = (userId) => ({
  userId,
  plan: "free",
  status: "none", // none | pending_payment | active | expired
  periodStart: null,
  periodEnd: null,
  payments: [],
});

/** The plan that applies right now; an active plan past its end date is free. */
export function effectivePlan(subscription, now = new Date()) {
  if (!subscription || subscription.status !== "active" || !subscription.periodEnd) return "free";
  return subscription.periodEnd > iso(now).toISOString() ? subscription.plan : "free";
}

/** Mark an ended Plus period as expired so the member is back on Free. */
export function expireSubscription(subscription, now = new Date()) {
  if (subscription?.status === "active" && subscription.periodEnd <= iso(now).toISOString())
    return { ...subscription, status: "expired", plan: "free" };
  return subscription;
}

/** Member transferred the monthly fee and attached a slip; an admin still has to verify it. */
export function reportSubscriptionPayment(subscription, { id, slipPath = null, transferredAt = null }, now = new Date()) {
  if (!id) fail("invalidId", "ไม่มีรหัสการชำระเงิน");
  if (subscription.payments.some((p) => p.status === "reported"))
    fail("paymentPending", "มีสลิปที่รอตรวจอยู่แล้ว");
  const payment = {
    id,
    amount: PLUS_PRICE_SATANG,
    status: "reported",
    slipPath,
    transferredAt,
    reportedAt: iso(now).toISOString(),
  };
  const current = expireSubscription(subscription, now);
  return {
    ...current,
    status: current.status === "active" ? "active" : "pending_payment",
    payments: [...current.payments, payment],
  };
}

/** Admin verified the slip: a new month starts now, or right after the current paid month. */
export function verifySubscriptionPayment(subscription, paymentId, now = new Date()) {
  const payment = subscription.payments.find((p) => p.id === paymentId);
  if (!payment) fail("paymentNotFound", "ไม่พบรายการชำระเงิน");
  if (payment.status !== "reported") fail("paymentNotPending", "รายการนี้ตรวจไปแล้ว");
  const at = iso(now).toISOString();
  const stillActive = subscription.status === "active" && subscription.periodEnd > at;
  const start = stillActive ? subscription.periodEnd : at;
  return {
    ...subscription,
    plan: "plus",
    status: "active",
    periodStart: stillActive ? subscription.periodStart : start,
    periodEnd: addMonths(start, 1),
    payments: subscription.payments.map((p) =>
      p.id === paymentId ? { ...p, status: "verified", verifiedAt: at, coversFrom: start, coversTo: addMonths(start, 1) } : p,
    ),
  };
}

export function rejectSubscriptionPayment(subscription, paymentId, note = "", now = new Date()) {
  const payment = subscription.payments.find((p) => p.id === paymentId);
  if (!payment) fail("paymentNotFound", "ไม่พบรายการชำระเงิน");
  if (payment.status !== "reported") fail("paymentNotPending", "รายการนี้ตรวจไปแล้ว");
  const payments = subscription.payments.map((p) =>
    p.id === paymentId ? { ...p, status: "rejected", rejectedAt: iso(now).toISOString(), note: String(note).slice(0, 500) } : p,
  );
  const status = subscription.status === "pending_payment" ? (subscription.periodEnd ? "expired" : "none") : subscription.status;
  return { ...subscription, status, payments };
}

/** How many open groups a person may own at once on their current plan. */
export const groupLimit = (subscription, now = new Date()) => PLAN_GROUP_LIMITS[effectivePlan(subscription, now)];
