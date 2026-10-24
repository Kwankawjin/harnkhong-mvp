import {allApproved, allocate, totalCost} from './domain.js';

// shortcut: identities, clocks and storage are browser-local; enforce these rules on a server before real use.
export const ORDER_TRANSITIONS = Object.freeze({
  waiting_for_members:['pending_payment'],
  pending_payment:['payment_secured','disputed'],
  payment_secured:['preparing_order','disputed'],
  preparing_order:['shipped','disputed'],
  shipped:['delivered','disputed'],
  delivered:['inspection_period','disputed'],
  inspection_period:['completed','disputed'],
  disputed:['pending_payment','payment_secured','preparing_order','shipped','delivered','inspection_period','refunded'],
  completed:[], refunded:[],
});
export const DISPUTE_REASONS = ['not_received','not_as_described','missing_items','shipping_problem','payment_disagreement','other'];
const activeStates = ['pending_payment','payment_secured','preparing_order','shipped','delivered','inspection_period'];
const fail = code => { throw Object.assign(new Error(code), {code}); };
const text = (value, max = 1000) => {
  if(typeof value !== 'string' || !value.trim() || value.trim().length > max) fail('orderInvalidDetails');
  return value.trim();
};
const timestamp = value => {
  const at = new Date(value);
  if(!Number.isFinite(at.getTime())) fail('orderInvalidDetails');
  return at.toISOString();
};
export function sellerIdFor(actor) {
  return actor?.role === 'seller' ? actor.sellerId || (actor.id === 'demo-seller' ? 's1' : null) : null;
}
export function assertListingSeller(product, actor) {
  if(!sellerIdFor(actor) || product?.sellerId !== sellerIdFor(actor)) fail('orderUnauthorized');
}
export const unresolvedDispute = order => order.disputes?.find(d => d.status !== 'resolved');
const verified = order => order.members.length === order.capacity && order.members.every(id => order.payments[id]?.status === 'verified' && order.payments[id]?.verificationMode === 'demo');
export const canViewOrder = (order, actor) => !!actor?.id && (order.members.includes(actor.id) || !!sellerIdFor(actor) && sellerIdFor(actor) === order.sellerId);
export function orderPermissions(order, actor, now = new Date()) {
  const member = !!actor?.id && order.members.includes(actor.id);
  const leader = member && order.ownerId === actor.id;
  const seller = !!sellerIdFor(actor) && sellerIdFor(actor) === order.sellerId;
  const active = activeStates.includes(order.status) && !unresolvedDispute(order);
  return {
    view:canViewOrder(order,actor), member, leader, seller,
    activate:leader && order.status === 'waiting_for_members',
    reportPayment:member && active && order.status === 'pending_payment' && order.payments[actor.id]?.status === 'unpaid',
    verifyPayment:leader && active && order.status === 'pending_payment',
    prepare:seller && active && order.status === 'payment_secured' && verified(order),
    shipment:seller && active && ['preparing_order','shipped'].includes(order.status),
    deliver:leader && active && order.status === 'shipped',
    inspect:leader && active && order.status === 'delivered',
    complete:leader && active && order.status === 'inspection_period' && !!order.inspection?.deadline && new Date(now).getTime() >= new Date(order.inspection.deadline).getTime(),
    dispute:member && active,
    propose:seller && order.status === 'disputed' && !!unresolvedDispute(order) && unresolvedDispute(order).reporterId !== actor.id,
    respond:member && order.status === 'disputed' && unresolvedDispute(order)?.reporterId === actor.id,
  };
}
function authorize(order, actor, permission) {
  if(!orderPermissions(order,actor)[permission]) fail('orderUnauthorized');
}
function assertActive(order) {
  if(unresolvedDispute(order) || order.status === 'disputed') fail('orderDisputeUnresolved');
  if(!activeStates.includes(order.status)) fail('orderInvalidTransition');
}
function event(order, type, actor, at, details = {}) {
  return {...order, history:[...order.history, {id:crypto.randomUUID(),type,actorId:actor?.id ?? null,at:timestamp(at),orderId:order.id,...details}]};
}
function move(order, next, actor, at) {
  if(!ORDER_TRANSITIONS[order.status]?.includes(next)) fail('orderInvalidTransition');
  if(next === 'completed' && unresolvedDispute(order)) fail('orderDisputeUnresolved');
  if(next === 'refunded' && (!order.refund || order.refund.mode !== 'demo' || order.refund.status !== 'recorded')) fail('orderRefundRequired');
  return event({...order,status:next}, 'order_status_changed', actor, at, {previousState:order.status,newState:next});
}
function inspectionHours(value) {
  if(!Number.isInteger(value) || value < 1 || value > 720) fail('orderInvalidInspection');
  return value;
}
function snapshot(group, product, hours) {
  if(!product?.sellerId || group.listingId !== product.id) fail('orderInvalidDetails');
  return {
    id:group.id,groupId:group.id,listingId:product.id,sellerId:product.sellerId,ownerId:group.ownerId,
    members:[...group.members],capacity:group.capacity,groupRevision:group.revision,costs:{...group.costs},
    approvals:{...group.approvals},totalSatang:totalCost(group.costs),mode:'demo',actualPaymentVerification:'unavailable',
    inspectionHours:inspectionHours(hours),inspection:null,shipment:null,disputes:[],refund:null,history:[],
    payments:Object.fromEntries(Object.entries(allocate(totalCost(group.costs),group.members)).map(([id,amountSatang]) => [id,{amountSatang,status:'unpaid',verificationMode:null}])),
  };
}
export function createOrder(group, product, actor, {hours = 24, now = new Date()} = {}) {
  if(!actor?.id || group.ownerId !== actor.id || !group.members.includes(actor.id)) fail('orderUnauthorized');
  if(group.orderId) fail('orderAlreadyExists');
  if(!allApproved(group)) fail('orderNotReady');
  let next = {...snapshot(group,product,hours),status:'pending_payment',createdAt:timestamp(now)};
  next = event(next,'order_created',actor,now,{newState:'pending_payment'});
  return event(next,'membership_completed',actor,now,{revision:group.revision});
}
export function activateOrder(order, group, product, actor, {hours = 24, now = new Date()} = {}) {
  if(order.status !== 'waiting_for_members') fail('orderInvalidTransition');
  if(order.groupId !== group.id || group.orderId) fail('orderAlreadyExists');
  const fresh = createOrder(group,product,actor,{hours,now});
  let next = {...fresh,createdAt:order.createdAt,history:[...order.history]};
  next = event(next,'membership_completed',actor,now,{revision:group.revision});
  return event(next,'order_status_changed',actor,now,{previousState:'waiting_for_members',newState:'pending_payment'});
}
export function reportPayment(order, actor, {note = '', now = new Date()} = {}) {
  assertActive(order);
  authorize(order,actor,'reportPayment');
  if(typeof note !== 'string' || note.length > 1000) fail('orderInvalidDetails');
  const payment = {...order.payments[actor.id],status:'payment_reported',reportedAt:timestamp(now),note:note.trim()};
  return event({...order,payments:{...order.payments,[actor.id]:payment}},'payment_reported',actor,now,{memberId:actor.id,previousState:'unpaid',newState:'payment_reported',note:note.trim()});
}
export function updatePayment(order, actor, memberId, nextStatus, {note = '', now = new Date()} = {}) {
  assertActive(order);
  authorize(order,actor,'verifyPayment');
  const payment = order.payments[memberId];
  const edges = {payment_reported:['verification_pending'],verification_pending:['verified','unpaid']};
  if(!payment || !order.members.includes(memberId) || !edges[payment.status]?.includes(nextStatus)) fail('orderInvalidPaymentTransition');
  if(nextStatus === 'unpaid') note = text(note);
  else if(typeof note !== 'string' || note.length > 1000) fail('orderInvalidDetails');
  const updated = {...payment,status:nextStatus,verificationMode:nextStatus === 'verified' ? 'demo' : null,updatedBy:actor.id,updatedAt:timestamp(now)};
  let next = event({...order,payments:{...order.payments,[memberId]:updated}},'payment_status_changed',actor,now,{memberId,previousState:payment.status,newState:nextStatus,note:note.trim()});
  if(verified(next)) next = move(next,'payment_secured',actor,now);
  return next;
}
export function transitionOrder(order, actor, nextStatus, {now = new Date()} = {}) {
  assertActive(order);
  const actions = {preparing_order:'prepare',delivered:'deliver',inspection_period:'inspect',completed:'leader'};
  if(!actions[nextStatus] || !ORDER_TRANSITIONS[order.status]?.includes(nextStatus)) fail('orderInvalidTransition');
  authorize(order,actor,actions[nextStatus]);
  if(['preparing_order','completed'].includes(nextStatus) && !verified(order)) fail('orderPaymentPending');
  let next = order;
  if(nextStatus === 'delivered') next = {...next,deliveredAt:timestamp(now)};
  if(nextStatus === 'inspection_period') {
    const startedAt = timestamp(now), deadline = timestamp(new Date(startedAt).getTime() + inspectionHours(order.inspectionHours)*3600000);
    next = event({...next,inspection:{startedAt,deadline}},'inspection_started',actor,now,{inspection:{startedAt,deadline}});
  }
  if(nextStatus === 'completed') {
    if(!orderPermissions(order,actor,now).complete) fail('orderInspectionActive');
    next = event(next,'inspection_ended',actor,now);
  }
  next = move(next,nextStatus,actor,now);
  return nextStatus === 'completed' ? event(next,'order_completed',actor,now) : next;
}
function trackingUrl(value) {
  if(!value) return '';
  try {
    const url = new URL(value);
    if(!['https:','http:'].includes(url.protocol) || url.username || url.password) fail('orderInvalidTracking');
    return url.href;
  } catch { fail('orderInvalidTracking'); }
}
export function updateShipment(order, actor, {carrier = '',trackingNumber = '',url = ''}, {now = new Date()} = {}) {
  assertActive(order);
  authorize(order,actor,'shipment');
  if([carrier,trackingNumber,url].some(v => typeof v !== 'string' || v.length > 500) || !(trackingNumber.trim() || url.trim())) fail('orderInvalidTracking');
  const shipment = {carrier:carrier.trim(),trackingNumber:trackingNumber.trim(),url:trackingUrl(url.trim()),shippedAt:order.shipment?.shippedAt || timestamp(now),updatedAt:timestamp(now),verified:false};
  let next = event({...order,shipment},'shipment_updated',actor,now,{previousState:order.shipment,newState:shipment});
  if(order.status === 'preparing_order') next = move(next,'shipped',actor,now);
  return next;
}
export function openDispute(order, actor, {reason,description,evidence = ''}, {now = new Date()} = {}) {
  assertActive(order);
  authorize(order,actor,'dispute');
  if(!DISPUTE_REASONS.includes(reason)) fail('orderInvalidDetails');
  description = text(description);
  if(typeof evidence !== 'string' || evidence.length > 1000) fail('orderInvalidDetails');
  const dispute = {id:crypto.randomUUID(),orderId:order.id,reporterId:actor.id,reason,description,evidence:evidence.trim(),createdAt:timestamp(now),status:'open',previousOrderStatus:order.status,proposals:[],resolution:null};
  let next = move({...order,disputes:[...order.disputes,dispute]},'disputed',actor,now);
  return event(next,'dispute_opened',actor,now,{disputeId:dispute.id,reason,note:description});
}
export function proposeResolution(order, actor, disputeId, {decision,note}, {now = new Date()} = {}) {
  authorize(order,actor,'propose');
  const dispute = unresolvedDispute(order);
  if(dispute.id !== disputeId || dispute.status !== 'open' || !['resume','refund'].includes(decision)) fail('orderInvalidResolution');
  const proposal = {id:crypto.randomUUID(),decision,note:text(note),proposerId:actor.id,proposedAt:timestamp(now),status:'pending'};
  const updated = {...dispute,status:'resolution_proposed',proposals:[...dispute.proposals,proposal]};
  return event({...order,disputes:order.disputes.map(d => d.id === disputeId ? updated : d)},'resolution_proposed',actor,now,{disputeId,reason:decision,note:proposal.note});
}
export function respondToResolution(order, actor, disputeId, accept, {now = new Date()} = {}) {
  authorize(order,actor,'respond');
  const dispute = unresolvedDispute(order), proposal = dispute.proposals.at(-1);
  if(dispute.id !== disputeId || dispute.status !== 'resolution_proposed' || !proposal || proposal.status !== 'pending' || proposal.proposerId === actor.id || typeof accept !== 'boolean') fail('orderInvalidResolution');
  const response = {...proposal,status:accept?'accepted':'rejected',responderId:actor.id,respondedAt:timestamp(now)};
  const resolution = accept ? {decision:proposal.decision,note:proposal.note,resolverId:actor.id,sellerId:proposal.proposerId,resolvedAt:timestamp(now)} : null;
  const updated = {...dispute,status:accept?'resolved':'open',proposals:[...dispute.proposals.slice(0,-1),response],resolution};
  let next = event({...order,disputes:order.disputes.map(d => d.id === disputeId ? updated : d)},accept?'dispute_resolved':'resolution_rejected',actor,now,{disputeId,reason:proposal.decision,note:proposal.note});
  if(!accept) return next;
  if(proposal.decision === 'refund') {
    const amountSatang = order.members.reduce((sum,id) => sum + (order.payments[id].status === 'verified' ? order.payments[id].amountSatang : 0),0);
    next = event({...next,refund:{mode:'demo',status:'recorded',amountSatang,disputeId,note:proposal.note,recordedBy:actor.id,proposedBy:proposal.proposerId,recordedAt:timestamp(now)}},'refund_recorded',actor,now,{disputeId,amountSatang,note:proposal.note});
    return move(next,'refunded',actor,now);
  }
  next = move(next,dispute.previousOrderStatus,actor,now);
  if(next.status === 'inspection_period') {
    const startedAt = timestamp(now), deadline = timestamp(new Date(startedAt).getTime() + next.inspectionHours*3600000);
    next = event({...next,inspection:{startedAt,deadline}},'inspection_started',actor,now,{reason:'restart_after_dispute',inspection:{startedAt,deadline}});
  }
  return next;
}

// Old orders contained only group IDs, never evidence of payment. Preserve unknown entries unchanged.
export function migrateOrders(orders, groups, products, now = new Date()) {
  return orders.map(order => {
    if(typeof order !== 'string') return order;
    const group = groups.find(g => g.id === order), product = products.find(p => p.id === group?.listingId);
    if(!group?.members.length || !product) return order;
    const next = {...snapshot(group,product,24),legacy:true,status:allApproved(group)?'pending_payment':'waiting_for_members',createdAt:null};
    return event(next,'legacy_order_imported',null,now,{newState:next.status});
  });
}
export function lockOrderedGroups(groups, orders) {
  return groups.map(group => {
    const order = orders.find(o => o.groupId === group.id && o.status !== 'waiting_for_members');
    return order && group.orderId !== order.id ? {...group,orderId:order.id} : group;
  });
}
