function fail(code, message) {
  throw Object.assign(new Error(message), { code });
}
function assertId(id) {
  if (typeof id !== "string" || !id.trim() || id !== id.trim())
    fail("invalidId", "รหัสต้องเป็นข้อความไม่ว่างและไม่มีช่องว่างหัวท้าย");
  return id;
}
export function assertCapacity(capacity) {
  if (!Number.isSafeInteger(capacity) || capacity < 2 || capacity > 6)
    fail("invalidCapacity", "จำนวนสมาชิกต้องอยู่ระหว่าง 2–6 คน");
  return capacity;
}
export function assertSatang(value) {
  if (!Number.isSafeInteger(value) || value < 0)
    fail(
      "invalidSatang",
      "จำนวนเงินต้องเป็นสตางค์จำนวนเต็มที่ไม่ติดลบและไม่เกินขอบเขตที่รองรับ",
    );
  return value;
}
export function parseBaht(value) {
  const text = String(value).trim();
  if (!/^(0|[1-9]\d*)(\.\d{1,2})?$/.test(text))
    fail("invalidBaht", "ระบุจำนวนบาทไม่ติดลบและทศนิยมไม่เกิน 2 ตำแหน่ง");
  const [baht, satang = ""] = text.split(".");
  return assertSatang(Number(baht) * 100 + Number(satang.padEnd(2, "0")));
}
export function costBreakdown(costs, memberCount = 1) {
  const product = assertSatang(costs?.product),
    delivery = assertSatang(costs?.delivery);
  if (costs?.mode === SEAT_MODE) {
    if (!Number.isSafeInteger(memberCount) || memberCount < 1 || memberCount > 20)
      fail("invalidMembers", "จำนวนที่นั่งไม่ถูกต้อง");
    const deliveryTotal = assertSatang(delivery * memberCount);
    const subtotal = assertSatang(product + deliveryTotal);
    // Nobody pays a fee on top: the 2% commission comes out of what the owner receives.
    return {
      product,
      delivery: deliveryTotal,
      deliveryPerMember: delivery,
      service: 0,
      commissionFromOwner: true,
      total: subtotal,
    };
  }
  if (costs?.mode === "per_member_v2") {
    if (
      !Number.isSafeInteger(memberCount) ||
      memberCount < 1 ||
      memberCount > 6
    )
      fail("invalidMembers", "จำนวนสมาชิกไม่ถูกต้อง");
    const deliveryTotal = assertSatang(delivery * memberCount);
    const subtotal = assertSatang(product + deliveryTotal);
    const service = assertSatang(Number((BigInt(subtotal) * 2n + 50n) / 100n));
    return {
      product,
      delivery: deliveryTotal,
      deliveryPerMember: delivery,
      service,
      total: assertSatang(subtotal + service),
    };
  }
  const service = assertSatang(costs?.service);
  return {
    product,
    delivery,
    deliveryPerMember: null,
    service,
    total: assertSatang(product + delivery + service),
  };
}
/**
 * Platform commission: 2% of each payment a member makes, rounded to the nearest satang.
 * Members transfer to the platform; the platform keeps the commission and passes the rest to
 * the group owner. Example: a member pays 50.00, the owner receives 49.00.
 */
export const OWNER_FEE_PERCENT = 2;
export const SEAT_MODE = "seat_v3";
export const platformCommission = (amount) => ownerFee(amount);
/** What the owner receives for a set of member payments, each with its own 2% taken off. */
export function ownerPayout(payments) {
  const gross = payments.reduce((sum, amount) => sum + assertSatang(amount), 0);
  const commission = payments.reduce((sum, amount) => sum + platformCommission(amount), 0);
  return { gross, commission, net: gross - commission };
}
export function ownerFee(subtotal) {
  assertSatang(subtotal);
  return assertSatang(Number((BigInt(subtotal) * BigInt(OWNER_FEE_PERCENT) + 50n) / 100n));
}
export const BILLING_MODES = Object.freeze(["one_time", "monthly"]);
/**
 * Fixed seat prices: the product cost is split over every seat (not over the people present),
 * each seat adds its own delivery. Seat order is join order; the owner holds seat 0.
 * The owner's figure is their own seat plus any empty seats: the part of the cost they carry
 * themselves. Only the other members transfer money; see ownerPayout for what the owner gets.
 */
export function seatShares(costs, capacity, members, ownerId) {
  assertCapacityRange(capacity);
  if (!Array.isArray(members) || !members.length || new Set(members).size !== members.length)
    fail("invalidMembers", "ต้องมีสมาชิกอย่างน้อย 1 คนและไม่ซ้ำกัน");
  if (members.length > capacity) fail("fullGroup", "สมาชิกเกินจำนวนที่นั่ง");
  if (!members.includes(ownerId)) fail("ownerNotMember", "เจ้าของกลุ่มต้องอยู่ในกลุ่ม");
  const product = assertSatang(costs?.product), delivery = assertSatang(costs?.delivery);
  const seats = Array.from({ length: capacity }, (_, i) => `seat-${i}`);
  const seatProduct = allocate(product, seats);
  const ordered = [ownerId, ...members.filter((id) => id !== ownerId)];
  const result = {};
  ordered.forEach((id, index) => {
    result[id] = seatProduct[`seat-${index}`] + delivery;
  });
  for (let index = ordered.length; index < capacity; index += 1)
    result[ownerId] += seatProduct[`seat-${index}`] + delivery;
  return result;
}
function assertCapacityRange(capacity) {
  if (!Number.isSafeInteger(capacity) || capacity < 2 || capacity > 20)
    fail("invalidCapacity", "จำนวนที่นั่งไม่ถูกต้อง");
  return capacity;
}
/** What a person would pay for one seat if they joined now (never includes the owner fee). */
export function seatPrice(costs, capacity, seatIndex = capacity - 1) {
  assertCapacityRange(capacity);
  const seats = Array.from({ length: capacity }, (_, i) => `seat-${i}`);
  return allocate(assertSatang(costs?.product), seats)[`seat-${Math.min(Math.max(seatIndex, 0), capacity - 1)}`] + assertSatang(costs?.delivery);
}
export const totalCost = (costs, memberCount = 1) =>
  costBreakdown(costs, memberCount).total;
export function createGroup({
  id,
  listingId,
  name,
  ownerId,
  visibility,
  capacity,
  costs,
  billing = "one_time",
}) {
  [id, listingId, ownerId].forEach(assertId);
  if (!BILLING_MODES.includes(billing))
    fail("invalidBilling", "กรุณาเลือกแบบรายเดือนหรือรอบเดียวจบ");
  if (typeof name !== "string" || !name.trim())
    fail("invalidName", "กรุณาตั้งชื่อกลุ่ม");
  if (!["public", "link"].includes(visibility))
    fail("invalidVisibility", "กรุณาเลือกกลุ่มสาธารณะหรือเฉพาะลิงก์");
  assertCapacity(capacity);
  const nextCosts = {
    product: costs?.product,
    delivery: costs?.delivery,
    mode: SEAT_MODE,
  };
  totalCost(nextCosts, capacity);
  return {
    billing,
    id,
    listingId,
    name: name.trim(),
    ownerId,
    visibility,
    capacity,
    costs: nextCosts,
    members: [ownerId],
    revision: 1,
    approvals: {},
    status: billing === "monthly" ? "gathering" : "awaiting_approval",
    ...(billing === "monthly" ? { cycles: [] } : {}),
    history: [
      { revision: 1, reason: "สร้างกลุ่ม", at: new Date().toISOString() },
    ],
  };
}
export function allocate(total, members) {
  assertSatang(total);
  if (
    !Array.isArray(members) ||
    !members.length ||
    new Set(members).size !== members.length
  )
    fail("invalidMembers", "ต้องมีสมาชิกอย่างน้อย 1 คนและไม่ซ้ำกัน");
  members.forEach(assertId);
  const base = Math.floor(total / members.length),
    remainder = total % members.length;
  return Object.fromEntries(
    members.map((id, index) => [id, base + (index < remainder ? 1 : 0)]),
  );
}
export function shares(group) {
  if (group.costs?.mode === SEAT_MODE)
    return seatShares(group.costs, group.capacity, group.members, group.ownerId);
  const breakdown = costBreakdown(group.costs, group.members.length);
  const base = allocate(
    breakdown.total - (breakdown.deliveryPerMember ?? 0) * group.members.length,
    group.members,
  );
  return breakdown.deliveryPerMember === null
    ? base
    : Object.fromEntries(
        group.members.map((id) => [id, base[id] + breakdown.deliveryPerMember]),
      );
}
export const allApproved = (group) =>
  group.members.length === group.capacity &&
  group.members.every((id) => group.approvals[id] === group.revision) &&
  (group.adminApprovedRevision === undefined ||
    group.adminApprovedRevision === group.revision);
function revise(group, patch, reason) {
  return {
    ...group,
    ...patch,
    revision: group.revision + 1,
    approvals: {},
    status: "awaiting_approval",
    history: [
      ...group.history,
      { revision: group.revision + 1, reason, at: new Date().toISOString() },
    ],
  };
}
function assertEditable(group) {
  if (group.orderId)
    fail(
      "orderedGroupLocked",
      "กลุ่มมีคำสั่งซื้อแล้ว เปลี่ยนสมาชิก ค่าใช้จ่าย หรือหัวหน้าไม่ได้",
    );
}
export function joinGroup(group, userId) {
  assertEditable(group);
  assertId(userId);
  if (group.details?.closesAt && group.details.closesAt < new Date().toISOString().slice(0, 10))
    fail("groupClosed", "กลุ่มนี้ปิดรับสมาชิกแล้ว");
  if (group.status === "cancelled")
    fail("cancelledGroup", "กลุ่มนี้ยกเลิกแล้ว");
  if (group.members.includes(userId))
    fail("alreadyMember", "คุณเป็นสมาชิกกลุ่มนี้แล้ว");
  if (group.members.length >= group.capacity)
    fail("fullGroup", "กลุ่มนี้เต็มแล้ว");
  if (group.billing === "monthly")
    // Joining never touches the running cycle: the new member starts paying next cycle.
    return { ...group, members: [...group.members, userId] };
  return revise(
    group,
    { members: [...group.members, userId] },
    "สมาชิกเข้าร่วม",
  );
}
export function leaveGroup(group, userId) {
  assertEditable(group);
  if (!group.members.includes(userId))
    fail("notMember", "คุณไม่ได้อยู่ในกลุ่มนี้");
  if (group.ownerId === userId)
    fail("ownerMustTransfer", "หัวหน้ากลุ่มต้องโอนสิทธิ์ก่อนออก");
  if (group.billing === "monthly")
    // Leaving keeps this cycle's locked amounts; the member is left out from the next cycle.
    return { ...group, members: group.members.filter((id) => id !== userId) };
  return revise(
    group,
    { members: group.members.filter((id) => id !== userId) },
    "สมาชิกออก",
  );
}
export function transferOwner(group, actorId, nextOwnerId) {
  assertEditable(group);
  if (
    group.ownerId !== actorId ||
    !group.members.includes(nextOwnerId) ||
    actorId === nextOwnerId
  )
    fail("invalidTransfer", "โอนหัวหน้ากลุ่มไม่ได้");
  return { ...group, ownerId: nextOwnerId };
}
export function changeCosts(group, actorId, costs) {
  assertEditable(group);
  if (group.ownerId !== actorId)
    fail("ownerOnly", "เฉพาะหัวหน้ากลุ่มแก้ไขค่าใช้จ่ายได้");
  const nextCosts = {
    product: group.costs.product,
    delivery: costs?.delivery,
    mode: group.costs.mode === SEAT_MODE ? SEAT_MODE : "per_member_v2",
  };
  totalCost(nextCosts, group.capacity);
  if (group.billing === "monthly")
    return { ...group, costs: nextCosts }; // applies from the next cycle; the running cycle is locked
  return revise(group, { costs: nextCosts }, "ค่าใช้จ่ายเปลี่ยน");
}
export function approve(group, userId, revision) {
  assertEditable(group);
  if (!group.members.includes(userId))
    fail("approvalMemberOnly", "เฉพาะสมาชิกยืนยันยอดได้");
  if (revision !== group.revision)
    fail("staleRevision", "ยอดนี้ล้าสมัย กรุณาดูยอดล่าสุด");
  const next = {
    ...group,
    approvals: { ...group.approvals, [userId]: revision },
  };
  return { ...next, status: allApproved(next) ? "ready" : "awaiting_approval" };
}
