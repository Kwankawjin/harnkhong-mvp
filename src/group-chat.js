import {supabase, supabaseConfigured} from './supabase.js';

const MAX_MESSAGE_LENGTH = 500;

function messageText(value) {
  return String(value ?? '').trim().slice(0, MAX_MESSAGE_LENGTH);
}

function displayTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat(undefined, {hour:'2-digit', minute:'2-digit'}).format(date);
}

function mapRemoteMessage(row) {
  const profile = Array.isArray(row.sender) ? row.sender[0] : row.sender;
  return {
    id: row.id,
    senderId: row.sender_id,
    sender: profile?.display_name || row.sender_name || 'สมาชิกในกลุ่ม',
    avatar: profile?.avatar_url || '',
    text: row.body,
    time: displayTime(row.created_at),
  };
}

export async function loadGroupMessages(groupId) {
  if (!supabaseConfigured) return [];
  const {data, error} = await supabase
    .from('group_messages')
    .select('id,group_id,sender_id,sender_name,body,created_at,sender:profiles(display_name,avatar_url)')
    .eq('group_id', groupId)
    .order('created_at', {ascending:true});
  if (error) throw error;
  return (data || []).map(mapRemoteMessage);
}

export async function sendGroupMessage(groupId, user, body) {
  const cleanBody = messageText(body);
  if (!cleanBody) throw new Error('Message is required');
  if (!supabaseConfigured) {
    const now = new Date();
    return {
      id: `gm_${crypto.randomUUID()}`,
      sender: user?.name || 'สมาชิกในกลุ่ม',
      senderId: user?.id || 'me',
      avatar: user?.avatar || '',
      text: cleanBody,
      time: displayTime(now),
      createdAt: now.toISOString(),
    };
  }
  const {data, error} = await supabase
    .from('group_messages')
    .insert({group_id:groupId, sender_id:user.id, sender_name:user.name, body:cleanBody})
    .select('id,group_id,sender_id,sender_name,body,created_at,sender:profiles(display_name,avatar_url)')
    .single();
  if (error) throw error;
  return mapRemoteMessage(data);
}

