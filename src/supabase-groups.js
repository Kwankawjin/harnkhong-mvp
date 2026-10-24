import {supabase} from './supabase.js';
import {mapDatabaseGroup} from './group-mapping.js';

function mapBundle({group, members = [], approvals = [], events = []}) {
  const names = {};
  const memberIds = members.map(member=>{
    names[member.user_id] = {id:member.user_id,name:member.display_name};
    return member.user_id;
  });
  const approved = Object.fromEntries(approvals.map(item=>[item.user_id,Number(item.revision)]));
  return {group:mapDatabaseGroup(group,memberIds,approved,events),names};
}

export async function loadSupabaseGroups(client = supabase) {
  const [groupResult,productResult,shopResult] = await Promise.all([
    // Embed related rows so totals and membership come from one database snapshot.
    client.from('groups').select('id,listing_id,owner_id,name,visibility,capacity,product_satang,delivery_per_member_satang,service_satang,total_satang,revision,status,created_at,members:group_members(user_id,display_name,joined_at,approvals:group_approvals(revision)),events:group_events(revision,event_type,created_at)')
      .order('created_at',{ascending:false}).order('joined_at',{referencedTable:'members'}).order('id',{referencedTable:'events'}),
    client.from('products').select('id,seller_id,title,category,kind,price_satang,art,mark,description,terms').eq('active',true),
    client.from('shops').select('id,name,intro,initials'),
  ]);
  for (const result of [groupResult,productResult,shopResult]) if (result.error) throw result.error;
  const bundles=(groupResult.data||[]).map(row=>mapBundle({
    group:row,
    members:row.members||[],
    approvals:(row.members||[]).flatMap(member=>member.approvals?[{...member.approvals,user_id:member.user_id}]:[]),
    events:row.events||[],
  }));
  return {
    groups:bundles.map(bundle=>bundle.group),names:Object.assign({},...bundles.map(bundle=>bundle.names)),
    listings:(productResult.data||[]).map(row=>{
      const price=Number(row.price_satang);
      if(!Number.isSafeInteger(price)||price<0)throw Object.assign(new Error('Product price exceeds supported amount'),{code:'groupTotalOutOfRange'});
      return {id:row.id,sellerId:row.seller_id,title:row.title,category:row.category,kind:row.kind,price,art:row.art,mark:row.mark,description:row.description,terms:row.terms};
    }),
    sellers:(shopResult.data||[]).map(row=>({id:row.id,name:row.name,intro:row.intro,initials:row.initials})),
  };
}

export async function resolveSupabaseInvite(groupId,token,userId) {
  if (!userId) return null;
  const {data,error} = await supabase.rpc('resolve_group_invite',{p_group:groupId,p_token:token});
  if (error) throw error;
  if (!data) return null;
  const row = data;
  const members = row.members||[];
  const approvals = Object.entries(row.approvals||{}).map(([user_id,revision])=>({user_id,revision}));
  const history = (row.history||[]).map(item=>({revision:item.revision,event_type:item.event_type,created_at:item.created_at}));
  const bundle = mapBundle({group:row,members,approvals,events:history});
  return bundle;
}

async function runMutation(name,args,requestId=crypto.randomUUID()) {
  const {data,error} = await supabase.rpc(name,{...args,p_request:requestId});
  if (error) throw error;
  return data;
}

export async function createSupabaseGroup({listingId,name,visibility,capacity,delivery,requestId}) {
  return runMutation('create_group',{p_listing:listingId,p_name:name,p_visibility:visibility,p_capacity:capacity,p_delivery:delivery},requestId);
}
export async function joinSupabaseGroup(groupId,token=null) {
  return runMutation('join_group',{p_group:groupId,p_token:token});
}
export async function leaveSupabaseGroup(groupId) {
  return runMutation('leave_group',{p_group:groupId});
}
export async function approveSupabaseGroup(groupId,revision) {
  return runMutation('approve_group',{p_group:groupId,p_revision:revision});
}
export async function changeSupabaseDelivery(groupId,delivery) {
  return runMutation('change_group_delivery',{p_group:groupId,p_delivery:delivery});
}
export async function transferSupabaseGroup(groupId,nextOwnerId) {
  return runMutation('transfer_group_owner',{p_group:groupId,p_next_owner:nextOwnerId});
}
export async function getSupabaseInvite(groupId) {
  const {data,error}=await supabase.rpc('get_group_invite',{p_group:groupId});
  if(error)throw error;
  return data;
}
