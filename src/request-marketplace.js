// Request Marketplace pages (Phase 2: the requester side).
// Routes: /requests, /requests/new, /requests/:id, /requests/:id/edit, /my-requests.
// The page shell, helpers and state live in app.js and are passed in through `ctx`.
import "./requests.css";
import { createGroup } from "./domain.js";
import {
  REQUEST_EXPIRY_DAYS,
  MY_REQUEST_TABS,
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
  MY_OFFER_TABS,
  filterMyOffers,
  offerableGroups,
  submitOffer,
  withdrawOffer,
  RESERVATION_HOURS,
  acceptOffer,
  activeReservation,
  completeReservation,
  expireReservations,
  rejectOffer,
  reservationFor,
  reservedSeatBlocks,
} from "./requests.js";
import {
  cancelSupabaseRequest,
  createSupabaseRequest,
  fetchMyRequests,
  fetchOpenRequests,
  fetchRequest,
  updateSupabaseRequest,
  fetchMyOffers,
  fetchOfferableGroups,
  submitSupabaseOffer,
  withdrawSupabaseOffer,
  acceptSupabaseOffer,
  joinSupabaseReservedGroup,
  rejectSupabaseOffer,
  fetchRequestNotifications,
  markRequestNotificationsRead,
  subscribeRequestNotifications,
} from "./supabase-requests.js";

const PHASE_LABEL = {
  open: "เปิดรับข้อเสนอ",
  has_offers: "มีข้อเสนอแล้ว",
  matched: "เลือกข้อเสนอแล้ว",
  completed: "เข้าร่วมสำเร็จ",
  cancelled: "ยกเลิกแล้ว",
  expired: "หมดอายุ",
};
const OFFER_LABEL = {
  pending: "รอพิจารณา",
  accepted: "ยอมรับแล้ว",
  rejected: "ปฏิเสธแล้ว",
  withdrawn: "Host ถอนข้อเสนอ",
  expired: "หมดอายุ",
  completed: "เข้าร่วมสำเร็จ",
  cancelled: "ยกเลิก",
};
const TAB_LABEL = { all: "ทั้งหมด", waiting: "รอข้อเสนอ", offers: "มีข้อเสนอ", done: "เสร็จสิ้น" };
const BILLING_LABEL = { monthly: "รายเดือน", one_time: "ครั้งเดียว" };
// Copy for hk_request_notifications rows: [title, body]. Body values: {title} {host} {group}.
const NOTE_COPY = {
  offer_received: ["มีข้อเสนอใหม่!", "{host} เสนอกลุ่ม “{group}” สำหรับ “{title}”"],
  offer_accepted: ["ข้อเสนอได้รับการยอมรับ", "ผู้หากลุ่มยอมรับข้อเสนอสำหรับ “{title}” ที่นั่งถูกจองไว้ 24 ชั่วโมง"],
  offer_rejected: ["ข้อเสนอไม่ได้รับเลือก", "ผู้หากลุ่มไม่ได้เลือกข้อเสนอของคุณสำหรับ “{title}”"],
  offer_withdrawn: ["Host ถอนข้อเสนอ", "{host} ถอนข้อเสนอสำหรับ “{title}”"],
  offer_cancelled: ["ข้อเสนอถูกยกเลิก", "กลุ่ม “{group}” ไม่ได้เปิดรับแล้ว ข้อเสนอสำหรับ “{title}” จึงถูกยกเลิก"],
  request_cancelled: ["ประกาศถูกยกเลิก", "ผู้หากลุ่มยกเลิกประกาศ “{title}” แล้ว"],
  request_expired: ["ประกาศหมดอายุ", "ประกาศ “{title}” หมดอายุแล้ว"],
  reservation_expired: ["การจองที่นั่งหมดเวลา", "ที่นั่งที่จองไว้สำหรับ “{title}” ถูกปล่อยแล้ว"],
  join_completed: ["ผู้หากลุ่มเข้าร่วมแล้ว", "ผู้หากลุ่มเข้าร่วมกลุ่ม “{group}” จากประกาศ “{title}” แล้ว"],
};
const OFFER_TAB_LABEL = { all: "ทั้งหมด", pending: "รอพิจารณา", accepted: "ยอมรับแล้ว", closed: "ปิดแล้ว" };
// Why a group can't be offered (codes from hk_my_offerable_groups and src/requests.js).
const BLOCKER_LABEL = {
  group_unavailable: "กลุ่มนี้ไม่ได้เปิดรับสมาชิก",
  billing_mismatch: "รอบการชำระเงินไม่ตรงกับประกาศ",
  product_mismatch: "บริการไม่ตรงกับประกาศ",
  category_mismatch: "หมวดหมู่ไม่ตรงกับประกาศ",
  requester_already_member: "ผู้หากลุ่มอยู่ในกลุ่มนี้แล้ว",
  full_group: "ที่นั่งเต็มแล้ว",
  over_budget: "ราคาต่อที่นั่งเกินงบของประกาศ",
  duplicate_offer: "ส่งข้อเสนอด้วยกลุ่มนี้แล้ว",
  offer_price_changed: "ราคากลุ่มเปลี่ยนไปจากที่เสนอ ขอให้ Host ส่งข้อเสนอใหม่",
};

export function createRequestMarketplace(ctx) {
  const { t, escape, icon, a, title, money } = ctx;

  // ------------------------------------------------------------------ data
  // Test mode (and the plain demo) keeps requests in app state; Supabase mode keeps a small cache.
  // Supabase notifications for the bell, kept live with Realtime.
  const notes = { userId: null, items: [], unsubscribe: null };
  const remote = { open: null, mine: null, myOffers: null, detail: new Map(), offerable: new Map(), loading: new Set(), errors: new Map() };
  const OTHER = "อื่น ๆ (ระบุชื่อเอง)";
  const blankDraft = () => ({ step: 1, category: "", pick: "", otherCategory: "", title: "", description: "", budgetMax: "", budgetMin: "", billingCycle: "monthly", expiresInDays: 7 });
  let draft = blankDraft();

  const local = () => {
    const state = ctx.getState();
    const held = expireReservations(state.hkRequests || [], state.hkOffers || [], state.hkReservations || []);
    if (held.changed) {
      state.hkReservations = held.reservations;
      state.hkOffers = held.offers;
      state.hkRequests = held.requests;
      for (const r of held.lapsed) {
        const request = held.requests.find((item) => item.id === r.requestId);
        const offer = held.offers.find((item) => item.id === r.offerId);
        const title = request?.title || "";
        ctx.notice(t("การจองที่นั่งหมดเวลา"), t("ที่นั่งที่จองไว้สำหรับ “{title}” หมดเวลาแล้ว ประกาศกลับมารับข้อเสนอได้", { title }), `/requests/${r.requestId}`, r.requesterId);
        if (offer) ctx.notice(t("การจองที่นั่งหมดเวลา"), t("ผู้หากลุ่มไม่ได้เข้าร่วมกลุ่มภายในเวลา ที่นั่งกลับมาว่างแล้ว"), `/requests/${r.requestId}`, offer.hostId);
      }
    }
    const result = expireRequests(state.hkRequests || [], state.hkOffers || []);
    if (held.changed || result.changed || !state.hkRequests || !state.hkReservations) {
      state.hkReservations = state.hkReservations || [];
      state.hkRequests = result.requests;
      state.hkOffers = result.offers;
      for (const id of result.expired) {
        const request = result.requests.find((item) => item.id === id);
        ctx.notice(t("ประกาศหมดอายุ"), t("ประกาศ “{title}” หมดอายุแล้ว", { title: request.title }), `/requests/${id}`, request.requesterId);
      }
      ctx.save();
    }
    return { requests: state.hkRequests, offers: state.hkOffers, reservations: state.hkReservations };
  };

  function load(key, loader, apply) {
    if (remote.loading.has(key)) return;
    remote.loading.add(key);
    remote.errors.delete(key);
    const path = location.pathname;
    loader()
      .then(apply)
      .catch((error) => remote.errors.set(key, error))
      .finally(() => {
        remote.loading.delete(key);
        if (location.pathname === path) ctx.render();
      });
  }
  const invalidate = () => {
    remote.open = null;
    remote.mine = null;
    remote.myOffers = null;
    remote.detail.clear();
    remote.offerable.clear();
  };

  /** Returns { ready, error, requests, offers } for the given view. */
  function source(view, id) {
    if (!ctx.supabaseConfigured()) return { ready: true, ...local() };
    const user = ctx.getState().user;
    if (view === "open") {
      if (!remote.open && !remote.errors.has("open")) load("open", fetchOpenRequests, (rows) => (remote.open = rows));
      return { ready: Boolean(remote.open), error: remote.errors.get("open"), requests: remote.open || [], offers: [] };
    }
    if (view === "mine") {
      if (!user) return { ready: true, requests: [], offers: [] };
      if (!remote.mine && !remote.errors.has("mine")) load("mine", () => fetchMyRequests(user.id), (data) => (remote.mine = data));
      return { ready: Boolean(remote.mine), error: remote.errors.get("mine"), ...(remote.mine || { requests: [], offers: [] }) };
    }
    if (view === "myOffers") {
      if (!user) return { ready: true, requests: [], offers: [] };
      if (ctx.supabaseConfigured()) {
        if (!remote.myOffers && !remote.errors.has("myOffers")) load("myOffers", () => fetchMyOffers(user.id), (data) => (remote.myOffers = data));
        return { ready: Boolean(remote.myOffers), error: remote.errors.get("myOffers"), ...(remote.myOffers || { requests: [], offers: [] }) };
      }
    }
    const key = `detail:${id}`;
    if (!remote.detail.has(id) && !remote.errors.has(key)) load(key, () => fetchRequest(id), (data) => remote.detail.set(id, data));
    const data = remote.detail.get(id);
    return { ready: Boolean(data), error: remote.errors.get(key), requests: data?.request ? [data.request] : [], offers: data?.offers || [], reservations: data?.reservations || [] };
  }

  /** The signed-in host's groups for a request: { ready, error, groups }. */
  function offerable(request) {
    const user = ctx.getState().user;
    if (!ctx.supabaseConfigured()) {
      const { offers, reservations } = local();
      return { ready: true, groups: offerableGroups(ctx.getState().groups || [], request, user, offers, Date.now(), reservations) };
    }
    const key = `offerable:${request.id}`;
    if (!remote.offerable.has(request.id) && !remote.errors.has(key))
      load(key, () => fetchOfferableGroups(request.id), (rows) => remote.offerable.set(request.id, rows));
    return { ready: remote.offerable.has(request.id), error: remote.errors.get(key), groups: remote.offerable.get(request.id) || [] };
  }

  // ------------------------------------------------------------------ pieces
  const billingLabel = (cycle) => t(BILLING_LABEL[cycle] || "รายเดือน");
  const perUnit = (cycle) => (cycle === "monthly" ? t("/ เดือน") : t("/ ที่นั่ง"));
  const phaseBadge = (phase) => `<span class="hk-status hk-status-${escape(phase)}">${t(PHASE_LABEL[phase] || phase)}</span>`;
  const shortId = (id) => `#HK${String(id).replace(/-/g, "").slice(0, 6).toUpperCase()}`;
  const leftLabel = (expiresAt) => {
    const left = timeLeft(expiresAt);
    if (left.expired) return t("หมดเวลาแล้ว");
    return left.hours >= 48 ? t("เหลือเวลา {days} วัน", { days: left.days }) : t("เหลือเวลา {hours} ชม.", { hours: left.hours });
  };
  const shortLeft = (expiresAt) => {
    const left = timeLeft(expiresAt);
    if (left.expired) return t("หมดเวลาแล้ว");
    return left.hours >= 48 ? t("{days} วัน", { days: left.days }) : t("{hours} ชม.", { hours: left.hours });
  };
  const budgetText = (request) =>
    request.budgetMin != null && request.budgetMin > 0
      ? `${money(request.budgetMin)} – ${money(request.budgetMax)}`
      : `≤ ${money(request.budgetMax)}`;
  const loadingBlock = () => `<div class="hk-loading" role="status" aria-busy="true"><span class="hk-skeleton"></span><span class="hk-skeleton"></span><span class="hk-skeleton short"></span><span class="sr-only">${t("กำลังโหลด")}</span></div>`;
  const errorBlock = (error) => {
    const missing = error?.code === "hk_not_installed" || /hk_|relation .* does not exist|schema cache/i.test(String(error?.message || ""));
    return `<div class="empty hk-empty"><h2>${t("โหลดข้อมูลไม่สำเร็จ")}</h2><p>${missing ? t("ระบบประกาศหากลุ่มยังไม่ได้เปิดในฐานข้อมูลนี้") : escape(ctx.errorMessage(error))}</p><button type="button" class="button primary" data-action="hk-retry">${t("ลองอีกครั้ง")}</button></div>`;
  };
  const signInBlock = (message) =>
    `<div class="empty hk-empty"><h2>${t("เข้าสู่ระบบก่อน")}</h2><p>${message}</p><button type="button" class="button primary" data-action="open-auth" data-step="1">${icon("user", 18)} ${t("เข้าสู่ระบบ")}</button></div>`;

  /** The two Marketplace tabs, shared with the existing /explore page. */
  function marketTabs(active) {
    return `<nav class="hk-market-tabs" aria-label="${t("ตลาดหารของ")}">${a("/explore", `${icon("users", 18)} ${t("กลุ่มที่เปิดหาร")}`, `hk-market-tab${active === "groups" ? " active" : ""}`)}${a("/requests", `${icon("search", 18)} ${t("กำลังหากลุ่ม")}`, `hk-market-tab${active === "requests" ? " active" : ""}`)}</nav>`;
  }

  function requestCard(request, offers, { mine = false, preview = false } = {}) {
    const phase = requestPhase(request, offers);
    const offerCount = mine ? offers.filter((offer) => offer.requestId === request.id && offer.status === "pending").length : request.offerCount;
    const body = `<div class="hk-card-top"><span class="hk-card-category">${escape(t(request.category))}</span>${phaseBadge(phase)}</div>
       <h3>${escape(request.title)}</h3>
       <p class="hk-card-need">${t("ต้องการ {count} ที่นั่ง", { count: request.seatsNeeded || 1 })} · ${billingLabel(request.billingCycle)}</p>
       <div class="opportunity-price hk-card-price"><div><small>${t("งบสูงสุดต่อที่นั่ง")}</small><strong>${money(request.budgetMax)} <span>${perUnit(request.billingCycle)}</span></strong></div><div><small>${request.budgetMin ? t("งบขั้นต่ำ") : t("ปิดรับข้อเสนอ")}</small><b>${request.budgetMin ? money(request.budgetMin) : shortLeft(request.expiresAt)}</b></div></div>
       <div class="hk-card-foot"><span>${icon("user", 15)} ${escape(request.requesterName)}</span>${request.budgetMin ? `<span>${icon("clock", 15)} ${leftLabel(request.expiresAt)}</span>` : ""}${offerCount ? `<span class="hk-card-offers">${t("{count} ข้อเสนอ", { count: offerCount })}</span>` : ""}</div>`;
    return preview ? `<div class="hk-request-card is-preview">${body}</div>` : a(`/requests/${encodeURIComponent(request.id)}`, body, "hk-request-card");
  }

  /** One offer. `host` adds the host's own controls; `withRequest` links back to the request. */
  function offerCard(offer, request, { host = false, withRequest = false, canDecide = false, reservation = null } = {}) {
    const cycle = request?.billingCycle || offer.snapshot.billing_cycle;
    const status = offer.status === "pending" && Date.parse(offer.expiresAt) <= Date.now() ? "expired" : offer.status;
    const head = withRequest && request
      ? `<div class="hk-offer-request">${a(`/requests/${encodeURIComponent(request.id)}`, escape(request.title), "hk-offer-request-link")}<small>${t("ผู้โพสต์: {name}", { name: escape(request.requesterName) })} · ${t("งบสูงสุด")} ${money(request.budgetMax)}</small></div>`
      : "";
    const who = host
      ? `<span class="avatar small">${icon("users", 16)}</span><div><strong>${escape(offer.snapshot.group_name || t("กลุ่ม"))}</strong><small>${t("{count} ที่นั่ง", { count: offer.seatsOffered || 1 })} · ${status === "pending" ? leftLabel(offer.expiresAt) : t("ส่งเมื่อ {date}", { date: new Date(offer.createdAt).toLocaleDateString(ctx.locale()) })}</small></div>`
      : `<span class="avatar small">${escape(String(offer.hostName || "H").slice(0, 1))}</span><div><strong>${escape(offer.hostName)}</strong><small>${escape(offer.snapshot.group_name || t("กลุ่ม"))} · ${t("{count} ที่นั่ง", { count: offer.seatsOffered || 1 })}</small></div>`;
    const decide = canDecide && status === "pending";
    const actions = [
      decide ? `<button type="button" class="button primary" data-action="hk-accept-offer" data-id="${escape(offer.id)}">${icon("check", 17)} ${t("ยอมรับข้อเสนอ")}</button>` : "",
      offer.groupId ? a(`/groups/${encodeURIComponent(offer.groupId)}`, t("ดูกลุ่ม"), "button outline") : "",
      decide ? `<button type="button" class="button danger-soft" data-action="hk-reject-offer" data-id="${escape(offer.id)}">${t("ปฏิเสธ")}</button>` : "",
      host && (status === "pending" || status === "accepted") ? `<button type="button" class="button danger-soft" data-action="hk-withdraw-offer" data-id="${escape(offer.id)}" data-accepted="${status === "accepted"}">${t("ถอนข้อเสนอ")}</button>` : "",
    ].join("");
    const held = reservation && reservation.offerId === offer.id ? reservation : null;
    const note = host && status === "accepted"
      ? `<p class="hk-offer-note">${icon("clock", 15)} ${held?.status === "reserved" ? t("ผู้หากลุ่มยอมรับแล้ว ที่นั่งถูกจองไว้ {left}", { left: leftLabel(held.expiresAt) }) : t("ผู้หากลุ่มยอมรับแล้ว รอเข้าร่วมกลุ่ม")}</p>`
      : host && status === "completed"
        ? `<p class="hk-offer-note ok">${icon("check", 15)} ${t("ผู้หากลุ่มเข้าร่วมกลุ่มแล้ว")}</p>`
        : "";
    return `<article class="hk-offer-card">${head}<div class="hk-offer-top">${who}<span class="hk-offer-status hk-offer-${escape(status)}">${t(OFFER_LABEL[status] || status)}</span></div><div class="hk-offer-price"><strong>${money(offer.offered)}</strong> <small>${perUnit(cycle)}</small></div>${offer.message ? `<p>${escape(offer.message)}</p>` : ""}${note}${actions ? `<div class="hk-offer-actions">${actions}</div>` : ""}</article>`;
  }

  // ------------------------------------------------------------------ /requests
  function listPage() {
    const params = new URLSearchParams(location.search);
    const q = (params.get("q") || "").trim();
    const category = params.get("category") || "ทั้งหมด";
    const data = source("open");
    const list = data.ready ? browseRequests(data.requests, { q, category }) : [];
    const user = ctx.getState().user;
    const href = (next) => {
      const search = new URLSearchParams();
      if (q) search.set("q", q);
      if (next !== "ทั้งหมด") search.set("category", next);
      const query = search.toString();
      return `/requests${query ? `?${query}` : ""}`;
    };
    const filters = `<div class="filter-carousel"><button type="button" class="filter-scroll-button filter-scroll-prev" data-action="scroll-filter" data-direction="prev" aria-label="${t("เลื่อนหมวดหมู่ไปซ้าย")}" hidden><span aria-hidden="true">‹</span></button><nav class="filter-row" aria-label="${t("หมวดหมู่")}">${["ทั้งหมด", ...ctx.categories].map((name) => a(href(name), escape(t(name)), `filter ${category === name ? "active" : ""}`)).join("")}</nav><button type="button" class="filter-scroll-button filter-scroll-next" data-action="scroll-filter" data-direction="next" aria-label="${t("เลื่อนหมวดหมู่ไปขวา")}" hidden><span aria-hidden="true">›</span></button></div>`;
    const body = data.error
      ? errorBlock(data.error)
      : !data.ready
        ? loadingBlock()
        : list.length
          ? `<div class="hk-request-grid">${list.map((request) => requestCard(request, data.offers)).join("")}</div>`
          : `<div class="empty"><h3>${q || category !== "ทั้งหมด" ? t("ไม่พบประกาศที่ตรงกับการค้นหา") : t("ยังไม่มีคนประกาศหากลุ่ม")}</h3><p>${t("โพสต์สิ่งที่คุณต้องการ แล้วให้เจ้าของกลุ่มเข้ามาเสนอ")}</p>${a("/requests/new", `${icon("plus", 18)} ${t("โพสต์หาของหาร")}`, "button primary")}</div>`;
    return `<div class="explore-page hk-list-page">
      ${marketTabs("requests")}
      ${title(t("คนที่กำลังหากลุ่ม"), t("ไม่อยากเปิดกลุ่มเอง? โพสต์สิ่งที่ต้องการ แล้วให้เจ้าของกลุ่มเข้ามาเสนอ"))}
      <form class="search-bar" id="hk-request-search"><span>${icon("search")}</span><input type="hidden" name="category" value="${escape(category)}"/><input name="q" value="${escape(q)}" placeholder="${t("ค้นหาบริการที่ต้องการ...")}" aria-label="${t("ค้นหา")}"/><button type="submit">${t("ค้นหาประกาศ")}</button></form>
      ${filters}
      <section aria-labelledby="hk-requests-heading"><div class="section-header hk-section-header"><div><h2 id="hk-requests-heading">${t("ประกาศหากลุ่มล่าสุด")}${data.ready && !data.error ? ` <small>${t("{count} ประกาศ", { count: list.length })}</small>` : ""}</h2><p>${t("เจ้าของกลุ่มเลือกประกาศที่ตรงกับกลุ่มของตัวเอง แล้วส่งข้อเสนอได้เลย")}</p></div><div class="hk-section-actions">${user ? `${a("/my-requests", t("ประกาศของฉัน"), "button outline")}${a("/my-offers", t("ข้อเสนอของฉัน"), "button outline")}` : ""}${a("/requests/new", `${icon("plus", 18)} ${t("โพสต์หาของหาร")}`, "button primary")}</div></div>
      ${body}</section>
    </div>`;
  }

  // ------------------------------------------------------------------ /requests/new
  /** Right-hand summary, the same panel the create-group page uses. Fields update live (onInput). */
  function requestSummary(values) {
    const row = (key, label, value, cls = "") => `<div${cls ? ` class="${cls}"` : ""}><dt>${label}</dt><dd data-hk-sum="${key}">${value}</dd></div>`;
    return `<aside class="create-group-summary hk-request-summary" aria-live="polite"><div class="create-summary-heading"><h2>${t("สรุปประกาศ")}</h2>${icon("search", 28)}</div><div class="create-summary-product"><div>${icon("search", 30)}</div><div><strong data-hk-sum="title">${values.title ? escape(values.title) : t("ชื่อประกาศ")}</strong><small data-hk-sum="category">${values.category ? escape(t(values.category)) : "—"}</small></div></div><dl>${row("billing", t("รอบการชำระเงิน"), values.billingCycle ? billingLabel(values.billingCycle) : "—")}${row("budgetMax", t("งบสูงสุดต่อที่นั่ง"), values.budgetMax || "—", "summary-per-person")}${row("budgetMin", t("งบขั้นต่ำ"), values.budgetMin || "—")}${row("seats", t("จำนวนที่นั่ง"), t("1 ที่นั่ง"))}${row("expiry", t("ระยะเวลาประกาศ"), values.expiresInDays ? t("{days} วัน", { days: values.expiresInDays }) : "—")}</dl><p>${t("เจ้าของกลุ่มจะเสนอกลุ่มที่มีอยู่จริง ราคาคิดจากราคาต่อที่นั่งของกลุ่มนั้น")}</p></aside>`;
  }
  const moneyText = (value) => {
    try {
      return value ? money(ctx.parseBaht(String(value).trim())) : "";
    } catch {
      return "";
    }
  };

  /** Same picker as the create-group page (selected box + option list), single choice. */
  function categoryPicker() {
    const pick = draft.pick || (draft.category ? (ctx.categories.includes(draft.category) ? draft.category : OTHER) : "");
    const other = pick === OTHER;
    return `<fieldset class="category-picker hk-category-picker"><legend>${t("หมวดหมู่สินค้า")} <b>*</b></legend>
      <input type="hidden" name="categoryPick" value="${escape(pick)}"/>
      <div class="selected-categories" data-hk-selected>${selectedTag(pick)}</div>
      <div class="category-options">${ctx.categories.map((name) => `<button type="button" class="category-option ${pick === name ? "selected" : ""}" data-action="hk-pick-category" data-category="${escape(name)}" aria-pressed="${pick === name}">${escape(t(name))}</button>`).join("")}</div></fieldset>
      <label data-hk-other ${other ? "" : "hidden"}>${t("ระบุชื่อหมวดหมู่")} <b>*</b><input name="otherCategory" maxlength="60" value="${escape(other ? draft.otherCategory || (ctx.categories.includes(draft.category) ? "" : draft.category) : "")}" placeholder="${t("เช่น บริการสตรีมมิ่ง")}"/></label>`;
  }
  const selectedTag = (pick) =>
    pick ? `<button type="button" class="selected-category" data-action="hk-pick-category" data-category="" aria-label="${t("นำหมวดหมู่ออก {category}", { category: t(pick) })}">${escape(t(pick))}<span aria-hidden="true">×</span></button>` : "";

  /** Picks (or clears) the category in place, so whatever is typed below stays. */
  function pickCategory(button) {
    const form = button.closest("form");
    if (!form) return;
    const pick = button.dataset.category || "";
    form.querySelector('[name="categoryPick"]').value = pick;
    form.querySelector("[data-hk-selected]").innerHTML = selectedTag(pick);
    for (const option of form.querySelectorAll(".category-options .category-option")) {
      const on = option.dataset.category === pick;
      option.classList.toggle("selected", on);
      option.setAttribute("aria-pressed", String(on));
    }
    const otherField = form.querySelector("[data-hk-other]");
    otherField.hidden = pick !== OTHER;
    if (pick === OTHER) otherField.querySelector("input").focus();
    updateSummary(form);
  }
  const resolvedCategory = (data) => {
    const pick = String(data.get("categoryPick") || "");
    return pick === OTHER ? String(data.get("otherCategory") || "").trim() : pick;
  };

  function wizardPage() {
    const user = ctx.getState().user;
    if (!user) return `<div class="hk-page">${title(t("โพสต์หาของหาร"))}${signInBlock(t("เข้าสู่ระบบเพื่อโพสต์ประกาศหากลุ่ม"))}</div>`;
    const step = draft.step;
    const steps = [[1, "ต้องการอะไร"], [2, "งบและรอบชำระ"], [3, "ตรวจสอบ"]];
    const stepper = `<nav class="create-stepper" aria-label="${t("ขั้นตอน")}">${steps.map(([n, label]) => `<button type="button" data-action="hk-wizard-step" data-step="${n}" aria-current="${step === n ? "step" : "false"}" class="${step === n ? "active" : ""}" ${n < step ? "" : n === step ? "" : "disabled"}><span>${n < step ? icon("check", 14) : n}</span>${t(label)}</button>`).join("")}</nav>`;
    let body = "";
    if (step === 1) {
      body = `<div class="create-form-section"><h2>${icon("search", 20)} ${t("ต้องการหาอะไร")}</h2>
        ${categoryPicker()}
        <label>${t("ชื่อประกาศ")} <b>*</b><input name="title" required minlength="3" maxlength="80" value="${escape(draft.title)}" placeholder="${t("หาเพื่อนหาร YouTube Premium")}"/></label>
        <label>${t("รายละเอียดเพิ่มเติม")} <small>(${t("ไม่บังคับ")})</small><textarea name="description" maxlength="600" rows="4" placeholder="${t("ต้องการเข้าร่วมกลุ่มระยะยาว...")}">${escape(draft.description)}</textarea></label></div>`;
    } else if (step === 2) {
      body = `<div class="create-form-section"><h2>${icon("calc", 20)} ${t("งบและรอบการชำระเงิน")}</h2>
        <fieldset class="product-type-picker"><legend>${t("รอบการชำระเงิน")} <b>*</b></legend><label><input type="radio" name="billingCycle" value="monthly" ${draft.billingCycle === "monthly" ? "checked" : ""}/><span>${icon("clock", 20)}<strong>${t("รายเดือน")}</strong><small>${t("จ่ายทุกเดือน เช่น แอปหรือบริการ")}</small></span></label><label><input type="radio" name="billingCycle" value="one_time" ${draft.billingCycle === "one_time" ? "checked" : ""}/><span>${icon("package", 20)}<strong>${t("ครั้งเดียว")}</strong><small>${t("จ่ายรอบเดียวจบ เช่น สินค้า")}</small></span></label></fieldset>
        <div class="hk-field-row"><label>${t("งบสูงสุดต่อที่นั่ง (บาท)")} <b>*</b><input name="budgetMax" inputmode="decimal" required value="${escape(draft.budgetMax)}" placeholder="50"/></label><label>${t("งบขั้นต่ำ (บาท)")} <small>(${t("ไม่บังคับ")})</small><input name="budgetMin" inputmode="decimal" value="${escape(draft.budgetMin)}" placeholder="0"/></label></div>
        <p class="field-help">${t("1 บัญชีเข้าร่วมกลุ่มได้ 1 ที่นั่ง")}</p></div>
        <div class="create-form-section"><h2>${icon("clock", 20)} ${t("ระยะเวลาประกาศ")}</h2>
        <fieldset class="product-type-picker hk-expiry-picker"><legend>${t("เปิดรับข้อเสนอนาน")} <b>*</b></legend>${REQUEST_EXPIRY_DAYS.map((days) => `<label><input type="radio" name="expiresInDays" value="${days}" ${Number(draft.expiresInDays) === days ? "checked" : ""}/><span>${icon("clock", 20)}<strong>${t("{days} วัน", { days })}</strong><small>${days === 3 ? t("ต้องการเร็ว") : days === 7 ? t("แนะนำ") : t("ไม่รีบ")}</small></span></label>`).join("")}</fieldset></div>`;
    } else {
      const preview = {
        id: "preview",
        title: draft.title,
        category: draft.category,
        budgetMax: ctx.parseBaht(draft.budgetMax),
        budgetMin: draft.budgetMin ? ctx.parseBaht(draft.budgetMin) : null,
        billingCycle: draft.billingCycle,
        seatsNeeded: 1,
        requesterName: user.name,
        status: "open",
        offerCount: 0,
        expiresAt: new Date(Date.now() + Number(draft.expiresInDays) * 86_400_000).toISOString(),
      };
      body = `<div class="create-form-section"><h2>${icon("check", 20)} ${t("ตรวจสอบก่อนโพสต์")}</h2><p class="field-help">${t("ประกาศจะแสดงแบบนี้ในหน้ารวมประกาศ")}</p>
        <div class="hk-preview">${requestCard(preview, [], { preview: true })}</div>
        ${draft.description ? `<div class="hk-preview-desc"><strong>${t("รายละเอียดเพิ่มเติม")}</strong><p>${escape(draft.description)}</p></div>` : ""}
        <ul class="hk-checklist"><li>${icon("check", 16)} ${t("เจ้าของกลุ่มจะเห็นประกาศและส่งข้อเสนอพร้อมกลุ่มที่มีอยู่จริง")}</li><li>${icon("check", 16)} ${t("คุณเลือกข้อเสนอได้ 1 รายการ แล้วเข้าร่วมกลุ่มตามขั้นตอนเดิม")}</li><li>${icon("check", 16)} ${t("ประกาศหมดอายุใน {days} วัน", { days: draft.expiresInDays })}</li></ul></div>`;
    }
    const back = step > 1 ? `<button type="button" class="button outline" data-action="hk-wizard-back">${t("ย้อนกลับ")}</button>` : a("/requests", t("ยกเลิก"), "button outline");
    const next = step < 3 ? `<button type="submit" class="button primary">${t("ต่อไป")} ${icon("arrow", 18)}</button>` : `<button type="submit" class="button primary">${icon("check", 18)} ${t("โพสต์ประกาศ")}</button>`;
    return `<div class="hk-page">
      ${title(t("โพสต์หาของหาร"), t("บอกว่าต้องการอะไร งบเท่าไหร่ แล้วรอให้เจ้าของกลุ่มเข้ามาเสนอ"))}
      <div class="create-group-layout"><form id="hk-request-wizard" class="form-panel create-group-form hk-request-form" data-step="${step}" novalidate>${stepper}${body}<div class="hk-feedback" role="alert" hidden></div><div class="create-step-actions">${back}${next}</div></form>
      ${requestSummary({ ...draft, budgetMax: moneyText(draft.budgetMax), budgetMin: moneyText(draft.budgetMin) })}</div>
    </div>`;
  }

  // ------------------------------------------------------------------ /requests/:id
  /** The requester's next step once an offer is accepted: join the held seat, then the group's own flow. */
  function matchPanel(request, offers, reservation) {
    const offer = offers.find((item) => item.id === reservation?.offerId);
    if (!reservation || !offer) return "";
    const groupLink = reservation.groupId ? `/groups/${encodeURIComponent(reservation.groupId)}` : null;
    if (reservation.status === "confirmed" || request.status === "completed")
      return `<section class="hk-match-panel done"><span class="hk-match-icon">${icon("check", 24)}</span><div><h2>${t("เข้าร่วมกลุ่มแล้ว")}</h2><p>${t("คุณเป็นสมาชิกกลุ่ม “{name}” แล้ว ขั้นต่อไปคือยืนยันยอดและชำระเงินตามขั้นตอนของกลุ่ม แอดมินจะตรวจสลิปก่อนยืนยัน", { name: escape(offer.snapshot.group_name || "") })}</p>${groupLink ? `<div class="hk-actions">${a(groupLink, `${t("ไปที่กลุ่ม")} ${icon("arrow", 18)}`, "button primary")}</div>` : ""}</div></section>`;
    if (reservation.status !== "reserved" || request.status !== "matched") return "";
    return `<section class="hk-match-panel"><span class="hk-match-icon">${icon("clock", 24)}</span><div><small>${t("จองที่นั่งไว้ให้คุณแล้ว")} · ${leftLabel(reservation.expiresAt)}</small><h2>${escape(offer.snapshot.group_name || t("กลุ่ม"))} · ${money(offer.offered)} ${perUnit(request.billingCycle)}</h2><p>${t("กดเข้าร่วมกลุ่มก่อนหมดเวลา ถ้าไม่ทัน ที่นั่งจะถูกปล่อยและประกาศจะกลับมารับข้อเสนอใหม่")}</p><p class="field-help">${t("หลังเข้าร่วม คุณจะยืนยันยอดและชำระเงินตามขั้นตอนเดิมของกลุ่ม การเข้าร่วมยังไม่ใช่การชำระเงิน")}</p><div class="hk-actions"><button type="button" class="button primary" data-action="hk-join-reserved" data-id="${escape(reservation.id)}">${icon("users", 18)} ${t("เข้าร่วมกลุ่ม")}</button>${groupLink ? a(groupLink, t("ดูกลุ่มก่อน"), "button outline") : ""}</div></div></section>`;
  }

  function detailPage(id) {
    const data = source("detail", id);
    if (data.error) return `<div class="hk-page">${errorBlock(data.error)}</div>`;
    if (!data.ready) return `<div class="hk-page">${loadingBlock()}</div>`;
    const request = data.requests.find((item) => item.id === id);
    if (!request) return `<div class="hk-page"><div class="empty"><h3>${t("ไม่พบประกาศนี้")}</h3><p>${t("ประกาศอาจหมดอายุหรือถูกยกเลิกแล้ว")}</p>${a("/requests", t("ดูประกาศทั้งหมด"), "button primary")}</div></div>`;
    const user = ctx.getState().user;
    const mine = user?.id === request.requesterId;
    const offers = data.offers.filter((offer) => offer.requestId === id);
    const phase = requestPhase(request, offers);
    const pendingCount = offers.filter((offer) => offer.status === "pending").length;
    const reservation = reservationFor((data.reservations || []).filter((r) => r.requestId === id), id);
    const open = request.status === "open" && phase !== "expired";
    const editable = mine && canEditRequest(request, offers);
    const cancellable = mine && ["open", "matched"].includes(request.status) && phase !== "expired";
    const sorted = [...offers].sort((x, y) => Number(["accepted", "completed"].includes(y.status)) - Number(["accepted", "completed"].includes(x.status)));
    const myOffers = user ? offers.filter((offer) => offer.hostId === user.id) : [];
    const offersSection = mine
      ? `<section class="members-card hk-offers-card" aria-labelledby="hk-offers-heading"><div class="group-section-head"><div><h2 id="hk-offers-heading">${t("ข้อเสนอที่ได้รับ")}</h2><p>${open ? t("เลือกได้ 1 ข้อเสนอ ระบบจะจองที่นั่งให้ 24 ชั่วโมง") : t("ประกาศนี้ไม่รับข้อเสนอเพิ่มแล้ว")}</p></div><strong>${pendingCount ? t("รอพิจารณา {count}", { count: pendingCount }) : t("{count} ข้อเสนอ", { count: offers.length })}</strong></div>${offers.length ? `<div class="hk-offer-list">${sorted.map((offer) => offerCard(offer, request, { canDecide: open })).join("")}</div>` : `<div class="group-open-row hk-offer-empty"><span>${icon("clock", 20)}</span><div><strong>${t("ยังไม่มีข้อเสนอ")}</strong><small>${t("เมื่อเจ้าของกลุ่มส่งข้อเสนอ จะแสดงที่นี่")}</small></div></div>`}</section>`
      : myOffers.length
        ? `<section class="members-card hk-offers-card" aria-labelledby="hk-offers-heading"><div class="group-section-head"><div><h2 id="hk-offers-heading">${t("ข้อเสนอของคุณ")}</h2><p>${t("ผู้หากลุ่มเห็นข้อเสนอนี้แล้ว")}</p></div><strong>${t("{count} ข้อเสนอ", { count: myOffers.length })}</strong></div><div class="hk-offer-list">${myOffers.map((offer) => offerCard(offer, request, { host: true, reservation })).join("")}</div></section>`
        : "";
    const action = (cls, inner) => `<span class="summary-btn-left">${inner}</span><span class="btn-arrow">${icon("arrow", 18)}</span>`;
    const asideActions = mine
      ? `${editable ? a(`/requests/${encodeURIComponent(id)}/edit`, action("", `${icon("edit", 18)} <span>${t("แก้ไขประกาศ")}</span>`), "button outline full summary-action-btn") : ""}${cancellable ? `<button type="button" class="button danger-soft full summary-action-btn" data-action="hk-cancel-request" data-id="${escape(id)}">${action("", `${icon("trash", 18)} <span>${t("ยกเลิกประกาศ")}</span>`)}</button>` : ""}${!editable && phase === "has_offers" ? `<p class="field-help">${t("มีข้อเสนอแล้ว จึงแก้ไขประกาศไม่ได้ เพื่อให้ข้อเสนอตรงกับสิ่งที่ประกาศไว้")}</p>` : ""}`
      : open
        ? user
          ? a(`/requests/${encodeURIComponent(id)}/offer`, action("", `${icon("users", 18)} <span>${t("เสนอกลุ่มของคุณ")}</span>`), "button primary full summary-action-btn")
          : `<button type="button" class="button primary full summary-action-btn" data-action="open-auth" data-step="1">${action("", `${icon("user", 18)} <span>${t("เข้าสู่ระบบเพื่อส่งข้อเสนอ")}</span>`)}</button>`
        : "";
    const date = (iso) => new Date(iso).toLocaleDateString(ctx.locale(), { day: "numeric", month: "short" });
    const fact = (iconName, label, value, sub = "") => `<div class="hk-fact"><span class="hk-fact-icon">${icon(iconName, 18)}</span><div><dt>${label}</dt><dd>${value}</dd>${sub ? `<small>${sub}</small>` : ""}</div></div>`;
    const howTo = !mine && open
      ? `<section class="members-card hk-howto" aria-labelledby="hk-howto-heading"><div class="group-section-head"><div><h2 id="hk-howto-heading">${t("มีกลุ่มที่ตรงกับประกาศนี้?")}</h2><p>${t("เสนอกลุ่มที่คุณเปิดอยู่ได้ใน 3 ขั้น")}</p></div></div><ol class="hk-steps-list"><li><span>1</span><div><strong>${t("เลือกกลุ่มของคุณ")}</strong><small>${t("หมวดและรอบชำระต้องตรง มีที่ว่าง และราคาต่อที่นั่งไม่เกินงบ")}</small></div></li><li><span>2</span><div><strong>${t("ส่งข้อเสนอ")}</strong><small>${t("ราคาคิดจากราคาต่อที่นั่งของกลุ่ม แนบข้อความได้")}</small></div></li><li><span>3</span><div><strong>${t("รอผู้หากลุ่มตอบ")}</strong><small>${t("ถ้ายอมรับ ระบบจะจองที่นั่งไว้ 24 ชั่วโมงให้เขาเข้ากลุ่ม")}</small></div></li></ol></section>`
      : "";
    const offerTotal = mine ? offers.length : request.offerCount || 0;
    return `<div class="group-page hk-detail-page">
      <nav class="breadcrumb product-breadcrumb" aria-label="${t("เส้นทางนำทาง")}">${a(mine ? "/my-requests" : "/requests", mine ? t("ประกาศของฉัน") : t("คนที่กำลังหากลุ่ม"))}<span aria-hidden="true">/</span><span aria-current="page">${escape(request.title)}</span></nav>
      <div class="group-detail">
        <main class="group-detail-main">
          ${mine ? matchPanel(request, offers, reservation) : ""}
          <section class="group-identity-card hk-identity" aria-labelledby="hk-request-title">
            <div class="group-heading-line"><div><h1 id="hk-request-title">${escape(request.title)}</h1><p>${escape(t(request.category))} · ${t("ประกาศ {id}", { id: shortId(id) })}</p></div>${phaseBadge(phase)}</div>
            <dl class="hk-facts">
              ${fact("user", t("ผู้โพสต์"), escape(request.requesterName), t("โพสต์เมื่อ {date}", { date: date(request.createdAt) }))}
              ${fact("users", t("ต้องการ"), t("{count} ที่นั่ง", { count: request.seatsNeeded || 1 }), billingLabel(request.billingCycle))}
              ${fact("clock", t("ปิดรับข้อเสนอ"), phase === "expired" ? t("หมดเวลาแล้ว") : shortLeft(request.expiresAt), date(request.expiresAt))}
            </dl>
            ${request.description ? `<div class="hk-description-block"><h2>${t("รายละเอียดจากผู้โพสต์")}</h2><p class="hk-description">${escape(request.description)}</p></div>` : ""}
          </section>
          ${offersSection}
          ${howTo}
        </main>
        <aside class="group-detail-aside"><div class="summary-card hk-budget-card"><small>${t("งบสูงสุดต่อที่นั่ง")}</small><strong>${money(request.budgetMax)} <span>${perUnit(request.billingCycle)}</span></strong><div class="summary-future-price"><span>${t("รอบการชำระเงิน")}</span><b>${billingLabel(request.billingCycle)}</b></div>${request.budgetMin ? `<div class="summary-future-price"><span>${t("งบขั้นต่ำ")}</span><b>${money(request.budgetMin)}</b></div>` : ""}<div class="summary-future-price"><span>${t("ข้อเสนอตอนนี้")}</span><b>${t("{count} ข้อเสนอ", { count: offerTotal })}</b></div><p>${mine ? t("เจ้าของกลุ่มจะเสนอราคาต่อที่นั่งของกลุ่มตัวเอง ไม่เกินงบนี้") : t("เสนอได้เฉพาะกลุ่มที่ราคาต่อที่นั่งไม่เกินงบนี้ และหมวดกับรอบชำระตรงกัน")}</p><div class="hk-aside-actions">${asideActions}</div></div></aside>
      </div>
    </div>`;
  }

  // ------------------------------------------------------------------ /requests/:id/edit
  function editPage(id) {
    const user = ctx.getState().user;
    if (!user) return `<div class="hk-page">${title(t("แก้ไขประกาศ"))}${signInBlock(t("เข้าสู่ระบบเพื่อแก้ไขประกาศ"))}</div>`;
    const data = source("detail", id);
    if (data.error) return `<div class="hk-page">${errorBlock(data.error)}</div>`;
    if (!data.ready) return `<div class="hk-page">${loadingBlock()}</div>`;
    const request = data.requests.find((item) => item.id === id);
    if (!request || request.requesterId !== user.id) return `<div class="hk-page"><div class="empty"><h3>${t("ไม่พบประกาศนี้")}</h3>${a("/my-requests", t("ประกาศของฉัน"), "button primary")}</div></div>`;
    if (!canEditRequest(request, data.offers)) return `<div class="hk-page"><div class="empty"><h3>${t("แก้ไขประกาศนี้ไม่ได้")}</h3><p>${t("แก้ไขได้เฉพาะประกาศที่เปิดอยู่และยังไม่มีข้อเสนอ")}</p>${a(`/requests/${encodeURIComponent(id)}`, t("กลับไปที่ประกาศ"), "button primary")}</div></div>`;
    return `<div class="hk-page">
      ${title(t("แก้ไขประกาศ"), escape(request.title))}
      <div class="create-group-layout"><form id="hk-request-edit" class="form-panel create-group-form hk-request-form" data-id="${escape(id)}" novalidate>
        <div class="create-form-section"><h2>${icon("edit", 20)} ${t("รายละเอียดประกาศ")}</h2>
        <label>${t("ชื่อประกาศ")} <b>*</b><input name="title" required minlength="3" maxlength="80" value="${escape(request.title)}"/></label>
        <label>${t("รายละเอียดเพิ่มเติม")} <small>(${t("ไม่บังคับ")})</small><textarea name="description" maxlength="600" rows="4">${escape(request.description)}</textarea></label>
        <div class="hk-field-row"><label>${t("งบสูงสุดต่อที่นั่ง (บาท)")} <b>*</b><input name="budgetMax" inputmode="decimal" required value="${escape(ctx.bahtInput(request.budgetMax))}"/></label><label>${t("งบขั้นต่ำ (บาท)")} <small>(${t("ไม่บังคับ")})</small><input name="budgetMin" inputmode="decimal" value="${request.budgetMin ? escape(ctx.bahtInput(request.budgetMin)) : ""}"/></label></div>
        <p class="field-help">${t("บริการ รอบการชำระเงิน และวันหมดอายุเปลี่ยนไม่ได้ ถ้าต้องการเปลี่ยน ให้ยกเลิกแล้วโพสต์ใหม่")}</p></div>
        <div class="hk-feedback" role="alert" hidden></div>
        <div class="create-step-actions">${a(`/requests/${encodeURIComponent(id)}`, t("ยกเลิก"), "button outline")}<button type="submit" class="button primary">${t("บันทึกการแก้ไข")}</button></div>
      </form>
      ${requestSummary({ title: request.title, category: request.category, billingCycle: request.billingCycle, budgetMax: money(request.budgetMax), budgetMin: request.budgetMin ? money(request.budgetMin) : "", expiresInDays: null }).replace(`data-hk-sum="expiry">—`, `data-hk-sum="expiry">${leftLabel(request.expiresAt)}`)}</div>
    </div>`;
  }

  /** Pill tabs in the notification-page style; counts are plain numbers, not alerts. */
  const pillTabs = (label, tabs) => `<nav class="note-tabs hk-tabs" aria-label="${label}">${tabs.map(([href, text, count, active]) => `<a href="${href}" data-link class="note-tab${active ? " active" : ""}"${active ? ' aria-current="page"' : ""}>${text}${count === null ? "" : ` <span class="hk-tab-count">${count}</span>`}</a>`).join("")}</nav>`;

  // ------------------------------------------------------------------ /my-requests
  function myRequestsPage() {
    const user = ctx.getState().user;
    if (!user) return `<div class="hk-page">${title(t("ประกาศหากลุ่มของฉัน"))}${signInBlock(t("เข้าสู่ระบบเพื่อดูประกาศหากลุ่มของคุณ"))}</div>`;
    const tab = MY_REQUEST_TABS.includes(new URLSearchParams(location.search).get("tab")) ? new URLSearchParams(location.search).get("tab") : "all";
    const data = source("mine");
    const mine = data.requests.filter((request) => request.requesterId === user.id);
    const list = filterMyRequests(mine, data.offers, tab);
    const tabs = pillTabs(t("ประกาศของฉัน"), MY_REQUEST_TABS.map((key) => [key === "all" ? "/my-requests" : `/my-requests?tab=${key}`, t(TAB_LABEL[key]), data.ready ? filterMyRequests(mine, data.offers, key).length : null, tab === key]));
    const body = data.error
      ? errorBlock(data.error)
      : !data.ready
        ? loadingBlock()
        : list.length
          ? `<div class="hk-request-grid">${list.map((request) => requestCard(request, data.offers, { mine: true })).join("")}</div>`
          : `<div class="empty"><h3>${tab === "all" ? t("คุณยังไม่มีประกาศหากลุ่ม") : t("ไม่มีประกาศในแท็บนี้")}</h3><p>${t("โพสต์สิ่งที่คุณต้องการ แล้วให้เจ้าของกลุ่มเข้ามาเสนอ")}</p>${a("/requests/new", `${icon("plus", 18)} ${t("โพสต์หาของหาร")}`, "button primary")}</div>`;
    return `<div class="hk-page">
      ${title(t("ประกาศหากลุ่มของฉัน"), t("ติดตามประกาศและข้อเสนอที่ได้รับ"))}
      <div class="hk-toolbar">${tabs}${a("/requests/new", `${icon("plus", 18)} ${t("โพสต์หาของหาร")}`, "button primary")}</div>
      ${body}
    </div>`;
  }

  // ------------------------------------------------------------------ /requests/:id/offer
  function offerPage(id) {
    const user = ctx.getState().user;
    if (!user) return `<div class="hk-page">${title(t("เสนอกลุ่มของคุณ"))}${signInBlock(t("เข้าสู่ระบบเพื่อส่งข้อเสนอ"))}</div>`;
    const data = source("detail", id);
    if (data.error) return `<div class="hk-page">${errorBlock(data.error)}</div>`;
    if (!data.ready) return `<div class="hk-page">${loadingBlock()}</div>`;
    const request = data.requests.find((item) => item.id === id);
    const back = a(`/requests/${encodeURIComponent(id)}`, t("กลับไปที่ประกาศ"), "button outline");
    if (!request) return `<div class="hk-page"><div class="empty"><h3>${t("ไม่พบประกาศนี้")}</h3>${a("/requests", t("ดูประกาศทั้งหมด"), "button primary")}</div></div>`;
    if (request.requesterId === user.id)
      return `<div class="hk-page"><div class="empty"><h3>${t("นี่คือประกาศของคุณ")}</h3><p>${t("ส่งข้อเสนอให้ประกาศของตัวเองไม่ได้")}</p>${back}</div></div>`;
    if (request.status !== "open" || requestPhase(request, []) === "expired")
      return `<div class="hk-page"><div class="empty"><h3>${t("ประกาศนี้ปิดรับข้อเสนอแล้ว")}</h3>${a("/requests", t("ดูประกาศอื่น"), "button primary")}</div></div>`;
    const list = offerable(request);
    const first = list.ready ? list.groups.find((group) => group.matches) : null;
    const summary = `<aside class="create-group-summary hk-request-summary" aria-live="polite"><div class="create-summary-heading"><h2>${t("ประกาศนี้")}</h2>${icon("search", 28)}</div><div class="create-summary-product"><div>${icon("search", 30)}</div><div><strong>${escape(request.title)}</strong><small>${escape(t(request.category))}</small></div></div><dl><div><dt>${t("ผู้โพสต์")}</dt><dd>${escape(request.requesterName)}</dd></div><div><dt>${t("ต้องการ")}</dt><dd>${t("{count} ที่นั่ง", { count: request.seatsNeeded || 1 })} · ${billingLabel(request.billingCycle)}</dd></div><div><dt>${t("งบสูงสุดต่อที่นั่ง")}</dt><dd>${money(request.budgetMax)}</dd></div><div><dt>${t("ปิดรับข้อเสนอ")}</dt><dd>${leftLabel(request.expiresAt)}</dd></div><div class="summary-per-person"><dt>${t("ราคาที่คุณเสนอ")}</dt><dd data-hk-offer-price>${first ? money(first.seatPrice) : "—"}</dd></div></dl><p>${t("ราคาคิดจากราคาต่อที่นั่งของกลุ่ม ซึ่งเป็นยอดที่ผู้หากลุ่มจะจ่ายจริงเมื่อเข้าร่วม และจะล็อกไว้ตอนส่ง")}</p></aside>`;
    let body;
    if (list.error) body = errorBlock(list.error);
    else if (!list.ready) body = loadingBlock();
    else if (!list.groups.length)
      body = `<div class="form-panel"><div class="empty"><h3>${t("คุณยังไม่มีกลุ่มที่เปิดอยู่")}</h3><p>${t("เปิดกลุ่มก่อน แล้วกลับมาส่งข้อเสนอด้วยกลุ่มนั้น")}</p>${a("/groups/create", `${icon("plus", 18)} ${t("สร้างกลุ่มหารของ")}`, "button primary")}</div></div>`;
    else {
      const options = list.groups.map((group) => `<label class="${group.matches ? "" : "is-disabled"}"><input type="radio" name="groupId" value="${escape(group.groupId)}" data-price="${group.seatPrice ?? ""}" ${group.matches ? "" : "disabled"} ${first && first.groupId === group.groupId ? "checked" : ""}/><span>${icon("users", 20)}<strong>${escape(group.name)}</strong><small>${group.matches ? `${t("ว่าง {count} ที่", { count: group.freeSeats })} · ${money(group.seatPrice)} ${perUnit(group.billing)}` : `${icon("info", 14)} ${t(BLOCKER_LABEL[group.reason] || group.reason)}`}</small></span></label>`).join("");
      body = `<form id="hk-offer-form" class="form-panel create-group-form hk-request-form" data-id="${escape(id)}" novalidate>
        <div class="create-form-section"><h2>${icon("users", 20)} ${t("เลือกกลุ่มของคุณ")}</h2>
        <fieldset class="product-type-picker hk-group-picker"><legend>${t("กลุ่มที่จะเสนอ")} <b>*</b></legend>${options}</fieldset>
        ${first ? "" : `<p class="field-help">${t("ยังไม่มีกลุ่มที่ตรงกับประกาศนี้ กลุ่มต้องอยู่หมวดเดียวกัน รอบการชำระเงินเดียวกัน มีที่ว่าง และราคาไม่เกินงบ")}</p>`}</div>
        <div class="create-form-section"><h2>${icon("chat", 20)} ${t("ข้อความถึงผู้หาของ")}</h2>
        <label>${t("ข้อความ")} <small>(${t("ไม่บังคับ")})</small><textarea name="message" maxlength="400" rows="3" placeholder="${t("สามารถเข้าร่วมได้ 1 ที่นั่ง รายละเอียดตามเงื่อนไขกลุ่ม...")}"></textarea></label></div>
        <div class="hk-feedback" role="alert" hidden></div>
        <div class="create-step-actions">${back}<button type="submit" class="button primary" ${first ? "" : "disabled"}>${icon("check", 18)} ${t("ส่งข้อเสนอ")}</button></div>
      </form>`;
    }
    return `<div class="hk-page">${title(t("เสนอกลุ่มของคุณ"), t("ผู้หากลุ่มจะเห็นกลุ่มและราคาต่อที่นั่งที่คุณเสนอ"))}<div class="create-group-layout">${body}${summary}</div></div>`;
  }

  // ------------------------------------------------------------------ /my-offers
  function myOffersPage() {
    const user = ctx.getState().user;
    if (!user) return `<div class="hk-page">${title(t("ข้อเสนอของฉัน"))}${signInBlock(t("เข้าสู่ระบบเพื่อดูข้อเสนอที่คุณส่ง"))}</div>`;
    const params = new URLSearchParams(location.search);
    const tab = MY_OFFER_TABS.includes(params.get("tab")) ? params.get("tab") : "all";
    const data = source("myOffers");
    const mine = data.offers.filter((offer) => offer.hostId === user.id).sort((x, y) => String(y.createdAt).localeCompare(String(x.createdAt)));
    const list = filterMyOffers(mine, tab);
    const requestOf = (offer) => data.requests.find((request) => request.id === offer.requestId);
    const reservationOf = (offer) => (data.reservations || []).find((r) => r.offerId === offer.id && ["reserved", "confirmed"].includes(r.status)) || null;
    const tabs = pillTabs(t("ข้อเสนอของฉัน"), MY_OFFER_TABS.map((key) => [key === "all" ? "/my-offers" : `/my-offers?tab=${key}`, t(OFFER_TAB_LABEL[key]), data.ready ? filterMyOffers(mine, key).length : null, tab === key]));
    const body = data.error
      ? errorBlock(data.error)
      : !data.ready
        ? loadingBlock()
        : list.length
          ? `<div class="hk-offer-list hk-my-offers">${list.map((offer) => offerCard(offer, requestOf(offer), { host: true, withRequest: true, reservation: reservationOf(offer) })).join("")}</div>`
          : `<div class="empty"><h3>${tab === "all" ? t("คุณยังไม่ได้ส่งข้อเสนอ") : t("ไม่มีข้อเสนอในแท็บนี้")}</h3><p>${t("ดูประกาศของคนที่กำลังหากลุ่ม แล้วเสนอกลุ่มที่คุณเปิดอยู่")}</p>${a("/requests", `${icon("search", 18)} ${t("ดูประกาศหากลุ่ม")}`, "button primary")}</div>`;
    return `<div class="hk-page">
      ${title(t("ข้อเสนอของฉัน"), t("ติดตามข้อเสนอที่คุณส่งให้คนที่กำลังหากลุ่ม"))}
      <div class="hk-toolbar">${tabs}${a("/requests", `${icon("search", 18)} ${t("ดูประกาศหากลุ่ม")}`, "button outline")}</div>
      ${body}
    </div>`;
  }

  // ------------------------------------------------------------------ home page section
  function homeSection() {
    const data = source("open");
    const latest = data.ready && !data.error ? browseRequests(data.requests).slice(0, 3) : [];
    const cards = data.error
      ? ""
      : !data.ready
        ? `<div class="hk-request-grid hk-home-grid" aria-hidden="true"><span class="hk-skeleton"></span><span class="hk-skeleton"></span><span class="hk-skeleton"></span></div>`
        : latest.length
          ? `<div class="hk-request-grid hk-home-grid">${latest.map((request) => requestCard(request, [])).join("")}</div>`
          : `<div class="hk-offer-empty">${icon("search", 22)}<div><strong>${t("ยังไม่มีคนประกาศหากลุ่ม")}</strong><p>${t("เป็นคนแรกที่โพสต์ แล้วให้เจ้าของกลุ่มเข้ามาเสนอ")}</p></div></div>`;
    return `<section class="home-discovery-section hk-home-section" data-reveal-kind="deal">
      <div class="home-section-banner"><span class="home-section-icon hk-home-icon">${icon("search", 40)}</span><div><h2>${t("กำลังหากลุ่ม")} <small>(Request Marketplace)</small></h2><p>${t("ไม่อยากเปิดกลุ่มเอง? โพสต์สิ่งที่ต้องการ แล้วให้เจ้าของกลุ่มเข้ามาเสนอ")}</p></div>${a("/requests", `${t("ดูทั้งหมด")} ${icon("arrow", 18)}`, "home-view-all")}</div>
      <div class="hk-home-sides">
        ${a("/requests/new", `<span class="hk-home-side-icon">${icon("search", 24)}</span><span><small>${t("สำหรับคนหาของ")}</small><strong>Find a Group</strong><span>${t("โพสต์ว่าต้องการอะไร งบเท่าไหร่ แล้วรอข้อเสนอ")}</span></span>${icon("arrow", 18)}`, "hk-home-side requester")}
        ${a("/requests", `<span class="hk-home-side-icon">${icon("users", 24)}</span><span><small>${t("สำหรับเจ้าของกลุ่ม (Host)")}</small><strong>Make an Offer</strong><span>${t("มีกลุ่มที่ยังมีที่ว่าง? เสนอให้คนที่กำลังหาได้เลย")}</span></span>${icon("arrow", 18)}`, "hk-home-side host")}
      </div>
      ${latest.length || !data.ready ? `<div class="hk-section-head"><h3>${t("ประกาศหากลุ่มล่าสุด")}</h3></div>` : ""}
      ${cards}
    </section>`;
  }

  // ------------------------------------------------------------------ routing
  function route(path) {
    if (path === "/requests") return listPage();
    if (path === "/requests/new") return wizardPage();
    if (path === "/my-requests") return myRequestsPage();
    if (path === "/my-offers") return myOffersPage();
    let match = path.match(/^\/requests\/([^/]+)\/edit$/);
    if (match) return editPage(match[1]);
    match = path.match(/^\/requests\/([^/]+)\/offer$/);
    if (match) return offerPage(match[1]);
    match = path.match(/^\/requests\/([^/]+)$/);
    if (match) return detailPage(match[1]);
    return null;
  }

  // ------------------------------------------------------------------ events
  const feedback = (form, message) => {
    const box = form.querySelector(".hk-feedback");
    if (!box) return ctx.alertError(message);
    box.textContent = message;
    box.hidden = !message;
  };
  const readMoney = (value, { optional = false } = {}) => {
    const text = String(value ?? "").trim();
    if (!text && optional) return null;
    return ctx.parseBaht(text);
  };
  const withBusy = async (button, task) => {
    if (button) button.disabled = true;
    try {
      return await task();
    } finally {
      if (button) button.disabled = false;
    }
  };

  async function submitWizard(form) {
    const data = new FormData(form);
    const step = Number(form.dataset.step);
    if (step === 1) {
      draft = { ...draft, pick: String(data.get("categoryPick") || ""), otherCategory: String(data.get("otherCategory") || "").trim(), category: resolvedCategory(data), title: String(data.get("title") || "").trim(), description: String(data.get("description") || "").trim() };
      if (!draft.pick) return feedback(form, t("กรุณาเลือกบริการหรือหมวดหมู่"));
      if (!draft.category) return feedback(form, t("กรุณาระบุชื่อหมวดหมู่"));
      if (draft.title.length < 3) return feedback(form, t("ชื่อประกาศต้องยาว 3–80 ตัวอักษร"));
    } else if (step === 2) {
      draft = { ...draft, billingCycle: String(data.get("billingCycle") || "monthly"), budgetMax: String(data.get("budgetMax") || "").trim(), budgetMin: String(data.get("budgetMin") || "").trim(), expiresInDays: Number(data.get("expiresInDays") || 7) };
      try {
        validateRequestInput({ ...draft, budgetMax: readMoney(draft.budgetMax), budgetMin: readMoney(draft.budgetMin, { optional: true }) });
      } catch (error) {
        return feedback(form, error.code === "invalidBaht" || error.code === "invalidSatang" ? t("กรุณากรอกงบสูงสุดให้ถูกต้อง") : ctx.errorMessage(error));
      }
    } else {
      const input = { ...draft, budgetMax: readMoney(draft.budgetMax), budgetMin: readMoney(draft.budgetMin, { optional: true }) };
      await withBusy(form.querySelector('[type="submit"]'), async () => {
        try {
          let id;
          if (ctx.supabaseConfigured()) {
            id = await createSupabaseRequest(validateRequestInput(input));
            invalidate();
          } else {
            const state = ctx.getState();
            const result = createRequest(local().requests, input, state.user);
            state.hkRequests = result.requests;
            ctx.save();
            id = result.request.id;
          }
          draft = blankDraft();
          ctx.go(`/requests/${id}`);
          ctx.alertMessage(t("โพสต์ประกาศแล้ว เจ้าของกลุ่มจะเห็นประกาศของคุณ"));
        } catch (error) {
          feedback(form, ctx.errorMessage(error));
        }
      });
      return;
    }
    draft.step = step + 1;
    ctx.render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function submitEdit(form) {
    const data = new FormData(form);
    const id = form.dataset.id;
    let input;
    try {
      input = validateRequestInput({ title: data.get("title"), description: data.get("description"), budgetMax: readMoney(data.get("budgetMax")), budgetMin: readMoney(data.get("budgetMin"), { optional: true }) }, { editing: true });
    } catch (error) {
      return feedback(form, error.code === "invalidBaht" || error.code === "invalidSatang" ? t("กรุณากรอกงบสูงสุดให้ถูกต้อง") : ctx.errorMessage(error));
    }
    await withBusy(form.querySelector('[type="submit"]'), async () => {
      try {
        if (ctx.supabaseConfigured()) {
          await updateSupabaseRequest(id, input);
          invalidate();
        } else {
          const state = ctx.getState();
          const { requests, offers } = local();
          state.hkRequests = updateRequest(requests, offers, id, input, state.user).requests;
          ctx.save();
        }
        ctx.go(`/requests/${id}`);
        ctx.alertMessage(t("บันทึกการแก้ไขแล้ว"));
      } catch (error) {
        feedback(form, ctx.errorMessage(error));
      }
    });
  }

  async function cancel(button) {
    const id = button.dataset.id;
    if (!confirm(t("ยกเลิกประกาศนี้ใช่ไหม? ข้อเสนอที่ยังรออยู่จะถูกยกเลิกด้วย"))) return;
    await withBusy(button, async () => {
      try {
        if (ctx.supabaseConfigured()) {
          await cancelSupabaseRequest(id);
          invalidate();
        } else {
          const state = ctx.getState();
          const { requests, offers } = local();
          const result = cancelRequest(requests, offers, id, state.user);
          state.hkReservations = result.releaseReservations(state.hkReservations || []);
          state.hkRequests = result.requests;
          state.hkOffers = result.offers;
          for (const offer of result.cancelledOffers)
            ctx.notice(t("ประกาศถูกยกเลิก"), t("ผู้หากลุ่มยกเลิกประกาศ “{title}” แล้ว", { title: result.request.title }), `/requests/${id}`, offer.hostId);
          ctx.save();
        }
        ctx.render();
        ctx.alertMessage(t("ยกเลิกประกาศแล้ว"));
      } catch (error) {
        ctx.alertError(ctx.errorMessage(error));
      }
    });
  }

  async function submitOfferForm(form) {
    const data = new FormData(form);
    const requestId = form.dataset.id;
    const groupId = String(data.get("groupId") || "");
    const message = String(data.get("message") || "").trim();
    if (!groupId) return feedback(form, t("กรุณาเลือกกลุ่มที่จะเสนอ"));
    await withBusy(form.querySelector('[type="submit"]'), async () => {
      try {
        if (ctx.supabaseConfigured()) {
          await submitSupabaseOffer(requestId, groupId, message);
          invalidate();
        } else {
          const state = ctx.getState();
          const { requests, offers, reservations } = local();
          const result = submitOffer(requests, offers, state.groups || [], requestId, groupId, message, state.user, { reservations });
          state.hkRequests = result.requests;
          state.hkOffers = result.offers;
          ctx.notice(t("มีข้อเสนอใหม่!"), t("{name} ส่งข้อเสนอสำหรับประกาศ “{title}” ของคุณ", { name: state.user.name, title: result.request.title }), `/requests/${requestId}`, result.request.requesterId);
          ctx.save();
        }
        ctx.go(`/requests/${requestId}`);
        ctx.alertMessage(t("ส่งข้อเสนอแล้ว รอผู้หากลุ่มพิจารณา"));
      } catch (error) {
        feedback(form, BLOCKER_LABEL[error.code] ? t(BLOCKER_LABEL[error.code]) : ctx.errorMessage(error));
      }
    });
  }

  async function withdraw(button) {
    const accepted = button.dataset.accepted === "true";
    if (!confirm(accepted ? t("ผู้หากลุ่มยอมรับข้อเสนอนี้แล้ว ถ้าถอน ที่นั่งที่จองไว้จะถูกปล่อย และประกาศจะกลับมารับข้อเสนอใหม่ ถอนใช่ไหม?") : t("ถอนข้อเสนอนี้ใช่ไหม? ผู้หากลุ่มจะได้รับแจ้ง"))) return;
    await withBusy(button, async () => {
      try {
        if (ctx.supabaseConfigured()) {
          await withdrawSupabaseOffer(button.dataset.id);
          invalidate();
        } else {
          const state = ctx.getState();
          const { requests, offers, reservations } = local();
          const result = withdrawOffer(offers, button.dataset.id, state.user, { requests, reservations });
          state.hkOffers = result.offers;
          state.hkRequests = result.requests;
          state.hkReservations = result.reservations;
          const request = requests.find((item) => item.id === result.offer.requestId);
          if (request)
            ctx.notice(t("Host ถอนข้อเสนอ"), t("{name} ถอนข้อเสนอสำหรับประกาศ “{title}”", { name: state.user.name, title: request.title }), `/requests/${request.id}`, request.requesterId);
          ctx.save();
        }
        ctx.render();
        ctx.alertMessage(t("ถอนข้อเสนอแล้ว"));
      } catch (error) {
        ctx.alertError(ctx.errorMessage(error));
      }
    });
  }

  async function accept(button) {
    if (!confirm(t("ยอมรับข้อเสนอนี้ใช่ไหม? ระบบจะจองที่นั่งไว้ให้ {hours} ชั่วโมง และข้อเสนออื่นของประกาศนี้จะถูกปฏิเสธ", { hours: RESERVATION_HOURS }))) return;
    await withBusy(button, async () => {
      try {
        if (ctx.supabaseConfigured()) {
          await acceptSupabaseOffer(button.dataset.id);
          invalidate();
        } else {
          const state = ctx.getState();
          const { requests, offers, reservations } = local();
          const result = acceptOffer(requests, offers, reservations, state.groups || [], button.dataset.id, state.user);
          state.hkRequests = result.requests;
          state.hkOffers = result.offers;
          state.hkReservations = result.reservations;
          ctx.notice(t("ข้อเสนอได้รับการยอมรับ"), t("{name} ยอมรับข้อเสนอจากกลุ่ม “{group}” แล้ว ที่นั่งถูกจองไว้ {hours} ชั่วโมง", { name: state.user.name, group: result.offer.snapshot.group_name, hours: RESERVATION_HOURS }), `/requests/${result.request.id}`, result.offer.hostId);
          for (const offer of result.turnedDown)
            ctx.notice(t("ข้อเสนอไม่ได้รับเลือก"), t("ผู้หากลุ่มเลือกข้อเสนออื่นสำหรับ “{title}”", { title: result.request.title }), `/requests/${result.request.id}`, offer.hostId);
          ctx.save();
        }
        ctx.render();
        ctx.alertMessage(t("ยอมรับข้อเสนอแล้ว จองที่นั่งไว้ให้คุณ {hours} ชั่วโมง", { hours: RESERVATION_HOURS }));
      } catch (error) {
        ctx.alertError(BLOCKER_LABEL[error.code] ? t(BLOCKER_LABEL[error.code]) : ctx.errorMessage(error));
        if (ctx.supabaseConfigured()) invalidate();
        ctx.render();
      }
    });
  }

  async function reject(button) {
    if (!confirm(t("ปฏิเสธข้อเสนอนี้ใช่ไหม?"))) return;
    await withBusy(button, async () => {
      try {
        if (ctx.supabaseConfigured()) {
          await rejectSupabaseOffer(button.dataset.id);
          invalidate();
        } else {
          const state = ctx.getState();
          const { requests, offers } = local();
          const result = rejectOffer(requests, offers, button.dataset.id, state.user);
          state.hkOffers = result.offers;
          ctx.notice(t("ข้อเสนอไม่ได้รับเลือก"), t("ผู้หากลุ่มปฏิเสธข้อเสนอสำหรับ “{title}”", { title: result.request.title }), `/requests/${result.request.id}`, result.offer.hostId);
          ctx.save();
        }
        ctx.render();
        ctx.alertMessage(t("ปฏิเสธข้อเสนอแล้ว"));
      } catch (error) {
        ctx.alertError(ctx.errorMessage(error));
      }
    });
  }

  /** Take the held seat through the group's normal join; payment then follows the group's own flow. */
  async function joinReserved(button) {
    await withBusy(button, async () => {
      try {
        let groupId;
        if (ctx.supabaseConfigured()) {
          groupId = await joinSupabaseReservedGroup(button.dataset.id);
          invalidate();
          await ctx.refreshGroups();
        } else {
          const state = ctx.getState();
          const { requests, offers, reservations } = local();
          const reservation = activeReservation(reservations, button.dataset.id, state.user);
          groupId = reservation.groupId;
          ctx.joinGroupLocally(groupId);
          const result = completeReservation(requests, offers, reservations, reservation.id);
          state.hkRequests = result.requests;
          state.hkOffers = result.offers;
          state.hkReservations = result.reservations;
          const offer = result.offers.find((item) => item.id === reservation.offerId);
          ctx.notice(t("ผู้หากลุ่มเข้าร่วมแล้ว"), t("{name} เข้าร่วมกลุ่ม “{group}” จากประกาศหากลุ่มแล้ว", { name: state.user.name, group: offer?.snapshot.group_name || "" }), `/groups/${groupId}`, offer?.hostId);
          ctx.save();
        }
        ctx.go(`/groups/${groupId}`);
        ctx.alertMessage(t("เข้าร่วมกลุ่มแล้ว กรุณายืนยันยอดใหม่"));
      } catch (error) {
        ctx.alertError(BLOCKER_LABEL[error.code] ? t(BLOCKER_LABEL[error.code]) : ctx.errorMessage(error));
        if (ctx.supabaseConfigured()) invalidate();
        ctx.render();
      }
    });
  }

  /** Test mode: the normal join path must not take a seat someone is holding (the DB trigger does this in Supabase). */
  function joinBlockedByReservation(group, userId) {
    if (ctx.supabaseConfigured() || !group) return false;
    return reservedSeatBlocks(group, local().reservations || [], userId);
  }

  /** Returns true when the event was handled here. */
  function onClick(e) {
    const target = e.target.closest?.("[data-action]");
    if (!target) return false;
    const action = target.dataset.action;
    if (action === "hk-pick-category") {
      pickCategory(target);
      return true;
    }
    if (action === "hk-wizard-step") {
      const goal = Number(target.dataset.step);
      if (!(goal < draft.step)) return true;
      keepDraft(target.closest("form"));
      draft.step = goal;
      ctx.render();
      return true;
    }
    if (action === "hk-wizard-back") {
      keepDraft(target.closest("form"));
      draft.step = Math.max(1, draft.step - 1);
      ctx.render();
      return true;
    }
    if (action === "hk-cancel-request") {
      void cancel(target);
      return true;
    }
    if (action === "hk-accept-offer") {
      void accept(target);
      return true;
    }
    if (action === "hk-reject-offer") {
      void reject(target);
      return true;
    }
    if (action === "hk-join-reserved") {
      void joinReserved(target);
      return true;
    }
    if (action === "hk-withdraw-offer") {
      void withdraw(target);
      return true;
    }
    if (action === "hk-retry") {
      remote.errors.clear();
      invalidate();
      ctx.render();
      return true;
    }
    return false;
  }

  function onSubmit(e) {
    const form = e.target;
    if (form.id === "hk-request-search") {
      e.preventDefault();
      const data = new FormData(form);
      const search = new URLSearchParams();
      const q = String(data.get("q") || "").trim();
      const category = String(data.get("category") || "ทั้งหมด");
      if (q) search.set("q", q);
      if (category !== "ทั้งหมด") search.set("category", category);
      ctx.go(`/requests${search.toString() ? `?${search}` : ""}`);
      return true;
    }
    if (form.id === "hk-request-wizard") {
      e.preventDefault();
      void submitWizard(form);
      return true;
    }
    if (form.id === "hk-offer-form") {
      e.preventDefault();
      void submitOfferForm(form);
      return true;
    }
    if (form.id === "hk-request-edit") {
      e.preventDefault();
      void submitEdit(form);
      return true;
    }
    return false;
  }

  /** Keep what was typed on the current step (used when moving back). */
  function keepDraft(form) {
    if (!form) return;
    const data = new FormData(form);
    for (const key of ["title", "description", "budgetMax", "budgetMin", "billingCycle", "otherCategory"])
      if (data.has(key)) draft[key] = String(data.get(key));
    if (data.has("categoryPick")) {
      draft.pick = String(data.get("categoryPick"));
      draft.category = resolvedCategory(data);
    }
    if (data.has("expiresInDays")) draft.expiresInDays = Number(data.get("expiresInDays"));
  }

  /** Live summary next to the create/edit forms. */
  function updateSummary(form) {
    const data = new FormData(form);
    const set = (key, text) => {
      const el = document.querySelector(`[data-hk-sum="${key}"]`);
      if (el) el.textContent = text;
    };
    if (data.has("title")) set("title", String(data.get("title")).trim() || t("ชื่อประกาศ"));
    if (data.has("categoryPick")) set("category", resolvedCategory(data) ? t(resolvedCategory(data)) : "—");
    if (data.has("billingCycle")) set("billing", billingLabel(String(data.get("billingCycle"))));
    if (data.has("budgetMax")) set("budgetMax", moneyText(data.get("budgetMax")) || "—");
    if (data.has("budgetMin")) set("budgetMin", moneyText(data.get("budgetMin")) || "—");
    if (data.has("expiresInDays")) set("expiry", t("{days} วัน", { days: Number(data.get("expiresInDays")) }));
  }

  function onInput(e) {
    const form = e.target.closest?.("#hk-request-wizard, #hk-request-edit");
    if (form) {
      updateSummary(form);
      return true;
    }
    if (e.target.matches?.('#hk-offer-form input[name="groupId"]')) {
      const price = Number(e.target.dataset.price);
      const box = document.querySelector("[data-hk-offer-price]");
      if (box) box.textContent = Number.isSafeInteger(price) ? money(price) : "—";
      return true;
    }
    return false;
  }

  /** Leaving the wizard starts it blank next time; new data shows after a sign-in change. */
  function onNavigate(path) {
    if (path !== "/requests/new") draft = blankDraft();
  }
  function onSessionChange(session) {
    invalidate();
    remote.errors.clear();
    const userId = ctx.supabaseConfigured() ? session?.user?.id || null : null;
    if (userId === notes.userId) return;
    notes.unsubscribe?.();
    notes.unsubscribe = null;
    notes.items = [];
    notes.userId = userId;
    if (!userId) return;
    const reload = () =>
      fetchRequestNotifications(userId)
        .then((items) => {
          if (notes.userId !== userId) return;
          notes.items = items;
          ctx.render();
        })
        .catch(() => {
          /* the bell just shows nothing from here; the pages still load their own data */
        });
    void reload();
    try {
      notes.unsubscribe = subscribeRequestNotifications(userId, (row) => {
        // Something changed for this person: drop cached pages so they reload, then refresh the bell.
        invalidate();
        const copy = NOTE_COPY[row?.type];
        if (copy) ctx.alertMessage(t(copy[0]));
        void reload();
      });
    } catch {
      /* Realtime unavailable: notifications still load on each sign-in */
    }
  }

  /** Items for the existing notification page and bell (Supabase mode; test mode uses ctx.notice). */
  function feedItems() {
    return notes.items.map((note) => {
      const copy = NOTE_COPY[note.type] || ["ประกาศหากลุ่ม", "{title}"];
      return {
        id: `hk:${note.id}`,
        kind: "request",
        title: t(copy[0]),
        body: t(copy[1], { title: note.requestTitle, host: note.hostName, group: note.groupName }),
        href: note.requestId ? `/requests/${note.requestId}` : "/my-requests",
        at: note.at,
        read: note.read,
      };
    });
  }

  /** Mirrors read marks to the server for hk notifications (best effort). */
  function markRead(ids) {
    const hk = ids.filter((id) => String(id).startsWith("hk:")).map((id) => String(id).slice(3));
    if (!hk.length || !ctx.supabaseConfigured()) return;
    notes.items = notes.items.map((note) => (hk.includes(note.id) ? { ...note, read: true } : note));
    void markRequestNotificationsRead(hk).catch(() => {});
  }

  /**
   * Browser-only test mode: sample requests from B and C, and one open group each for A and B
   * so they can try Make an Offer. Runs once per step (hkSeeded counts the steps done).
   */
  function seedTestData(users) {
    const state = ctx.getState();
    if (state.hkSeeded === true) state.hkSeeded = 1;
    if ((state.hkSeeded || 0) < 1) seedRequests(state, users);
    if ((state.hkSeeded || 0) < 2) seedHostGroups(state, users);
    ctx.save();
  }

  function seedHostGroups(state, users) {
    const samples = [
      [users[0], "hk-test-yt", "YouTube Premium Family", "แอปพลิเคชันและเว็บไซต์", 6, 25900, 5, "บัญชี Family แชร์ได้ 6 คน"],
      [users[1], "hk-test-cloud", "Google One 2TB ครอบครัว", "สินค้าดิจิทัล", 5, 30000, 10, "พื้นที่ 2TB แชร์ในครอบครัว"],
    ];
    for (const [user, id, name, category, capacity, product, payDay, description] of samples) {
      if (state.groups.some((group) => group.id === id)) continue;
      const listingId = `custom-${id}`;
      const group = createGroup({ id, listingId, name, ownerId: user.id, visibility: "public", capacity, costs: { product, delivery: 0 }, billing: "monthly", payDay });
      Object.assign(group, { category, categories: [category], images: [], details: { minimumMembers: 2, memberNote: "", visibilityMode: "public" } });
      state.customListings = [
        { id: listingId, sellerId: user.id, sellerName: user.name, title: name, category, kind: "บริการ", price: product, art: "custom", mark: "", description, terms: "", images: [], productDetails: { type: "digital" } },
        ...(state.customListings || []),
      ];
      state.groups = [group, ...state.groups];
    }
    state.hkSeeded = 2;
  }

  function seedRequests(state, users) {
    let requests = state.hkRequests || [];
    const samples = [
      [users[1], { title: "หาเพื่อนหาร YouTube Premium", category: "แอปพลิเคชันและเว็บไซต์", description: "ต้องการเข้าร่วมกลุ่มระยะยาว ใช้งานตามเงื่อนไขของผู้ให้บริการ", budgetMax: 5000, billingCycle: "monthly", expiresInDays: 2 }],
      [users[2], { title: "หากลุ่มหาร Cloud Storage 2TB", category: "สินค้าดิจิทัล", description: "อยากได้พื้นที่เก็บรูปครอบครัว", budgetMax: 8000, budgetMin: 3000, billingCycle: "monthly", expiresInDays: 4 }],
      [users[1], { title: "หาคนหารซื้อกระดาษ A4 ยกลัง", category: "สินค้าขายส่ง", description: "", budgetMax: 25000, billingCycle: "one_time", expiresInDays: 7 }],
    ];
    samples.forEach(([user, input], index) => {
      requests = createRequest(requests, input, user, { now: Date.now() - (samples.length - index) * 3_600_000 }).requests;
    });
    state.hkRequests = requests;
    state.hkOffers = state.hkOffers || [];
    state.hkSeeded = 1;
  }

  return { route, marketTabs, homeSection, joinBlockedByReservation, feedItems, markRead, onClick, onSubmit, onInput, onNavigate, onSessionChange, seedTestData };
}
