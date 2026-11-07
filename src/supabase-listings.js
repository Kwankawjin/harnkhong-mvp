import { supabase } from "./supabase.js";

const BUCKET = "secondhand-listings";
const LISTING_FIELDS =
  "id,owner_id,seller_name,title,category,item_condition,delivery,area,market_address,market_latitude,market_longitude,contact,images,price_satang,description,quantity";

function isMissingBoostColumn(error) {
  return (
    ["42703", "PGRST204"].includes(error?.code) ||
    String(error?.message || "")
      .toLowerCase()
      .includes("boosted_until")
  );
}

async function queryListing(buildQuery) {
  let result = await buildQuery(`${LISTING_FIELDS},boosted_until`);
  if (isMissingBoostColumn(result.error))
    result = await buildQuery(LISTING_FIELDS);
  return result;
}

function mapListing(row) {
  return {
    id: row.id,
    sellerId: row.owner_id,
    sellerName: row.seller_name,
    title: row.title,
    category: row.category,
    kind: "สินค้า",
    listingType: "secondhand",
    condition: row.item_condition,
    delivery: row.delivery,
    area: row.area,
    marketAddress: row.market_address,
    marketCoordinates:
      row.market_latitude == null
        ? null
        : {
            lat: Number(row.market_latitude),
            lng: Number(row.market_longitude),
          },
    contact: row.contact,
    images: row.images || [],
    price: Number(row.price_satang),
    art: "custom",
    mark: "มือ2",
    description: row.description,
    quantity: Number(row.quantity) || 1,
    boostedUntil: row.boosted_until || null,
    active: row.active !== false,
    terms: `${row.delivery}${row.area ? ` · ${row.area}` : ""}`,
  };
}

export async function loadSupabaseSecondhandListings(client = supabase) {
  const { data, error } = await queryListing((fields) =>
    client
      .from("secondhand_listings")
      .select(fields)
      .eq("active", true)
      .order("created_at", { ascending: false }),
  );
  // Keep the existing marketplace usable before the new migration is deployed.
  if (error?.code === "PGRST205") return [];
  if (error) throw error;
  return (data || []).map(mapListing);
}

function dataUrlToBlob(dataUrl) {
  const [header, base64] = dataUrl.split(",");
  const contentType = header.match(/^data:(.*?);base64$/)?.[1];
  if (!contentType || contentType !== "image/jpeg" || !base64)
    throw new Error("secondhandImageInvalid");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1)
    bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: contentType });
}

export async function createSupabaseSecondhandListing(listing, user) {
  if (!user?.id) throw new Error("secondhandAuthRequired");
  const uploadedPaths = [];
  try {
    const images = [];
    for (const [index, dataUrl] of listing.images.entries()) {
      const path = `${user.id}/${listing.id}/${index + 1}.jpg`;
      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(path, dataUrlToBlob(dataUrl), {
          contentType: "image/jpeg",
          cacheControl: "31536000",
          upsert: false,
        });
      if (uploadError) throw uploadError;
      uploadedPaths.push(path);
      images.push(
        supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl,
      );
    }

    const row = {
      id: listing.id,
      owner_id: user.id,
      seller_name:
        String(user.name || "")
          .trim()
          .slice(0, 70) || "สมาชิก HarnKhong",
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
      quantity: listing.quantity || 1,
    };
    const { data, error } = await supabase
      .from("secondhand_listings")
      .insert(row)
      .select(LISTING_FIELDS)
      .single();
    if (error) throw error;
    return mapListing(data);
  } catch (error) {
    if (uploadedPaths.length)
      await supabase.storage
        .from(BUCKET)
        .remove(uploadedPaths)
        .catch(() => {});
    throw error;
  }
}

export async function updateSupabaseSecondhandListing(id, listing, user) {
  if (!user?.id) throw new Error("secondhandAuthRequired");
  const existing = new Set(listing.existingImages || []);
  const uploadedPaths = [];
  try {
    const images = [];
    for (const [index, image] of listing.images.entries()) {
      if (!image.startsWith("data:")) {
        images.push(image);
        continue;
      }
      const path = `${user.id}/${id}/${crypto.randomUUID()}.jpg`;
      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(path, dataUrlToBlob(image), {
          contentType: "image/jpeg",
          cacheControl: "31536000",
          upsert: false,
        });
      if (error) throw error;
      uploadedPaths.push(path);
      images.push(
        supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl,
      );
    }
    const row = {
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
      quantity: listing.quantity || 1,
    };
    const { data, error } = await supabase
      .from("secondhand_listings")
      .update(row)
      .eq("id", id)
      .eq("owner_id", user.id)
      .select(LISTING_FIELDS)
      .single();
    if (error) throw error;
    const removedPaths = [...existing]
      .filter((url) => !images.includes(url))
      .map((url) => {
        const marker = `/storage/v1/object/public/${BUCKET}/`;
        const index = url.indexOf(marker);
        return index < 0
          ? null
          : decodeURIComponent(url.slice(index + marker.length));
      })
      .filter(Boolean);
    if (removedPaths.length)
      await supabase.storage.from(BUCKET).remove(removedPaths);
    return mapListing(data);
  } catch (error) {
    if (uploadedPaths.length)
      await supabase.storage
        .from(BUCKET)
        .remove(uploadedPaths)
        .catch(() => {});
    throw error;
  }
}

export async function deleteSupabaseSecondhandListing(id, listing, user) {
  if (!user?.id) throw new Error("secondhandAuthRequired");
  const { data, error } = await supabase
    .from("secondhand_listings")
    .delete()
    .eq("id", id)
    .eq("owner_id", user.id)
    .select("id")
    .maybeSingle();
  if (error?.code === "23503") {
    const { error: archiveError } = await supabase
      .from("secondhand_listings")
      .update({ active: false })
      .eq("id", id)
      .eq("owner_id", user.id);
    if (archiveError) throw archiveError;
    return;
  }
  if (error) throw error;
  if (!data) throw new Error("secondhandListingDeleteNotAllowed");
  const paths = (listing.images || [])
    .map((url) => {
      const marker = `/storage/v1/object/public/${BUCKET}/`;
      const index = url.indexOf(marker);
      return index < 0
        ? null
        : decodeURIComponent(url.slice(index + marker.length));
    })
    .filter(Boolean);
  if (paths.length) await supabase.storage.from(BUCKET).remove(paths);
}

export async function boostSupabaseSecondhandListing(id, user, boostedUntil) {
  if (!user?.id) throw new Error("secondhandAuthRequired");
  const { data, error } = await supabase
    .from("secondhand_listings")
    .update({ boosted_until: boostedUntil })
    .eq("id", id)
    .eq("owner_id", user.id)
    .select(`${LISTING_FIELDS},boosted_until`)
    .single();
  if (error) throw error;
  return mapListing(data);
}
