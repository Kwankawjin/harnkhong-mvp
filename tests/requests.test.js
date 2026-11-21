import test from "node:test";
import assert from "node:assert/strict";
import {
  browseRequests,
  canEditRequest,
  cancelRequest,
  createRequest,
  expireRequests,
  filterMyRequests,
  requestPhase,
  timeLeft,
  updateRequest,
  validateRequestInput,
  filterMyOffers,
  nextSeatPrice,
  offerBlocker,
  offerableGroups,
  submitOffer,
  withdrawOffer,
} from "../src/requests.js";
import { createGroup } from "../src/domain.js";

const jin = { id: "jin", name: "Jin" };
const other = { id: "other", name: "Other" };
const now = Date.parse("2026-11-21T10:00:00Z");
const input = {
  title: "หาเพื่อนหาร YouTube Premium",
  category: "แอปพลิเคชันและเว็บไซต์",
  description: "ระยะยาว",
  budgetMax: 5000,
  billingCycle: "monthly",
  expiresInDays: 7,
};

test("validates request input", () => {
  assert.deepEqual(validateRequestInput(input), { ...input, budgetMin: null, seatsNeeded: 1 });
  assert.throws(() => validateRequestInput({ ...input, title: "ab" }), { code: "hk_invalid_title" });
  assert.throws(() => validateRequestInput({ ...input, category: "" }), { code: "hk_invalid_category" });
  assert.throws(() => validateRequestInput({ ...input, budgetMax: -1 }), { code: "hk_invalid_budget" });
  assert.throws(() => validateRequestInput({ ...input, budgetMax: 1.5 }), { code: "hk_invalid_budget" });
  assert.throws(() => validateRequestInput({ ...input, budgetMin: 6000 }), { code: "hk_invalid_budget_range" });
  assert.throws(() => validateRequestInput({ ...input, billingCycle: "yearly" }), { code: "hk_invalid_billing" });
  assert.throws(() => validateRequestInput({ ...input, expiresInDays: 31 }), { code: "hk_invalid_expiry" });
  assert.throws(() => validateRequestInput({ ...input, description: "x".repeat(601) }), { code: "hk_invalid_description" });
});

test("creates an open request that expires after the chosen days", () => {
  const { request, requests } = createRequest([], input, jin, { now, id: "r1" });
  assert.equal(requests.length, 1);
  assert.equal(request.status, "open");
  assert.equal(request.requesterId, "jin");
  assert.equal(request.seatsNeeded, 1);
  assert.equal(Date.parse(request.expiresAt) - now, 7 * 86_400_000);
  assert.throws(() => createRequest([], input, null), { code: "authentication_required" });
});

test("caps live requests per person at 10", () => {
  let requests = [];
  for (let i = 0; i < 10; i += 1) requests = createRequest(requests, input, jin, { now, id: `r${i}` }).requests;
  assert.throws(() => createRequest(requests, input, jin, { now }), { code: "too_many_open_requests" });
  assert.doesNotThrow(() => createRequest(requests, input, other, { now }));
});

test("only the owner edits, and only while open without pending offers", () => {
  const { requests } = createRequest([], input, jin, { now, id: "r1" });
  const edited = updateRequest(requests, [], "r1", { title: "หากลุ่ม Netflix", budgetMax: 9000 }, jin, { now });
  assert.equal(edited.request.title, "หากลุ่ม Netflix");
  assert.equal(edited.request.budgetMax, 9000);
  assert.equal(edited.request.category, input.category, "category stays");
  assert.throws(() => updateRequest(requests, [], "r1", input, other, { now }), { code: "request_not_found" });
  const offers = [{ id: "o1", requestId: "r1", status: "pending" }];
  assert.equal(canEditRequest(requests[0], offers, now), false);
  assert.throws(() => updateRequest(requests, offers, "r1", input, jin, { now }), { code: "request_has_offers" });
});

test("cancelling a request cancels its pending and accepted offers", () => {
  const { requests } = createRequest([], input, jin, { now, id: "r1" });
  const offers = [
    { id: "o1", requestId: "r1", status: "pending", hostId: "h1" },
    { id: "o2", requestId: "r1", status: "rejected", hostId: "h2" },
    { id: "o3", requestId: "other", status: "pending", hostId: "h3" },
  ];
  const result = cancelRequest(requests, offers, "r1", jin, { now });
  assert.equal(result.request.status, "cancelled");
  assert.deepEqual(result.offers.map((o) => o.status), ["cancelled", "rejected", "pending"]);
  assert.deepEqual(result.cancelledOffers.map((o) => o.id), ["o1"]);
  assert.throws(() => cancelRequest(result.requests, result.offers, "r1", jin, { now }), { code: "request_not_open" });
  assert.throws(() => cancelRequest(requests, offers, "r1", other, { now }), { code: "request_not_found" });
});

test("expiry closes requests and their pending offers", () => {
  const { requests } = createRequest([], { ...input, expiresInDays: 1 }, jin, { now, id: "r1" });
  const offers = [{ id: "o1", requestId: "r1", status: "pending", expiresAt: new Date(now + 3 * 86_400_000).toISOString() }];
  assert.equal(expireRequests(requests, offers, now).changed, false);
  const later = now + 2 * 86_400_000;
  const result = expireRequests(requests, offers, later);
  assert.equal(result.changed, true);
  assert.deepEqual(result.expired, ["r1"]);
  assert.equal(result.requests[0].status, "expired");
  assert.equal(result.offers[0].status, "expired");
  assert.equal(requestPhase(requests[0], [], later), "expired", "phase reads expiry even before it is stored");
});

test("phases, tabs and browsing", () => {
  let requests = createRequest([], input, jin, { now, id: "a" }).requests;
  requests = createRequest(requests, { ...input, title: "หากลุ่ม Spotify", category: "สินค้าดิจิทัล" }, jin, { now: now + 1000, id: "b" }).requests;
  requests = cancelRequest(requests, [], "b", jin, { now }).requests;
  requests = createRequest(requests, { ...input, title: "Netflix" }, other, { now: now + 2000, id: "c" }).requests;
  const offers = [{ id: "o", requestId: "a", status: "pending" }];
  assert.equal(requestPhase(requests.find((r) => r.id === "a"), offers, now), "has_offers");
  assert.equal(requestPhase(requests.find((r) => r.id === "c"), offers, now), "open");
  const mine = requests.filter((r) => r.requesterId === "jin");
  assert.deepEqual(filterMyRequests(mine, offers, "all", now).map((r) => r.id).sort(), ["a", "b"]);
  assert.deepEqual(filterMyRequests(mine, offers, "offers", now).map((r) => r.id), ["a"]);
  assert.deepEqual(filterMyRequests(mine, offers, "waiting", now).map((r) => r.id), []);
  assert.deepEqual(filterMyRequests(mine, offers, "done", now).map((r) => r.id), ["b"]);
  assert.deepEqual(browseRequests(requests, {}, now).map((r) => r.id), ["c", "a"], "open only, newest first");
  assert.deepEqual(browseRequests(requests, { q: "netflix" }, now).map((r) => r.id), ["c"]);
  assert.deepEqual(browseRequests(requests, { category: "สินค้าดิจิทัล" }, now).map((r) => r.id), []);
});

test("time left", () => {
  assert.deepEqual(timeLeft(new Date(now + 2.5 * 86_400_000).toISOString(), now), { expired: false, days: 2, hours: 60 });
  assert.deepEqual(timeLeft(new Date(now + 3_000_000).toISOString(), now), { expired: false, days: 0, hours: 1 });
  assert.equal(timeLeft(new Date(now - 1).toISOString(), now).expired, true);
});

// ------------------------------------------------------------------ host side
const host = { id: "host", name: "Host A" };
const ytGroup = () => ({
  ...createGroup({ id: "g-yt", listingId: "l1", name: "YouTube Family", ownerId: "host", visibility: "public", capacity: 6, costs: { product: 25900, delivery: 0 }, billing: "monthly", payDay: 5 }),
  category: input.category,
  categories: [input.category],
});
const openRequest = () => createRequest([], input, jin, { now, id: "r1" });

test("next seat price follows the group's own seat pricing", () => {
  const group = ytGroup();
  assert.equal(nextSeatPrice(group), 4317, "25900 over 6 seats, seat 1 carries a remainder satang");
  assert.equal(nextSeatPrice({ ...group, members: ["host", "a", "b", "c", "d", "e"] }), null, "full");
});

test("lists the host's groups with the reason a group can't be offered", () => {
  const { request } = openRequest();
  const groups = [
    ytGroup(),
    { ...ytGroup(), id: "g-other", category: "สินค้าดิจิทัล", categories: ["สินค้าดิจิทัล"] },
    { ...ytGroup(), id: "g-onetime", billing: "one_time" },
    { ...ytGroup(), id: "g-pricey", costs: { product: 90000, delivery: 0, mode: "seat_v3" } },
    { ...ytGroup(), id: "g-not-mine", ownerId: "someone" },
    { ...ytGroup(), id: "g-closed", closedAt: "2026-11-01T00:00:00Z" },
  ];
  const list = offerableGroups(groups, request, host, [], now);
  assert.deepEqual(list.map((g) => [g.groupId, g.reason]), [
    ["g-yt", null],
    ["g-other", "category_mismatch"],
    ["g-onetime", "billing_mismatch"],
    ["g-pricey", "over_budget"],
  ]);
  assert.equal(list[0].seatPrice, 4317);
  assert.equal(list[0].freeSeats, 5);
  assert.equal(offerBlocker({ ...ytGroup(), members: ["host", "jin"] }, request, [], now), "requester_already_member");
  assert.equal(offerBlocker({ ...ytGroup(), status: "cancelled" }, request, [], now), "group_unavailable");
});

test("submitting an offer freezes the seat price and counts it on the request", () => {
  const { requests } = openRequest();
  const groups = [ytGroup()];
  const result = submitOffer(requests, [], groups, "r1", "g-yt", " ว่าง 1 ที่ ", host, { now, id: "o1" });
  assert.equal(result.offer.offered, 4317);
  assert.equal(result.offer.status, "pending");
  assert.equal(result.offer.message, "ว่าง 1 ที่");
  assert.equal(result.offer.snapshot.group_name, "YouTube Family");
  assert.equal(result.offer.snapshot.offered_satang, 4317);
  assert.equal(Date.parse(result.offer.expiresAt) - now, 72 * 3_600_000);
  assert.equal(result.request.offerCount, 1);
  assert.throws(() => submitOffer(result.requests, result.offers, groups, "r1", "g-yt", "", host, { now }), { code: "duplicate_offer" });
  assert.throws(() => submitOffer(requests, [], groups, "r1", "g-yt", "", jin, { now }), { code: "own_request" });
  assert.throws(() => submitOffer(requests, [], groups, "r1", "g-yt", "", other, { now }), { code: "group_not_owned" });
  assert.throws(() => submitOffer(requests, [], groups, "r1", "g-yt", "x".repeat(401), host, { now }), { code: "hk_invalid_message" });
  const cancelled = cancelRequest(requests, [], "r1", jin, { now }).requests;
  assert.throws(() => submitOffer(cancelled, [], groups, "r1", "g-yt", "", host, { now }), { code: "request_not_open" });
});

test("an offer never outlives its request", () => {
  const { requests } = createRequest([], { ...input, expiresInDays: 1 }, jin, { now, id: "r1" });
  const { offer } = submitOffer(requests, [], [ytGroup()], "r1", "g-yt", "", host, { now });
  assert.equal(offer.expiresAt, requests[0].expiresAt);
});

test("hosts withdraw their own pending offers, and may offer again", () => {
  const { requests } = openRequest();
  const groups = [ytGroup()];
  const sent = submitOffer(requests, [], groups, "r1", "g-yt", "", host, { now, id: "o1" });
  assert.throws(() => withdrawOffer(sent.offers, "o1", other, { now }), { code: "offer_not_found" });
  const { offers } = withdrawOffer(sent.offers, "o1", host, { now });
  assert.equal(offers[0].status, "withdrawn");
  assert.throws(() => withdrawOffer(offers, "o1", host, { now }), { code: "offer_not_pending" });
  assert.doesNotThrow(() => submitOffer(sent.requests, offers, groups, "r1", "g-yt", "", host, { now }));
  assert.deepEqual(filterMyOffers(offers, "closed", now).map((o) => o.id), ["o1"]);
  assert.deepEqual(filterMyOffers(sent.offers, "pending", now).map((o) => o.id), ["o1"]);
  assert.deepEqual(filterMyOffers(sent.offers, "closed", Date.parse(sent.offer.expiresAt) + 1).map((o) => o.id), ["o1"], "a lapsed pending offer counts as closed");
});
