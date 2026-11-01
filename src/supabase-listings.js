import { supabase } from './supabase.js';

const BUCKET = 'secondhand-listings';

function mapListing(row) {
  return {
    id: row.id,
    sellerId: row.owner_id,
    sellerName: row.seller_name,
    title: row.title,
    category: row.category,
    kind: 'สินค้า',
    listingType: 'secondhand',
    condition: row.item_condition,
    delivery: row.delivery,
    area: row.area,
    marketAddress: row.market_address,
    marketCoordinates: row.market_latitude == null ? null : { lat: Number(row.market_latitude), lng: Number(row.market_longitude) },
    contact: row.contact,
    images: row.images || [],
    price: Number(row.price_satang),
    art: 'custom',
    mark: 'มือ2',
    description: row.description,
    terms: `${row.delivery}${row.area ? ` · ${row.area}` : ''}`,
  };
}

export async function loadSupabaseSecondhandListings(client = supabase) {
  const { data, error } = await client.from('secondhand_listings')
    .select('id,owner_id,seller_name,title,category,item_condition,delivery,area,market_address,market_latitude,market_longitude,contact,images,price_satang,description')
    .eq('active', true)
    .order('created_at', { ascending: false });
  // Keep the existing marketplace usable before the new migration is deployed.
  if (error?.code === 'PGRST205') return [];
  if (error) throw error;
  return (data || []).map(mapListing);
}

function dataUrlToBlob(dataUrl) {
  const [header, base64] = dataUrl.split(',');
  const contentType = header.match(/^data:(.*?);base64$/)?.[1];
  if (!contentType || contentType !== 'image/jpeg' || !base64) throw new Error('secondhandImageInvalid');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: contentType });
}

export async function createSupabaseSecondhandListing(listing, user) {
  if (!user?.id) throw new Error('secondhandAuthRequired');
  const uploadedPaths = [];
  try {
    const images = [];
    for (const [index, dataUrl] of listing.images.entries()) {
      const path = `${user.id}/${listing.id}/${index + 1}.jpg`;
      const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, dataUrlToBlob(dataUrl), {
        contentType: 'image/jpeg', cacheControl: '31536000', upsert: false,
      });
      if (uploadError) throw uploadError;
      uploadedPaths.push(path);
      images.push(supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl);
    }

    const row = {
      id: listing.id,
      owner_id: user.id,
      seller_name: String(user.name || '').trim().slice(0, 70) || 'สมาชิก HarnKhong',
      title: listing.title,
      category: listing.category,
      item_condition: listing.condition,
      delivery: listing.delivery,
      area: listing.area,
      market_address: listing.marketAddress,
      market_latitude: listing.marketCoordinates?.lat ?? null,
      market_longitude: listing.marketCoordinates?.lng ?? null,
      contact: listing.contact,
      images,
      price_satang: listing.price,
      description: listing.description,
    };
    const { data, error } = await supabase.from('secondhand_listings').insert(row)
      .select('id,owner_id,seller_name,title,category,item_condition,delivery,area,market_address,market_latitude,market_longitude,contact,images,price_satang,description')
      .single();
    if (error) throw error;
    return mapListing(data);
  } catch (error) {
    if (uploadedPaths.length) await supabase.storage.from(BUCKET).remove(uploadedPaths).catch(() => {});
    throw error;
  }
}
