import test from 'node:test';
import assert from 'node:assert/strict';
import {joinGroup,leaveGroup,changeCosts,transferOwner,approve} from '../src/domain.js';
import {ORDER_TRANSITIONS,createOrder,activateOrder,reportPayment,updatePayment,transitionOrder,updateShipment,openDispute,proposeResolution,respondToResolution,migrateOrders,lockOrderedGroups,orderPermissions,assertListingSeller} from '../src/orders.js';

const owner = {id:'a',role:'member'}, member = {id:'b',role:'member'}, outsider = {id:'x',role:'member'};
const seller = {id:'demo-seller',role:'seller'}, otherSeller = {id:'s2-user',role:'seller',sellerId:'s2'};
const product = {id:'p',sellerId:'s1'};
const group = () => ({id:'g',listingId:'p',ownerId:'a',members:['a','b'],capacity:2,costs:{product:10001,delivery:1000,service:0},revision:2,approvals:{a:2,b:2},status:'ready',history:[]});
const start = '2026-10-24T00:00:00.000Z';
const make = () => createOrder(group(),product,owner,{now:start,hours:1});
function paid(order = make()) {
  for(const actor of [owner,member]) {
    order = reportPayment(order,actor,{now:start});
    order = updatePayment(order,owner,actor.id,'verification_pending',{now:start});
    order = updatePayment(order,owner,actor.id,'verified',{now:start});
  }
  return order;
}
function inspecting() {
  let order = transitionOrder(paid(),seller,'preparing_order',{now:start});
  order = updateShipment(order,seller,{carrier:'Demo carrier',trackingNumber:'USER-ENTERED'},{now:start});
  order = transitionOrder(order,owner,'delivered',{now:start});
  return transitionOrder(order,owner,'inspection_period',{now:start});
}
const rejects = (fn,code) => assert.throws(fn,{code});

test('create requires leader, full membership and current confirmations; snapshot preserves all satang', () => {
  rejects(()=>createOrder({...group(),members:['a']},product,owner),'orderNotReady');
  rejects(()=>createOrder({...group(),approvals:{a:2,b:1}},product,owner),'orderNotReady');
  for(const actor of [member,outsider,seller,null]) rejects(()=>createOrder(group(),product,actor),'orderUnauthorized');
  rejects(()=>createOrder({...group(),orderId:'g'},product,owner),'orderAlreadyExists');
  const input = group(), order = createOrder(input,product,owner,{now:start});
  input.costs.product = 9;
  assert.equal(order.totalSatang,11001);
  assert.equal(Object.values(order.payments).reduce((sum,p)=>sum+p.amountSatang,0),11001);
  assert.equal(order.status,'pending_payment');
  assert.deepEqual(order.history.map(h=>h.type),['order_created','membership_completed']);
  assert.equal(order.mode,'demo');
  assert.equal(order.actualPaymentVerification,'unavailable');
});

test('member reporting is separate from amount approval and cannot verify or report for another member', () => {
  const original = make(), order = reportPayment(original,member);
  assert.equal(order.payments.b.status,'payment_reported');
  assert.equal(order.payments.a.status,'unpaid');
  assert.equal(original.payments.b.status,'unpaid');
  assert.equal(order.status,'pending_payment');
  assert.deepEqual(order.approvals,{a:2,b:2});
  rejects(()=>reportPayment(order,member),'orderUnauthorized');
  rejects(()=>reportPayment(order,outsider),'orderUnauthorized');
  for(const actor of [member,seller,outsider]) rejects(()=>updatePayment(order,actor,'b','verification_pending'),'orderUnauthorized');
  rejects(()=>updatePayment(order,owner,'b','verified'),'orderInvalidPaymentTransition');
  rejects(()=>updatePayment(order,owner,'x','verification_pending'),'orderInvalidPaymentTransition');
  rejects(()=>transitionOrder(order,seller,'preparing_order'),'orderInvalidTransition');
});

test('verification has explicit stages; every payment must be demo verified before fulfillment', () => {
  let order = reportPayment(make(),member);
  order = updatePayment(order,owner,'b','verification_pending');
  rejects(()=>updatePayment(order,owner,'b','unpaid'),'orderInvalidDetails');
  order = updatePayment(order,owner,'b','unpaid',{note:'Incorrect demo reference'});
  assert.equal(order.payments.b.verificationMode,null);
  order = paid();
  assert.equal(order.status,'payment_secured');
  assert.ok(Object.values(order.payments).every(p=>p.status==='verified'&&p.verificationMode==='demo'));
  assert.equal(order.actualPaymentVerification,'unavailable');
  rejects(()=>transitionOrder(order,owner,'preparing_order'),'orderUnauthorized');
  rejects(()=>transitionOrder(order,otherSeller,'preparing_order'),'orderUnauthorized');
  const tampered = {...order,payments:{...order.payments,b:{...order.payments.b,status:'payment_reported'}}};
  rejects(()=>transitionOrder(tampered,seller,'preparing_order'),'orderUnauthorized');
});

test('normal workflow enforces seller, leader and inspection deadline and records chronological history', () => {
  let order = transitionOrder(paid(),seller,'preparing_order',{now:start});
  rejects(()=>updateShipment(order,owner,{trackingNumber:'X'}),'orderUnauthorized');
  rejects(()=>updateShipment(order,otherSeller,{trackingNumber:'X'}),'orderUnauthorized');
  order = updateShipment(order,seller,{trackingNumber:'ABC',url:'https://example.com/ABC'},{now:start});
  assert.equal(order.status,'shipped');
  assert.equal(order.shipment.verified,false);
  rejects(()=>transitionOrder(order,seller,'delivered'),'orderUnauthorized');
  order = transitionOrder(order,owner,'delivered',{now:start});
  order = transitionOrder(order,owner,'inspection_period',{now:start});
  assert.equal(order.inspection.deadline,'2026-10-24T01:00:00.000Z');
  rejects(()=>transitionOrder(order,owner,'completed',{now:'2026-10-24T00:59:59Z'}),'orderInspectionActive');
  rejects(()=>transitionOrder(order,member,'completed',{now:'2026-10-24T01:00:00Z'}),'orderUnauthorized');
  order = transitionOrder(order,owner,'completed',{now:'2026-10-24T01:00:00Z'});
  assert.equal(order.status,'completed');
  assert.ok(order.history.some(e=>e.type==='inspection_ended'));
  assert.equal(order.history.at(-1).type,'order_completed');
  for(const e of order.history) {
    assert.equal(e.orderId,'g');
    assert.ok(e.id && e.actorId && Number.isFinite(Date.parse(e.at)));
  }
  for(const next of Object.keys(ORDER_TRANSITIONS)) rejects(()=>transitionOrder(order,owner,next),'orderInvalidTransition');
});

test('all arbitrary status jumps fail in business logic with no input mutation or success history', () => {
  for(const order of [make(),paid(),inspecting()]) {
    for(const next of ['shipped','refunded','disputed','waiting_for_members','pending_payment','payment_secured','unknown']) {
      const before = structuredClone(order);
      rejects(()=>transitionOrder(order,owner,next),'orderInvalidTransition');
      assert.deepEqual(order,before);
    }
  }
});

test('shipping validates URLs, keeps the first shipment date and preserves edit history', () => {
  let order = transitionOrder(paid(),seller,'preparing_order');
  for(const input of [{},{url:'javascript:alert(1)'},{url:'https://user:password@example.com'},{url:'not-a-url'},{carrier:8,trackingNumber:'X'}]) rejects(()=>updateShipment(order,seller,input),'orderInvalidTracking');
  order = updateShipment(order,seller,{trackingNumber:'ABC'},{now:start});
  const first = order.shipment;
  order = updateShipment(order,seller,{trackingNumber:'XYZ'},{now:'2026-10-24T00:30:00Z'});
  assert.equal(order.shipment.shippedAt,first.shippedAt);
  const events = order.history.filter(e=>e.type==='shipment_updated');
  assert.equal(events.length,2);
  assert.equal(events.at(-1).previousState.trackingNumber,'ABC');
});

test('eligible member dispute blocks all payment, fulfillment and completion actions', () => {
  for(const original of [make(),paid(),inspecting()]) {
    const order = openDispute(original,member,{reason:'missing_items',description:'One missing item',evidence:'Photo reference #1'},{now:start});
    assert.equal(order.status,'disputed');
    assert.equal(order.refund,null);
    const d = order.disputes[0];
    assert.equal(d.orderId,order.id);
    assert.equal(d.reporterId,'b');
    assert.equal(d.status,'open');
    assert.equal(d.evidence,'Photo reference #1');
    for(const next of ['completed','preparing_order','refunded']) rejects(()=>transitionOrder(order,owner,next),'orderDisputeUnresolved');
    rejects(()=>reportPayment(order,owner),'orderDisputeUnresolved');
    rejects(()=>updateShipment(order,seller,{trackingNumber:'X'}),'orderDisputeUnresolved');
    rejects(()=>openDispute(order,owner,{reason:'other',description:'Duplicate'}),'orderDisputeUnresolved');
    assert.equal(original.disputes.length,0);
  }
  rejects(()=>openDispute(make(),outsider,{reason:'other',description:'Issue'}),'orderUnauthorized');
  for(const input of [{reason:'invalid',description:'Issue'},{reason:'other',description:'   '},{reason:'other',description:'Issue',evidence:42}]) rejects(()=>openDispute(make(),member,input),'orderInvalidDetails');
});

test('seller proposes; reporter independently accepts or rejects, retaining all proposals and disputes', () => {
  let order = openDispute(paid(),member,{reason:'other',description:'Review'}), d = order.disputes[0];
  for(const actor of [owner,member,otherSeller,outsider]) rejects(()=>proposeResolution(order,actor,d.id,{decision:'refund',note:'Return'}),'orderUnauthorized');
  order = proposeResolution(order,seller,d.id,{decision:'resume',note:'Clarified'});
  for(const actor of [owner,seller,outsider]) rejects(()=>respondToResolution(order,actor,d.id,true),'orderUnauthorized');
  order = respondToResolution(order,member,d.id,false);
  assert.equal(order.status,'disputed');
  assert.equal(order.disputes[0].proposals[0].status,'rejected');
  order = proposeResolution(order,seller,d.id,{decision:'resume',note:'New proposal'});
  order = respondToResolution(order,member,d.id,true);
  assert.equal(order.status,'payment_secured');
  assert.equal(order.disputes[0].status,'resolved');
  assert.equal(order.disputes[0].resolution.resolverId,'b');
  assert.equal(order.disputes[0].resolution.sellerId,seller.id);
  assert.equal(order.disputes[0].proposals.length,2);
  order = openDispute(order,owner,{reason:'payment_disagreement',description:'Another issue'});
  assert.equal(order.disputes.length,2);
});

test('seller who is also reporter cannot propose their own resolution', () => {
  const order = openDispute({...make(),members:['a',seller.id]},seller,{reason:'other',description:'Issue'});
  rejects(()=>proposeResolution(order,seller,order.disputes[0].id,{decision:'refund',note:'Self'}),'orderUnauthorized');
});

test('refund is recorded only after joint resolution and reconciles with verified demo payments', () => {
  for(const initial of [make(),paid()]) {
    let order = openDispute(initial,member,{reason:'payment_disagreement',description:'Disagree'});
    const id = order.disputes[0].id;
    order = proposeResolution(order,seller,id,{decision:'refund',note:'Agreed demo refund outcome'});
    assert.equal(order.refund,null);
    assert.equal(order.status,'disputed');
    order = respondToResolution(order,member,id,true);
    assert.equal(order.status,'refunded');
    assert.equal(order.refund.status,'recorded');
    assert.equal(order.refund.mode,'demo');
    assert.equal(order.refund.amountSatang,initial.status==='payment_secured'?11001:0);
    assert.ok(order.history.some(e=>e.type==='refund_recorded'&&e.disputeId===id));
    rejects(()=>transitionOrder(order,owner,'pending_payment'),'orderInvalidTransition');
    rejects(()=>openDispute(order,member,{reason:'other',description:'Issue'}),'orderInvalidTransition');
  }
});

test('resuming inspection starts a full new window rather than expiring during a dispute', () => {
  let order = openDispute(inspecting(),member,{reason:'not_as_described',description:'Check'});
  const id = order.disputes[0].id;
  order = proposeResolution(order,seller,id,{decision:'resume',note:'Agreed'});
  order = respondToResolution(order,member,id,true,{now:'2026-10-26T00:00:00Z'});
  assert.equal(order.inspection.deadline,'2026-10-26T01:00:00.000Z');
  rejects(()=>transitionOrder(order,owner,'completed',{now:'2026-10-26T00:00:00Z'}),'orderInspectionActive');
});

test('legacy storage migration is idempotent, keeps unrelated data, infers no payment and validates stale orders again', () => {
  const oldGroups = [group()], oldOrders = ['g','orphan'];
  const migrated = migrateOrders(oldOrders,oldGroups,[product],start);
  assert.equal(migrated[0].status,'pending_payment');
  assert.ok(Object.values(migrated[0].payments).every(p=>p.status==='unpaid'));
  assert.equal(migrated[0].createdAt,null);
  assert.equal(migrated[0].history[0].type,'legacy_order_imported');
  assert.equal(migrated[1],'orphan');
  assert.deepEqual(migrateOrders(migrated,oldGroups,[product]),migrated);
  assert.deepEqual(oldOrders,['g','orphan']);
  const stale = {...group(),approvals:{}};
  const waiting = migrateOrders(['g'],[stale],[product],start)[0];
  assert.equal(waiting.status,'waiting_for_members');
  rejects(()=>activateOrder(waiting,stale,product,owner),'orderNotReady');
  rejects(()=>reportPayment(waiting,member),'orderInvalidTransition');
  const active = activateOrder(waiting,group(),product,owner);
  assert.equal(active.status,'pending_payment');
  assert.equal(active.history[0].type,'legacy_order_imported');
  const reloaded = JSON.parse(JSON.stringify(active));
  assert.equal(reportPayment(reloaded,member).payments.b.status,'payment_reported');
});

test('ordered group locks prevent changing confirmed snapshot or creating a second order', () => {
  const locked = lockOrderedGroups([group()],[make()])[0];
  const checks = [()=>joinGroup(locked,'x'),()=>leaveGroup(locked,'b'),()=>changeCosts(locked,'a',locked.costs),()=>transferOwner(locked,'a','b'),()=>approve(locked,'a',2)];
  for(const check of checks) rejects(check,'orderedGroupLocked');
  rejects(()=>createOrder(locked,product,owner),'orderAlreadyExists');
});

test('permissions restrict order visibility and listing management to participants and owning seller', () => {
  const order = make();
  for(const actor of [owner,member,seller]) assert.equal(orderPermissions(order,actor).view,true);
  for(const actor of [outsider,otherSeller,null,{id:'fake-seller',role:'seller'}]) assert.equal(orderPermissions(order,actor).view,false);
  assert.doesNotThrow(()=>assertListingSeller(product,seller));
  for(const actor of [member,otherSeller,{id:'unknown',role:'seller'}]) rejects(()=>assertListingSeller(product,actor),'orderUnauthorized');
});

test('inspection configuration validates bounds and rejected actions never mutate order or history', () => {
  for(const hours of [0,-1,0.5,721,NaN,'24']) rejects(()=>createOrder(group(),product,owner,{hours}),'orderInvalidInspection');
  const order = make(), before = structuredClone(order);
  rejects(()=>updatePayment(order,owner,'b','verified'),'orderInvalidPaymentTransition');
  rejects(()=>openDispute(order,member,{reason:'other',description:''}),'orderInvalidDetails');
  assert.deepEqual(order,before);
});

test('refund outcome includes only verified shares when other members are still reporting payment', () => {
  let order = reportPayment(make(),owner);
  order = updatePayment(order,owner,'a','verification_pending');
  order = updatePayment(order,owner,'a','verified');
  order = reportPayment(order,member);
  order = openDispute(order,member,{reason:'payment_disagreement',description:'Partial demo payment disagreement'});
  const id = order.disputes[0].id;
  order = proposeResolution(order,seller,id,{decision:'refund',note:'Refund verified demo shares only'});
  order = respondToResolution(order,member,id,true);
  assert.equal(order.refund.amountSatang,5501);
  assert.equal(order.payments.b.status,'payment_reported');
  assert.equal(order.status,'refunded');
});

test('waiting legacy orders activate from current membership and current leader after a transfer', () => {
  const stale = {...group(),approvals:{}};
  const waiting = migrateOrders(['g'],[stale],[product],start)[0];
  let current = transferOwner(stale,'a','b');
  current = leaveGroup(current,'a');
  current = joinGroup(current,'x');
  current = approve(current,'b',current.revision);
  current = approve(current,'x',current.revision);
  rejects(()=>activateOrder(waiting,current,product,owner),'orderUnauthorized');
  const active = activateOrder(waiting,current,product,member);
  assert.equal(active.ownerId,'b');
  assert.deepEqual(active.members,['b','x']);
  assert.deepEqual(Object.keys(active.payments),['b','x']);
  assert.equal(active.history[0].type,'legacy_order_imported');
});
