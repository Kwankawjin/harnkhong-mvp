import { SEAT_MODE, UNIT_MODE, openUnits, saleMode, seatPrice, unitJoinPrice, unitMode } from "./domain.js";

// Request Marketplace: requester side (Phase 2) and host side (Phase 3).
// Pure functions over plain arrays: the browser-only test mode keeps its data with them, and the
// Supabase mode uses the same validation before calling the RPCs in supabase-requests.js.
// The rules mirror supabase/migrations/20261121130000_request_marketplace.sql.

export const REQUEST_STATUSES = Object.freeze(["open", "matched", "completed", "cancelled", "expired"]);
export const REQUEST_BILLING = Object.freeze(["monthly", "one_time"]);
export const REQUEST_EXPIRY_DAYS = Object.freeze([3, 7, 14]);
export const MAX_OPEN_REQUESTS = 10;
export const MAX_BUDGET_SATANG = 100_000_000;
const DAY = 86_400_000;

const fail = (code, message) => {
  throw Object.assign(new Error(message), { code });
};

const satangOrNull = (value) => (value === null || value === undefined || value === "" ? null : value);

/** Checks and normalizes what the create/edit forms send. Amounts are satang integers. */
export function validateRequestInput(input, { editing = false } = {}) {
  const title = String(input?.title ?? "").trim();
  const description = String(input?.description ?? "").trim();
  if (title.length < 3 || title.length > 80) fail("hk_invalid_title", "ชื่อประกาศต้องยาว 3–80 ตัวอักษร");
  if (description.length > 600) fail("hk_invalid_description", "รายละเอียดยาวได้ไม่เกิน 600 ตัวอักษร");
  const budgetMax = input?.budgetMax;
  const budgetMin = satangOrNull(input?.budgetMin);
  if (!Number.isSafeInteger(budgetMax) || budgetMax < 0 || budgetMax > MAX_BUDGET_SATANG)
    fail("hk_invalid_budget", "กรุณากรอกงบสูงสุดให้ถูกต้อง");
  if (budgetMin !== null && (!Number.isSafeInteger(budgetMin) || budgetMin < 0 || budgetMin > budgetMax))
    fail("hk_invalid_budget_range", "งบขั้นต่ำต้องไม่มากกว่างบสูงสุด");
  const result = { title, description, budgetMax, budgetMin };
  if (editing) return result;
  const category = String(input?.category ?? "").trim();
  if (!category || category.length > 60) fail("hk_invalid_category", "กรุณาเลือกบริการหรือหมวดหมู่");
  if (!REQUEST_BILLING.includes(input?.billingCycle)) fail("hk_invalid_billing", "กรุณาเลือกรอบการชำระเงิน");
  const expiresInDays = Number(input?.expiresInDays);
  if (!Number.isSafeInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > 30)
    fail("hk_invalid_expiry", "กรุณาเลือกระยะเวลาประกาศ");
  return { ...result, category, billingCycle: input.billingCycle, expiresInDays, seatsNeeded: 1 };
}

const isLive = (request, now) => ["open", "matched"].includes(request.status) && Date.parse(request.expiresAt) > now;

/** Time-outs, applied lazily the way private.hk_expire does. Returns new arrays when something changed. */
export function expireRequests(requests = [], offers = [], now = Date.now()) {
  let changed = false;
  const nextOffers = offers.map((offer) => {
    if (offer.status === "pending" && Date.parse(offer.expiresAt) <= now) {
      changed = true;
      return { ...offer, status: "expired", updatedAt: new Date(now).toISOString() };
    }
    return offer;
  });
  const expired = new Set();
  const nextRequests = requests.map((request) => {
    if (request.status === "open" && Date.parse(request.expiresAt) <= now) {
      changed = true;
      expired.add(request.id);
      return { ...request, status: "expired", updatedAt: new Date(now).toISOString() };
    }
    return request;
  });
  return {
    changed,
    expired: [...expired],
    requests: nextRequests,
    offers: nextOffers.map((offer) =>
      expired.has(offer.requestId) && offer.status === "pending" ? { ...offer, status: "expired" } : offer,
    ),
  };
}

export function createRequest(requests = [], input, user, { now = Date.now(), id = crypto.randomUUID() } = {}) {
  if (!user?.id) fail("authentication_required", "กรุณาเข้าสู่ระบบก่อน");
  const clean = validateRequestInput(input);
  const live = requests.filter((request) => request.requesterId === user.id && isLive(request, now));
  if (live.length >= MAX_OPEN_REQUESTS) fail("too_many_open_requests", "เปิดประกาศค้างไว้ได้ไม่เกิน 10 ประกาศ");
  const at = new Date(now).toISOString();
  const request = {
    id,
    requesterId: user.id,
    requesterName: String(user.name || "สมาชิก").slice(0, 70),
    productId: null,
    category: clean.category,
    title: clean.title,
    description: clean.description,
    budgetMin: clean.budgetMin,
    budgetMax: clean.budgetMax,
    seatsNeeded: 1,
    billingCycle: clean.billingCycle,
    status: "open",
    offerCount: 0,
    expiresAt: new Date(now + clean.expiresInDays * DAY).toISOString(),
    createdAt: at,
    updatedAt: at,
  };
  return { request, requests: [request, ...requests] };
}

function ownedRequest(requests, id, user) {
  const request = requests.find((item) => item.id === id);
  if (!request || request.requesterId !== user?.id) fail("request_not_found", "ไม่พบประกาศนี้");
  return request;
}

/** Hosts never answer a moving target: only open requests without live offers can change. */
export function canEditRequest(request, offers = [], now = Date.now()) {
  return (
    request?.status === "open" &&
    Date.parse(request.expiresAt) > now &&
    !offers.some((offer) => offer.requestId === request.id && offer.status === "pending")
  );
}

export function updateRequest(requests, offers, id, input, user, { now = Date.now() } = {}) {
  const request = ownedRequest(requests, id, user);
  if (request.status !== "open" || Date.parse(request.expiresAt) <= now) fail("request_not_open", "ประกาศนี้ไม่ได้เปิดรับข้อเสนอแล้ว");
  if (!canEditRequest(request, offers, now)) fail("request_has_offers", "มีข้อเสนอแล้ว แก้ไขประกาศไม่ได้");
  const clean = validateRequestInput(input, { editing: true });
  const next = { ...request, ...clean, updatedAt: new Date(now).toISOString() };
  return { request: next, requests: requests.map((item) => (item.id === id ? next : item)) };
}

export function cancelRequest(requests, offers, id, user, { now = Date.now() } = {}) {
  const request = ownedRequest(requests, id, user);
  if (!["open", "matched"].includes(request.status)) fail("request_not_open", "ประกาศนี้ไม่ได้เปิดรับข้อเสนอแล้ว");
  const at = new Date(now).toISOString();
  const cancelledOffers = [];
  const nextOffers = offers.map((offer) => {
    if (offer.requestId === id && ["pending", "accepted"].includes(offer.status)) {
      cancelledOffers.push(offer);
      return { ...offer, status: "cancelled", updatedAt: at };
    }
    return offer;
  });
  const next = { ...request, status: "cancelled", updatedAt: at };
  return {
    request: next,
    cancelledOffers,
    releaseReservations: (reservations = []) =>
      reservations.map((r) => (r.requestId === id && r.status === "reserved" ? { ...r, status: "cancelled", updatedAt: at } : r)),
    requests: requests.map((item) => (item.id === id ? next : item)),
    offers: nextOffers,
  };
}

/**
 * What the UI shows. "has_offers" is derived (pending offers exist), never stored, so it can't drift.
 */
export function requestPhase(request, offers = [], now = Date.now()) {
  if (!request) return "missing";
  if (request.status === "open" && Date.parse(request.expiresAt) <= now) return "expired";
  if (request.status !== "open") return request.status;
  const pending = offers.some((offer) => offer.requestId === request.id && offer.status === "pending");
  return pending || (!offers.length && request.offerCount > 0) ? "has_offers" : "open";
}

export const MY_REQUEST_TABS = Object.freeze(["all", "waiting", "offers", "done"]);

/** My Requests tabs: all, waiting (no offer yet), offers (has offers or matched), done (closed). */
export function filterMyRequests(requests, offers, tab, now = Date.now()) {
  return requests.filter((request) => {
    const phase = requestPhase(request, offers, now);
    if (tab === "waiting") return phase === "open";
    if (tab === "offers") return phase === "has_offers" || phase === "matched";
    if (tab === "done") return ["completed", "cancelled", "expired"].includes(phase);
    return true;
  });
}

/** Open requests anyone can browse, newest first, filtered by category and text. */
export function browseRequests(requests, { q = "", category = "ทั้งหมด" } = {}, now = Date.now()) {
  const query = q.trim().toLowerCase();
  return requests
    .filter((request) => request.status === "open" && Date.parse(request.expiresAt) > now)
    .filter((request) => category === "ทั้งหมด" || request.category === category)
    .filter((request) => !query || `${request.title} ${request.category} ${request.description}`.toLowerCase().includes(query))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

/** Whole days/hours left, for "เหลือเวลา 2 วัน". */
export function timeLeft(expiresAt, now = Date.now()) {
  const ms = Date.parse(expiresAt) - now;
  if (!(ms > 0)) return { expired: true, days: 0, hours: 0 };
  const hours = Math.ceil(ms / 3_600_000);
  return { expired: false, days: Math.floor(hours / 24), hours };
}

// ------------------------------------------------------------------ Host side (Phase 3)
// Local mirror of hk_my_offerable_groups / hk_submit_offer / hk_withdraw_offer. The group helpers
// come from domain.js so prices and free seats match what joining the group really costs.

export const OFFER_HOURS = 72;
export const MY_OFFER_TABS = Object.freeze(["all", "pending", "accepted", "closed"]);
const LIVE_OFFER = ["pending", "accepted", "completed"];

export const groupCategories = (group) =>
  group?.categories?.length ? group.categories : group?.category ? [group.category] : [];
export const groupBilling = (group) => (group?.billing === "monthly" ? "monthly" : "one_time");

/** Can this group take a new member at all (seats aside)? Same idea as private.hk_group_open. */
export function groupOpenForOffers(group, now = Date.now()) {
  if (!group || group.status === "cancelled" || group.closedAt || group.orderId || saleMode(group)) return false;
  if (![SEAT_MODE, UNIT_MODE].includes(group.costs?.mode)) return false;
  const closesAt = group.details?.closesAt || group.closesAt;
  return !(closesAt && closesAt < new Date(now).toISOString().slice(0, 10));
}

export const RESERVATION_HOURS = 24;
const liveReservation = (reservation, now) => reservation.status === "reserved" && Date.parse(reservation.expiresAt) > now;

/** Seats nobody holds: open seats minus live reservations by anyone but `exceptUser` (hk_free_seats). */
export const freeSeats = (group, reservations = [], exceptUser = null, now = Date.now()) =>
  openUnits(group) -
  reservations
    .filter((r) => r.groupId === group.id && liveReservation(r, now) && r.requesterId !== exceptUser)
    .reduce((sum, r) => sum + (r.seatsReserved || 1), 0);

/** Would joining this group take a seat someone else is holding? (the group_members trigger) */
export const reservedSeatBlocks = (group, reservations, userId, now = Date.now()) =>
  reservations.some((r) => r.groupId === group.id && liveReservation(r, now)) && freeSeats(group, reservations, userId, now) <= 0;

/** What the next member pays for one seat; null when nobody can join. */
export function nextSeatPrice(group) {
  if (!group || freeSeats(group) < 1) return null;
  if (unitMode(group)) return unitJoinPrice(group, 1);
  if (group.costs?.mode !== SEAT_MODE) return null;
  return seatPrice(group.costs, group.capacity, group.members.length);
}

/** Why a group can't be offered for a request (null when it can). */
export function offerBlocker(group, request, offers = [], now = Date.now(), reservations = []) {
  if (!groupOpenForOffers(group, now)) return "group_unavailable";
  if (groupBilling(group) !== request.billingCycle) return "billing_mismatch";
  if (request.productId && group.listingId !== request.productId) return "product_mismatch";
  if (!groupCategories(group).includes(request.category)) return "category_mismatch";
  if (group.members.includes(request.requesterId)) return "requester_already_member";
  if (freeSeats(group, reservations, null, now) < (request.seatsNeeded || 1)) return "full_group";
  const price = nextSeatPrice(group);
  if (price === null) return "group_unavailable";
  if (price > request.budgetMax) return "over_budget";
  if (offers.some((offer) => offer.requestId === request.id && offer.groupId === group.id && LIVE_OFFER.includes(offer.status)))
    return "duplicate_offer";
  return null;
}

/** The host's own groups, offerable ones first, with free seats and the seat price. */
export function offerableGroups(groups, request, user, offers = [], now = Date.now(), reservations = []) {
  return groups
    .filter((group) => group.ownerId === user?.id && group.status !== "cancelled" && !group.closedAt)
    .map((group) => {
      const reason = offerBlocker(group, request, offers, now, reservations);
      return {
        groupId: group.id,
        name: group.name,
        capacity: group.capacity,
        freeSeats: freeSeats(group, reservations, null, now),
        seatPrice: groupOpenForOffers(group, now) ? nextSeatPrice(group) : null,
        billing: groupBilling(group),
        matches: reason === null,
        reason,
      };
    })
    .sort((a, b) => Number(b.matches) - Number(a.matches));
}

export function submitOffer(requests, offers, groups, requestId, groupId, message, user, { now = Date.now(), id = crypto.randomUUID(), reservations = [] } = {}) {
  if (!user?.id) fail("authentication_required", "กรุณาเข้าสู่ระบบก่อน");
  const request = requests.find((item) => item.id === requestId);
  if (!request) fail("request_not_found", "ไม่พบประกาศนี้");
  if (request.status !== "open" || Date.parse(request.expiresAt) <= now) fail("request_not_open", "ประกาศนี้ไม่ได้เปิดรับข้อเสนอแล้ว");
  if (request.requesterId === user.id) fail("own_request", "เสนอให้ประกาศของตัวเองไม่ได้");
  const group = groups.find((item) => item.id === groupId);
  if (!group || group.ownerId !== user.id) fail("group_not_owned", "เลือกได้เฉพาะกลุ่มที่คุณเป็นเจ้าของ");
  const text = String(message ?? "").trim();
  if (text.length > 400) fail("hk_invalid_message", "ข้อความยาวได้ไม่เกิน 400 ตัวอักษร");
  const blocker = offerBlocker(group, request, offers, now, reservations);
  if (blocker) fail(blocker, blocker);
  const price = nextSeatPrice(group);
  const at = new Date(now).toISOString();
  const offer = {
    id,
    requestId,
    hostId: user.id,
    hostName: String(user.name || "สมาชิก").slice(0, 70),
    groupId,
    offered: price,
    seatsOffered: 1,
    message: text,
    snapshot: {
      group_name: group.name,
      categories: groupCategories(group),
      capacity: group.capacity,
      billing_cycle: groupBilling(group),
      pay_day: group.payDay ?? null,
      offered_satang: price,
      seats_offered: 1,
      free_seats: freeSeats(group, reservations, null, now),
      captured_at: at,
    },
    status: "pending",
    expiresAt: new Date(Math.min(now + OFFER_HOURS * 3_600_000, Date.parse(request.expiresAt))).toISOString(),
    createdAt: at,
    updatedAt: at,
  };
  const nextRequest = { ...request, offerCount: (request.offerCount || 0) + 1, updatedAt: at };
  return {
    offer,
    request: nextRequest,
    offers: [...offers, offer],
    requests: requests.map((item) => (item.id === requestId ? nextRequest : item)),
  };
}

/**
 * Hosts withdraw their own pending offer, or back out of an accepted one: that releases the held
 * seat and reopens the request (hk_withdraw_offer).
 */
export function withdrawOffer(offers, offerId, user, { now = Date.now(), requests = [], reservations = [] } = {}) {
  const offer = offers.find((item) => item.id === offerId);
  if (!offer || offer.hostId !== user?.id) fail("offer_not_found", "ไม่พบข้อเสนอนี้");
  if (!["pending", "accepted"].includes(offer.status)) fail("offer_not_pending", "ข้อเสนอนี้ไม่ได้รอพิจารณาแล้ว");
  const at = new Date(now).toISOString();
  const next = { ...offer, status: "withdrawn", updatedAt: at };
  let nextRequests = requests;
  let nextReservations = reservations;
  if (offer.status === "accepted") {
    nextReservations = reservations.map((r) => (r.offerId === offerId && r.status === "reserved" ? { ...r, status: "cancelled", updatedAt: at } : r));
    nextRequests = requests.map((r) =>
      r.id === offer.requestId && r.status === "matched" ? { ...r, status: Date.parse(r.expiresAt) > now ? "open" : "expired", updatedAt: at } : r,
    );
  }
  return { offer: next, offers: offers.map((item) => (item.id === offerId ? next : item)), requests: nextRequests, reservations: nextReservations };
}

/** My Offers tabs: all, pending, accepted (accepted or joined), closed (everything else). */
export function filterMyOffers(offers, tab, now = Date.now()) {
  return offers.filter((offer) => {
    const status = offer.status === "pending" && Date.parse(offer.expiresAt) <= now ? "expired" : offer.status;
    if (tab === "pending") return status === "pending";
    if (tab === "accepted") return status === "accepted" || status === "completed";
    if (tab === "closed") return ["rejected", "withdrawn", "expired", "cancelled"].includes(status);
    return true;
  });
}

// ------------------------------------------------------------------ Matching (Phase 4)
// Local mirror of hk_reject_offer / hk_accept_offer / hk_join_reserved_group and the reservation
// part of private.hk_expire. Joining itself goes through the group's normal join (domain.joinGroup).

export function rejectOffer(requests, offers, offerId, user, { now = Date.now() } = {}) {
  const offer = offers.find((item) => item.id === offerId);
  const request = offer && requests.find((item) => item.id === offer.requestId);
  if (!offer || !request || request.requesterId !== user?.id) fail("offer_not_found", "ไม่พบข้อเสนอนี้");
  if (offer.status !== "pending" || Date.parse(offer.expiresAt) <= now) fail("offer_not_pending", "ข้อเสนอนี้ไม่ได้รอพิจารณาแล้ว");
  const next = { ...offer, status: "rejected", updatedAt: new Date(now).toISOString() };
  return { offer: next, request, offers: offers.map((item) => (item.id === offerId ? next : item)) };
}

/**
 * Accept one offer: re-check the group now (owner, open, not already a member, a free seat that
 * nobody else holds, price not above what was offered), hold the seat for 24 hours, turn the other
 * pending offers down and mark the request matched.
 */
export function acceptOffer(requests, offers, reservations, groups, offerId, user, { now = Date.now(), id = crypto.randomUUID() } = {}) {
  const offer = offers.find((item) => item.id === offerId);
  const request = offer && requests.find((item) => item.id === offer.requestId);
  if (!offer || !request || request.requesterId !== user?.id) fail("offer_not_found", "ไม่พบข้อเสนอนี้");
  if (request.status !== "open" || Date.parse(request.expiresAt) <= now) fail("request_not_open", "ประกาศนี้ไม่ได้เปิดรับข้อเสนอแล้ว");
  if (offer.status !== "pending" || Date.parse(offer.expiresAt) <= now) fail("offer_not_pending", "ข้อเสนอนี้ไม่ได้รอพิจารณาแล้ว");
  const group = groups.find((item) => item.id === offer.groupId);
  if (!group || group.ownerId !== offer.hostId || !groupOpenForOffers(group, now)) fail("group_unavailable", "กลุ่มนี้ไม่ได้เปิดรับสมาชิกแล้ว");
  if (group.members.includes(user.id)) fail("requester_already_member", "คุณอยู่ในกลุ่มนี้แล้ว");
  if (freeSeats(group, reservations, null, now) < (request.seatsNeeded || 1)) fail("full_group", "ที่นั่งเต็มแล้ว");
  const price = nextSeatPrice(group);
  if (price === null || price > offer.offered) fail("offer_price_changed", "ราคากลุ่มเปลี่ยนไปจากที่เสนอ");
  const at = new Date(now).toISOString();
  const reservation = {
    id,
    offerId,
    requestId: request.id,
    groupId: group.id,
    requesterId: user.id,
    seatsReserved: request.seatsNeeded || 1,
    status: "reserved",
    expiresAt: new Date(now + RESERVATION_HOURS * 3_600_000).toISOString(),
    createdAt: at,
    updatedAt: at,
  };
  const turnedDown = [];
  const nextOffers = offers.map((item) => {
    if (item.id === offerId) return { ...item, status: "accepted", updatedAt: at };
    if (item.requestId === request.id && item.status === "pending") {
      turnedDown.push(item);
      return { ...item, status: "rejected", updatedAt: at };
    }
    return item;
  });
  const nextRequest = { ...request, status: "matched", updatedAt: at };
  return {
    reservation,
    request: nextRequest,
    offer: nextOffers.find((item) => item.id === offerId),
    turnedDown,
    offers: nextOffers,
    requests: requests.map((item) => (item.id === request.id ? nextRequest : item)),
    reservations: [...reservations, reservation],
  };
}

/** Checks a reservation can be used to join now. The caller joins the group, then calls completeReservation. */
export function activeReservation(reservations, reservationId, user, now = Date.now()) {
  const reservation = reservations.find((item) => item.id === reservationId);
  if (!reservation || reservation.requesterId !== user?.id) fail("reservation_not_found", "ไม่พบการจองที่นั่งนี้");
  if (reservation.status !== "reserved" || Date.parse(reservation.expiresAt) <= now || !reservation.groupId)
    fail("reservation_not_active", "การจองที่นั่งหมดเวลาหรือถูกยกเลิกแล้ว");
  return reservation;
}

/** After the join succeeded: reservation confirmed, offer and request completed. */
export function completeReservation(requests, offers, reservations, reservationId, { now = Date.now() } = {}) {
  const at = new Date(now).toISOString();
  const reservation = reservations.find((item) => item.id === reservationId);
  return {
    reservations: reservations.map((item) => (item.id === reservationId ? { ...item, status: "confirmed", updatedAt: at } : item)),
    offers: offers.map((item) => (item.id === reservation.offerId ? { ...item, status: "completed", updatedAt: at } : item)),
    requests: requests.map((item) => (item.id === reservation.requestId ? { ...item, status: "completed", updatedAt: at } : item)),
  };
}

/** Held seats that timed out go back; their offer is cancelled and the request reopens if it can. */
export function expireReservations(requests = [], offers = [], reservations = [], now = Date.now()) {
  const at = new Date(now).toISOString();
  const lapsed = reservations.filter((r) => r.status === "reserved" && Date.parse(r.expiresAt) <= now);
  if (!lapsed.length) return { changed: false, lapsed, requests, offers, reservations };
  const offerIds = new Set(lapsed.map((r) => r.offerId));
  const requestIds = new Set(lapsed.map((r) => r.requestId));
  return {
    changed: true,
    lapsed,
    reservations: reservations.map((r) => (lapsed.includes(r) ? { ...r, status: "expired", updatedAt: at } : r)),
    offers: offers.map((o) => (offerIds.has(o.id) && o.status === "accepted" ? { ...o, status: "cancelled", updatedAt: at } : o)),
    requests: requests.map((r) =>
      requestIds.has(r.id) && r.status === "matched" ? { ...r, status: Date.parse(r.expiresAt) > now ? "open" : "expired", updatedAt: at } : r,
    ),
  };
}

/** The live (or last) reservation for a request, if any. */
export const reservationFor = (reservations, requestId) =>
  [...reservations].reverse().find((r) => r.requestId === requestId && ["reserved", "confirmed"].includes(r.status)) || null;
