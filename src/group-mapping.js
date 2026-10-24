import {costBreakdown, totalCost} from './domain.js';

const eventReason = {
  group_created: 'สร้างกลุ่มแล้ว', member_joined: 'มีสมาชิกเข้าร่วม', member_left: 'มีสมาชิกออกจากกลุ่ม',
  costs_changed: 'มีการเปลี่ยนค่าใช้จ่าย', leadership_transferred: 'มีการโอนหัวหน้ากลุ่ม', share_approved: 'ยืนยันยอดแล้ว',
};
const asSafeSatang = value => {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount < 0) throw Object.assign(new Error('Group total exceeds supported amount'), {code:'groupTotalOutOfRange'});
  return amount;
};

export function mapDatabaseGroup(row, members = [], approvals = {}, history = []) {
  const product = asSafeSatang(row.product_satang), delivery = asSafeSatang(row.delivery_per_member_satang);
  const costs = {product, delivery, mode:'per_member_v2'};
  if (asSafeSatang(row.total_satang) !== totalCost(costs, members.length) || asSafeSatang(row.service_satang) !== costBreakdown(costs, members.length).service) {
    throw Object.assign(new Error('Database and app group totals differ'), {code:'groupTotalMismatch'});
  }
  return {
    id:row.id, listingId:row.listing_id, name:row.name, ownerId:row.owner_id,
    visibility:row.visibility, capacity:Number(row.capacity), costs, members,
    revision:Number(row.revision), approvals, status:row.status, orderId:null,
    history:history.map(event=>({revision:Number(event.revision),reason:eventReason[event.event_type]||'มีการอัปเดตกลุ่ม',at:event.created_at})),
  };
}
