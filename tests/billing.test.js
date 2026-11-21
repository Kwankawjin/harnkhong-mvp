import test from "node:test";
import assert from "node:assert/strict";
import {
  createGroup,
  joinGroup,
  leaveGroup,
  changeCosts,
  seatShares,
  seatPrice,
  ownerFee,
  ownerPayout,
  platformCommission,
  costBreakdown,
  shares,
} from "../src/domain.js";
import {
  addMonths,
  startFirstCycle,
  rollCycles,
  confirmCycle,
  recordCyclePayment,
  currentCycle,
  cyclePayers,
  waitsForNextCycle,
  emptySubscription,
  effectivePlan,
  expireSubscription,
  reportSubscriptionPayment,
  verifySubscriptionPayment,
  rejectSubscriptionPayment,
  groupLimit,
  PLUS_PRICE_SATANG,
} from "../src/billing.js";

const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
const monthly = (over = {}) =>
  createGroup({
    id: "g1",
    listingId: "p1",
    name: "หาร Netflix",
    ownerId: "owner",
    visibility: "public",
    capacity: 4,
    costs: { product: 41900, delivery: 0 },
    billing: "monthly",
    ...over,
  });

// ---------------------------------------------------------------- fee

test("ค่าธรรมเนียม 2% คิดจากยอดรวมกลุ่ม ปัดเป็นสตางค์ใกล้สุด", () => {
  assert.equal(ownerFee(41900), 838);
  assert.equal(ownerFee(25), 1); // 0.5 สตางค์ ปัดขึ้น
  assert.equal(ownerFee(24), 0);
  assert.equal(ownerFee(0), 0);
});

test("ตัวอย่างจริง: ของ 100 บาท หาร 50 สมาชิกโอน 50 เจ้าของได้ 49", () => {
  const amounts = seatShares({ product: 10000, delivery: 0 }, 2, ["owner", "a"], "owner");
  assert.deepEqual(amounts, { owner: 5000, a: 5000 }, "ผู้ร่วมหารจ่ายครึ่งเดียว ไม่มีค่าธรรมเนียมบวกเพิ่ม");
  assert.equal(platformCommission(amounts.a), 100);
  assert.deepEqual(ownerPayout([amounts.a]), { gross: 5000, commission: 100, net: 4900 });
});

test("ค่าคอมหักจากเงินแต่ละก้อนที่สมาชิกโอน ไม่ได้บวกให้ใครจ่ายเพิ่ม", () => {
  const amounts = seatShares({ product: 40000, delivery: 0 }, 4, ["owner", "a", "b", "c"], "owner");
  assert.deepEqual(amounts, { owner: 10000, a: 10000, b: 10000, c: 10000 });
  assert.deepEqual(ownerPayout([amounts.a, amounts.b, amounts.c]), { gross: 30000, commission: 600, net: 29400 });
  assert.deepEqual(ownerPayout([]), { gross: 0, commission: 0, net: 0 });
});

test("ยอดของทุกที่นั่งรวมกันเท่ากับค่าสินค้า + ค่าส่ง พอดี ทุกกรณี", () => {
  for (const [product, delivery, capacity] of [[41901, 0, 4], [100, 7, 3], [1, 0, 6], [999999, 4000, 5]]) {
    for (let present = 1; present <= capacity; present += 1) {
      const members = ["owner", ...Array.from({ length: present - 1 }, (_, i) => `m${i}`)];
      const amounts = seatShares({ product, delivery }, capacity, members, "owner");
      assert.equal(sum(amounts), product + delivery * capacity, `${product}/${capacity}/${present}`);
      const breakdown = costBreakdown({ product, delivery, mode: "seat_v3" }, capacity);
      assert.equal(breakdown.total, sum(amounts));
      assert.equal(breakdown.service, 0);
      assert.equal(breakdown.commissionFromOwner, true);
    }
  }
});

test("ที่นั่งว่าง เจ้าของกลุ่มรับไว้เอง ผู้เข้าร่วมจ่ายราคาที่นั่งเท่าเดิม", () => {
  const two = seatShares({ product: 40000, delivery: 500 }, 4, ["owner", "a"], "owner");
  const four = seatShares({ product: 40000, delivery: 500 }, 4, ["owner", "a", "b", "c"], "owner");
  assert.equal(two.a, four.a);
  assert.equal(two.a, 10500);
  assert.equal(two.owner, 10500 * 3);
  assert.equal(seatPrice({ product: 40000, delivery: 500 }, 4), 10500);
});

test("กลุ่มใหม่ใช้ราคาต่อที่นั่ง กลุ่มเก่า (per_member_v2) คงยอดแบบเดิม", () => {
  const fresh = createGroup({ id: "n", listingId: "p", name: "x", ownerId: "o", visibility: "public", capacity: 2, costs: { product: 1000, delivery: 0 } });
  assert.equal(fresh.costs.mode, "seat_v3");
  assert.equal(fresh.billing, "one_time");
  const legacy = { ...fresh, costs: { product: 1000, delivery: 0, mode: "per_member_v2" }, members: ["o", "p"] };
  assert.deepEqual(shares(legacy), { o: 510, p: 510 }); // old rule: fee split by everyone
  assert.deepEqual(shares({ ...fresh, members: ["o", "p"] }), { o: 500, p: 500 });
});

test("เลือกแบบชำระได้ตอนสร้างกลุ่ม และปฏิเสธค่าที่ไม่รู้จัก", () => {
  assert.equal(monthly().billing, "monthly");
  assert.equal(monthly().status, "gathering");
  assert.throws(() => monthly({ billing: "weekly" }), { code: "invalidBilling" });
});

// ---------------------------------------------------------------- cycles

test("วันสิ้นรอบเลื่อนทีละเดือน และไม่เลื่อนวันเมื่อผ่านเดือนสั้น", () => {
  assert.equal(addMonths("2026-01-31T09:00:00.000Z"), "2026-02-28T09:00:00.000Z");
  let g = startFirstCycle(joinGroup(monthly(), "a"), "owner", "2026-01-31T09:00:00.000Z");
  g = rollCycles(g, "2026-03-01T00:00:00.000Z");
  assert.equal(currentCycle(g).start, "2026-02-28T09:00:00.000Z");
  assert.equal(currentCycle(g).end, "2026-03-31T09:00:00.000Z");
});

test("เริ่มรอบแรกได้เฉพาะเจ้าของ และคนที่เข้าก่อนเริ่มอยู่ในรอบแรก", () => {
  let g = joinGroup(joinGroup(monthly(), "a"), "b");
  assert.throws(() => startFirstCycle(g, "a"), { code: "ownerOnly" });
  g = startFirstCycle(g, "owner", "2026-11-01T00:00:00.000Z");
  const cycle = currentCycle(g);
  assert.equal(cycle.number, 1);
  assert.deepEqual(cycle.members, ["owner", "a", "b"]);
  assert.equal(cycle.start, "2026-11-01T00:00:00.000Z");
  assert.equal(cycle.end, "2026-12-01T00:00:00.000Z");
  assert.equal(cycle.status, "awaiting_confirmation");
  assert.throws(() => startFirstCycle(g, "owner"), { code: "cycleStarted" });
});

test("คนเข้าหรือออกกลางรอบ ยอดและรายชื่อของรอบนี้ไม่เปลี่ยน", () => {
  let g = startFirstCycle(joinGroup(monthly(), "a"), "owner", "2026-11-01T00:00:00.000Z");
  const before = structuredClone(currentCycle(g));
  g = confirmCycle(g, "a", 1, "2026-11-02T00:00:00.000Z");
  g = joinGroup(g, "late");
  g = leaveGroup(g, "a");
  const cycle = currentCycle(g);
  assert.deepEqual(cycle.amounts, before.amounts);
  assert.deepEqual(cycle.members, before.members);
  assert.ok(cycle.confirmations.a, "การยืนยันเดิมไม่ถูกล้าง");
  assert.equal(waitsForNextCycle(g, "late"), true);
  assert.throws(() => confirmCycle(g, "late", 1), { code: "notInCycle" });
});

test("ยืนยันครบทุกคนแล้วรอบสมบูรณ์ และยืนยันซ้ำในรอบเดิมไม่ได้", () => {
  let g = startFirstCycle(joinGroup(monthly(), "a"), "owner", "2026-11-01T00:00:00.000Z");
  g = confirmCycle(g, "owner", 1, "2026-11-01T01:00:00.000Z");
  assert.equal(currentCycle(g).status, "awaiting_confirmation");
  g = confirmCycle(g, "a", 1, "2026-11-01T02:00:00.000Z");
  assert.equal(currentCycle(g).status, "confirmed");
  assert.throws(() => confirmCycle(g, "a", 1), { code: "alreadyConfirmed" });
  assert.throws(() => confirmCycle(g, "a", 2), { code: "staleCycle" });
});

test("ขึ้นเดือนใหม่: ปิดรอบเก่า เปิดรอบใหม่ด้วยสมาชิกปัจจุบัน ต้องยืนยันใหม่", () => {
  let g = startFirstCycle(joinGroup(monthly(), "a"), "owner", "2026-11-01T00:00:00.000Z");
  g = confirmCycle(confirmCycle(g, "owner", 1), "a", 1);
  g = leaveGroup(joinGroup(g, "late"), "a");
  g = rollCycles(g, "2026-12-01T00:00:00.000Z");
  assert.equal(g.cycles.length, 2);
  assert.equal(g.cycles[0].status, "closed");
  assert.equal(g.cycles[0].closedFrom, "confirmed");
  const next = currentCycle(g);
  assert.equal(next.number, 2);
  assert.deepEqual(next.members, ["owner", "late"]);
  assert.deepEqual(next.confirmations, {});
  assert.equal(next.status, "awaiting_confirmation");
  assert.equal(next.amounts.late, 10475);
  assert.equal(sum(next.amounts), 41900);
});

test("ยังไม่ถึงสิ้นเดือน ไม่ขึ้นรอบใหม่ และข้ามหลายเดือนได้ถูกต้อง", () => {
  let g = startFirstCycle(monthly(), "owner", "2026-11-01T00:00:00.000Z");
  assert.equal(rollCycles(g, "2026-11-30T23:59:59.000Z"), g);
  g = rollCycles(g, "2027-02-15T00:00:00.000Z");
  assert.deepEqual(g.cycles.map((c) => c.number), [1, 2, 3, 4]);
  assert.ok(g.cycles.slice(0, 3).every((c) => c.status === "closed"));
});

test("เปลี่ยนค่าส่งของกลุ่มรายเดือน มีผลรอบถัดไป ไม่กระทบรอบที่ยืนยันแล้ว", () => {
  let g = startFirstCycle(joinGroup(monthly({ costs: { product: 40000, delivery: 0 } }), "a"), "owner", "2026-11-01T00:00:00.000Z");
  const locked = currentCycle(g).amounts;
  g = changeCosts(g, "owner", { delivery: 1000 });
  assert.deepEqual(currentCycle(g).amounts, locked);
  g = rollCycles(g, "2026-12-01T00:00:00.000Z");
  assert.equal(currentCycle(g).amounts.a, 11000);
});

test("เจ้าของไม่ต้องโอน: รอบชำระครบเมื่อสมาชิกคนอื่นจ่ายครบ และยอดต้องตรง", () => {
  let g = startFirstCycle(joinGroup(monthly({ costs: { product: 40000, delivery: 0 } }), "a"), "owner", "2026-11-01T00:00:00.000Z");
  assert.deepEqual(cyclePayers(currentCycle(g)), ["a"]);
  assert.throws(() => recordCyclePayment(g, "a", 1, "reported", 10000), { code: "confirmFirst" });
  g = confirmCycle(confirmCycle(g, "owner", 1), "a", 1);
  assert.throws(() => recordCyclePayment(g, "owner", 1, "reported", 30000), { code: "ownerReceivesPayout" });
  assert.throws(() => recordCyclePayment(g, "a", 1, "verified", 9999), { code: "amountMismatch" });
  g = recordCyclePayment(g, "a", 1, "verified", 10000);
  assert.equal(currentCycle(g).status, "paid");
  assert.deepEqual(ownerPayout([currentCycle(g).amounts.a]), { gross: 10000, commission: 200, net: 9800 });
});

// ---------------------------------------------------------------- Plus

test("Plus: แนบสลิปแล้วรอตรวจ ยังเป็น Free จนแอดมินยืนยัน", () => {
  let s = reportSubscriptionPayment(emptySubscription("u"), { id: "p1" }, "2026-11-10T00:00:00.000Z");
  assert.equal(s.status, "pending_payment");
  assert.equal(s.payments[0].amount, PLUS_PRICE_SATANG);
  assert.equal(effectivePlan(s, "2026-11-10T00:00:00.000Z"), "free");
  assert.throws(() => reportSubscriptionPayment(s, { id: "p2" }), { code: "paymentPending" });
  s = verifySubscriptionPayment(s, "p1", "2026-11-11T00:00:00.000Z");
  assert.equal(s.status, "active");
  assert.equal(s.periodStart, "2026-11-11T00:00:00.000Z");
  assert.equal(s.periodEnd, "2026-12-11T00:00:00.000Z");
  assert.equal(effectivePlan(s, "2026-12-10T23:00:00.000Z"), "plus");
  assert.equal(groupLimit(s, "2026-12-10T23:00:00.000Z"), 5);
});

test("Plus: ต่ออายุก่อนหมด นับเดือนใหม่ต่อจากวันสิ้นสุดเดิม", () => {
  let s = verifySubscriptionPayment(reportSubscriptionPayment(emptySubscription("u"), { id: "p1" }, "2026-11-11T00:00:00.000Z"), "p1", "2026-11-11T00:00:00.000Z");
  s = reportSubscriptionPayment(s, { id: "p2" }, "2026-12-05T00:00:00.000Z");
  assert.equal(s.status, "active");
  s = verifySubscriptionPayment(s, "p2", "2026-12-06T00:00:00.000Z");
  assert.equal(s.periodStart, "2026-11-11T00:00:00.000Z");
  assert.equal(s.periodEnd, "2027-01-11T00:00:00.000Z");
});

test("Plus: หมดอายุแล้วกลับเป็น Free และต่ออายุหลังหมดเริ่มนับใหม่", () => {
  let s = verifySubscriptionPayment(reportSubscriptionPayment(emptySubscription("u"), { id: "p1" }, "2026-11-11T00:00:00.000Z"), "p1", "2026-11-11T00:00:00.000Z");
  assert.equal(effectivePlan(s, "2026-12-11T00:00:00.000Z"), "free");
  assert.equal(groupLimit(s, "2026-12-11T00:00:00.000Z"), 2);
  s = expireSubscription(s, "2026-12-20T00:00:00.000Z");
  assert.equal(s.status, "expired");
  s = verifySubscriptionPayment(reportSubscriptionPayment(s, { id: "p2" }, "2026-12-20T00:00:00.000Z"), "p2", "2026-12-21T00:00:00.000Z");
  assert.equal(s.periodStart, "2026-12-21T00:00:00.000Z");
  assert.equal(s.periodEnd, "2027-01-21T00:00:00.000Z");
});

test("Plus: แอดมินปฏิเสธสลิป สถานะกลับเป็นเดิมและตรวจซ้ำไม่ได้", () => {
  let s = reportSubscriptionPayment(emptySubscription("u"), { id: "p1" }, "2026-11-10T00:00:00.000Z");
  s = rejectSubscriptionPayment(s, "p1", "ยอดไม่ตรง");
  assert.equal(s.status, "none");
  assert.equal(s.payments[0].status, "rejected");
  assert.throws(() => verifySubscriptionPayment(s, "p1"), { code: "paymentNotPending" });
});

test("pay day: the first cycle starts on the next pay date at least 3 days away", async () => {
  const { firstPayDate } = await import("../src/billing.js");
  const day = (d) => [d.getFullYear(), d.getMonth() + 1, d.getDate()].join("-");
  assert.equal(day(firstPayDate(new Date(2026, 10, 1, 9), 5)), "2026-11-5");
  assert.equal(day(firstPayDate(new Date(2026, 10, 3, 9), 5)), "2026-12-5");
  assert.equal(day(firstPayDate(new Date(2026, 10, 20, 9), 5)), "2026-12-5");
  assert.equal(day(firstPayDate(new Date(2026, 11, 27, 9), 28)), "2027-1-28");
});

test("pay day: a monthly group with a pay day starts its cycle on it and is due that day", async () => {
  const { createGroup } = await import("../src/domain.js");
  const { startFirstCycle } = await import("../src/billing.js");
  const { paymentReminders } = await import("../src/reminders.js");
  const g = createGroup({ id: "pd1", listingId: "l1", name: "Spotify", ownerId: "owner", visibility: "public", capacity: 2, costs: { product: 10000, delivery: 0 }, billing: "monthly", payDay: 5 });
  assert.throws(() => createGroup({ id: "pd2", listingId: "l1", name: "x", ownerId: "owner", visibility: "public", capacity: 2, costs: { product: 10000, delivery: 0 }, billing: "monthly", payDay: 31 }));
  const started = startFirstCycle({ ...g, members: ["owner", "me"] }, "owner", new Date(2026, 10, 20, 9));
  const cycle = started.cycles[0];
  assert.equal(new Date(cycle.start).getDate(), 5);
  assert.equal(new Date(cycle.start).getMonth(), 11);
  const confirmed = { ...started, cycles: [{ ...cycle, confirmations: { owner: "x", me: "x" }, status: "confirmed" }] };
  const [reminder] = paymentReminders([confirmed], "me", new Date(2026, 11, 4, 12));
  assert.equal(reminder.dueAt, new Date(cycle.start).toISOString());
  assert.equal(reminder.level, "tomorrow");
});
