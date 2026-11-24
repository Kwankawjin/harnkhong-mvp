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
  "own_request", "group_not_owned", "group_unavailable", "billing_mismatch", "product_mismatch",
  "category_mismatch", "requester_already_member", "full_group", "over_budget", "duplicate_offer",
  "offer_not_found", "offer_not_pending", "offer_price_changed", "reservation_not_found",
  "reservation_not_active", "group_closed", "invite_invalid",
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

const RESERVATION_FIELDS = "id,offer_id,request_id,group_id,requester_id,seats_reserved,status,expires_at,created_at,updated_at";
export const mapReservation = (row) => ({
  id: row.id,
  offerId: row.offer_id,
  requestId: row.request_id,
  groupId: row.group_id,
  requesterId: row.requester_id,
  seatsReserved: row.seats_reserved,
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
  const [request, offers, reservations] = await Promise.all([
    supabase.from("hk_requests").select(REQUEST_FIELDS).eq("id", id).maybeSingle(),
    supabase.from("hk_request_offers").select(OFFER_FIELDS).eq("request_id", id).order("created_at"),
    supabase.from("hk_group_reservations").select(RESERVATION_FIELDS).eq("request_id", id).order("created_at"),
  ]);
  rethrow(request.error);
  // Guests have no access to offers or reservations at all; that is not an error for the page.
  const offerRows = offers.error ? [] : offers.data || [];
  const reservationRows = reservations.error ? [] : reservations.data || [];
  return {
    request: request.data ? mapRequest(request.data) : null,
    offers: offerRows.map(mapOffer),
    reservations: reservationRows.map(mapReservation),
  };
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

// ------------------------------------------------------------------ host side (Phase 3)
/** The signed-in host's groups for this request, with free seats, seat price and why not. */
export async function fetchOfferableGroups(requestId) {
  const { data, error } = await supabase.rpc("hk_my_offerable_groups", { p_request: requestId });
  rethrow(error);
  return (data || []).map((row) => ({
    groupId: row.group_id,
    name: row.name,
    capacity: row.capacity,
    freeSeats: row.free_seats,
    seatPrice: row.seat_satang == null ? null : Number(row.seat_satang),
    billing: row.billing_mode,
    matches: row.matches,
    reason: row.reason,
  }));
}

export async function submitSupabaseOffer(requestId, groupId, message) {
  const { data, error } = await supabase.rpc("hk_submit_offer", {
    p_request: requestId,
    p_group: groupId,
    p_message: message,
  });
  rethrow(error);
  return data;
}

export async function withdrawSupabaseOffer(offerId) {
  const { error } = await supabase.rpc("hk_withdraw_offer", { p_offer: offerId });
  rethrow(error);
}

/** Offers this user sent, each with the request it answers. */
export async function fetchMyOffers(userId) {
  await sync();
  const { data, error } = await supabase
    .from("hk_request_offers")
    .select(`${OFFER_FIELDS},request:hk_requests(${REQUEST_FIELDS}),reservations:hk_group_reservations(${RESERVATION_FIELDS})`)
    .eq("host_id", userId)
    .order("created_at", { ascending: false })
    .limit(200);
  rethrow(error);
  const rows = data || [];
  return {
    offers: rows.map(mapOffer),
    requests: rows.filter((row) => row.request).map((row) => mapRequest(row.request)),
    reservations: rows.flatMap((row) => [].concat(row.reservations || [])).map(mapReservation),
  };
}

// ------------------------------------------------------------------ matching (Phase 4)
export async function acceptSupabaseOffer(offerId) {
  const { data, error } = await supabase.rpc("hk_accept_offer", { p_offer: offerId });
  rethrow(error);
  return data; // reservation id
}

export async function rejectSupabaseOffer(offerId) {
  const { error } = await supabase.rpc("hk_reject_offer", { p_offer: offerId });
  rethrow(error);
}

/** Joins through private.join_group; returns the group id. */
export async function joinSupabaseReservedGroup(reservationId) {
  const { data, error } = await supabase.rpc("hk_join_reserved_group", {
    p_reservation: reservationId,
    p_request_key: crypto.randomUUID(),
  });
  rethrow(error);
  return data;
}

// ------------------------------------------------------------------ notifications (Phase 5)
const NOTIFICATION_FIELDS =
  "id,type,is_read,created_at,request_id,offer_id,request:hk_requests(title),offer:hk_request_offers(host_name,group_snapshot)";

export async function fetchRequestNotifications(userId) {
  const { data, error } = await supabase
    .from("hk_request_notifications")
    .select(NOTIFICATION_FIELDS)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(60);
  rethrow(error);
  return (data || []).map((row) => ({
    id: row.id,
    type: row.type,
    read: row.is_read,
    at: row.created_at,
    requestId: row.request_id,
    offerId: row.offer_id,
    requestTitle: row.request?.title || "",
    hostName: row.offer?.host_name || "",
    groupName: row.offer?.group_snapshot?.group_name || "",
  }));
}

export async function markRequestNotificationsRead(ids) {
  const { error } = await supabase.rpc("hk_mark_notifications_read", { p_ids: ids?.length ? ids : null });
  rethrow(error);
}

/** Calls onInsert for every new notification row for this user; returns an unsubscribe function. */
export function subscribeRequestNotifications(userId, onInsert) {
  const channel = supabase
    .channel(`hk-notifications-${userId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "hk_request_notifications", filter: `user_id=eq.${userId}` },
      (payload) => onInsert(payload.new),
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}
