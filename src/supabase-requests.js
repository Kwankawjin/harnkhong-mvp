// Request Marketplace data in Supabase. Tables are read-only for clients; every write is an RPC
// (see supabase/migrations/20261121130000_request_marketplace.sql).
import { supabase } from "./supabase.js";

const REQUEST_FIELDS =
  "id,requester_id,requester_name,product_id,category,title,description,budget_min_satang,budget_max_satang,seats_needed,billing_cycle,status,offer_count,expires_at,created_at,updated_at";
const OFFER_FIELDS =
  "id,request_id,host_id,host_name,group_id,offered_satang,seats_offered,message,group_snapshot,status,expires_at,created_at,updated_at";

// RPC errors arrive as plain messages ("request_not_open"); give them a code the UI can translate.
const KNOWN = new Set([
  "authentication_required", "profile_required", "invalid_request_expiry", "product_unavailable",
  "too_many_open_requests", "request_not_found", "request_not_open", "request_has_offers",
]);
function rethrow(error) {
  if (!error) return;
  const message = String(error.message || "");
  if (KNOWN.has(message)) throw Object.assign(new Error(message), { code: message });
  if (/check constraint|violates/i.test(message)) throw Object.assign(new Error(message), { code: "hk_invalid_input" });
  if (error.code === "PGRST202" || error.code === "42P01" || (/hk_\w+/.test(message) && /function|schema cache|relation/i.test(message)))
    throw Object.assign(new Error(message), { code: "hk_not_installed" });
  throw error;
}

export const mapRequest = (row) => ({
  id: row.id,
  requesterId: row.requester_id,
  requesterName: row.requester_name,
  productId: row.product_id,
  category: row.category,
  title: row.title,
  description: row.description || "",
  budgetMin: row.budget_min_satang,
  budgetMax: Number(row.budget_max_satang),
  seatsNeeded: row.seats_needed,
  billingCycle: row.billing_cycle,
  status: row.status,
  offerCount: row.offer_count || 0,
  expiresAt: row.expires_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const mapOffer = (row) => ({
  id: row.id,
  requestId: row.request_id,
  hostId: row.host_id,
  hostName: row.host_name,
  groupId: row.group_id,
  offered: Number(row.offered_satang),
  seatsOffered: row.seats_offered,
  message: row.message || "",
  snapshot: row.group_snapshot || {},
  status: row.status,
  expiresAt: row.expires_at,
  createdAt: row.created_at,
});

async function sync() {
  const { error } = await supabase.rpc("hk_sync");
  rethrow(error);
}

export async function fetchOpenRequests() {
  await sync();
  const { data, error } = await supabase
    .from("hk_requests")
    .select(REQUEST_FIELDS)
    .eq("status", "open")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(200);
  rethrow(error);
  return (data || []).map(mapRequest);
}

export async function fetchMyRequests(userId) {
  await sync();
  const [requests, offers] = await Promise.all([
    supabase.from("hk_requests").select(REQUEST_FIELDS).eq("requester_id", userId)
      .order("created_at", { ascending: false }).limit(200),
    supabase.from("hk_request_offers").select(`${OFFER_FIELDS},hk_requests!inner(requester_id)`)
      .eq("hk_requests.requester_id", userId).limit(500),
  ]);
  rethrow(requests.error);
  rethrow(offers.error);
  return { requests: (requests.data || []).map(mapRequest), offers: (offers.data || []).map(mapOffer) };
}

/** One request with the offers this viewer may see (RLS: the requester and each offer's host). */
export async function fetchRequest(id) {
  await sync();
  const [request, offers] = await Promise.all([
    supabase.from("hk_requests").select(REQUEST_FIELDS).eq("id", id).maybeSingle(),
    supabase.from("hk_request_offers").select(OFFER_FIELDS).eq("request_id", id).order("created_at"),
  ]);
  rethrow(request.error);
  // Guests have no access to offers at all; that is not an error for the page.
  const offerRows = offers.error ? [] : offers.data || [];
  return { request: request.data ? mapRequest(request.data) : null, offers: offerRows.map(mapOffer) };
}

export async function createSupabaseRequest(input) {
  const { data, error } = await supabase.rpc("hk_create_request", {
    p_title: input.title,
    p_category: input.category,
    p_budget_max_satang: input.budgetMax,
    p_billing_cycle: input.billingCycle,
    p_description: input.description,
    p_budget_min_satang: input.budgetMin,
    p_product_id: null,
    p_expires_in_days: input.expiresInDays,
  });
  rethrow(error);
  return data;
}

export async function updateSupabaseRequest(id, input) {
  const { error } = await supabase.rpc("hk_update_request", {
    p_request: id,
    p_title: input.title,
    p_description: input.description,
    p_budget_max_satang: input.budgetMax,
    p_budget_min_satang: input.budgetMin,
  });
  rethrow(error);
}

export async function cancelSupabaseRequest(id) {
  const { error } = await supabase.rpc("hk_cancel_request", { p_request: id });
  rethrow(error);
}
