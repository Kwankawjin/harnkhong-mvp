import test from 'node:test';
import assert from 'node:assert/strict';
import {mapDatabaseGroup} from '../src/group-mapping.js';
import {costBreakdown,totalCost,shares} from '../src/domain.js';
import {loadSupabaseGroups} from '../src/supabase-groups.js';

const cases = [
  {product:64500,delivery:4000,count:4,service:1610,total:82110},
  {product:101,delivery:1,count:3,service:2,total:106},
  {product:120000,delivery:0,count:3,service:2400,total:122400},
];

test('Supabase totals match the app fee and remainder rules for shared cases',()=>{
  for(const item of cases){
    const costs={product:item.product,delivery:item.delivery,mode:'per_member_v2'};
    assert.equal(costBreakdown(costs,item.count).service,item.service);
    assert.equal(totalCost(costs,item.count),item.total);
    const members=Array.from({length:item.count},(_,index)=>`member-${index+1}`);
    const group={id:'g',listing_id:'p1',owner_id:members[0],name:'Group',visibility:'public',capacity:item.count,product_satang:item.product,delivery_per_member_satang:item.delivery,service_satang:item.service,total_satang:item.total,revision:1,status:'awaiting_approval'};
    const mapped=mapDatabaseGroup(group,members,{},[]);
    assert.equal(Object.values(shares(mapped)).reduce((sum,value)=>sum+value,0),item.total);
  }
});

test('Supabase group mapping rejects stale or unsafe database totals',()=>{
  const row={id:'g',listing_id:'p1',owner_id:'a',name:'Group',visibility:'public',capacity:2,product_satang:101,delivery_per_member_satang:1,service_satang:2,total_satang:999,revision:1,status:'awaiting_approval'};
  assert.throws(()=>mapDatabaseGroup(row,['a','b']),{code:'groupTotalMismatch'});
  assert.throws(()=>mapDatabaseGroup({...row,total_satang:Number.MAX_SAFE_INTEGER+1},['a','b']),{code:'groupTotalOutOfRange'});
});

test('group loader reads membership, one-to-one approvals and history in the same query',async()=>{
  const queries=[];
  const row={id:'g',listing_id:'p1',owner_id:'a',name:'Group',visibility:'public',capacity:2,product_satang:101,delivery_per_member_satang:1,service_satang:2,total_satang:105,revision:2,status:'awaiting_approval',
    members:[{user_id:'a',display_name:'Alice',approvals:{revision:2}},{user_id:'b',display_name:'Bob',approvals:null}],
    events:[{revision:2,event_type:'member_joined',created_at:'2026-10-25T00:00:00Z'}]};
  const client={from(table){
    const query={table,orders:[]};queries.push(query);
    return {select(columns){query.columns=columns;return this;},order(column,options){query.orders.push({column,...options});return this;},eq(){return this;},then(resolve){resolve({data:table==='groups'?[row]:[],error:null});}};
  }};
  const result=await loadSupabaseGroups(client);
  assert.deepEqual(queries.map(query=>query.table),['groups','products','shops']);
  assert.match(queries[0].columns,/members:group_members\(.+approvals:group_approvals\(revision\)/);
  assert.match(queries[0].columns,/events:group_events/);
  assert.ok(queries[0].orders.some(order=>order.column==='joined_at'&&order.referencedTable==='members'));
  assert.deepEqual(result.groups[0].members,['a','b']);
  assert.deepEqual(result.groups[0].approvals,{a:2});
  assert.equal(result.names.b.name,'Bob');
  assert.equal(result.groups[0].history[0].reason,'มีสมาชิกเข้าร่วม');
  assert.equal(Object.values(shares(result.groups[0])).reduce((a,b)=>a+b,0),105);
});

test('group loader handles an empty catalog and propagates database errors',async()=>{
  const failure={code:'42501',message:'permission denied'};
  let error=null;
  const client={from(){return {select(){return this;},order(){return this;},eq(){return this;},then(resolve){resolve({data:[],error});}};}};
  assert.deepEqual(await loadSupabaseGroups(client),{groups:[],names:{},listings:[],sellers:[]});
  error=failure;
  await assert.rejects(loadSupabaseGroups(client),failure);
});
