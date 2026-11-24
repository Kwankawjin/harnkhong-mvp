import test from "node:test";
import assert from "node:assert/strict";
import { createGroup, joinGroup, leaveGroup, changeCosts, recommendGroups } from "../src/domain.js";
import { startFirstCycle, nextCycleForecast } from "../src/billing.js";

const monthly = () => {
  let g = createGroup({ id: "m1", listingId: "p1", name: "Netflix", ownerId: "o", visibility: "public", capacity: 4, costs: { product: 40000, delivery: 0 }, billing: "monthly", payDay: 15 });
  g = joinGroup(g, "a");
  g = joinGroup(g, "b");
  return startFirstCycle(g, "o", new Date("2026-11-01T00:00:00Z"));
};

test("รอบถัดไป: ยอดเท่าเดิมเมื่อไม่มีอะไรเปลี่ยน และบอกวันเริ่มรอบ", () => {
  const g = monthly();
  const f = nextCycleForecast(g, "a");
  assert.equal(f.number, 2);
  assert.equal(f.amount, 10000);
  assert.equal(f.previous, 10000);
  assert.equal(f.changed, false);
  assert.equal(f.startsAt, g.cycles[0].end);
});

test("รอบถัดไป: มีคนเข้าใหม่ ยอดที่นั่งคงที่ไม่เปลี่ยน แต่ค่าส่งเปลี่ยนแล้วบอกเหตุผล", () => {
  let g = joinGroup(monthly(), "c");
  assert.equal(nextCycleForecast(g, "a").changed, false);
  g = changeCosts(g, "o", { delivery: 500 });
  const f = nextCycleForecast(g, "a");
  assert.equal(f.amount, 10500);
  assert.equal(f.changed, true);
  assert.deepEqual(f.reasons.map((r) => r.kind), ["joined", "costs"]);
});

test("รอบถัดไป: คนที่ออกแล้วไม่มียอดรอบหน้า คนที่เพิ่งเข้าเห็นยอดแรกของตัวเอง", () => {
  let g = joinGroup(monthly(), "c");
  assert.equal(nextCycleForecast(g, "c").previous, null);
  assert.equal(nextCycleForecast(g, "c").amount, 10000);
  g = leaveGroup(g, "b");
  assert.equal(nextCycleForecast(g, "b"), null);
});

test("กลุ่มรอบเดียวไม่มียอดรอบหน้า", () => {
  const g = createGroup({ id: "o1", listingId: "p1", name: "x", ownerId: "o", visibility: "public", capacity: 2, costs: { product: 100, delivery: 0 } });
  assert.equal(nextCycleForecast(g, "o"), null);
});

const group = (id, extra = {}) => ({
  ...createGroup({ id, listingId: "p1", name: id, ownerId: "o-" + id, visibility: "public", capacity: 4, costs: { product: 400, delivery: 0 } }),
  ...extra,
});

test("กลุ่มแนะนำ: หมวดเดียวกันก่อน แล้วกลุ่มที่ใกล้เต็ม ไม่เอากลุ่มที่อยู่แล้ว เต็ม ส่วนตัว หรือรายการขาย", () => {
  const current = { ...group("cur"), category: "แฟชั่น" };
  const nearFull = { ...joinGroup(joinGroup(group("near"), "x"), "y"), category: "อาหาร" };
  const sameCat = { ...group("same"), category: "แฟชั่น" };
  const mine = { ...joinGroup(group("mine"), "me"), category: "แฟชั่น" };
  const full = { ...joinGroup(joinGroup(joinGroup(group("full"), "x"), "y"), "z"), category: "แฟชั่น" };
  const privateGroup = { ...group("priv"), category: "แฟชั่น", details: { visibilityMode: "private" } };
  const linkOnly = { ...group("link"), visibility: "link" };
  const sale = { ...group("sale"), costs: { product: 100, delivery: 0, mode: "sale_v1" } };
  const lonely = { ...group("lonely"), category: "อาหาร" };
  const picks = recommendGroups([current, nearFull, sameCat, mine, full, privateGroup, linkOnly, sale, lonely], current, "me");
  assert.deepEqual(picks.map((g) => g.id), ["same", "near", "lonely"]);
});

import { closeGroup, endAfterCycle, monthlyEnded, rollCycles } from "../src/billing.js";

test("ปิดกลุ่มรอบเดียว: เจ้าของปิดได้เมื่อทุกคนยืนยันครบ คนอื่นปิดไม่ได้", () => {
  let g = createGroup({ id: "x1", listingId: "p1", name: "x", ownerId: "o", visibility: "public", capacity: 2, costs: { product: 100, delivery: 0 } });
  assert.throws(() => closeGroup(g, "o"), { code: "groupNotFinished" });
  g = joinGroup(g, "a");
  g = { ...g, approvals: { o: g.revision, a: g.revision } };
  assert.throws(() => closeGroup(g, "a"), { code: "ownerOnly" });
  assert.ok(closeGroup(g, "o").closedAt);
});

test("จบกลุ่มรายเดือน: เลือกรอบสุดท้าย ไม่เปิดรอบใหม่ ไม่มียอดรอบหน้า แล้วปิดได้เมื่อรอบจบ", () => {
  let g = monthly();
  assert.throws(() => endAfterCycle(g, "a", 1), { code: "ownerOnly" });
  assert.throws(() => endAfterCycle(g, "o", 0), { code: "invalidLastCycle" });
  g = endAfterCycle(g, "o", 1);
  assert.equal(nextCycleForecast(g, "a"), null);
  const later = new Date(new Date(g.cycles[0].end).getTime() + 40 * 86_400_000);
  const rolled = rollCycles(g, later);
  assert.equal(rolled.cycles.length, 1);
  assert.equal(rolled.cycles[0].status, "closed");
  assert.equal(monthlyEnded(rolled, later), true);
  assert.ok(closeGroup(rolled, "o", later).closedAt);
  assert.equal(endAfterCycle(g, "o", null).lastCycle, null);
});
