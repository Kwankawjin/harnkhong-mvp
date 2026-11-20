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
  if (costs?.mode === SEAT_MODE || costs?.mode === UNIT_MODE) {
    if (!Number.isSafeInteger(memberCount) || memberCount < 0 || memberCount > 20)
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
/**
 * Unit pricing: the item is split into `capacity` equal parts and each member takes one or more.
 * Delivery is charged once per person who takes at least one part. The owner may take no parts
 * at all (selling only); parts nobody took are carried by the owner, like empty seats.
 */
export const UNIT_MODE = "unit_v4";
export const MAX_UNITS = 20;
/**
 * Selling (no split): the seller sets a price per item, how many are for sale and a delivery
 * charge per buyer. Each buyer takes any quantity and pays quantity × price + delivery through the
 * platform; the seller gets each payment minus the 2% commission. Promo codes never waive it.
 * Buyers do not wait for each other: every purchase stands on its own.
 */
export const SALE_MODE = "sale_v1";
export const MAX_STOCK = 999;
/** Seat, unit or sale pricing: fixed prices, the owner never transfers and receives the payments minus 2%. */
export const seatPriced = (costs) => [SEAT_MODE, UNIT_MODE, SALE_MODE].includes(costs?.mode);
export const saleMode = (group) => group?.costs?.mode === SALE_MODE;
/** Groups where people take a number of parts or items. */
export const unitMode = (group) => group?.costs?.mode === UNIT_MODE || saleMode(group);
/** How many parts this member holds (1 for every seat-priced group). */
export const unitsOf = (group, id) => {
  const value = group?.units?.[id];
  return Number.isSafeInteger(value) && value >= 0 ? value : 1;
};
export const takenUnits = (group) => group.members.reduce((sum, id) => sum + unitsOf(group, id), 0);
export const openUnits = (group) => Math.max(0, group.capacity - takenUnits(group));
export const groupFull = (group) => takenUnits(group) >= group.capacity;
/** People who receive a delivery: everyone holding at least one part. */
export const unitHolders = (group) => group.members.filter((id) => unitsOf(group, id) > 0);
/**
 * Unit shares: the product is allocated over every part in order (owner first, then join order),
 * each person holding parts adds one delivery, and parts nobody took go to the owner.
 */
export function unitShares(costs, capacity, members, ownerId, units = {}) {
  if (!Number.isSafeInteger(capacity) || capacity < 2 || capacity > MAX_UNITS)
    fail("invalidCapacity", "จำนวนส่วนต้องอยู่ระหว่าง 2–20 ส่วน");
  if (!Array.isArray(members) || !members.length || new Set(members).size !== members.length)
    fail("invalidMembers", "ต้องมีสมาชิกอย่างน้อย 1 คนและไม่ซ้ำกัน");
  if (!members.includes(ownerId)) fail("ownerNotMember", "เจ้าของกลุ่มต้องอยู่ในกลุ่ม");
  const product = assertSatang(costs?.product), delivery = assertSatang(costs?.delivery);
  const ordered = [ownerId, ...members.filter((id) => id !== ownerId)];
  const count = (id) => {
    const value = units?.[id] ?? 1;
    if (!Number.isSafeInteger(value) || value < (id === ownerId ? 0 : 1))
      fail("invalidUnits", "จำนวนส่วนไม่ถูกต้อง");
    return value;
  };
  const taken = ordered.reduce((sum, id) => sum + count(id), 0);
  if (taken > capacity) fail("fullGroup", "ส่วนเกินจำนวนที่แบ่งไว้");
  const slots = Array.from({ length: capacity }, (_, i) => `unit-${i}`);
  const parts = allocate(product, slots);
  const result = {};
  let next = 0;
  for (const id of ordered) {
    const n = count(id);
    let amount = n > 0 ? delivery : 0;
    for (let i = 0; i < n; i += 1) amount += parts[`unit-${next++}`];
    result[id] = amount;
  }
  for (; next < capacity; next += 1) result[ownerId] += parts[`unit-${next}`];
  return result;
}
/** Sale: each buyer pays quantity × price + delivery; the seller pays nothing. */
export function saleShares(group) {
  const price = assertSatang(group.costs?.product), delivery = assertSatang(group.costs?.delivery);
  return Object.fromEntries(group.members.map((id) => {
    const n = unitsOf(group, id);
    return [id, id === group.ownerId ? 0 : assertSatang(n * price + delivery)];
  }));
}
/** What someone would pay to take `units` parts of this group now. */
export function unitJoinPrice(group, units = 1) {
  if (saleMode(group)) return assertSatang(units * group.costs.product + group.costs.delivery);
  const members = [...group.members, "__joining__"];
  return unitShares(group.costs, group.capacity, members, group.ownerId, { ...group.units, __joining__: units }).__joining__;
}
export const platformCommission = (amount) => ownerFee(amount);
/** What the owner receives for a set of member payments, each with its own 2% taken off. */
export function ownerPayout(payments, { waived = false } = {}) {
  const gross = payments.reduce((sum, amount) => sum + assertSatang(amount), 0);
  // The launch promo (HARN-WITH-JINN) waives the commission for its holder.
  const commission = waived ? 0 : payments.reduce((sum, amount) => sum + platformCommission(amount), 0);
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
  payDay = null,
  ownerUnits = null,
  sale = null,
}) {
  if (sale) return createSale({ id, listingId, name, ownerId, visibility, sale });
  [id, listingId, ownerId].forEach(assertId);
  if (!BILLING_MODES.includes(billing))
    fail("invalidBilling", "กรุณาเลือกแบบรายเดือนหรือรอบเดียวจบ");
  // The form always sends a pay day for monthly groups; older groups have none and keep 3-day dues.
  if (billing === "monthly" && payDay != null && !(Number.isInteger(payDay) && payDay >= 1 && payDay <= 28))
    fail("invalidPayDay", "กรุณาเลือกวันที่ต้องจ่ายทุกเดือน (1–28)");
  if (typeof name !== "string" || !name.trim())
    fail("invalidName", "กรุณาตั้งชื่อกลุ่ม");
  if (!["public", "link"].includes(visibility))
    fail("invalidVisibility", "กรุณาเลือกกลุ่มสาธารณะหรือเฉพาะลิงก์");
  // New groups pass ownerUnits and use unit pricing; older callers keep fixed seats.
  const units = ownerUnits !== null && ownerUnits !== undefined;
  if (units) {
    if (!Number.isSafeInteger(capacity) || capacity < 2 || capacity > MAX_UNITS)
      fail("invalidCapacity", "จำนวนส่วนต้องอยู่ระหว่าง 2–20 ส่วน");
    if (!Number.isSafeInteger(ownerUnits) || ownerUnits < 0 || ownerUnits >= capacity)
      fail("invalidUnits", "ส่วนของเจ้าของกลุ่มต้องน้อยกว่าจำนวนส่วนทั้งหมด");
  } else assertCapacity(capacity);
  const nextCosts = {
    product: costs?.product,
    delivery: costs?.delivery,
    mode: units ? UNIT_MODE : SEAT_MODE,
  };
  totalCost(nextCosts, units ? 1 : capacity);
  return {
    ...(units ? { units: { [ownerId]: ownerUnits } } : {}),
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
    ...(billing === "monthly" ? { cycles: [], payDay } : {}),
    history: [
      { revision: 1, reason: "สร้างกลุ่ม", at: new Date().toISOString() },
    ],
  };
}
/** A sale listing: price per item, stock and delivery per buyer, all in satang. */
export function createSale({ id, listingId, name, ownerId, visibility, sale }) {
  [id, listingId, ownerId].forEach(assertId);
  if (typeof name !== "string" || !name.trim()) fail("invalidName", "กรุณาตั้งชื่อรายการขาย");
  if (!["public", "link"].includes(visibility)) fail("invalidVisibility", "กรุณาเลือกกลุ่มสาธารณะหรือเฉพาะลิงก์");
  const price = assertSatang(sale?.price), delivery = assertSatang(sale?.delivery ?? 0), stock = sale?.stock;
  if (price < 1) fail("invalidPrice", "กรุณาใส่ราคาขายต่อชิ้น");
  if (!Number.isSafeInteger(stock) || stock < 1 || stock > MAX_STOCK) fail("invalidStock", "จำนวนที่มีขายต้องอยู่ระหว่าง 1–999 ชิ้น");
  return {
    billing: "one_time",
    id,
    listingId,
    name: name.trim(),
    ownerId,
    visibility,
    capacity: stock,
    costs: { product: price, delivery, mode: SALE_MODE },
    units: { [ownerId]: 0 },
    members: [ownerId],
    revision: 1,
    approvals: {},
    status: "selling",
    history: [{ revision: 1, reason: "เปิดขาย", at: new Date().toISOString() }],
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
  if (saleMode(group)) return saleShares(group);
  if (group.costs?.mode === UNIT_MODE)
    return unitShares(group.costs, group.capacity, group.members, group.ownerId, group.units);
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
  groupFull(group) &&
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
export function joinGroup(group, userId, units = 1) {
  assertEditable(group);
  assertId(userId);
  if (group.details?.closesAt && group.details.closesAt < new Date().toISOString().slice(0, 10))
    fail("groupClosed", "กลุ่มนี้ปิดรับสมาชิกแล้ว");
  if (group.status === "cancelled")
    fail("cancelledGroup", "กลุ่มนี้ยกเลิกแล้ว");
  if (group.members.includes(userId))
    fail("alreadyMember", "คุณเป็นสมาชิกกลุ่มนี้แล้ว");
  if (groupFull(group))
    fail("fullGroup", "กลุ่มนี้เต็มแล้ว");
  if (!Number.isSafeInteger(units) || units < 1 || (!unitMode(group) && units !== 1))
    fail("invalidUnits", "จำนวนส่วนไม่ถูกต้อง");
  if (units > openUnits(group))
    fail("notEnoughUnits", "เหลือส่วนไม่พอ");
  const patch = {
    members: [...group.members, userId],
    ...(unitMode(group) ? { units: { ...group.units, [userId]: units } } : {}),
  };
  if (saleMode(group)) {
    // A purchase never changes anyone else's amount, so nobody re-confirms.
    const next = { ...group, ...patch, approvals: { ...group.approvals, [userId]: group.revision } };
    return { ...next, status: groupFull(next) ? "sold_out" : "selling" };
  }
  if (group.billing === "monthly")
    // Joining never touches the running cycle: the new member starts paying next cycle.
    return { ...group, ...patch };
  return revise(group, patch, "สมาชิกเข้าร่วม");
}
export function leaveGroup(group, userId) {
  assertEditable(group);
  if (!group.members.includes(userId))
    fail("notMember", "คุณไม่ได้อยู่ในกลุ่มนี้");
  if (group.ownerId === userId)
    fail("ownerMustTransfer", "หัวหน้ากลุ่มต้องโอนสิทธิ์ก่อนออก");
  const units = group.units ? Object.fromEntries(Object.entries(group.units).filter(([id]) => id !== userId)) : undefined;
  const patch = { members: group.members.filter((id) => id !== userId), ...(units ? { units } : {}) };
  if (saleMode(group)) {
    const approvals = Object.fromEntries(Object.entries(group.approvals || {}).filter(([id]) => id !== userId));
    const salePayments = Object.fromEntries(Object.entries(group.salePayments || {}).filter(([id]) => id !== userId));
    const saleOrders = Object.fromEntries(Object.entries(group.saleOrders || {}).filter(([id]) => id !== userId));
    return { ...group, ...patch, approvals, salePayments, saleOrders, status: "selling" };
  }
  if (group.billing === "monthly")
    // Leaving keeps this cycle's locked amounts; the member is left out from the next cycle.
    return { ...group, ...patch };
  return revise(group, patch, "สมาชิกออก");
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
    mode: seatPriced(group.costs) ? group.costs.mode : "per_member_v2",
  };
  totalCost(nextCosts, unitMode(group) ? 1 : group.capacity);
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

// ---------------------------------------------------------------- receipt protection
/**
 * Buyers and members are protected by the platform holding the money until they have the goods.
 * The clock starts when the seller (group owner) marks the order as shipped: if the buyer neither
 * confirms nor reports a problem within AUTO_RECEIPT_DAYS, receipt is confirmed automatically and
 * the money can go to the seller. An open problem report freezes the money until an admin decides.
 */
export const AUTO_RECEIPT_DAYS = 7;
const DAY_MS = 86_400_000;
export const autoReceiptAt = (shippedAt) =>
  shippedAt ? new Date(new Date(shippedAt).getTime() + AUTO_RECEIPT_DAYS * DAY_MS).toISOString() : null;
/**
 * Where one buyer's receipt stands:
 * "waiting_shipment" (paid, seller has not shipped), "shipped" (clock running),
 * "received" (buyer confirmed), "auto_received" (7 days passed without a problem),
 * "disputed" (problem reported, money frozen), "refunded" (admin refunded the buyer).
 */
export function receiptState({ received = false, shippedAt = null, dispute = null, now = new Date() } = {}) {
  if (received) return "received";
  // An admin settles a problem report by releasing the money to the seller or refunding the buyer.
  if (dispute?.status === "released") return "received";
  if (dispute?.status === "refunded") return "refunded";
  if (dispute) return "disputed";
  if (!shippedAt) return "waiting_shipment";
  return new Date(now).getTime() >= new Date(autoReceiptAt(shippedAt)).getTime() ? "auto_received" : "shipped";
}
export const receiptDone = (state) => state === "received" || state === "auto_received";
/** Whole days left before the automatic confirmation (0 when due). */
export function autoReceiptDaysLeft(shippedAt, now = new Date()) {
  if (!shippedAt) return null;
  return Math.max(0, Math.ceil((new Date(autoReceiptAt(shippedAt)).getTime() - new Date(now).getTime()) / DAY_MS));
}
