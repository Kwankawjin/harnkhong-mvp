import test from 'node:test';
import assert from 'node:assert/strict';
import {allocate, parseBaht, totalCost, createGroup, joinGroup, leaveGroup, approve, changeCosts, transferOwner, allApproved} from '../src/domain.js';
const group = () => ({id:'g',ownerId:'a',members:['a','b','c','d'],capacity:4,costs:{product:40000,delivery:0,service:0},revision:1,approvals:{a:1,b:1,c:1,d:1},status:'ready',history:[]});
const newGroup = () => ({id:'new',listingId:'p1',name:' กลุ่มใหม่ ',ownerId:'a',visibility:'public',capacity:4,costs:{product:101,delivery:1,service:0}});

test('สร้างกลุ่มสาธารณะและเฉพาะลิงก์ด้วยผู้สร้างเป็นสมาชิกแรก', () => {
  for (const visibility of ['public', 'link']) {
    const input = {...newGroup(), visibility}, snapshot = structuredClone(input);
    const g = createGroup(input);
    assert.equal(g.name, 'กลุ่มใหม่');
    assert.equal(g.visibility, visibility);
    assert.deepEqual(g.members, ['a']);
    assert.equal(g.ownerId, 'a');
    assert.equal(g.revision, 1);
    assert.deepEqual(g.approvals, {});
    assert.equal(g.status, 'awaiting_approval');
    assert.equal(g.history[0].revision, 1);
    assert.deepEqual(allocate(totalCost(g.costs), g.members), {a:102});
    assert.deepEqual(input, snapshot);
    g.costs.product = 5;
    assert.equal(input.costs.product, 101);
  }
});

test('ตรวจข้อมูลสร้างกลุ่มและรหัสสมาชิกก่อนนำไปใช้', () => {
  const badInputs = [{name:''}, {name:'   '}, {name:null}, {visibility:'private'}, {capacity:1}, {capacity:21}, {capacity:2.5}, {capacity:'4'}, {costs:null}];
  for (const patch of badInputs) assert.throws(() => createGroup({...newGroup(), ...patch}), e => typeof e.code === 'string');
  for (const id of ['', ' ', ' a', 'a ', null, undefined, 12]) {
    for (const field of ['id', 'listingId', 'ownerId']) assert.throws(() => createGroup({...newGroup(), [field]:id}), {code:'invalidId'});
    assert.throws(() => allocate(100, [id]), {code:'invalidId'});
    assert.throws(() => joinGroup({...group(), members:['a']}, id), {code:'invalidId'});
  }
});

test('ปฏิเสธผลรวมเกิน safe integer แม้แต่ละรายการถูกต้อง', () => {
  const costs = {product:Number.MAX_SAFE_INTEGER, delivery:1, service:0};
  assert.throws(() => totalCost(costs), {code:'invalidSatang'});
  assert.throws(() => createGroup({...newGroup(), costs}), {code:'invalidSatang'});
  assert.throws(() => changeCosts(group(), 'a', costs), {code:'invalidSatang'});
  for (const amount of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER+1, '100']) assert.throws(() => allocate(amount, ['a']), {code:'invalidSatang'});
  assert.equal(parseBaht('0.29'), 29);
  assert.equal(parseBaht('90071992547409.91'), Number.MAX_SAFE_INTEGER);
  assert.throws(() => parseBaht('90071992547409.92'), {code:'invalidSatang'});
});
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

test('ทุกสตางค์ถูกจัดสรรตามลำดับ รวมถึงขอบเขตจำนวนเต็ม', () => {
  for (const total of [0, 1, 2, 101, 40000, Number.MAX_SAFE_INTEGER]) {
    for (let count = 1; count <= 20; count++) {
      const ids = Array.from({length:count}, (_, i) => 'm'+i);
      const amounts = Object.values(allocate(total, ids));
      assert.equal(amounts.reduce((sum, n) => sum + BigInt(n), 0n), BigInt(total));
      assert.ok(Math.max(...amounts) - Math.min(...amounts) <= 1);
      assert.ok(amounts.every((n, i) => Number.isSafeInteger(n) && n === Math.floor(total/count) + (i < total%count ? 1 : 0)));
    }
  }
});

test('ออกซ้ำและเปลี่ยนสมาชิกรอบถัดไปยกเลิกคำยืนยันก่อนหน้า', () => {
  let g = approve(leaveGroup(group(), 'd'), 'a', 2);
  g = leaveGroup(g, 'c');
  assert.equal(g.revision, 3);
  assert.deepEqual(g.approvals, {});
  assert.throws(() => approve(g, 'a', 2));
  g = approve(g, 'a', 3);
  g = joinGroup(g, 'e');
  assert.equal(g.revision, 4);
  assert.deepEqual(g.approvals, {});
  assert.throws(() => approve(g, 'a', 3));
  g = changeCosts(approve(g, 'b', 4), 'a', {...g.costs, delivery:100});
  assert.equal(g.revision, 5);
  assert.deepEqual(g.approvals, {});
  assert.throws(() => approve(g, 'b', 4));
});

test('ผู้ไม่มีสิทธิ์เปลี่ยนกลุ่มหรือยืนยันยอดไม่ได้', () => {
  assert.throws(() => leaveGroup(group(), 'outsider'));
  assert.throws(() => approve(group(), 'outsider', 1));
  assert.throws(() => changeCosts(group(), 'b', group().costs));
  assert.throws(() => transferOwner(group(), 'b', 'c'));
  assert.throws(() => transferOwner(group(), 'a', 'outsider'));
  assert.throws(() => transferOwner(group(), 'a', 'a'));
  assert.throws(() => joinGroup({...group(), status:'cancelled'}, 'outsider'));
});

test('การเปลี่ยนกลุ่มไม่แก้ object ตั้งต้น', () => {
  const original = group(), snapshot = structuredClone(original);
  const left = leaveGroup(original, 'd');
  const leftSnapshot = structuredClone(left);
  joinGroup(left, 'e');
  approve(left, 'a', left.revision);
  changeCosts(left, 'a', {...left.costs, delivery:100});
  transferOwner(left, 'a', 'b');
  assert.deepEqual(original, snapshot);
  assert.deepEqual(left, leftSnapshot);
});
