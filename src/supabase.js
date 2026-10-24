import { createClient } from '@supabase/supabase-js';

const url = import.meta.env?.VITE_SUPABASE_URL?.trim();
const publishableKey = import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();

export const supabaseConfigured = Boolean(url && publishableKey);
export const supabase = supabaseConfigured
  ? createClient(url, publishableKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      },
    })
  : null;

export let googleAuthAvailable = false;

export async function refreshAuthProviders() {
  if (!supabaseConfigured) return false;
  try {
    const response = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: publishableKey } });
    if (!response.ok) return false;
    const settings = await response.json();
    googleAuthAvailable = settings.external?.google === true;
  } catch {
    googleAuthAvailable = false;
  }
  return googleAuthAvailable;
}

export async function loadAuthenticatedUser(authUser) {
  const displayName = String(authUser.user_metadata?.display_name || authUser.user_metadata?.full_name || authUser.email?.split('@')[0] || '').slice(0, 70);
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .upsert({ id: authUser.id, display_name: displayName }, { onConflict: 'id', ignoreDuplicates: true })
    .select('id, display_name, bio, avatar_url')
    .maybeSingle();
  if (profileError) throw profileError;

  // Upsert with ignoreDuplicates can return no row when a profile already exists.
  let currentProfile = profile;
  if (!currentProfile) {
    const { data, error } = await supabase.from('profiles').select('id, display_name, bio, avatar_url').eq('id', authUser.id).single();
    if (error) throw error;
    currentProfile = data;
  }

  const { data: address, error: addressError } = await supabase
    .from('addresses')
    .select('house_no, village_no, province, district, subdistrict, alley, road, postal_code, phone')
    .eq('user_id', authUser.id)
    .maybeSingle();
  if (addressError) throw addressError;

  return {
    id: authUser.id,
    email: authUser.email || '',
    name: currentProfile.display_name || displayName,
    bio: currentProfile.bio || '',
    avatar: currentProfile.avatar_url || '',
    role: 'member',
    address: address ? {
      houseNo: address.house_no, villageNo: address.village_no || '', province: address.province,
      district: address.district, subdistrict: address.subdistrict, alley: address.alley || '',
      road: address.road || '', postalCode: address.postal_code, phone: address.phone,
    } : null,
  };
}

export async function saveAuthenticatedAddress(userId, address) {
  const { error } = await supabase.from('addresses').upsert({
    user_id: userId,
    house_no: address.houseNo,
    village_no: address.villageNo || null,
    province: address.province,
    district: address.district,
    subdistrict: address.subdistrict,
    alley: address.alley || null,
    road: address.road || null,
    postal_code: address.postalCode,
    phone: address.phone,
  }, { onConflict: 'user_id' });
  if (error) throw error;
}
