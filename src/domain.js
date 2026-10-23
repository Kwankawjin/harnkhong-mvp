export function assertSatang(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('จำนวนเงินต้องเป็นสตางค์จำนวนเต็มที่ไม่ติดลบ');
  return value;
}
export function parseBaht(value) {
  const text = String(value).trim();
  if (!/^(0|[1-9]\d*)(\.\d{1,2})?$/.test(text)) throw new Error('ระบุจำนวนบาทไม่ติดลบและทศนิยมไม่เกิน 2 ตำแหน่ง');
  const [baht, satang = ''] = text.split('.');
  return assertSatang(Number(baht) * 100 + Number(satang.padEnd(2, '0')));
}
export const totalCost = costs => assertSatang(assertSatang(costs.product) + assertSatang(costs.delivery) + assertSatang(costs.service));
export function allocate(total, members) {
  assertSatang(total);
  if (!Array.isArray(members) || !members.length || new Set(members).size !== members.length) throw new Error('ต้องมีสมาชิกอย่างน้อย 1 คนและไม่ซ้ำกัน');
  const base = Math.floor(total / members.length), remainder = total % members.length;
  return Object.fromEntries(members.map((id, index) => [id, base + (index < remainder ? 1 : 0)]));
}
export const shares = group => allocate(totalCost(group.costs), group.members);
export const allApproved = group => group.members.length === group.capacity && group.members.every(id => group.approvals[id] === group.revision);
function revise(group, patch, reason) {
  return {...group, ...patch, revision: group.revision + 1, approvals: {}, status: 'awaiting_approval', history: [...group.history, {revision: group.revision + 1, reason, at: new Date().toISOString()}]};
}
export function joinGroup(group, userId) {
  if (group.status === 'cancelled') throw new Error('กลุ่มนี้ยกเลิกแล้ว');
  if (group.members.includes(userId)) throw new Error('คุณเป็นสมาชิกกลุ่มนี้แล้ว');
  if (group.members.length >= group.capacity) throw new Error('กลุ่มนี้เต็มแล้ว');
  return revise(group, {members: [...group.members, userId]}, 'สมาชิกเข้าร่วม');
}
export function leaveGroup(group, userId) {
  if (!group.members.includes(userId)) throw new Error('คุณไม่ได้อยู่ในกลุ่มนี้');
  if (group.ownerId === userId) throw new Error('หัวหน้ากลุ่มต้องโอนสิทธิ์ก่อนออก');
  return revise(group, {members: group.members.filter(id => id !== userId)}, 'สมาชิกออก');
}
export function transferOwner(group, actorId, nextOwnerId) {
  if (group.ownerId !== actorId || !group.members.includes(nextOwnerId) || actorId === nextOwnerId) throw new Error('โอนหัวหน้ากลุ่มไม่ได้');
  return {...group, ownerId: nextOwnerId};
}
export function changeCosts(group, actorId, costs) {
  if (group.ownerId !== actorId) throw new Error('เฉพาะหัวหน้ากลุ่มแก้ไขค่าใช้จ่ายได้');
  totalCost(costs);
  return revise(group, {costs}, 'ค่าใช้จ่ายเปลี่ยน');
}
export function approve(group, userId, revision) {
  if (!group.members.includes(userId)) throw new Error('เฉพาะสมาชิกยืนยันยอดได้');
  if (revision !== group.revision) throw new Error('ยอดนี้ล้าสมัย กรุณาดูยอดล่าสุด');
  const next = {...group, approvals: {...group.approvals, [userId]: revision}};
  return {...next, status: allApproved(next) ? 'ready' : 'awaiting_approval'};
}
