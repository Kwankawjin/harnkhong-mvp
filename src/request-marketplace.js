// Request Marketplace pages (Phase 2: the requester side).
// Routes: /requests, /requests/new, /requests/:id, /requests/:id/edit, /my-requests.
// The page shell, helpers and state live in app.js and are passed in through `ctx`.
import "./requests.css";
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
} from "./requests.js";
import {
  cancelSupabaseRequest,
  createSupabaseRequest,
  fetchMyRequests,
  fetchOpenRequests,
  fetchRequest,
  updateSupabaseRequest,
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

export function createRequestMarketplace(ctx) {
  const { t, escape, icon, a, title, money } = ctx;

  // ------------------------------------------------------------------ data
  // Test mode (and the plain demo) keeps requests in app state; Supabase mode keeps a small cache.
  const remote = { open: null, mine: null, detail: new Map(), loading: new Set(), errors: new Map() };
  const blankDraft = () => ({ step: 1, category: "", title: "", description: "", budgetMax: "", budgetMin: "", billingCycle: "monthly", expiresInDays: 7 });
  let draft = blankDraft();

  const local = () => {
    const state = ctx.getState();
    const result = expireRequests(state.hkRequests || [], state.hkOffers || []);
    if (result.changed || !state.hkRequests) {
      state.hkRequests = result.requests;
      state.hkOffers = result.offers;
      for (const id of result.expired) {
        const request = result.requests.find((item) => item.id === id);
        ctx.notice(t("ประกาศหมดอายุ"), t("ประกาศ “{title}” หมดอายุแล้ว", { title: request.title }), `/requests/${id}`, request.requesterId);
      }
      ctx.save();
    }
    return { requests: state.hkRequests, offers: state.hkOffers };
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
    remote.detail.clear();
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
    const key = `detail:${id}`;
    if (!remote.detail.has(id) && !remote.errors.has(key)) load(key, () => fetchRequest(id), (data) => remote.detail.set(id, data));
    const data = remote.detail.get(id);
    return { ready: Boolean(data), error: remote.errors.get(key), requests: data?.request ? [data.request] : [], offers: data?.offers || [] };
  }

  // ------------------------------------------------------------------ pieces
  const billingLabel = (cycle) => t(BILLING_LABEL[cycle] || "รายเดือน");
  const perUnit = (cycle) => (cycle === "monthly" ? t("/ เดือน") : t("/ ที่นั่ง"));
  const phaseBadge = (phase) => `<span class="hk-status hk-status-${escape(phase)}">${t(PHASE_LABEL[phase] || phase)}</span>`;
  const shortId = (id) => `#HK${String(id).replace(/-/g, "").slice(0, 6).toUpperCase()}`;
  const leftLabel = (expiresAt) => {
    const left = timeLeft(expiresAt);
    if (left.expired) return t("หมดเวลาแล้ว");
    return left.days >= 1 ? t("เหลือเวลา {days} วัน", { days: left.days }) : t("เหลือเวลา {hours} ชม.", { hours: left.hours });
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
    return `<div class="hk-market-head"><div><span class="hk-eyebrow">Marketplace</span><p>${t("ค้นหากลุ่มที่ต้องการ หรือประกาศหาสิ่งที่กำลังมองหา")}</p></div><nav class="hk-market-tabs" aria-label="Marketplace">${a("/explore", `${icon("users", 18)} ${t("กลุ่มที่เปิดหาร")}`, `hk-market-tab${active === "groups" ? " active" : ""}`)}${a("/requests", `${icon("search", 18)} ${t("กำลังหากลุ่ม")}`, `hk-market-tab${active === "requests" ? " active" : ""}`)}</nav></div>`;
  }

  function requestCard(request, offers, { mine = false } = {}) {
    const phase = requestPhase(request, offers);
    const offerCount = mine ? offers.filter((offer) => offer.requestId === request.id && offer.status === "pending").length : request.offerCount;
    return a(
      `/requests/${encodeURIComponent(request.id)}`,
      `<div class="hk-card-top"><span class="hk-card-category">${escape(t(request.category))}</span>${phaseBadge(phase)}</div>
       <h3>${escape(request.title)}</h3>
       <p class="hk-card-need">${t("ต้องการ {count} ที่นั่ง", { count: request.seatsNeeded || 1 })} · ${billingLabel(request.billingCycle)}</p>
       <div class="hk-card-budget"><strong>${budgetText(request)}</strong><small>${t("งบสูงสุด")} ${perUnit(request.billingCycle)}</small></div>
       <div class="hk-card-foot"><span>${icon("user", 15)} ${escape(request.requesterName)}</span><span>${icon("clock", 15)} ${leftLabel(request.expiresAt)}</span>${offerCount ? `<span class="hk-card-offers">${t("{count} ข้อเสนอ", { count: offerCount })}</span>` : ""}</div>`,
      "hk-request-card",
    );
  }

  // ------------------------------------------------------------------ /requests
  function listPage() {
    const params = new URLSearchParams(location.search);
    const q = (params.get("q") || "").trim();
    const category = params.get("category") || "ทั้งหมด";
    const data = source("open");
    const list = data.ready ? browseRequests(data.requests, { q, category }) : [];
    const href = (next) => {
      const search = new URLSearchParams();
      if (q) search.set("q", q);
      if (next !== "ทั้งหมด") search.set("category", next);
      const query = search.toString();
      return `/requests${query ? `?${query}` : ""}`;
    };
    const filters = `<nav class="filter-row hk-filter-row" aria-label="${t("หมวดหมู่")}">${["ทั้งหมด", ...ctx.categories].map((name) => a(href(name), escape(t(name)), `filter ${category === name ? "active" : ""}`)).join("")}</nav>`;
    const body = data.error
      ? errorBlock(data.error)
      : !data.ready
        ? loadingBlock()
        : list.length
          ? `<div class="hk-request-grid">${list.map((request) => requestCard(request, data.offers)).join("")}</div>`
          : `<div class="empty hk-empty"><h2>${q || category !== "ทั้งหมด" ? t("ไม่พบประกาศที่ตรงกับการค้นหา") : t("ยังไม่มีคนประกาศหากลุ่ม")}</h2><p>${t("โพสต์สิ่งที่คุณต้องการ แล้วให้เจ้าของกลุ่มเข้ามาเสนอ")}</p>${a("/requests/new", `${icon("plus", 18)} ${t("โพสต์หาของหาร")}`, "button primary")}</div>`;
    return `<div class="hk-page hk-list-page">
      ${marketTabs("requests")}
      <section class="hk-hero"><div><span class="hk-new-badge">NEW FEATURE</span><h1>Request Marketplace</h1><p><strong>Post what you need. Find what you want.</strong></p><p>${t("โพสต์สิ่งที่ต้องการ แล้วให้เจ้าของกลุ่มเข้ามาเสนอได้เลย ไม่ต้องเปิดกลุ่มเอง")}</p></div><div class="hk-hero-actions">${a("/requests/new", `${icon("plus", 18)} ${t("โพสต์หาของหาร")}`, "button primary")}${ctx.getState().user ? a("/my-requests", t("ประกาศของฉัน"), "button outline") : ""}</div></section>
      <form class="search-bar" id="hk-request-search"><span>${icon("search")}</span><input type="hidden" name="category" value="${escape(category)}"/><input name="q" value="${escape(q)}" placeholder="${t("ค้นหาบริการที่ต้องการ...")}" aria-label="${t("ค้นหา")}"/><button type="submit">${t("ค้นหา")}</button></form>
      ${filters}
      <div class="hk-section-head"><h2>${t("ประกาศหากลุ่มล่าสุด")}</h2>${data.ready && !data.error ? `<span>${t("{count} ประกาศ", { count: list.length })}</span>` : ""}</div>
      ${body}
    </div>`;
  }

  // ------------------------------------------------------------------ /requests/new
  function wizardPage() {
    const user = ctx.getState().user;
    if (!user) return `<div class="hk-page">${signInBlock(t("เข้าสู่ระบบเพื่อโพสต์ประกาศหากลุ่ม"))}</div>`;
    const step = draft.step;
    const steps = [t("ต้องการหาอะไร?"), t("ระบุความต้องการ"), t("ตรวจสอบประกาศ")];
    const progress = `<ol class="hk-steps" aria-label="${t("ขั้นตอน")}">${steps.map((label, index) => `<li class="${index + 1 === step ? "active" : index + 1 < step ? "done" : ""}" ${index + 1 === step ? 'aria-current="step"' : ""}><span>${index + 1 < step ? icon("check", 14) : index + 1}</span>${label}</li>`).join("")}</ol>`;
    let body = "";
    if (step === 1) {
      body = `<h2>${t("ขั้นตอนที่ 1: ต้องการหาอะไร?")}</h2><p class="hk-help">${t("เลือกบริการหรือหมวดหมู่ที่ต้องการหาร")}</p>
        <label class="hk-field"><span class="sr-only">${t("ค้นหาบริการ...")}</span><input type="search" data-hk-category-filter placeholder="${t("ค้นหาบริการ...")}" autocomplete="off"/></label>
        <fieldset class="hk-category-grid"><legend class="sr-only">${t("หมวดหมู่")}</legend>${ctx.categories.map((name) => `<label class="hk-category-option" data-name="${escape(`${name} ${t(name)}`.toLowerCase())}"><input type="radio" name="category" value="${escape(name)}" ${draft.category === name ? "checked" : ""} required/><span>${ctx.categorySymbol(name)} ${escape(t(name))}</span></label>`).join("")}</fieldset>
        <p class="hk-help small">${t("ไม่เจอบริการที่ต้องการ? เลือก “อื่น ๆ (ระบุชื่อเอง)” แล้วใส่ชื่อบริการในชื่อประกาศ")}</p>
        <h3>${t("รายละเอียดที่ต้องการ")}</h3>
        <label class="hk-field">${t("ชื่อประกาศ")}<input name="title" required minlength="3" maxlength="80" value="${escape(draft.title)}" placeholder="${t("หาเพื่อนหาร YouTube Premium")}"/></label>
        <label class="hk-field">${t("รายละเอียดเพิ่มเติม")} <small>(${t("ไม่บังคับ")})</small><textarea name="description" maxlength="600" rows="4" placeholder="${t("ต้องการเข้าร่วมกลุ่มระยะยาว...")}">${escape(draft.description)}</textarea></label>`;
    } else if (step === 2) {
      body = `<h2>${t("ขั้นตอนที่ 2: ระบุความต้องการ")}</h2>
        <div class="hk-field"><span>${t("จำนวนที่นั่ง")}</span><div class="hk-fixed-value"><strong>${t("1 ที่นั่ง")}</strong><small>${t("1 บัญชีเข้าร่วมกลุ่มได้ 1 ที่นั่ง")}</small></div></div>
        <fieldset class="hk-segment"><legend>${t("รอบการชำระเงิน")}</legend>${Object.keys(BILLING_LABEL).map((cycle) => `<label><input type="radio" name="billingCycle" value="${cycle}" ${draft.billingCycle === cycle ? "checked" : ""}/><span>${billingLabel(cycle)}</span></label>`).join("")}</fieldset>
        <div class="hk-field-row"><label class="hk-field">${t("งบสูงสุด (บาท)")}<input name="budgetMax" inputmode="decimal" required value="${escape(draft.budgetMax)}" placeholder="50"/></label><label class="hk-field">${t("งบขั้นต่ำ (บาท)")} <small>(${t("ไม่บังคับ")})</small><input name="budgetMin" inputmode="decimal" value="${escape(draft.budgetMin)}" placeholder="0"/></label></div>
        <p class="hk-help small">${t("งบต่อ 1 ที่นั่ง ตามรอบการชำระเงินที่เลือก")}</p>
        <fieldset class="hk-segment"><legend>${t("ระยะเวลาประกาศ")}</legend>${REQUEST_EXPIRY_DAYS.map((days) => `<label><input type="radio" name="expiresInDays" value="${days}" ${Number(draft.expiresInDays) === days ? "checked" : ""}/><span>${t("{days} วัน", { days })}</span></label>`).join("")}</fieldset>`;
    } else {
      const preview = {
        id: "preview",
        title: draft.title,
        category: draft.category,
        description: draft.description,
        budgetMax: ctx.parseBaht(draft.budgetMax),
        budgetMin: draft.budgetMin ? ctx.parseBaht(draft.budgetMin) : null,
        billingCycle: draft.billingCycle,
        seatsNeeded: 1,
        requesterName: user.name,
        status: "open",
        offerCount: 0,
        expiresAt: new Date(Date.now() + Number(draft.expiresInDays) * 86_400_000).toISOString(),
      };
      body = `<h2>${t("ขั้นตอนที่ 3: ตรวจสอบประกาศ")}</h2><p class="hk-help">${t("ประกาศจะแสดงแบบนี้ในหน้ารวมประกาศ")}</p>
        <div class="hk-preview">${requestCard(preview, []).replace(/<a [^>]*>/, '<div class="hk-request-card is-preview">').replace(/<\/a>$/, "</div>")}</div>
        ${draft.description ? `<div class="hk-preview-desc"><strong>${t("รายละเอียดเพิ่มเติม")}</strong><p>${escape(draft.description)}</p></div>` : ""}
        <ul class="hk-checklist"><li>${icon("check", 16)} ${t("เจ้าของกลุ่มจะเห็นประกาศและส่งข้อเสนอพร้อมกลุ่มที่มีอยู่จริง")}</li><li>${icon("check", 16)} ${t("คุณเลือกข้อเสนอได้ 1 รายการ แล้วเข้าร่วมกลุ่มตามขั้นตอนเดิม")}</li><li>${icon("check", 16)} ${t("ประกาศหมดอายุใน {days} วัน", { days: draft.expiresInDays })}</li></ul>`;
    }
    const back = step > 1 ? `<button type="button" class="button outline" data-action="hk-wizard-back">${t("ย้อนกลับ")}</button>` : a("/requests", t("ยกเลิก"), "button outline");
    const next = step < 3 ? `<button type="submit" class="button primary">${t("ถัดไป")} ${icon("arrow", 18)}</button>` : `<button type="submit" class="button primary">${icon("check", 18)} Publish Request</button>`;
    return `<div class="hk-page hk-wizard-page">
      ${a("/requests", `← ${t("กลับไปหน้าประกาศ")}`, "listing-back-link")}
      <div class="hk-wizard-head"><h1>${t("สร้างประกาศหากลุ่ม")}</h1><span>Step ${step} / 3</span></div>
      ${progress}
      <form id="hk-request-wizard" class="hk-panel hk-wizard" data-step="${step}" novalidate>${body}<div class="hk-feedback" role="alert" hidden></div><div class="hk-actions">${back}${next}</div></form>
    </div>`;
  }

  // ------------------------------------------------------------------ /requests/:id
  function detailPage(id) {
    const data = source("detail", id);
    if (data.error) return `<div class="hk-page">${errorBlock(data.error)}</div>`;
    if (!data.ready) return `<div class="hk-page">${loadingBlock()}</div>`;
    const request = data.requests.find((item) => item.id === id);
    if (!request) return `<div class="hk-page"><div class="empty hk-empty"><h2>${t("ไม่พบประกาศนี้")}</h2><p>${t("ประกาศอาจหมดอายุหรือถูกยกเลิกแล้ว")}</p>${a("/requests", t("ดูประกาศทั้งหมด"), "button primary")}</div></div>`;
    const user = ctx.getState().user;
    const mine = user?.id === request.requesterId;
    const offers = data.offers.filter((offer) => offer.requestId === id);
    const phase = requestPhase(request, offers);
    const pendingCount = offers.filter((offer) => offer.status === "pending").length;
    const ownerActions = mine
      ? `<div class="hk-owner-actions">${canEditRequest(request, offers) ? a(`/requests/${encodeURIComponent(id)}/edit`, `${icon("edit", 17)} ${t("แก้ไขประกาศ")}`, "button outline") : ""}${["open", "matched"].includes(request.status) && phase !== "expired" ? `<button type="button" class="button danger-soft" data-action="hk-cancel-request" data-id="${escape(id)}">${icon("trash", 17)} ${t("ยกเลิกประกาศ")}</button>` : ""}</div>${!canEditRequest(request, offers) && phase === "has_offers" ? `<p class="hk-help small">${t("มีข้อเสนอแล้ว จึงแก้ไขประกาศไม่ได้ เพื่อให้ข้อเสนอตรงกับสิ่งที่ประกาศไว้")}</p>` : ""}`
      : "";
    const offerList = offers.length
      ? `<div class="hk-offer-list">${offers.map((offer) => `<article class="hk-offer-card"><div class="hk-offer-top"><span class="avatar small">${escape(String(offer.hostName || "H").slice(0, 1))}</span><div><strong>${escape(offer.hostName)}</strong><small>${escape(offer.snapshot.group_name || t("กลุ่ม"))} · ${t("{count} ที่นั่ง", { count: offer.seatsOffered || 1 })}</small></div><span class="hk-offer-status hk-offer-${escape(offer.status)}">${t(OFFER_LABEL[offer.status] || offer.status)}</span></div><div class="hk-offer-price"><strong>${money(offer.offered)}</strong> <small>${perUnit(request.billingCycle)}</small></div>${offer.message ? `<p>${escape(offer.message)}</p>` : ""}${offer.groupId ? a(`/groups/${encodeURIComponent(offer.groupId)}`, t("ดูกลุ่ม"), "button outline") : ""}</article>`).join("")}</div>`
      : `<div class="hk-offer-empty">${icon("clock", 22)}<div><strong>${t("ยังไม่มีข้อเสนอ")}</strong><p>${mine ? t("เมื่อเจ้าของกลุ่มส่งข้อเสนอ จะแสดงที่นี่") : t("ข้อเสนอจะเห็นได้เฉพาะเจ้าของประกาศ")}</p></div></div>`;
    const hostCta = !mine && request.status === "open" && phase !== "expired"
      ? `<section class="hk-panel hk-host-cta"><div><h2>${t("มีกลุ่มที่ตรงกับประกาศนี้?")}</h2><p>${t("เจ้าของกลุ่มจะส่งข้อเสนอพร้อมแนบกลุ่มที่มีอยู่ได้ เร็ว ๆ นี้")}</p></div><button type="button" class="button primary" disabled>Make an Offer · ${t("เร็ว ๆ นี้")}</button></section>`
      : "";
    return `<div class="hk-page hk-detail-page">
      ${a(mine ? "/my-requests" : "/requests", `← ${mine ? t("ประกาศของฉัน") : t("กลับไปหน้าประกาศ")}`, "listing-back-link")}
      <section class="hk-panel hk-detail-head">
        <div class="hk-detail-meta">${phaseBadge(phase)}<span>Request ${shortId(id)}</span><span class="hk-card-category">${escape(t(request.category))}</span></div>
        <h1>${escape(request.title)}</h1>
        <p class="hk-detail-sub">${t("ต้องการเข้าร่วมกลุ่ม{cycle} จำนวน {count} ที่นั่ง", { cycle: billingLabel(request.billingCycle), count: request.seatsNeeded || 1 })}</p>
        <div class="hk-detail-stats"><div><small>${t("งบประมาณสูงสุด")}</small><strong>${money(request.budgetMax)}</strong><span>${perUnit(request.billingCycle)}${request.budgetMin ? ` · ${t("ขั้นต่ำ {amount}", { amount: money(request.budgetMin) })}` : ""}</span></div><div><small>${t("จำนวนที่ต้องการ")}</small><strong>${t("{count} ที่นั่ง", { count: request.seatsNeeded || 1 })}</strong><span>${billingLabel(request.billingCycle)}</span></div><div><small>${t("ระยะเวลา")}</small><strong>${leftLabel(request.expiresAt)}</strong><span>${t("ผู้โพสต์: {name}", { name: escape(request.requesterName) })}</span></div></div>
        ${ownerActions}
      </section>
      ${request.description ? `<section class="hk-panel"><h2>${t("รายละเอียดเพิ่มเติม")}</h2><p class="hk-description">${escape(request.description)}</p></section>` : ""}
      ${mine ? `<section class="hk-panel"><div class="hk-section-head"><h2>${t("ข้อเสนอที่ได้รับ")}</h2><span>${t("{count} ข้อเสนอ", { count: offers.length })}${pendingCount ? ` · ${t("รอพิจารณา {count}", { count: pendingCount })}` : ""}</span></div>${offerList}</section>` : hostCta}
    </div>`;
  }

  // ------------------------------------------------------------------ /requests/:id/edit
  function editPage(id) {
    const user = ctx.getState().user;
    if (!user) return `<div class="hk-page">${signInBlock(t("เข้าสู่ระบบเพื่อแก้ไขประกาศ"))}</div>`;
    const data = source("detail", id);
    if (data.error) return `<div class="hk-page">${errorBlock(data.error)}</div>`;
    if (!data.ready) return `<div class="hk-page">${loadingBlock()}</div>`;
    const request = data.requests.find((item) => item.id === id);
    if (!request || request.requesterId !== user.id) return `<div class="hk-page"><div class="empty hk-empty"><h2>${t("ไม่พบประกาศนี้")}</h2>${a("/my-requests", t("ประกาศของฉัน"), "button primary")}</div></div>`;
    if (!canEditRequest(request, data.offers)) return `<div class="hk-page"><div class="empty hk-empty"><h2>${t("แก้ไขประกาศนี้ไม่ได้")}</h2><p>${t("แก้ไขได้เฉพาะประกาศที่เปิดอยู่และยังไม่มีข้อเสนอ")}</p>${a(`/requests/${encodeURIComponent(id)}`, t("กลับไปที่ประกาศ"), "button primary")}</div></div>`;
    return `<div class="hk-page hk-wizard-page">
      ${a(`/requests/${encodeURIComponent(id)}`, `← ${t("กลับไปที่ประกาศ")}`, "listing-back-link")}
      <div class="hk-wizard-head"><h1>${t("แก้ไขประกาศ")}</h1><span>${escape(t(request.category))} · ${billingLabel(request.billingCycle)}</span></div>
      <form id="hk-request-edit" class="hk-panel hk-wizard" data-id="${escape(id)}" novalidate>
        <label class="hk-field">${t("ชื่อประกาศ")}<input name="title" required minlength="3" maxlength="80" value="${escape(request.title)}"/></label>
        <label class="hk-field">${t("รายละเอียดเพิ่มเติม")} <small>(${t("ไม่บังคับ")})</small><textarea name="description" maxlength="600" rows="4">${escape(request.description)}</textarea></label>
        <div class="hk-field-row"><label class="hk-field">${t("งบสูงสุด (บาท)")}<input name="budgetMax" inputmode="decimal" required value="${escape(ctx.bahtInput(request.budgetMax))}"/></label><label class="hk-field">${t("งบขั้นต่ำ (บาท)")} <small>(${t("ไม่บังคับ")})</small><input name="budgetMin" inputmode="decimal" value="${request.budgetMin ? escape(ctx.bahtInput(request.budgetMin)) : ""}"/></label></div>
        <p class="hk-help small">${t("บริการ รอบการชำระเงิน และวันหมดอายุเปลี่ยนไม่ได้ ถ้าต้องการเปลี่ยน ให้ยกเลิกแล้วโพสต์ใหม่")}</p>
        <div class="hk-feedback" role="alert" hidden></div>
        <div class="hk-actions">${a(`/requests/${encodeURIComponent(id)}`, t("ยกเลิก"), "button outline")}<button type="submit" class="button primary">${t("บันทึกการแก้ไข")}</button></div>
      </form>
    </div>`;
  }

  // ------------------------------------------------------------------ /my-requests
  function myRequestsPage() {
    const user = ctx.getState().user;
    if (!user) return `<div class="hk-page">${signInBlock(t("เข้าสู่ระบบเพื่อดูประกาศหากลุ่มของคุณ"))}</div>`;
    const tab = MY_REQUEST_TABS.includes(new URLSearchParams(location.search).get("tab")) ? new URLSearchParams(location.search).get("tab") : "all";
    const data = source("mine");
    const mine = data.requests.filter((request) => request.requesterId === user.id);
    const counts = Object.fromEntries(MY_REQUEST_TABS.map((key) => [key, filterMyRequests(mine, data.offers, key).length]));
    const list = filterMyRequests(mine, data.offers, tab);
    const tabs = `<nav class="hk-tabs" aria-label="${t("ประกาศของฉัน")}">${MY_REQUEST_TABS.map((key) => a(key === "all" ? "/my-requests" : `/my-requests?tab=${key}`, `${t(TAB_LABEL[key])}${data.ready ? ` <span>${counts[key]}</span>` : ""}`, `hk-tab${tab === key ? " active" : ""}`)).join("")}</nav>`;
    const body = data.error
      ? errorBlock(data.error)
      : !data.ready
        ? loadingBlock()
        : list.length
          ? `<div class="hk-request-grid">${list.map((request) => requestCard(request, data.offers, { mine: true })).join("")}</div>`
          : `<div class="empty hk-empty"><h2>${tab === "all" ? t("คุณยังไม่มีประกาศหากลุ่ม") : t("ไม่มีประกาศในแท็บนี้")}</h2><p>${t("โพสต์สิ่งที่คุณต้องการ แล้วให้เจ้าของกลุ่มเข้ามาเสนอ")}</p>${a("/requests/new", `${icon("plus", 18)} ${t("โพสต์หาของหาร")}`, "button primary")}</div>`;
    return `<div class="hk-page">
      ${title(t("ประกาศหากลุ่มของฉัน"), t("ติดตามประกาศและข้อเสนอที่ได้รับ"))}
      <div class="hk-toolbar">${tabs}${a("/requests/new", `${icon("plus", 18)} ${t("โพสต์หาของหาร")}`, "button primary")}</div>
      ${body}
    </div>`;
  }

  // ------------------------------------------------------------------ routing
  function route(path) {
    if (path === "/requests") return listPage();
    if (path === "/requests/new") return wizardPage();
    if (path === "/my-requests") return myRequestsPage();
    let match = path.match(/^\/requests\/([^/]+)\/edit$/);
    if (match) return editPage(match[1]);
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
      draft = { ...draft, category: String(data.get("category") || ""), title: String(data.get("title") || "").trim(), description: String(data.get("description") || "").trim() };
      if (!draft.category) return feedback(form, t("กรุณาเลือกบริการหรือหมวดหมู่"));
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

  /** Returns true when the event was handled here. */
  function onClick(e) {
    const target = e.target.closest?.("[data-action]");
    if (!target) return false;
    const action = target.dataset.action;
    if (action === "hk-wizard-back") {
      const form = target.closest("form");
      if (form) {
        // Keep what was typed on this step before going back.
        const data = new FormData(form);
        for (const key of ["title", "description", "budgetMax", "budgetMin", "billingCycle", "category"])
          if (data.has(key)) draft[key] = String(data.get(key));
        if (data.has("expiresInDays")) draft.expiresInDays = Number(data.get("expiresInDays"));
      }
      draft.step = Math.max(1, draft.step - 1);
      ctx.render();
      return true;
    }
    if (action === "hk-cancel-request") {
      void cancel(target);
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
    if (form.id === "hk-request-edit") {
      e.preventDefault();
      void submitEdit(form);
      return true;
    }
    return false;
  }

  function onInput(e) {
    if (!e.target.matches?.("[data-hk-category-filter]")) return false;
    const query = e.target.value.trim().toLowerCase();
    for (const option of document.querySelectorAll(".hk-category-option"))
      option.hidden = Boolean(query) && !option.dataset.name.includes(query) && !option.querySelector("input").checked;
    return true;
  }

  /** Leaving the wizard starts it blank next time; new data shows after a sign-in change. */
  function onNavigate(path) {
    if (path !== "/requests/new") draft = blankDraft();
  }
  function onSessionChange() {
    invalidate();
    remote.errors.clear();
  }

  /** Sample requests for the browser-only test mode, from the other test people. */
  function seedTestData(users) {
    const state = ctx.getState();
    if (state.hkSeeded) return;
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
    state.hkSeeded = true;
    ctx.save();
  }

  return { route, marketTabs, onClick, onSubmit, onInput, onNavigate, onSessionChange, seedTestData };
}
