import test from 'node:test';
import assert from 'node:assert/strict';
import {mapDatabaseGroup} from '../src/group-mapping.js';
import {costBreakdown,totalCost,shares} from '../src/domain.js';

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
