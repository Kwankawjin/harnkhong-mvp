import { supabase, supabaseConfigured } from "./supabase.js";

export async function createSupabaseSecondhandOrder(
  listing,
  buyer,
  quantity,
  deliveryMethod,
) {
  if (!supabaseConfigured || !buyer?.id)
    throw new Error("secondhandOrderAuthRequired");
  const unitPrice = Number(listing?.price);
  const total = unitPrice * Number(quantity);
  if (
    !Number.isSafeInteger(unitPrice) ||
    !Number.isSafeInteger(total) ||
    quantity < 1
  ) {
    throw new Error("secondhandOrderInvalidAmount");
  }
  const { data, error } = await supabase
    .from("secondhand_orders")
    .insert({
      listing_id: listing.id,
      buyer_id: buyer.id,
      seller_id: listing.sellerId,
      listing_title: listing.title,
      unit_price_satang: unitPrice,
      quantity,
      total_satang: total,
      delivery_method: deliveryMethod,
    })
    .select(
      "id,listing_id,buyer_id,seller_id,listing_title,unit_price_satang,quantity,total_satang,delivery_method,status,created_at",
    )
    .single();
  if (error) throw error;
  return data;
}
