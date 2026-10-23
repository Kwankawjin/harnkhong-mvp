import test from 'node:test';
import assert from 'node:assert/strict';
import {allocate, parseBaht, totalCost, joinGroup, leaveGroup, approve, changeCosts, transferOwner, allApproved} from '../src/domain.js';
const group = () => ({id:'g',ownerId:'a',members:['a','b','c','d'],capacity:4,costs:{product:40000,delivery:0,service:0},revision:1,approvals:{a:1,b:1,c:1,d:1},status:'ready',history:[]});
test('เงินลงตัวและเศษสตางค์รวมครบ', () => {
  assert.deepEqual(Object.values(allocate(40000,['a','b','c','d'])),[10000,10000,10000,10000]);
  assert.deepEqual(Object.values(allocate(40000,['a','b','c'])),[13334,13333,13333]);
  assert.deepEqual(Object.values(allocate(10000,['a','b','c'])),[3334,3333,3333]);
  assert.deepEqual(Object.values(allocate(44000,['a','b','c'])),[14667,14667,14666]);
  assert.deepEqual(Object.values(allocate(101,['a'])),[101]);
  assert.equal(Object.values(allocate(101,['a','b','c'])).reduce((a,b)=>a+b),101);
});
test('ปฏิเสธเงินผิดรูปแบบ', () => {
  assert.equal(parseBaht('12.30'),1230);
  for (const bad of ['-1','1.234','abc','Infinity']) assert.throws(()=>parseBaht(bad));
  assert.throws(()=>allocate(-1,['a'])); assert.throws(()=>allocate(1,[])); assert.throws(()=>allocate(1,['a','a']));
  assert.equal(totalCost({product:40000,delivery:4000,service:0}),44000);
});
test('ออกจากกลุ่มแล้วแก้ revision และล้างการยืนยัน', () => {
  const left=leaveGroup(group(),'d');
  assert.equal(left.revision,2); assert.deepEqual(left.approvals,{}); assert.equal(left.status,'awaiting_approval');
  assert.deepEqual(Object.values(allocate(totalCost(left.costs),left.members)),[13334,13333,13333]);
  assert.throws(()=>approve(left,'a',1));
  let next=approve(left,'a',2); next=approve(next,'b',2); next=approve(next,'c',2);
  assert.equal(allApproved(next),false); // ยังไม่เต็ม 4 คน
  assert.equal(next.status,'awaiting_approval');
});
test('สมาชิกซ้ำ กลุ่มเต็ม และหัวหน้ากลุ่มออกถูกป้องกัน', () => {
  assert.throws(()=>joinGroup(group(),'a')); assert.throws(()=>joinGroup(group(),'x'));
  assert.throws(()=>leaveGroup(group(),'a'));
  assert.equal(transferOwner(group(),'a','b').ownerId,'b');
});
test('สมาชิกใหม่และค่าใช้จ่ายใหม่ต้องยืนยันอีกครั้ง', () => {
  let g={...group(),members:['a','b','c'],status:'awaiting_approval'};
  g=joinGroup(g,'d'); assert.equal(g.revision,2); assert.deepEqual(g.approvals,{});
  g=changeCosts(g,'a',{product:40000,delivery:4000,service:0}); assert.equal(g.revision,3);
  for (const id of g.members) g=approve(g,id,3);
  assert.equal(g.status,'ready');
});
