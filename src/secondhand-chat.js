import { supabase, supabaseConfigured } from './supabase.js';

const cleanMessage = value => String(value ?? '').trim().slice(0, 500);

function mapMessage(row, userId) {
  return {
    id: row.id,
    from: row.sender_id === userId ? 'me' : 'seller',
    senderId: row.sender_id,
    body: row.body,
    at: row.created_at,
  };
}

export async function startSecondhandConversation(listingId, user, sellerId) {
  if (!supabaseConfigured) throw new Error('Secondhand chat requires Supabase');
  if (!user?.id || !listingId || !sellerId || user.id === sellerId) throw new Error('Invalid secondhand conversation');
  const query = () => supabase.from('secondhand_conversations')
    .select('id,listing_id,buyer_id,seller_id,created_at')
    .eq('listing_id', listingId).eq('buyer_id', user.id).maybeSingle();
  const existing = await query();
  if (existing.error) throw existing.error;
  if (existing.data) return existing.data;
  const { data, error } = await supabase.from('secondhand_conversations')
    .insert({ listing_id: listingId, buyer_id: user.id, seller_id: sellerId })
    .select('id,listing_id,buyer_id,seller_id,created_at').single();
  if (!error) return data;
  // A second click in another tab may create the same unique conversation first.
  if (error.code === '23505') {
    const raced = await query();
    if (raced.error) throw raced.error;
    if (raced.data) return raced.data;
  }
  throw error;
}

export async function loadSecondhandMessages(conversationId, userId) {
  if (!supabaseConfigured) return [];
  const { data, error } = await supabase.from('secondhand_messages')
    .select('id,conversation_id,sender_id,body,created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []).map(row => mapMessage(row, userId));
}

export async function sendSecondhandMessage(conversationId, user, body) {
  const cleanBody = cleanMessage(body);
  if (!cleanBody) throw new Error('Message is required');
  const { data, error } = await supabase.from('secondhand_messages')
    .insert({ conversation_id: conversationId, sender_id: user.id, body: cleanBody })
    .select('id,conversation_id,sender_id,body,created_at').single();
  if (error) throw error;
  return mapMessage(data, user.id);
}

export async function loadSecondhandConversations(userId) {
  if (!supabaseConfigured) return [];
  const { data, error } = await supabase.from('secondhand_conversations')
    .select('id,listing_id,buyer_id,seller_id,created_at')
    .or(`buyer_id.eq.${userId},seller_id.eq.${userId}`)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}
