function fail(code, message) {
  throw Object.assign(new Error(message), {code});
}
function assertId(id) {
  if (typeof id !== 'string' || !id.trim() || id !== id.trim()) fail('invalidId', 'รหัสต้องเป็นข้อความไม่ว่างและไม่มีช่องว่างหัวท้าย');
  return id;
}
export function assertCapacity(capacity) {
  if (!Number.isSafeInteger(capacity) || capacity < 2 || capacity > 20) fail('invalidCapacity', 'จำนวนสมาชิกต้องอยู่ระหว่าง 2–20 คน');
  return capacity;
}
export function assertSatang(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail('invalidSatang', 'จำนวนเงินต้องเป็นสตางค์จำนวนเต็มที่ไม่ติดลบและไม่เกินขอบเขตที่รองรับ');
  return value;
}
export function parseBaht(value) {
  const text = String(value).trim();
  if (!/^(0|[1-9]\d*)(\.\d{1,2})?$/.test(text)) fail('invalidBaht', 'ระบุจำนวนบาทไม่ติดลบและทศนิยมไม่เกิน 2 ตำแหน่ง');
  const [baht, satang = ''] = text.split('.');
  return assertSatang(Number(baht) * 100 + Number(satang.padEnd(2, '0')));
}
export function costBreakdown(costs, memberCount = 1) {
  const product = assertSatang(costs?.product), delivery = assertSatang(costs?.delivery);
  if (costs?.mode === 'per_member_v2') {
    if (!Number.isSafeInteger(memberCount) || memberCount < 1 || memberCount > 20) fail('invalidMembers', 'จำนวนสมาชิกไม่ถูกต้อง');
    const deliveryTotal = assertSatang(delivery * memberCount);
    const subtotal = assertSatang(product + deliveryTotal);
    const service = assertSatang(Number((BigInt(subtotal) * 2n + 50n) / 100n));
    return {product, delivery:deliveryTotal, deliveryPerMember:delivery, service, total:assertSatang(subtotal + service)};
  }
  const service = assertSatang(costs?.service);
  return {product, delivery, deliveryPerMember:null, service, total:assertSatang(product + delivery + service)};
}
export const totalCost = (costs, memberCount = 1) => costBreakdown(costs, memberCount).total;
export function createGroup({id, listingId, name, ownerId, visibility, capacity, costs}) {
  [id, listingId, ownerId].forEach(assertId);
  if (typeof name !== 'string' || !name.trim()) fail('invalidName', 'กรุณาตั้งชื่อกลุ่ม');
  if (!['public', 'link'].includes(visibility)) fail('invalidVisibility', 'กรุณาเลือกกลุ่มสาธารณะหรือเฉพาะลิงก์');
  assertCapacity(capacity);
  const nextCosts = {product:costs?.product, delivery:costs?.delivery, mode:'per_member_v2'};
  totalCost(nextCosts, capacity);
  return {id, listingId, name:name.trim(), ownerId, visibility, capacity, costs:nextCosts, members:[ownerId], revision:1, approvals:{}, status:'awaiting_approval', history:[{revision:1, reason:'สร้างกลุ่ม', at:new Date().toISOString()}]};
}
export function allocate(total, members) {
  assertSatang(total);
  if (!Array.isArray(members) || !members.length || new Set(members).size !== members.length) fail('invalidMembers', 'ต้องมีสมาชิกอย่างน้อย 1 คนและไม่ซ้ำกัน');
  members.forEach(assertId);
  const base = Math.floor(total / members.length), remainder = total % members.length;
  return Object.fromEntries(members.map((id, index) => [id, base + (index < remainder ? 1 : 0)]));
}
export function shares(group) {
  const breakdown = costBreakdown(group.costs, group.members.length);
  const base = allocate(breakdown.total - (breakdown.deliveryPerMember ?? 0) * group.members.length, group.members);
  return breakdown.deliveryPerMember === null ? base : Object.fromEntries(group.members.map(id => [id, base[id] + breakdown.deliveryPerMember]));
}
export const allApproved = group => group.members.length === group.capacity && group.members.every(id => group.approvals[id] === group.revision);
function revise(group, patch, reason) {
  return {...group, ...patch, revision: group.revision + 1, approvals: {}, status: 'awaiting_approval', history: [...group.history, {revision: group.revision + 1, reason, at: new Date().toISOString()}]};
}
function assertEditable(group) {
  if(group.orderId) fail('orderedGroupLocked', 'กลุ่มมีคำสั่งซื้อแล้ว เปลี่ยนสมาชิก ค่าใช้จ่าย หรือหัวหน้าไม่ได้');
}
export function joinGroup(group, userId) {
  assertEditable(group);
  assertId(userId);
  if (group.status === 'cancelled') fail('cancelledGroup', 'กลุ่มนี้ยกเลิกแล้ว');
  if (group.members.includes(userId)) fail('alreadyMember', 'คุณเป็นสมาชิกกลุ่มนี้แล้ว');
  if (group.members.length >= group.capacity) fail('fullGroup', 'กลุ่มนี้เต็มแล้ว');
  return revise(group, {members: [...group.members, userId]}, 'สมาชิกเข้าร่วม');
}
export function leaveGroup(group, userId) {
  assertEditable(group);
  if (!group.members.includes(userId)) fail('notMember', 'คุณไม่ได้อยู่ในกลุ่มนี้');
  if (group.ownerId === userId) fail('ownerMustTransfer', 'หัวหน้ากลุ่มต้องโอนสิทธิ์ก่อนออก');
  return revise(group, {members: group.members.filter(id => id !== userId)}, 'สมาชิกออก');
}
export function transferOwner(group, actorId, nextOwnerId) {
  assertEditable(group);
  if (group.ownerId !== actorId || !group.members.includes(nextOwnerId) || actorId === nextOwnerId) fail('invalidTransfer', 'โอนหัวหน้ากลุ่มไม่ได้');
  return {...group, ownerId: nextOwnerId};
}
export function changeCosts(group, actorId, costs) {
  assertEditable(group);
  if (group.ownerId !== actorId) fail('ownerOnly', 'เฉพาะหัวหน้ากลุ่มแก้ไขค่าใช้จ่ายได้');
  const nextCosts = {product:group.costs.product, delivery:costs?.delivery, mode:'per_member_v2'};
  totalCost(nextCosts, group.capacity);
  return revise(group, {costs:nextCosts}, 'ค่าใช้จ่ายเปลี่ยน');
}
export function approve(group, userId, revision) {
  assertEditable(group);
  if (!group.members.includes(userId)) fail('approvalMemberOnly', 'เฉพาะสมาชิกยืนยันยอดได้');
  if (revision !== group.revision) fail('staleRevision', 'ยอดนี้ล้าสมัย กรุณาดูยอดล่าสุด');
  const next = {...group, approvals: {...group.approvals, [userId]: revision}};
  return {...next, status: allApproved(next) ? 'ready' : 'awaiting_approval'};
}
