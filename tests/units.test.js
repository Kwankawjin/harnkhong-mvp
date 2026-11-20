import test from "node:test";
import assert from "node:assert/strict";
import {
  createGroup, joinGroup, leaveGroup, shares, unitShares, unitJoinPrice,
  openUnits, takenUnits, groupFull, allApproved, approve, UNIT_MODE, seatShares,
} from "../src/domain.js";

const base = { id: "g1", listingId: "p1", name: "หารทดสอบ", visibility: "public" };
const sum = (amounts) => Object.values(amounts).reduce((a, b) => a + b, 0);

test("ส่วน: คนหนึ่งเอา 2 อีกคนเอา 1 จ่ายตามจำนวนส่วน", () => {
  let g = createGroup({ ...base, ownerId: "owner", capacity: 3, ownerUnits: 1, costs: { product: 30000, delivery: 0 } });
  assert.equal(g.costs.mode, UNIT_MODE);
  g = joinGroup(g, "a", 2);
  assert.deepEqual(shares(g), { owner: 10000, a: 20000 });
  assert.equal(groupFull(g), true);
  assert.equal(openUnits(g), 0);
});

test("ส่วน: ค่าส่งคิดครั้งเดียวต่อคน ไม่ใช่ต่อส่วน", () => {
  let g = createGroup({ ...base, ownerId: "owner", capacity: 3, ownerUnits: 1, costs: { product: 30000, delivery: 4000 } });
  g = joinGroup(g, "a", 2);
  assert.deepEqual(shares(g), { owner: 14000, a: 24000 });
});

test("ขายอย่างเดียว: เจ้าของไม่ถือส่วน ส่วนที่ว่างเจ้าของรับเอง", () => {
  let g = createGroup({ ...base, ownerId: "owner", capacity: 4, ownerUnits: 0, costs: { product: 40000, delivery: 500 } });
  assert.equal(takenUnits(g), 0);
  g = joinGroup(g, "a", 3);
  assert.deepEqual(shares(g), { owner: 10000, a: 30500 });
  g = joinGroup(g, "b", 1);
  assert.deepEqual(shares(g), { owner: 0, a: 30500, b: 10500 });
  assert.equal(groupFull(g), true);
});

test("ส่วน: หารไม่ลงตัว เศษสตางค์ไม่หาย", () => {
  for (const product of [1, 100, 99999, 1000001]) {
    for (const capacity of [2, 3, 7, 20]) {
      const amounts = unitShares({ product, delivery: 0 }, capacity, ["owner", "a"], "owner", { owner: 1, a: capacity - 1 });
      assert.equal(sum(amounts), product);
      const partial = unitShares({ product, delivery: 0 }, capacity, ["owner", "a"], "owner", { owner: 0, a: 1 });
      assert.equal(sum(partial), product);
    }
  }
});

test("ราคาเข้าร่วมตรงกับยอดหลังเข้าร่วมจริง", () => {
  let g = createGroup({ ...base, ownerId: "owner", capacity: 7, ownerUnits: 2, costs: { product: 100000, delivery: 300 } });
  const price = unitJoinPrice(g, 3);
  g = joinGroup(g, "a", 3);
  assert.equal(shares(g).a, price);
});

test("เข้าร่วมเกินส่วนที่เหลือไม่ได้ และออกแล้วส่วนคืน", () => {
  let g = createGroup({ ...base, ownerId: "owner", capacity: 3, ownerUnits: 1, costs: { product: 300, delivery: 0 } });
  assert.throws(() => joinGroup(g, "a", 3), { code: "notEnoughUnits" });
  assert.throws(() => joinGroup(g, "a", 0), { code: "invalidUnits" });
  g = joinGroup(g, "a", 2);
  assert.throws(() => joinGroup(g, "b", 1), { code: "fullGroup" });
  g = leaveGroup(g, "a");
  assert.equal(openUnits(g), 2);
  assert.equal(g.units.a, undefined);
});

test("เจ้าของต้องเหลือส่วนให้คนอื่นอย่างน้อย 1 ส่วน", () => {
  assert.throws(() => createGroup({ ...base, ownerId: "owner", capacity: 3, ownerUnits: 3, costs: { product: 300, delivery: 0 } }), { code: "invalidUnits" });
});

test("ยืนยันยอดครบเมื่อส่วนเต็ม ไม่ใช่เมื่อคนครบ", () => {
  let g = createGroup({ ...base, ownerId: "owner", capacity: 4, ownerUnits: 1, costs: { product: 400, delivery: 0 } });
  g = joinGroup(g, "a", 3);
  g = approve(g, "owner", g.revision);
  g = approve(g, "a", g.revision);
  assert.equal(allApproved(g), true);
  assert.equal(g.status, "ready");
});

test("กลุ่มแบบที่นั่งเดิมคิดยอดเหมือนเดิม", () => {
  let g = createGroup({ ...base, ownerId: "owner", capacity: 4, costs: { product: 40000, delivery: 500 } });
  assert.equal(g.costs.mode, "seat_v3");
  g = joinGroup(g, "a");
  assert.deepEqual(shares(g), seatShares(g.costs, 4, ["owner", "a"], "owner"));
  assert.throws(() => joinGroup(g, "b", 2), { code: "invalidUnits" });
});
