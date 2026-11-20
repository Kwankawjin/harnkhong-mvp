import "./style.css";
import "./theme.css";
import "./mobile.css";
import * as React from "react";
import { createRoot } from "react-dom/client";
import DoodleCrewFooter from "../components/ui/doodle-crew-footer.tsx";
import LanyardBadge from "../components/ui/lanyard-badge.tsx";
import QRCode from "qrcode";
import {
  demoAccount,
  editProfile,
  readLocalImage,
  isLocalImage,
  MAX_GROUP_IMAGES,
} from "./prototype.js";
import {
  listings as seedListings,
  sellers,
  demoNames,
  initialState,
} from "./data.js";
import {
  assertCapacity,
  createGroup,
  costBreakdown,
  totalCost,
  shares,
  joinGroup,
  leaveGroup,
  approve,
  changeCosts,
  parseBaht,
  allApproved,
  transferOwner,
  SEAT_MODE,
  seatPrice,
  ownerPayout,
} from "./domain.js";
import {
  currentCycle,
  startFirstCycle,
  rollCycles,
  confirmCycle,
  recordCyclePayment,
  waitsForNextCycle,
  cyclePayers,
  confirmCycleReceipt,
  cycleReleased,
  redeemPromo,
  commissionWaived,
  LAUNCH_PROMO,
  emptySubscription,
  effectivePlan,
  expireSubscription,
  reportSubscriptionPayment,
  verifySubscriptionPayment,
  groupLimit,
  PLUS_PRICE_SATANG,
} from "./billing.js";
import { messages, translate, formatSatang, bahtInput } from "./i18n.js";
import {
  supabase,
  supabaseConfigured,
  googleAuthAvailable,
  refreshAuthProviders,
  loadAuthenticatedUser,
  saveAuthenticatedAddress,
} from "./supabase.js";
import { createAuthSessionSync } from "./auth-session.js";

const BANK_PAYMENT_QR_SRC = "/images/bank-payment-qr.webp";
const BANK_PAYMENT_RECIPIENT = "จิณห์นิภา บรรจบสมัย";
const ADMIN_ACCOUNT_EMAILS = ["harnkhong@gmail.com", "asdwadwaa8@gmail.com"];

let doodleFooterRoot = null;
let profileBadgeRoot = null;
let adminPageModule = null;
let adminPageModulePromise = null;
import { loadGroupMessages, sendGroupMessage } from "./group-chat.js";
import {
  loadSupabaseGroups,
  resolveSupabaseInvite,
  createSupabaseGroup,
  joinSupabaseGroup,
  leaveSupabaseGroup,
  approveSupabaseGroup,
  reportSupabaseGroupPayment,
  updateSupabaseGroupDetails,
  transferSupabaseGroup,
  removeSupabaseGroupMember,
  getSupabaseInvite,
  startSupabaseCycle,
  syncSupabaseCycles,
  confirmSupabaseCycle,
  reportSupabaseCyclePayment,
  loadSupabaseSubscription,
  reportSupabaseSubscriptionPayment,
  confirmSupabaseReceipt,
  confirmSupabaseCycleReceipt,
  redeemSupabasePromo,
  loadSupabasePayoutAccount,
  saveSupabasePayoutAccount,
  openPayoutSlip,
} from "./supabase-groups.js";
import {
  createOrder,
  activateOrder,
  migrateOrders,
  lockOrderedGroups,
  orderPermissions,
  reportPayment,
  updatePayment,
  transitionOrder,
  updateShipment,
  openDispute,
  proposeResolution,
  respondToResolution,
  DISPUTE_REASONS,
  sellerIdFor,
} from "./orders.js";
import {
  createSupabaseSecondhandListing,
  updateSupabaseSecondhandListing,
  deleteSupabaseSecondhandListing,
  boostSupabaseSecondhandListing,
} from "./supabase-listings.js";
import {
  loadSecondhandConversations,
  loadSecondhandMessages,
  sendSecondhandMessage,
  startSecondhandConversation,
} from "./secondhand-chat.js";
import { createSupabaseSecondhandOrder } from "./secondhand-orders.js";

const LOCALE_KEY = "harnkhong-locale";
let locale = "th";
try {
  if (localStorage.getItem(LOCALE_KEY) === "en") locale = "en";
} catch {
  /* Keep Thai when storage is unavailable. */
}
const THEME_KEY = "harnkhong-theme";
let theme = "light";
try {
  if (localStorage.getItem(THEME_KEY) === "dark") theme = "dark";
} catch {
  /* Keep the light theme when storage is unavailable. */
}
let mobileMenuOpen = false;
let profileMenuOpen = false;
let listingMenuOpen = false;
let heroHeadlineTimeout = null;
let heroHeadlineIndex = 0;
let heroHeadlineAnimation = null;
let heroHeadlineResizeHandler = null;
function startHeroHeadlineLoop() {
  clearTimeout(heroHeadlineTimeout);
  heroHeadlineAnimation?.cancel();
  heroHeadlineAnimation = null;
  if (heroHeadlineResizeHandler)
    window.removeEventListener("resize", heroHeadlineResizeHandler);
  const visible = document.querySelector("[data-text-loop]");
  if (!visible) return;
  let phrases = [];
  try {
    phrases = JSON.parse(visible.dataset.textLoop || "[]");
  } catch {
    return;
  }
  if (phrases.length < 2) return;
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const accessible = document.querySelector("[data-headline-accessible]");
  const staticText = visible.dataset.staticText || "";
  const current = visible.querySelector(".headline-rotator-current");
  const windowElement = visible.querySelector(".headline-rotator-window");
  const measure = visible.querySelector(".headline-rotator-measure");
  const staticElement = visible.querySelector(".hero-headline-static");
  const cursor = visible.querySelector(".headline-rotator-cursor");
  const heading = visible.closest("h1");
  heroHeadlineResizeHandler = () => {
    if (!heading || !staticElement || !windowElement || !measure) return;
    const headingWidth =
      window.innerWidth >= 960 ? window.innerWidth - 32 : heading.clientWidth;
    const available = Math.max(
      80,
      headingWidth -
        staticElement.getBoundingClientRect().width -
        (cursor?.offsetWidth || 0) -
        12,
    );
    windowElement.style.maxWidth = `${available}px`;
    measure.style.maxWidth = `${available}px`;
  };
  heroHeadlineResizeHandler();
  window.addEventListener("resize", heroHeadlineResizeHandler, {
    passive: true,
  });
  const cycle = async () => {
    heroHeadlineIndex = (heroHeadlineIndex + 1) % phrases.length;
    const phrase = phrases[heroHeadlineIndex];
    if (!current || !windowElement || !measure) return;
    if (reduceMotion) {
      current.textContent = phrase;
      if (accessible) accessible.textContent = `${staticText} ${phrase}`;
      heroHeadlineTimeout = setTimeout(cycle, 3000);
      return;
    }
    const previousWidth = windowElement.getBoundingClientRect().width;
    heroHeadlineAnimation = windowElement.animate(
      [
        { width: `${previousWidth}px`, opacity: 1 },
        { width: "0px", opacity: 0 },
      ],
      { duration: 220, easing: "ease-in", fill: "forwards" },
    );
    await heroHeadlineAnimation.finished.catch(() => {});
    if (!visible.isConnected) return;
    heroHeadlineAnimation.cancel();
    current.textContent = phrase;
    const reservedText = measure.textContent;
    measure.textContent = phrase;
    const nextWidth = measure.getBoundingClientRect().width + 4;
    measure.textContent = reservedText;
    windowElement.style.width = "0px";
    windowElement.style.opacity = "0";
    windowElement.getBoundingClientRect();
    heroHeadlineAnimation = windowElement.animate(
      [
        { width: "0px", opacity: 0 },
        { width: `${nextWidth}px`, opacity: 1 },
      ],
      { duration: 580, easing: "cubic-bezier(0.16,1,0.3,1)", fill: "forwards" },
    );
    await heroHeadlineAnimation.finished.catch(() => {});
    if (!visible.isConnected) return;
    heroHeadlineAnimation.cancel();
    windowElement.style.width = "auto";
    windowElement.style.opacity = "1";
    if (accessible) accessible.textContent = `${staticText} ${phrase}`;
    heroHeadlineTimeout = setTimeout(cycle, 2200);
  };
  heroHeadlineTimeout = setTimeout(cycle, 3000);
}

let heroParallaxCleanup = null;
function initHeroPhoneParallax() {
  if (heroParallaxCleanup) {
    heroParallaxCleanup();
    heroParallaxCleanup = null;
  }
  if (typeof document === "undefined") return;
  const showcase = document.querySelector(".hero-phone-showcase");
  if (!showcase) return;
  const frame = showcase.querySelector(".hero-phone-frame");
  if (!frame) return;
  const visual = showcase.closest(".hero-visual") || showcase;
  const cardCalc = showcase.querySelector(".card-calc");
  const cardNotice = showcase.querySelector(".card-notice");
  const cardBadge = showcase.querySelector(".card-badge");

  if (
    typeof matchMedia !== "undefined" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches
  )
    return;

  let targetX = 0;
  let targetY = 0;
  let currentX = 0;
  let currentY = 0;
  let isHovered = false;
  let rafId = null;

  const baseRx = 6;
  const baseRy = -10;
  const maxTiltX = 14;
  const maxTiltY = 18;

  const update = () => {
    currentX += (targetX - currentX) * 0.12;
    currentY += (targetY - currentY) * 0.12;

    const rx = baseRx - currentY * maxTiltX;
    const ry = baseRy + currentX * maxTiltY;
    const scale = isHovered ? 1.025 : 1;
    const lift = isHovered ? -6 : 0;

    frame.style.transform = `perspective(1200px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) translateY(${lift}px) scale(${scale})`;

    const glareAngle = 135 + currentX * 25;
    frame.style.setProperty("--glare-angle", `${glareAngle.toFixed(1)}deg`);

    if (cardCalc) {
      cardCalc.style.setProperty(
        "--parallax-x",
        `${(currentX * 14).toFixed(1)}px`,
      );
      cardCalc.style.setProperty(
        "--parallax-y",
        `${(currentY * 12).toFixed(1)}px`,
      );
    }
    if (cardNotice) {
      cardNotice.style.setProperty(
        "--parallax-x",
        `${(currentX * -16).toFixed(1)}px`,
      );
      cardNotice.style.setProperty(
        "--parallax-y",
        `${(currentY * -14).toFixed(1)}px`,
      );
    }
    if (cardBadge) {
      cardBadge.style.setProperty(
        "--parallax-x",
        `${(currentX * 10).toFixed(1)}px`,
      );
      cardBadge.style.setProperty(
        "--parallax-y",
        `${(currentY * 8).toFixed(1)}px`,
      );
    }

    if (
      isHovered ||
      Math.abs(targetX - currentX) > 0.001 ||
      Math.abs(targetY - currentY) > 0.001
    ) {
      rafId = requestAnimationFrame(update);
    } else {
      rafId = null;
      frame.style.transform = "";
      frame.style.removeProperty("--glare-angle");
      if (cardCalc) {
        cardCalc.style.removeProperty("--parallax-x");
        cardCalc.style.removeProperty("--parallax-y");
      }
      if (cardNotice) {
        cardNotice.style.removeProperty("--parallax-x");
        cardNotice.style.removeProperty("--parallax-y");
      }
      if (cardBadge) {
        cardBadge.style.removeProperty("--parallax-x");
        cardBadge.style.removeProperty("--parallax-y");
      }
    }
  };

  const onMouseMove = (e) => {
    const rect = showcase.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;
    targetX = Math.max(-1.2, Math.min(1.2, (px - 0.5) * 2));
    targetY = Math.max(-1.2, Math.min(1.2, (py - 0.5) * 2));
    if (!rafId) rafId = requestAnimationFrame(update);
  };

  const onMouseEnter = () => {
    isHovered = true;
    frame.style.transition = "none";
    if (!rafId) rafId = requestAnimationFrame(update);
  };

  const onMouseLeave = () => {
    isHovered = false;
    targetX = 0;
    targetY = 0;
    frame.style.transition =
      "transform 0.5s cubic-bezier(0.2, 0.8, 0.2, 1), box-shadow 0.5s ease";
    if (!rafId) rafId = requestAnimationFrame(update);
  };

  visual.addEventListener("mousemove", onMouseMove, { passive: true });
  visual.addEventListener("mouseenter", onMouseEnter, { passive: true });
  visual.addEventListener("mouseleave", onMouseLeave, { passive: true });

  heroParallaxCleanup = () => {
    if (rafId) cancelAnimationFrame(rafId);
    visual.removeEventListener("mousemove", onMouseMove);
    visual.removeEventListener("mouseenter", onMouseEnter);
    visual.removeEventListener("mouseleave", onMouseLeave);
  };
}

const t = (key, values) => translate(locale, key, values);
const errorMessage = (error) =>
  messages[locale][error.code] ??
  error.message ??
  t("เกิดข้อผิดพลาด กรุณาลองใหม่");

const KEY = "harnkhong-demo-v1";
let state;
try {
  state = {
    ...initialState(),
    ...JSON.parse(localStorage.getItem(KEY) || "{}"),
  };
} catch {
  state = initialState();
}
if (supabaseConfigured)
  state = {
    ...state,
    user: null,
    profiles: {},
    groups: [],
    remoteListings: [],
    remoteSellers: [],
    orders: [],
    notifications: [],
    conversations: {},
  };
const save = (next = state) => {
  if (!supabaseConfigured) localStorage.setItem(KEY, JSON.stringify(next));
  state = next;
};
const restoredOrders = migrateOrders(state.orders, state.groups, [
  ...seedListings,
  ...state.customListings,
]);
const restoredGroups = lockOrderedGroups(state.groups, restoredOrders).map(
  (g) => {
    if (g.orderId || g.costs?.mode === "per_member_v2" || g.costs?.mode === SEAT_MODE) return g;
    return {
      ...g,
      costs: {
        product: g.costs.product,
        delivery: g.costs.delivery,
        mode: "per_member_v2",
      },
      revision: g.revision + 1,
      approvals: {},
      status: "awaiting_approval",
      history: [
        ...g.history,
        {
          revision: g.revision + 1,
          reason: "ปรับวิธีคิดค่าส่งและค่าธรรมเนียม",
          at: new Date().toISOString(),
        },
      ],
    };
  },
);
if (
  restoredOrders.some((o, i) => o !== state.orders[i]) ||
  restoredGroups.some((g, i) => g !== state.groups[i])
) {
  // Keep the original stored data if upgrading cannot be saved.
  try {
    save({ ...state, orders: restoredOrders, groups: restoredGroups });
  } catch {
    state = { ...state, orders: restoredOrders, groups: restoredGroups };
  }
}
const listings = () =>
  supabaseConfigured
    ? [...state.remoteListings, ...state.customListings]
    : [...seedListings, ...state.customListings];
const listing = (id) => listings().find((x) => x.id === id);
const seller = (id) =>
  (supabaseConfigured ? state.remoteSellers : sellers).find(
    (x) => x.id === id,
  ) || {
    id,
    name: t("ร้านตัวอย่าง"),
    intro: t("ผู้ขายในโหมดเดโม"),
    initials: "DE",
  };
const group = (id) => state.groups.find((x) => x.id === id);
const name = (id) =>
  id === state.user?.id
    ? state.user.name
    : state.profiles?.[id]?.name || demoNames[id] || t("สมาชิกเดโม");
const money = (n) => formatSatang(n, locale);
/** The member's Plus subscription: from Supabase, or the demo copy kept in local state. */
function mySubscription(userId = state.user?.id) {
  if (!userId) return null;
  if (supabaseConfigured) return state.remoteSubscription || null;
  return expireSubscription(state.subscriptions?.[userId] || emptySubscription(userId));
}
/** The launch promo (HARN-WITH-JINN): no 2% commission until this date, or null. */
function myFeeWaiverUntil(userId = state.user?.id) {
  if (!userId) return null;
  const until = supabaseConfigured ? state.remoteSubscription?.feeWaiverUntil : state.promos?.[userId]?.waiverUntil;
  return until && new Date(until) > new Date() ? until : null;
}
/** Where the admin sends this person's payouts as a group owner, or null. */
function myPayoutAccount(userId = state.user?.id) {
  if (!userId) return null;
  return supabaseConfigured ? state.remotePayoutAccount || null : state.payoutAccounts?.[userId] || null;
}
const THAI_BANKS = ["กสิกรไทย", "กรุงเทพ", "กรุงไทย", "ไทยพาณิชย์", "กรุงศรีอยุธยา", "ทหารไทยธนชาต (ttb)", "ออมสิน", "ธ.ก.ส.", "อาคารสงเคราะห์", "ยูโอบี", "ซีไอเอ็มบี ไทย", "เกียรตินาคินภัทร", "แลนด์ แอนด์ เฮ้าส์", "ไอซีบีซี (ไทย)", "ทิสโก้"];
const maskNumber = (value = "") => (value.length > 4 ? `${"•".repeat(Math.max(0, value.length - 4))}${value.slice(-4)}` : value);
function payoutAccountSummary(account) {
  if (!account) return "";
  return account.method === "promptpay"
    ? `PromptPay ${maskNumber(account.promptpay_id)} · ${escape(account.account_name)}`
    : `${escape(account.bank_name)} ${maskNumber(account.account_number)} · ${escape(account.account_name)}`;
}
/** Transfers the admin already made to this owner, each with its slip. */
function payoutsReceivedList(g) {
  const rows = g.payoutsReceived || [];
  if (!rows.length) return "";
  return `<div class="payouts-received"><strong>${t("โอนให้คุณแล้ว")}</strong><ul>${rows.map((row) => `<li><span>${shortDate(row.paid_at)}</span><b>${money(Number(row.net_satang))}</b>${row.slip_path ? `<button type="button" class="link-button" data-action="open-payout-slip" data-path="${escape(row.slip_path)}">${t("ดูสลิป")}</button>` : ""}</li>`).join("")}</ul></div>`;
}
/** Reminder shown to group owners who have money coming but no account to receive it. */
const payoutAccountReminder = () =>
  myPayoutAccount() ? "" : `<p class="warning summary-warning"><span class="warning-icon">${icon("alert-circle", 20)}</span><span>${t("ยังไม่มีบัญชีรับเงิน")} ${a("/profile#payout-account", t("เพิ่มบัญชีรับเงิน"))}</span></p>`;
function payoutAccountCard() {
  const account = myPayoutAccount() || {};
  const method = account.method || "promptpay";
  return `<section class="account-card payout-account-card" id="payout-account" aria-labelledby="payout-account-title"><div class="account-card-heading"><div><h2 id="payout-account-title">${t("บัญชีรับเงิน")}</h2><p>${t("สำหรับเจ้าของกลุ่ม แอดมินจะโอนเงินจากกองกลางเข้าบัญชีนี้หลังหักค่าคอม 2% เห็นได้เฉพาะคุณกับแอดมิน")}</p></div>${account.method ? `<span class="chip">${t("บันทึกแล้ว")}</span>` : ""}</div>
    ${account.method ? `<p class="payout-account-current">${icon("check", 16)} ${payoutAccountSummary(account)}</p>` : ""}
    <form id="payout-account-form" class="payout-account-form" data-method="${method}">
      <fieldset class="visibility-picker"><legend>${t("รับเงินผ่าน")}</legend><label><input type="radio" name="method" value="promptpay" ${method === "promptpay" ? "checked" : ""}/><span>PromptPay</span></label><label><input type="radio" name="method" value="bank" ${method === "bank" ? "checked" : ""}/><span>${t("บัญชีธนาคาร")}</span></label></fieldset>
      <label data-payout-field="promptpay">${t("เบอร์โทรหรือเลขบัตรประชาชนที่ผูก PromptPay")}<input name="promptpayId" inputmode="numeric" autocomplete="off" maxlength="17" value="${escape(account.promptpay_id || "")}" placeholder="08x-xxx-xxxx"/></label>
      <label data-payout-field="bank">${t("ธนาคาร")}<select name="bankName">${THAI_BANKS.map((bank) => `<option value="${escape(bank)}" ${account.bank_name === bank ? "selected" : ""}>${escape(bank)}</option>`).join("")}</select></label>
      <label data-payout-field="bank">${t("เลขบัญชี")}<input name="accountNumber" inputmode="numeric" autocomplete="off" maxlength="20" value="${escape(account.account_number || "")}" placeholder="xxx-x-xxxxx-x"/></label>
      <label>${t("ชื่อบัญชี")}<input name="accountName" maxlength="100" autocomplete="name" value="${escape(account.account_name || state.user?.name || "")}" required/></label>
      <button type="submit" class="button primary">${account.method ? t("บันทึกการเปลี่ยนแปลง") : t("บันทึกบัญชีรับเงิน")}</button>
    </form></section>`;
}
/** "plus" while a paid month is running, otherwise "free". */
function subscriptionFor(userId = state.user?.id) {
  const sub = mySubscription(userId);
  if (!sub) return "free";
  return supabaseConfigured ? sub.plan || "free" : effectivePlan(sub);
}
const escape = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const icon = (id, size = 22) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><use href="#i-${id}"/></svg>`;
const icons = `<svg xmlns="http://www.w3.org/2000/svg" style="position:absolute;width:0;height:0;overflow:hidden"><symbol id="i-eye" viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></symbol><symbol id="i-home" viewBox="0 0 24 24"><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M9 21v-7h6v7"/></symbol><symbol id="i-search" viewBox="0 0 24 24"><circle cx="10.8" cy="10.8" r="7"/><path d="m16 16 5 5"/></symbol><symbol id="i-users" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></symbol><symbol id="i-edit" viewBox="0 0 24 24"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></symbol><symbol id="i-trash" viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></symbol><symbol id="i-info" viewBox="0 0 24 24"><circle cx="12" cy="10" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></symbol><symbol id="i-alert-circle" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></symbol><symbol id="i-chat" viewBox="0 0 24 24"><path d="M4 4h16v13H8l-4 3z"/><path d="M8 9h8M8 13h5"/></symbol><symbol id="i-user" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></symbol><symbol id="i-bell" viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 8-3 9h18c0-1-3-2-3-9ZM10 21h4"/></symbol><symbol id="i-arrow" viewBox="0 0 24 24"><path d="M5 12h14m-6-6 6 6-6 6"/></symbol><symbol id="i-check" viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></symbol><symbol id="i-plus" viewBox="0 0 24 24"><path d="M12 4v16M4 12h16"/></symbol><symbol id="i-back" viewBox="0 0 24 24"><path d="m14 5-7 7 7 7"/></symbol><symbol id="i-lock" viewBox="0 0 24 24"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></symbol><symbol id="i-link" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2"/></symbol><symbol id="i-shield" viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></symbol><symbol id="i-sparkles" viewBox="0 0 24 24"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3z"/></symbol><symbol id="i-calc" viewBox="0 0 24 24"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="16" y1="14" x2="16" y2="18"/><path d="M16 10h.01M12 10h.01M8 10h.01M12 14h.01M8 14h.01M12 18h.01M8 18h.01"/></symbol><symbol id="i-trending" viewBox="0 0 24 24"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></symbol><symbol id="i-fire" viewBox="0 0 24 24"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></symbol><symbol id="i-truck" viewBox="0 0 24 24"><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-5l-3-4h-5v10Z"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/></symbol><symbol id="i-package" viewBox="0 0 24 24"><path d="m16.5 9.4-9-5.19M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></symbol><symbol id="i-copy" viewBox="0 0 24 24"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></symbol><symbol id="i-map-pin" viewBox="0 0 24 24"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></symbol><symbol id="i-clock" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></symbol></svg>`;
const a = (href, label, cls = "") =>
  `<a href="${href}" data-link class="${cls}">${label}</a>`;
function go(path) {
  profileMenuOpen = false;
  listingMenuOpen = false;
  if (
    location.pathname === "/groups/create" &&
    path.split("?")[0] !== "/groups/create"
  ) {
    groupImages = [];
    selectedCreateCategories = [];
  }
  if (!/^\/seller\/products\/[^/]+\/edit$/.test(path)) listingImages = [];
  history.pushState({}, "", path);
  render();
  window.scrollTo(0, 0);
}
let authModalActive = false;
let passwordRecoveryPending = false;
let mockupCurrentStep = 1;
let tempSignupData = {};
let groupImages = [];
let selectedCreateCategories = [];
let createGroupStep = 1;
let selectedHomeGroupCategory = "ทั้งหมด";
let listingImages = [];
let listingMap = null;
let secondhandDetailMap = null;
let listingMapMarker = null;
let leafletLoaderPromise = null;
let listingMapReady = false;
let listingMapRequestId = 0;
let lastOsmRequestAt = 0;
const SAMUT_PRAKAN_MARKET_ALIASES = [
  {
    match: /ทิพย์เกสร|ทิพเกสร/i,
    queries: ["Tipgaysorn Plaza", "Tipgaysorn Market"],
  },
];
let imagesLoading = false;
let profileAvatar = "";
let avatarLoading = false;
let groupsLoading = supabaseConfigured;
let groupsError = null;
const groupMessageCache = new Map();
const groupMessageLoadState = new Map();
const groupMessageErrors = new Map();
let groupChatPollTimer = null;
let groupChatPollId = null;
const secondhandChatMessages = new Map();
let secondhandConversationRows = [];
let secondhandChatPollTimer = null;
let secondhandChatPollId = null;
let secondhandConversationListLoadingFor = null;
let secondhandConversationListLoadedFor = null;
let secondhandPendingTimer = null;
const secondhandChatCacheKey = (conversationId) =>
  `${state.user?.id || "guest"}:${conversationId}`;
let syncSupabaseSession = async () => {};
let authSessionSync = null;
let activeSupabaseSession = null;

function isAuthRequired(href) {
  if (!href) return false;
  const path = href.split("?")[0];
  if (
    [
      "/my-groups",
      "/my-orders",
      "/chat",
      "/profile",
      "/notifications",
      "/groups/create",
      "/seller/dashboard",
      "/seller/products/new",
    ].includes(path)
  ) {
    return true;
  }
  if (/^\/chat\/[^/]+$/.test(path)) return true;
  if (/^\/checkout\/secondhand\/[^/]+$/.test(path)) return true;
  if (/^\/groups\/[^/]+\/join$/.test(path)) return true;
  if (/^\/orders\/[^/]+$/.test(path)) return true;
  if (/^\/seller\/products\/[^/]+\/edit$/.test(path)) return true;
  return false;
}

function openAuthModal(step = 1) {
  mockupCurrentStep = step;
  authModalActive = true;
  render();
}

function closeAuthModal() {
  authModalActive = false;
  tempSignupData = {};
  if (isAuthRequired(location.pathname)) {
    go("/");
  } else {
    render();
  }
}

function clearFieldError(inputEl) {
  if (!inputEl) return;
  inputEl.classList.remove("input-error");
  inputEl.removeAttribute("aria-invalid");
  inputEl.removeAttribute("aria-describedby");
  const wrapper = inputEl.closest(".auth-input");
  if (wrapper) wrapper.classList.remove("has-error");
  const label = inputEl.closest("label");
  if (label) {
    label.querySelectorAll(".auth-field-error").forEach((el) => el.remove());
  }
}

function clearFormErrors(form) {
  if (!form) return;
  form
    .querySelectorAll(".input-error")
    .forEach((input) => clearFieldError(input));
  form.querySelectorAll(".auth-field-error").forEach((el) => el.remove());
}

function setFieldError(inputEl, message) {
  if (!inputEl) return;
  clearFieldError(inputEl);
  inputEl.classList.add("input-error");
  inputEl.setAttribute("aria-invalid", "true");
  const errId = inputEl.id
    ? inputEl.id + "-error"
    : "err-" + Math.random().toString(36).slice(2, 7);
  inputEl.setAttribute("aria-describedby", errId);
  const wrapper = inputEl.closest(".auth-input");
  if (wrapper) wrapper.classList.add("has-error");
  const errSpan = document.createElement("span");
  errSpan.className = "auth-field-error";
  errSpan.id = errId;
  errSpan.setAttribute("role", "alert");
  errSpan.innerHTML = `<span class="field-error-icon" aria-hidden="true">⚠️</span><span>${escape(message)}</span>`;
  if (wrapper && wrapper.parentNode) {
    wrapper.insertAdjacentElement("afterend", errSpan);
  } else if (inputEl.parentNode) {
    inputEl.insertAdjacentElement("afterend", errSpan);
  }
}

function setMockupStep(step, triggerElement = null) {
  if (step === 3 && !tempSignupData.email) step = 2;
  mockupCurrentStep = step;
  const root = triggerElement?.closest(".auth-switch");
  (root ? [root] : document.querySelectorAll(".auth-switch")).forEach(
    (panel) => {
      clearFormErrors(panel);
      panel.classList.toggle("is-signup", step !== 1);
      panel.querySelectorAll(".mockup-screen").forEach((screen, index) => {
        screen.hidden = index + 1 !== step;
        screen.classList.toggle("active", index + 1 === step);
      });
      panel.querySelector(".mockup-screen.active h2")?.focus();
    },
  );
}
function fillMockupDemo() {
  const values = {
    "mockup-login-email": "somchai.demo@example.com",
    "mockup-login-pw": "Password123!",
    "mockup-signup-name": "สมชาย ใจดี",
    "mockup-signup-email": "somchai.demo@example.com",
    "mockup-signup-pw": "Password123!",
    "mockup-signup-confirm-pw": "Password123!",
    "mockup-id-card": "",
    "mockup-house-no": "128/45",
    "mockup-village-no": "3",
    "mockup-province": "กรุงเทพมหานคร",
    "mockup-district": "ปทุมวัน",
    "mockup-subdistrict": "ลุมพินี",
    "mockup-alley": "ซอยร่วมฤดี",
    "mockup-road": "เพลินจิต",
    "mockup-postal-code": "10330",
    "mockup-phone": "089-123-4567",
  };
  Object.entries(values).forEach(([id, value]) => {
    const el = document.getElementById(id);
    if (el) el.value = value;
  });

  alertMessage(t("กรอกข้อมูลตัวอย่างใน Mockup เรียบร้อยแล้ว"));
}
function finishAuth(user) {
  if (supabaseConfigured) state = { ...state, user };
  else
    save({ ...state, user, profiles: { ...state.profiles, [user.id]: user } });
  tempSignupData = {};
  authModalActive = false;
  mockupCurrentStep = 1;
  const back = sessionStorage.getItem("harn-return") || "/";
  sessionStorage.removeItem("harn-return");
  go(["/login", "/register"].includes(back.split("?")[0]) ? "/" : back);
  alertMessage(
    t("เข้าสู่ระบบสำเร็จ! ยินดีต้อนรับ {name}", { name: user.name }),
  );
}
function renderPhoneMockup(initialStep = 1, isModal = true) {
  if (!isModal && authModalActive) return "";
  mockupCurrentStep = initialStep;
  const step = initialStep === 3 && !tempSignupData.email ? 2 : initialStep;
  const input = (id, label, type = "text", extra = "") =>
    `<label>${label}<span class="auth-input"><input id="${id}" type="${type}" required ${extra}/>${type === "password" ? `<button type="button" data-action="toggle-mockup-pw" data-target="${id}" aria-label="${t("แสดงหรือซ่อนรหัสผ่าน")}">${icon("eye", 17)}</button>` : ""}</span></label>`;
  const google = supabaseConfigured
    ? `${googleAuthAvailable ? `<button type="button" class="button google-button full" data-action="supabase-google"><b aria-hidden="true">G</b> ${t("ดำเนินการด้วย Google")}</button>` : `<button type="button" class="button google-button full" disabled><b aria-hidden="true">G</b> ${t("ยังไม่ได้เปิดใช้ Google OAuth")}</button>`}<div class="auth-divider"><span>${t("หรือใช้อีเมล")}</span></div>`
    : `<button type="button" class="button google-button full" data-action="mockup-social" data-provider="Google"><b aria-hidden="true">G</b> ${t("ดำเนินการด้วย Google (จำลอง)")}</button><div class="auth-divider"><span>${t("หรือใช้อีเมล")}</span></div>`;
  const addressFields = [
    ["house-no", "บ้านเลขที่", true],
    ["village-no", "หมู่", false],
    ["province", "จังหวัด", true],
    ["district", "อำเภอ", true],
    ["subdistrict", "ตำบล", true],
    ["alley", "ซอย", false],
    ["road", "ถนน", false],
    ["postal-code", "รหัสไปรษณีย์", true],
    ["phone", "เบอร์มือถือ", true],
  ];
  return `<div class="auth-switch ${step !== 1 ? "is-signup" : ""}">
    ${isModal ? `<button class="dialog-close" type="button" data-action="close-auth" aria-label="${t("ปิดหน้าต่าง")}">✕</button>` : ""}
    <aside class="auth-welcome"><span class="auth-wordmark">Harn<span>Khong</span></span><div><h2>${t("หารของด้วยกัน")}</h2><p>${t("เลือกสินค้า สร้างกลุ่ม แล้วชวนเพื่อนมาหาร")}</p><span class="auth-welcome-line"></span><p>${t(supabaseConfigured ? "ยืนยันตัวตนด้วย Supabase Auth" : "บัญชีทดลอง · ไม่มีการยืนยันตัวตนจริง")}</p></div><span>${t("เริ่มได้จากการเลือกสินค้า")}</span></aside>
    <div class="auth-forms">
      <section class="mockup-screen ${step === 1 ? "active" : ""}" ${step !== 1 ? "hidden" : ""}>
        <h2 tabindex="-1">${t("ยินดีต้อนรับกลับ")}</h2><p>${t(supabaseConfigured ? "เข้าสู่ระบบเพื่อไปต่อกับกลุ่มของคุณ" : "เข้าสู่ระบบเดโมเพื่อไปต่อกับกลุ่มของคุณ")}</p>${google}
        <form id="mockup-login-form" class="auth-form" novalidate>
          ${input("mockup-login-email", t("อีเมล"), "email", 'autocomplete="email" maxlength="254"')}
          ${input("mockup-login-pw", t("รหัสผ่าน"), "password", 'autocomplete="current-password"')}
          <button class="button primary full" type="submit">${t("เข้าสู่ระบบ")}</button>
        </form>${supabaseConfigured ? `<button type="button" class="auth-forgot-password" data-action="request-password-reset">${t("ลืมรหัสผ่าน? ตั้งรหัสผ่านทางอีเมล")}</button>` : ""}<p class="auth-switch-prompt">${t("ยังไม่มีบัญชี?")} <button type="button" data-action="mockup-step" data-step="2">${t("สมัครสมาชิก")}</button></p>
      </section>
      <section class="mockup-screen ${step === 2 ? "active" : ""}" ${step !== 2 ? "hidden" : ""}>
        <h2 tabindex="-1">${t("สร้างบัญชีของคุณ")}</h2><p>${t(supabaseConfigured ? "สมัครแล้วตรวจอีเมลเพื่อยืนยันบัญชี" : "สมัครเสร็จแล้วไปกรอกที่อยู่สำหรับเดโม")}</p>${google}
        <form id="mockup-signup-form" class="auth-form" novalidate>
          ${input("mockup-signup-name", t("ชื่อ"), "text", 'autocomplete="name" maxlength="70"')}
          ${input("mockup-signup-email", t("อีเมล"), "email", 'autocomplete="email" maxlength="254"')}
          ${input("mockup-signup-pw", t("รหัสผ่าน"), "password", 'autocomplete="new-password" minlength="4"')}
          ${input("mockup-signup-confirm-pw", t("ยืนยันรหัสผ่าน"), "password", 'autocomplete="new-password"')}
          <button class="button primary full" type="submit">${t("ต่อไป (กรอกที่อยู่)")} ${icon("arrow", 18)}</button>
        </form><p class="auth-switch-prompt">${t("มีบัญชีอยู่แล้ว?")} <button type="button" data-action="mockup-step" data-step="1">${t("เข้าสู่ระบบ")}</button></p>
      </section>
      <section class="mockup-screen ${step === 3 ? "active" : ""}" ${step !== 3 ? "hidden" : ""}>
        <small>${t("ขั้นตอนที่ 2 จาก 2")}</small><h2 tabindex="-1">${t("กรอกที่อยู่")}</h2><p>${t(supabaseConfigured ? "ที่อยู่ส่วนนี้เห็นได้เฉพาะคุณ" : "ใช้ข้อมูลตัวอย่างเท่านั้น ข้อมูลบันทึกในเบราว์เซอร์นี้")}</p>
        <form id="mockup-address-form" class="auth-form" novalidate><div class="form-grid">${addressFields.map(([id, label, required]) => `<label>${t(label)}<input id="mockup-${id}" ${required ? "required" : ""} ${id === "phone" ? 'type="tel" maxlength="12" pattern="[0-9 -]{9,12}" autocomplete="tel"' : id === "postal-code" ? 'inputmode="numeric" pattern="[0-9]{5}" maxlength="5" autocomplete="postal-code"' : 'maxlength="100"'}/></label>`).join("")}</div>${supabaseConfigured ? "" : `<label>${t("เลขบัตรประชาชน (ไม่บังคับ ใช้ข้อมูลจำลองเท่านั้น)")}<input id="mockup-id-card" maxlength="17" inputmode="numeric" autocomplete="off"/></label>`}<button class="button primary full" type="submit">${t("ยืนยันข้อมูล")}</button><button class="button subtle full" type="button" data-action="mockup-step" data-step="2">${t("กลับไปแก้ข้อมูลบัญชี")}</button></form>

      </section>
      <section class="mockup-screen ${step === 4 ? "active" : ""}" ${step !== 4 ? "hidden" : ""}>
        <h2 tabindex="-1">${t("ตั้งรหัสผ่านใหม่")}</h2><p>${t("ตั้งรหัสผ่านเพื่อเข้าใช้ด้วยอีเมลได้ โดยบัญชี Google เดิมยังใช้ได้")}</p>
        <form id="mockup-reset-password-form" class="auth-form" novalidate>
          ${input("mockup-reset-password", t("รหัสผ่านใหม่"), "password", 'autocomplete="new-password" minlength="8"')}
          ${input("mockup-reset-password-confirm", t("ยืนยันรหัสผ่านใหม่"), "password", 'autocomplete="new-password" minlength="8"')}
          <button class="button primary full" type="submit">${t("บันทึกรหัสผ่านใหม่")}</button>
        </form><p class="auth-switch-prompt"><button type="button" data-action="mockup-step" data-step="1">${t("กลับไปเข้าสู่ระบบ")}</button></p>
      </section>
      <footer class="auth-demo-note"><span>${t(supabaseConfigured ? "รหัสผ่านจัดการโดย Supabase Auth" : "เดโมเท่านั้น ไม่เก็บรหัสผ่าน ไม่เชื่อม Google หรือฐานข้อมูล")}</span>${supabaseConfigured ? "" : `<button type="button" data-action="mockup-autofill">${t("ข้อมูลตัวอย่าง")}</button>`}</footer>
    </div>
  </div>`;
}

function requireAuth(path) {
  if (!state.user) {
    sessionStorage.setItem("harn-return", path);
    return false;
  }
  if (supabaseConfigured && !state.user.address) {
    sessionStorage.setItem("harn-return", path);
    tempSignupData = state.user;
    mockupCurrentStep = 3;
    return false;
  }
  return true;
}

function authRequiredView(
  title = t("เข้าสู่ระบบเพื่อดำเนินการต่อ"),
  desc = t("หน้านี้ต้องการการเข้าสู่ระบบเพื่อใช้งาน"),
) {
  return `
    <div class="auth-required-container">
      <div class="auth-required-header">
        <span class="auth-lock-badge">${icon("lock", 24)}</span>
        <h1>${escape(title)}</h1>
        <p>${escape(desc)}</p>
      </div>
      <div class="auth-page-wrapper" style="padding-top:0;">
        ${renderPhoneMockup(supabaseConfigured && state.user && !state.user.address ? 3 : 1, false)}
      </div>
      <div class="auth-return-center">
        <a href="/" data-link class="auth-return-link">← ${t("กลับสู่หน้าหลัก HarnKhong")}</a>
      </div>
    </div>
  `;
}
function notice(
  title,
  body,
  href = "/notifications",
  recipient = state.user?.id,
) {
  if (!recipient) return;
  state.notifications.unshift({
    id: crypto.randomUUID(),
    recipient,
    title,
    body,
    href,
    read: false,
    at: new Date().toISOString(),
  });
  save();
}
function updateGroup(next) {
  state.groups = state.groups.map((g) => (g.id === next.id ? next : g));
  save();
}
const orderFor = (id) => state.orders.find((o) => o.groupId === id);
function updateOrder(next) {
  const orders = state.orders.some((o) => o.id === next.id)
    ? state.orders.map((o) => (o.id === next.id ? next : o))
    : [...state.orders, next];
  const last = next.history.at(-1),
    recipients = [
      ...new Set([
        ...next.members,
        ...(next.sellerId === "s1"
          ? ["demo-seller"]
          : next.sellerId === "s2"
            ? ["demo-seller-s2"]
            : []),
      ]),
    ];
  const notifications = recipients.map((recipient) => ({
    id: crypto.randomUUID(),
    recipient,
    title: t("orderEvent_" + last.type),
    body: orderStatus(next.status) + " · " + t("จำลองเท่านั้น"),
    href: `/orders/${next.groupId}`,
    read: false,
    at: last.at,
  }));
  save({
    ...state,
    orders,
    groups: lockOrderedGroups(state.groups, orders),
    notifications: [...notifications, ...state.notifications],
  });
}
function orderChanged(next, feedback) {
  updateOrder(next);
  render();
  alertMessage(feedback);
}
const dateTime = (at) =>
  at
    ? new Date(at).toLocaleString(locale === "en" ? "en-GB" : "th-TH")
    : t("ไม่ทราบเวลาเดิม");
const actorName = (id) =>
  id === state.user?.id
    ? state.user.name
    : state.profiles?.[id]?.name ||
      demoNames[id] ||
      (id === "demo-seller"
        ? seller("s1").name
        : id === "demo-seller-s2"
          ? seller("s2").name
          : id || t("ระบบนำเข้าข้อมูลเดิม"));
const orderStatus = (status) => t("orderStatus_" + status);
const paymentStatus = (status) => t("paymentStatus_" + status);
/**
 * Web notifications: a toast that drops in at the top of the screen.
 * type: "success" (default), "error", "info" or "warning". Errors stay longer and use role="alert".
 * The stack lives in a manual popover so it shows above open dialogs too.
 */
const TOAST_ICONS = { success: "check", error: "alert-circle", warning: "alert-circle", info: "info" };
function toastStack() {
  let stack = document.querySelector("#toast-stack");
  if (!stack) {
    stack = document.createElement("div");
    stack.id = "toast-stack";
    stack.className = "toast-stack";
    if ("popover" in HTMLElement.prototype) stack.setAttribute("popover", "manual");
    document.body.append(stack);
  }
  // Re-open on top so it sits above any dialog opened after it.
  if (stack.showPopover) {
    try { if (stack.matches(":popover-open")) stack.hidePopover(); stack.showPopover(); } catch { /* not supported */ }
  }
  return stack;
}
function dismissToast(toast) {
  if (!toast || toast.dataset.leaving) return;
  toast.dataset.leaving = "1";
  toast.classList.add("is-leaving");
  setTimeout(() => {
    toast.remove();
    const stack = document.querySelector("#toast-stack");
    if (stack && !stack.children.length) {
      try { stack.hidePopover?.(); } catch { /* not supported */ }
    }
  }, 220);
}
function alertMessage(msg, type = "success") {
  const text = String(msg ?? "").trim();
  if (!text) return;
  const kind = TOAST_ICONS[type] ? type : "success";
  const stack = toastStack();
  // The same message again just restarts its timer instead of stacking a copy.
  const existing = [...stack.children].find((node) => node.dataset.message === text && !node.dataset.leaving);
  if (existing) existing.remove();
  const toast = document.createElement("div");
  toast.className = `app-toast is-${kind}`;
  toast.dataset.message = text;
  toast.setAttribute("role", kind === "error" || kind === "warning" ? "alert" : "status");
  const duration = kind === "error" || kind === "warning" ? 6000 : 3800;
  toast.style.setProperty("--toast-duration", `${duration}ms`);
  toast.innerHTML = `<span class="app-toast-icon">${icon(TOAST_ICONS[kind], 18)}</span><p class="app-toast-text">${escape(text)}</p><button type="button" class="app-toast-close" aria-label="${t("ปิดการแจ้งเตือน")}">✕</button><span class="app-toast-bar" aria-hidden="true"></span>`;
  toast.querySelector(".app-toast-close").addEventListener("click", () => dismissToast(toast));
  stack.prepend(toast);
  while (stack.children.length > 4) dismissToast(stack.lastElementChild);
  let timer = setTimeout(() => dismissToast(toast), duration);
  toast.addEventListener("mouseenter", () => clearTimeout(timer));
  toast.addEventListener("mouseleave", () => { clearTimeout(timer); timer = setTimeout(() => dismissToast(toast), 1800); });
}
const alertError = (msg) => alertMessage(msg, "error");
const alertWarning = (msg) => alertMessage(msg, "warning");
const title = (heading, sub = "") =>
  `<div class="page-heading"><h1>${heading}</h1>${sub ? `<p>${sub}</p>` : ""}</div>`;
const art = (item) =>
  `<div class="product-art ${escape(item.art)}">${item.mark ? `<span>${escape(item.mark)}</span>` : ""}<small>${escape(t(item.category))}</small></div>`;
function gallery(images = [], editable = false) {
  images = images.filter(isLocalImage);
  if (!images.length) return "";
  return `<div class="group-gallery ${editable ? "editable" : ""}" aria-label="${t("รูปกลุ่ม")}"><div class="gallery-main"><img src="${images[0]}" alt="${t("รูปกลุ่ม")} 1"/><span class="gallery-counter">1 / ${images.length}</span></div><div class="gallery-thumbnails">${images.map((image, index) => `<div><button type="button" data-action="gallery-select" data-index="${index}" ${editable ? 'data-editable="true"' : ""} aria-label="${t("ดูรูปที่ {number}", { number: index + 1 })}" aria-pressed="${index === 0}"><img src="${image}" alt=""/></button>${editable ? `<button class="image-remove" type="button" data-action="image-remove" data-index="${index}" aria-label="${t("ลบรูปที่ {number}", { number: index + 1 })}">✕</button>` : ""}</div>`).join("")}</div>${editable ? `<small>${t("รูปแรกเป็นภาพปก แตะรูปย่อเพื่อเลือกภาพปก")}</small>` : ""}</div>`;
}
function profileDialog() {
  const user = state.user;
  return `<dialog id="profile-dialog" class="profile-dialog" aria-labelledby="profile-dialog-title"><form id="profile-form" class="auth-form"><header><div><h2 id="profile-dialog-title">${t("แก้ไขโปรไฟล์")}</h2><p>${t(supabaseConfigured ? "แก้ไขชื่อและข้อมูลแนะนำตัว" : "ปรับข้อมูลที่แสดงในบัญชีเดโมของคุณ")}</p></div><button type="button" class="dialog-close" data-action="close-dialog" aria-label="${t("ปิดหน้าต่าง")}">✕</button></header><div class="profile-cover"></div><div class="profile-avatar-editor"><span class="avatar large" id="profile-avatar-preview">${profileAvatarMarkup(user)}</span><label class="button outline">${t("เปลี่ยนรูป")}<input id="profile-avatar" type="file" accept="image/jpeg,image/png,image/webp"/></label><button class="button subtle" type="button" data-action="avatar-remove">${t("ลบรูป")}</button></div><p id="avatar-status" role="status"></p><p class="field-help">${t(supabaseConfigured ? "JPG, PNG, WebP ไม่เกิน 5 MB · บันทึกกับโปรไฟล์" : "JPG, PNG, WebP ไม่เกิน 5 MB · บันทึกเฉพาะในเครื่อง")}</p><label>${t("ชื่อ")}<input name="name" value="${escape(user.name)}" maxlength="70" required autocomplete="name"/></label><label>${t("อีเมล")}<input name="email" type="email" value="${escape(user.email || "")}" maxlength="254" autocomplete="email" ${supabaseConfigured ? "readonly" : ""}/></label>${supabaseConfigured ? `<small class="field-help">อีเมลนี้มาจากบัญชี Google ที่เข้าสู่ระบบ หากต้องการใช้อีเมลอื่น ให้ออกจากระบบแล้วเข้าสู่ระบบด้วยบัญชี Google นั้น</small>` : ""}<label>${t("เกี่ยวกับฉัน")}<textarea name="bio" maxlength="160" rows="3">${escape(user.bio || "")}</textarea></label><small id="bio-counter">${(user.bio || "").length} / 160</small><footer class="dialog-footer"><button type="button" class="button outline" data-action="close-dialog">${t("ยกเลิก")}</button><button type="submit" class="button primary">${t("บันทึกการเปลี่ยนแปลง")}</button></footer></form></dialog>`;
}
function profileAvatarSrc(value) {
  if (isLocalImage(value)) return value;
  if (typeof value !== "string" || !value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  if (supabaseConfigured && value.includes("/"))
    return supabase.storage.from("avatars").getPublicUrl(value).data.publicUrl;
  return "";
}
function profileAvatarMarkup(user) {
  const src = profileAvatarSrc(user?.avatar);
  return src
    ? `<img src="${escape(src)}" alt=""/>`
    : escape(user?.name?.slice(0, 1) || "?");
}
const demoReference = () =>
  `REF-${new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, "")
    .slice(0, 14)}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`;
const demoAcceptUrl = (
  reference,
  amount,
  { expires, group, revision, secondhandListing, orderNumber } = {},
) => {
  const url = new URL("/demo-accept", location.origin);
  url.searchParams.set("ref", reference);
  url.searchParams.set("amount", String(amount));
  if (expires) url.searchParams.set("expires", String(expires));
  if (group) url.searchParams.set("group", group);
  if (revision !== undefined)
    url.searchParams.set("revision", String(revision));
  if (secondhandListing) {
    url.searchParams.set("secondhand", secondhandListing);
    url.searchParams.set("order", orderNumber || "");
  }
  return url;
};
function startDemoCountdown(container, expiresAt) {
  const display = container?.querySelector(".demo-countdown");
  if (!display || !Number.isFinite(expiresAt)) return;
  let timer = null;
  const tick = () => {
    if (!display.isConnected) {
      if (timer) clearInterval(timer);
      return;
    }
    const remaining = Math.max(0, expiresAt - Date.now()),
      seconds = Math.floor(remaining / 1000);
    display.textContent = `${String(Math.floor(seconds / 3600)).padStart(2, "0")} : ${String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")} : ${String(seconds % 60).padStart(2, "0")}`;
    if (!remaining) {
      container
        .querySelector('[data-action="accept-demo-amount"]')
        ?.setAttribute("disabled", "");
      const notice = container.querySelector(".demo-expired-message");
      if (notice) notice.hidden = false;
      if (timer) clearInterval(timer);
    }
  };
  tick();
  timer = setInterval(tick, 1000);
  container.addEventListener("close", () => clearInterval(timer), {
    once: true,
  });
}
async function refreshSecondhandCheckoutQr(form) {
  const qr = form?.querySelector("#secondhand-checkout-qr");
  if (!qr) return;
  const quantity = Math.max(
    1,
    Number(form.querySelector('[name="quantity"]')?.value) || 1,
  );
  const delivery = form.querySelector('[name="delivery"]')?.value;
  const shippingFee =
    delivery === "จัดส่ง" ? Number(form.dataset.shippingFee) || 0 : 0;
  const amount = Number(form.dataset.price) * quantity + shippingFee;
  qr.dataset.amount = String(amount);
  try {
    qr.src = await QRCode.toDataURL(
      demoAcceptUrl(qr.dataset.reference, amount, {
        expires: Number(qr.dataset.expires),
        secondhandListing: form.dataset.id,
        orderNumber: form.dataset.orderNumber,
      }).href,
      {
        errorCorrectionLevel: "M",
        margin: 2,
        width: 420,
        color: { dark: "#092847", light: "#ffffff" },
      },
    );
  } catch {
    /* Keep checkout usable if QR generation is temporarily unavailable. */
  }
}
function initializeSecondhandCheckout() {
  const form = document.querySelector("#secondhand-checkout-form");
  if (!form) return;
  const product = listing(form.dataset.id);
  const shippingFee = Number(product?.deliveryFee) || 0;
  form.dataset.shippingFee = String(shippingFee);
  const deliverySelect = form.querySelector('[name="delivery"]');
  for (const option of deliverySelect?.options || []) {
    option.textContent =
      option.value === "จัดส่ง"
        ? t("จัดส่ง · ค่าส่ง {amount}", { amount: money(shippingFee) })
        : t("รับสินค้าเอง · ไม่มีค่าส่ง");
  }
  const amountBox = form.querySelector(".checkout-amount");
  if (amountBox && !form.querySelector(".checkout-shipping-breakdown")) {
    amountBox.insertAdjacentHTML(
      "beforebegin",
      `<div class="checkout-shipping-breakdown"><span>${t("ค่าสินค้า")}</span><b data-checkout-subtotal></b><span>${t("ค่าจัดส่ง")}</span><b data-checkout-shipping></b></div>`,
    );
  }
  updateSecondhandCheckoutSummary(form);
  void refreshSecondhandCheckoutQr(form);
  startDemoCountdown(form, Number(form.dataset.expires));
}
function updateSecondhandCheckoutSummary(form) {
  if (!form) return;
  const quantity = Math.max(
    1,
    Number(form.querySelector('[name="quantity"]')?.value) || 1,
  );
  const subtotal = Number(form.dataset.price) * quantity;
  const shippingFee =
    form.querySelector('[name="delivery"]')?.value === "จัดส่ง"
      ? Number(form.dataset.shippingFee) || 0
      : 0;
  const total = subtotal + shippingFee;
  const subtotalEl = form.querySelector("[data-checkout-subtotal]");
  const shippingEl = form.querySelector("[data-checkout-shipping]");
  if (subtotalEl) subtotalEl.textContent = money(subtotal);
  if (shippingEl) shippingEl.textContent = money(shippingFee);
  const totalEl = form.querySelector("#secondhand-checkout-total");
  if (totalEl) totalEl.textContent = money(total);
  const qr = form.querySelector("#secondhand-checkout-qr");
  if (qr) qr.dataset.amount = String(total);
}
function paymentDialog(order, reference) {
  const amount = order.payments[state.user.id].amountSatang;
  const expires = Date.now() + 5 * 60 * 60 * 1000;
  return `<dialog id="payment-dialog" class="payment-dialog share-approval-dialog" aria-labelledby="payment-title"><div class="payment-head"><span class="chip">${t("จำลองเท่านั้น")}</span><button type="button" class="dialog-close" data-action="close-dialog" aria-label="${t("ปิดหน้าต่าง")}">✕</button></div><h2 id="payment-title">${t("สแกน QR เพื่อยืนยันยอด")}</h2><p>${t("สแกนด้วยโทรศัพท์เพื่อตรวจสอบและยอมรับยอด")}</p><div class="demo-qr"><img id="payment-qr" data-reference="${escape(reference)}" data-amount="${amount}" data-expires="${expires}" alt="${t("QR สำหรับยอมรับยอดจำลอง")}"/></div><div class="approval-amount-panel"><small>${t("ยอดชำระจำลอง")}</small><strong class="payment-amount">${money(amount)}</strong></div><div class="demo-expiry-box"><span>${t("กรุณายอมรับภายใน")}<b>5 ${t("ชั่วโมง")}</b></span><strong class="demo-countdown">05 : 00 : 00</strong></div><small class="demo-expired-message" hidden>${t("หมดเวลายอมรับ กรุณาสร้าง QR ใหม่")}</small><div class="demo-reference-row"><span>${t("รหัสอ้างอิง")}</span><b>${escape(reference)}</b></div><div class="demo-pending-status"><span>${t("สถานะการยืนยัน")}</span><b>${t("รอยืนยัน")}</b></div><div class="demo-only-note">${t("การยืนยันนี้เป็นการยอมรับจำนวนเงินจำลองเท่านั้น ไม่มีการชำระหรือเก็บเงินจริง")}</div></dialog>`;
}
/** Small slip picker for the checkout dialog: the slip goes to the admin payment queue. */
function checkoutSlipField() {
  const localNow = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  return `<div class="checkout-slip"><label class="checkout-slip-file">${icon("copy", 16)}<span data-payment-slip-status>${supabaseConfigured ? t("แนบสลิป (JPG, PNG, WebP ไม่เกิน 8 MB)") : t("แนบสลิป (ไม่บังคับในโหมดเดโม)")}</span><input type="file" accept="image/jpeg,image/png,image/webp" data-payment-slip-input/></label><label class="checkout-slip-time"><small>${t("เวลาที่โอน")}</small><input type="datetime-local" data-payment-transfer-time value="${localNow}"/></label></div>`;
}
/** Upload a slip for the current group revision and file it for admin review. */
async function reportGroupSlip(id, revision, file, transferredAt) {
  const extension = ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" })[file.type];
  const slipPath = `${state.user.id}/${id}/${revision}/${crypto.randomUUID()}.${extension}`;
  const { error: uploadError } = await supabase.storage.from("group-payment-slips").upload(slipPath, file, {
    cacheControl: "3600", upsert: false, contentType: file.type,
  });
  if (uploadError) throw uploadError;
  try {
    await reportSupabaseGroupPayment(id, revision, slipPath, transferredAt.toISOString());
  } catch (error) {
    await supabase.storage.from("group-payment-slips").remove([slipPath]);
    throw error;
  }
}
function slipFromPanel(panel, { required }) {
  const file = panel?.querySelector("[data-payment-slip-input]")?.files?.[0] || null,
    transferTime = panel?.querySelector("[data-payment-transfer-time]")?.value,
    transferredAt = new Date(transferTime || "");
  if (!file && !required) return null;
  if (!file || !["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 8 * 1024 * 1024)
    throw new Error(t("กรุณาแนบสลิป JPG, PNG หรือ WebP ขนาดไม่เกิน 8 MB"));
  if (!transferTime || Number.isNaN(transferredAt.valueOf()) || transferredAt > new Date(Date.now() + 10 * 60 * 1000))
    throw new Error(t("กรุณาระบุวันและเวลาที่โอนให้ถูกต้อง"));
  return { file, transferredAt };
}
function shareApprovalDialog(amount, g, p) {
  const addr = state.user?.address || {};
  const addressParts = [
    [t("บ้านเลขที่"), addr.houseNo],
    [t("หมู่"), addr.villageNo],
    [t("ซอย"), addr.alley],
    [t("ถนน"), addr.road],
    [t("ตำบล"), addr.subdistrict],
    [t("อำเภอ"), addr.district],
    [t("จังหวัด"), addr.province],
    [t("รหัสไปรษณีย์"), addr.postalCode],
  ].filter(([, value]) => String(value || "").trim());
  const isDigitalProduct = p?.productDetails?.type === "digital";
  const coverImage = isDigitalProduct
    ? p?.images?.[0] || p?.image
    : p?.images?.[0] || p?.image || g?.images?.[0];
  const itemImage = coverImage
    ? `<img src="${escape(coverImage)}" alt="${escape(p?.title || g.name)}"/>`
    : `<div class="checkout-product-art ${isDigitalProduct ? "is-digital" : ""}">${art({ ...p, category: g.category || p?.category })}</div>`;
  return `<dialog id="share-approval-dialog" class="payment-dialog share-approval-dialog" aria-labelledby="share-approval-title"><div class="checkout-page-head"><div><h2 id="share-approval-title">${t("สั่งซื้อ (หารของ)")}</h2></div><button type="button" class="dialog-close" data-action="close-dialog" aria-label="${t("ปิดหน้าต่าง")}">✕</button></div><div class="checkout-steps"><span class="active">1 · ${t("ตรวจสอบข้อมูล")}</span><i></i><span class="active">2 · ${t("ยืนยันยอด")}</span><i></i><span>3 · ${t("เสร็จสิ้น")}</span></div><div class="checkout-layout"><div class="checkout-info-column"><section class="checkout-panel"><h3>${icon("map-pin", 20)} ${t("ที่อยู่ในการจัดส่ง")}</h3><div class="checkout-address"><div class="checkout-address-contact"><strong>${escape(state.user?.name || "—")}</strong><span>${escape(addr.phone || "—")}</span></div>${addressParts.length ? `<div class="checkout-address-details">${addressParts.map(([label, value]) => `<span><small>${escape(label)}</small><b>${escape(value)}</b></span>`).join("")}</div>` : `<p>${t("ยังไม่ได้ระบุที่อยู่")}</p>`}</div></section><section class="checkout-panel"><h3>${icon("package", 20)} ${t("รายละเอียดสินค้า")}</h3><div class="checkout-product">${itemImage}<div><strong>${escape(p?.title || g.name)}</strong><span>${t("กลุ่มหาร")}: ${escape(g.name)}</span><span>${escape(p?.description || t("สินค้าในกลุ่มหารของ"))}</span></div><b>${money(amount)}</b></div></section><section class="checkout-panel checkout-note"><h3>${icon("edit", 20)} ${t("หมายเหตุถึงผู้จัดกลุ่ม")}</h3><textarea maxlength="200" placeholder="${t("เช่น สีที่ต้องการ / รายละเอียดเพิ่มเติม...")}" aria-label="${t("หมายเหตุถึงผู้จัดกลุ่ม")}"></textarea><small>0 / 200</small></section></div><section class="checkout-panel checkout-pay-panel"><h3>${icon("package", 22)} ${t("ชำระเงิน")}</h3><p>${t("สแกน QR เพื่อชำระเงิน")}</p><div class="checkout-qr-row bank-transfer-qr-row share-approval-bank-qr"><div class="bank-payment-qr-frame"><img src="${BANK_PAYMENT_QR_SRC}" alt="${t("QR สำหรับโอนเงินเข้าบัญชี")}"/></div><div class="checkout-bank"><strong>${t("QR บัญชีรับเงิน")}</strong><span>${t("ชื่อบัญชีรับโอน")}</span><b>${BANK_PAYMENT_RECIPIENT}</b><small>${t("ยอดส่วนของคุณ")}: ${money(amount)}</small></div></div><div class="checkout-amount"><span>${t("ยอดชำระ")} (${t("ส่วนของคุณ")})</span><strong>${money(amount)}</strong></div><p class="checkout-payment-report-note">${t("หลังโอนเงินจริงแล้ว แนบสลิปแล้วกดปุ่มด้านล่างเพื่อแจ้งแอดมินตรวจยอด")}</p>${checkoutSlipField()}<button class="button primary full" type="button" data-action="confirm-share-amount" data-slip-submit data-id="${escape(g.id)}" data-revision="${Number(g.revision)}" ${supabaseConfigured ? "disabled" : ""}>${t("โอนแล้ว แจ้งแอดมินตรวจยอด")}</button></section></div></dialog>`;
}
function demoApprovalPage(success = false) {
  const params = new URLSearchParams(location.search),
    reference = (params.get("ref") || "").slice(0, 80),
    amount = Number(params.get("amount"));
  if (!reference || !Number.isSafeInteger(amount) || amount < 0)
    return `<section class="demo-approval-page"><div class="demo-approval-card"><h1>${t("QR ไม่ถูกต้อง")}</h1>${a("/explore", t("กลับหน้าหลัก"), "button primary full")}</div></section>`;
  const expires = Number(params.get("expires")),
    groupId = params.get("group") || "",
    revision = Number(params.get("revision"));
  const expired =
    Number.isFinite(expires) && expires > 0 && Date.now() >= expires;
  const linkedGroup = group(groupId),
    needsLogin = !!(supabaseConfigured && groupId && !state.user),
    wrongMember = !!(
      supabaseConfigured &&
      groupId &&
      state.user &&
      !linkedGroup?.members.includes(state.user.id)
    );
  let acceptedRecord = null;
  try {
    acceptedRecord = JSON.parse(
      localStorage.getItem(`harnkhong-demo-acceptance:${reference}`) || "null",
    );
  } catch {
    /* Treat unavailable storage as not yet accepted. */
  }
  success = success && !expired && acceptedRecord?.amount === amount;
  if (success && params.get("secondhand"))
    return secondhandPurchaseSuccessPage(
      params.get("secondhand"),
      params.get("order") || reference,
      amount,
      acceptedRecord.acceptedAt,
    );
  if (params.get("secondhand"))
    return secondhandPaymentApprovalPage(
      reference,
      amount,
      expires,
      params.get("secondhand"),
      params.get("order") || reference,
      expired,
    );
  const acceptedAt = Number(acceptedRecord?.acceptedAt);
  const acceptedDate =
    success && Number.isFinite(acceptedAt)
      ? new Date(acceptedAt).toLocaleString(locale === "en" ? "en-GB" : "th-TH")
      : "—";
  const accessNotice = needsLogin
    ? t("เข้าสู่ระบบด้วยบัญชีสมาชิกของกลุ่มเพื่อยืนยันยอด")
    : wrongMember
      ? t("บัญชีนี้ไม่ได้เป็นสมาชิกกลุ่ม จึงยืนยันยอดนี้ไม่ได้")
      : "";
  const accessAction = needsLogin
    ? a("/login", t("เข้าสู่ระบบ"), "button primary full demo-login-link")
    : "";
  return `<section class="demo-approval-page ${success ? "is-success" : ""}" ${!success && expires ? `data-demo-expiry="${expires}"` : ""}><article class="demo-approval-card"><span class="chip">${t("ยืนยันยอด")}</span>${success ? `<div class="approval-success-icon" aria-hidden="true">✓</div><h1>${t("ยืนยันยอดสำเร็จ!")}</h1><p>${t("บันทึกการยืนยันยอดเรียบร้อยแล้ว")}</p>` : `<h1>${expired ? t("QR หมดอายุแล้ว") : t("ตรวจสอบยอดก่อนยอมรับ")}</h1><p>${expired ? t("QR นี้หมดเวลายอมรับแล้ว กรุณาขอ QR ใหม่") : t("โปรดตรวจสอบจำนวนเงินก่อนกดยอมรับ")}</p>`}<div class="approval-amount-panel"><small>${t("ยอดที่ยืนยัน")}</small><strong class="payment-amount">${money(amount)}</strong></div>${success ? `<div class="demo-success-details"><div><span>${t("รหัสอ้างอิง")}</span><b>${escape(reference)}</b></div><div><span>${t("วันที่และเวลา")}</span><b>${escape(acceptedDate)}</b></div><div><span>${t("ช่องทาง")}</span><b>${t("QR ตัวกลาง")}</b></div><div><span>${t("สถานะ")}</span><b class="demo-success-status">● ${t("สำเร็จ")}</b></div></div>` : `<div class="demo-phone-expiry"><span>${t("เวลาที่เหลือ")}</span><strong class="demo-countdown">05 : 00 : 00</strong></div><small class="demo-expired-message" ${expired ? "" : "hidden"}>${t("หมดเวลายอมรับ กรุณาสร้าง QR ใหม่")}</small><small>${t("รหัสอ้างอิง")}: ${escape(reference)}</small><div class="demo-pending-status"><span>${t("สถานะการยืนยัน")}</span><b>${t("รอยืนยัน")}</b></div>`}<p class="demo-approval-notice">${t("QR นี้ใช้บันทึกการยืนยันยอดส่วนแบ่ง ไม่ใช่การแจ้งโอนเงิน")}</p>${accessNotice ? `<p class="demo-access-notice">${accessNotice}</p>${accessAction}` : success ? a("/", `${icon("home", 18)} ${t("กลับหน้าหลัก")}`, "button outline full") : expired || wrongMember ? "" : `<button type="button" class="button primary full" data-action="accept-demo-amount" data-ref="${escape(reference)}" data-amount="${amount}" data-expires="${expires}" data-group="${escape(groupId)}" data-revision="${revision}">${t("ยอมรับยอดนี้")}</button>`}</article></section>`;
}
function leaveGroupDialog(g, currentShare) {
  return `<dialog id="leave-group-dialog" class="leave-group-dialog" aria-labelledby="leave-group-title">
    <div class="leave-modal-inner">
      <div class="leave-modal-head">
        <div class="leave-modal-badge" aria-hidden="true">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
            <polyline points="16 17 21 12 16 7"/>
            <line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
        </div>
        <button type="button" class="dialog-close" data-action="close-dialog" aria-label="${t("ปิดหน้าต่าง")}">✕</button>
      </div>

      <h2 id="leave-group-title" class="leave-modal-title">${t("ยืนยันออกจากกลุ่ม")}</h2>
      <p class="leave-modal-subtitle">${t("คุณแน่ใจหรือไม่ว่าต้องการออกจากกลุ่มนี้?")}</p>

      <div class="leave-group-preview">
        <div class="leave-group-meta">
          <small>${t("กลุ่ม")}</small>
          <strong title="${escape(g.name)}">${escape(g.name)}</strong>
        </div>
        <div class="leave-group-share-box">
          <small>${t("ยอดส่วนแบ่งของคุณ")}</small>
          <strong>${money(currentShare)}</strong>
        </div>
      </div>

      <div class="leave-impact-box">
        <div class="leave-impact-title">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>
            <line x1="12" y1="9" x2="12" y2="13"/>
            <line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <span>${t("สิ่งที่ควรรู้ก่อนออกจากกลุ่ม")}</span>
        </div>
        <ul class="leave-impact-list">
          <li>${t("สมาชิกที่เหลือจะต้องยืนยันยอดใหม่ เนื่องจากยอดหารจะถูกคำนวณใหม่")}</li>
          <li>${t("คำยืนยันยอดรอบล่าสุดของคุณจะถูกยกเลิกทันที")}</li>
          <li>${t("หากออกจากกลุ่มแล้ว ต้องการกลับเข้ากลุ่มใหม่ จะต้องรอให้มีที่ว่าง")}</li>
        </ul>
      </div>

      <div class="leave-modal-actions">
        <button type="button" class="button outline" data-action="close-dialog">${t("ยกเลิก")}</button>
        <button type="button" class="button danger" data-action="confirm-leave" data-id="${g.id}">${t("ออกจากกลุ่ม")}</button>
      </div>
    </div>
  </dialog>`;
}
function deleteGroupDialog(g) {
  const memberCount = g.members?.length || 1;
  return `<dialog id="delete-group-dialog" class="leave-group-dialog" aria-labelledby="delete-group-title">
    <div class="leave-modal-inner">
      <div class="leave-modal-head">
        <div class="leave-modal-badge" aria-hidden="true">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            <line x1="10" y1="11" x2="10" y2="17"/>
            <line x1="14" y1="11" x2="14" y2="17"/>
          </svg>
        </div>
        <button type="button" class="dialog-close" data-action="close-dialog" aria-label="${t("ปิดหน้าต่าง")}">✕</button>
      </div>

      <h2 id="delete-group-title" class="leave-modal-title">${t("ยืนยันลบห้อง")}</h2>
      <p class="leave-modal-subtitle">${t("คุณแน่ใจหรือไม่ว่าต้องการลบห้องนี้? ข้อมูลห้องจะถูกลบออกจากระบบอย่างถาวร")}</p>

      <div class="leave-group-preview">
        <div class="leave-group-meta">
          <small>${t("ห้องที่จะลบ")}</small>
          <strong title="${escape(g.name)}">${escape(g.name)}</strong>
        </div>
        <div class="leave-group-share-box">
          <small>${t("จำนวนสมาชิก")}</small>
          <strong>${t("สมาชิก {count} / {capacity} คน", { count: memberCount, capacity: g.capacity })}</strong>
        </div>
      </div>

      <div class="leave-impact-box">
        <div class="leave-impact-title">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>
            <line x1="12" y1="9" x2="12" y2="13"/>
            <line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <span>${t("สิ่งที่ควรรู้ก่อนลบห้อง")}</span>
        </div>
        <ul class="leave-impact-list">
          <li>${t("ห้องนี้จะถูกปิดและนำออกจากรายการค้นหาทันที")}</li>
          <li>${t("สมาชิกทุกคนในห้องจะได้รับแจ้งเตือนว่าห้องถูกลบ")}</li>
          <li>${t("ประวัติการแชตและคำยืนยันยอดของห้องนี้จะไม่สามารถกู้คืนได้")}</li>
        </ul>
      </div>

      <div class="leave-modal-actions">
        <button type="button" class="button outline" data-action="close-dialog">${t("ยกเลิก")}</button>
        <button type="button" class="button danger" data-action="confirm-delete-group" data-id="${escape(g.id)}">${t("ยืนยันลบห้อง")}</button>
      </div>
    </div>
  </dialog>`;
}
function transferGroupDialog(g) {
  const members = g.members.filter((userId) => userId !== state.user?.id);
  const options = members
    .map(
      (userId) =>
        `<option value="${escape(userId)}">${escape(name(userId))}</option>`,
    )
    .join("");
  return `<dialog id="transfer-group-dialog" class="payment-dialog" aria-labelledby="transfer-group-title"><div class="payment-head"><span class="chip">${t("โอนหัวหน้ากลุ่ม")}</span><button type="button" class="dialog-close" data-action="close-dialog" aria-label="${t("ปิดหน้าต่าง")}">✕</button></div><h2 id="transfer-group-title">${t("เลือกหัวหน้ากลุ่มคนใหม่")}</h2><p>${t("สมาชิกใหม่จะได้รับสิทธิ์จัดการกลุ่มแทนคุณ")}</p><form id="transfer-group-form" data-id="${escape(g.id)}"><label>${t("สมาชิก")}<select name="memberId" required>${options}</select></label><footer class="dialog-footer"><button type="button" class="button outline" data-action="close-dialog">${t("ยกเลิก")}</button><button type="submit" class="button primary">${t("ยืนยันโอนสิทธิ์")}</button></footer></form></dialog>`;
}
function listingCard(p) {
  const groups = state.groups.filter(
    (g) =>
      g.listingId === p.id &&
      g.visibility === "public" &&
      g.status !== "cancelled" &&
      g.members.length < g.capacity &&
      !g.orderId,
  );
  const g = groups[0];
  const destination = g ? `/groups/${g.id}` : `/products/${p.id}`;
  const s = seller(p.sellerId);
  return `
    <article class="listing-card">
      <div class="card-media-wrapper">
        ${a(destination, art(p), "art-link")}
        <div class="card-floating-badge">
          <span class="chip-kind">${escape(t(p.kind))}</span>
          <span class="chip-cat">${escape(t(p.category))}</span>
        </div>
        ${groups.length ? `<span class="chip-live-groups">${icon("users", 13)} ${t("เปิดรับ {count} กลุ่ม", { count: groups.length })}</span>` : `<span class="chip-new-group">${icon("sparkles", 13)} ${t("เปิดกลุ่มแรก")}</span>`}
      </div>
      <div class="listing-copy">
        <div class="seller-store-line">
          <span class="seller-store-dot"></span>
          ${a(`/shops/${p.sellerId}`, `<b>${escape(s.name)}</b>`)}
        </div>
        ${a(destination, `<h3 class="listing-title">${escape(p.title)}</h3>`)}
        <p class="listing-desc">${escape(p.description)}</p>
        <div class="listing-pricing-box">
          <div class="price-full">
            <small>${t("ราคารวมเต็ม")}</small>
            <span>${money(p.price)}</span>
          </div>
          <div class="price-split">
            <small>${g ? (g.members.includes(state.user?.id) ? t("ยอดปัจจุบันของคุณ") : t("ถ้าคุณเข้าร่วมตอนนี้")) : t("ประมาณเมื่อหาร 4 คน")}</small>
            <strong>${money(g ? (g.members.includes(state.user?.id) ? shares(g)[state.user.id] : joinEstimate(g)) : Math.ceil(p.price / 4))}<small> ${t("/คน")}</small></strong>
          </div>
        </div>
        ${
          g
            ? `
          <div class="listing-group-preview">
            ${icon("users", 14)}
            <span>${t("กลุ่ม “{name}” ว่างอีก {count} ที่", { name: escape(g.name), count: "<b>" + (g.capacity - g.members.length) + "</b>" })}</span>
          </div>
        `
            : `
          <div class="listing-group-preview empty-preview">
            ${icon("sparkles", 14)}
            <span>${t("ยังไม่มีกลุ่ม แตะเพื่อเปิดกลุ่มหารคนแรก")}</span>
          </div>
        `
        }
        <div class="listing-card-actions">
          ${a(destination, `${g ? t("ดูกลุ่มและเข้าร่วม") : t("ดูรายละเอียดและกลุ่ม")} ${icon("arrow", 16)}`, "button outline full flow-button")}
        </div>
      </div>
    </article>
  `;
}

function groupCard(g) {
  const p = listing(g.listingId);
  if (!p) return "";
  const category = g.category || p.category;
  const categories = g.categories?.length ? g.categories : [category];
  const remaining = Math.max(0, g.capacity - g.members.length);
  const open = remaining > 0 && !g.orderId && g.status !== "cancelled";
  const isMember = g.members.includes(state.user?.id);
  const nowCount = g.members.length + (open && !isMember ? 1 : 0);
  const seatMode = g.costs?.mode === SEAT_MODE;
  const now = isMember
    ? shares(g)[state.user.id]
    : seatMode
      ? joinEstimate(g)
      : Math.ceil(totalCost(g.costs, nowCount) / nowCount);
  const full = seatMode ? joinEstimate(g) : Math.ceil(totalCost(g.costs, g.capacity) / g.capacity);
  const destination = `/groups/${g.id}`;
  return `<article class="opportunity-card">
    <div class="opportunity-media">${a(destination, isLocalImage(g.images?.[0]) ? `<img src="${g.images[0]}" alt="${escape(g.name)}" loading="lazy"/>` : art({ ...p, category }), "opportunity-art-link")}</div>
    <div class="opportunity-content">
      <div class="opportunity-topline"><span class="opportunity-category">${categories
        .slice(0, 2)
        .map((item) => escape(t(item)))
        .join(
          " · ",
        )}${categories.length > 2 ? ` +${categories.length - 2}` : ""}</span><span class="opportunity-spots ${open ? "" : "is-closed"}">${open ? t("ว่าง {count} ที่", { count: remaining }) : t("ปิดรับสมาชิก")}</span></div>
      ${a(destination, `<h3>${escape(g.name)}</h3>`, "opportunity-title")}
      <p class="opportunity-group-name">${t("หมวดหมู่")}: ${escape(t(category))}</p>
      <div class="opportunity-price"><div><small>${isMember ? t("ยอดปัจจุบันของคุณ") : open ? t("ถ้าคุณเข้าร่วมตอนนี้") : t("ประมาณต่อคนปัจจุบัน")}</small><strong>${money(now)} <span>${t("/คน")}</span></strong></div><div><small>${t("เมื่อครบ {count} คน", { count: g.capacity })}</small><b>${money(full)} ${t("/คน")}</b></div></div>
      <div class="opportunity-members"><span>${icon("users", 17)} ${t("สมาชิก {count} / {capacity} คน", { count: g.members.length, capacity: g.capacity })}</span><div class="opportunity-track" role="progressbar" aria-label="${t("ความคืบหน้า")}" aria-valuemin="0" aria-valuemax="${g.capacity}" aria-valuenow="${g.members.length}"><span style="width:${(g.members.length / g.capacity) * 100}%"></span></div></div>
      <p class="opportunity-leader">${icon("user", 16)} ${t("หัวหน้ากลุ่ม")}: ${escape(name(g.ownerId).replace(/\s*\(หัวหน้ากลุ่ม\)$/, ""))}</p>
      <p class="opportunity-terms">${icon("check", 16)} ${t("ยืนยันยอดก่อนสั่งซื้อ")}</p>
      <div class="opportunity-actions">${a(destination, open && !isMember ? t("ดูรายละเอียดกลุ่ม") : t("ดูกลุ่ม"), `button opportunity-view ${open && !isMember ? "primary" : "outline"}`)}${isMember ? a(`/groups/${g.id}/chat`, `${icon("chat", 17)} ${t("แชทกลุ่ม")}`, "opportunity-chat") : ""}${open || isMember || g.ownerId === state.user?.id ? `<button type="button" class="opportunity-share" data-action="copy-link" data-id="${escape(g.id)}" aria-label="${t("คัดลอกลิงก์เชิญ")}">${icon("link", 17)} ${t("ชวนเพื่อน")}</button>` : ""}</div>
    </div>
  </article>`;
}

const CATEGORIES_LIST = [
  { name: "ทั้งหมด", symbol: "✳" },
  { name: "แอปพลิเคชันและเว็บไซต์", symbol: "🌐" },
  { name: "เสื้อผ้าและแฟชั่น", symbol: "👗" },
  { name: "เครื่องสำอางและความงาม", symbol: "💄" },
  { name: "อาหารและเครื่องดื่ม", symbol: "🍱" },
  { name: "ของใช้ทั่วไป", symbol: "🧼" },
  { name: "สินค้าดิจิทัล", symbol: "💾" },
  { name: "อุปกรณ์อิเล็กทรอนิกส์และไอที", symbol: "💻" },
  { name: "สินค้าขายส่ง", symbol: "📦" },
  { name: "บริการทั่วไป", symbol: "🛠️" },
  { name: "อื่น ๆ (ระบุชื่อเอง)", symbol: "✨" },
];
const CATEGORY_NAMES = CATEGORIES_LIST.map((c) => c.name);
const CREATE_CATEGORY_NAMES = CATEGORY_NAMES.filter(
  (name) => name !== "ทั้งหมด",
);
function home() {
  const activeGroups = state.groups.filter(
    (g) =>
      g.visibility === "public" &&
      g.status !== "cancelled" &&
      !g.orderId &&
      g.members.length < g.capacity,
  );
  const groupFilters = [
    ["ทั้งหมด", "ทั้งหมด"],
    ["อุปกรณ์ไอที", "อุปกรณ์อิเล็กทรอนิกส์และไอที"],
    ["เครื่องสำอาง", "เครื่องสำอางและความงาม"],
    ["เสื้อผ้า", "เสื้อผ้าและแฟชั่น"],
    ["ของใช้ในบ้าน", "ของใช้ทั่วไป"],
    ["อาหาร / ขนม", "อาหารและเครื่องดื่ม"],
    ["อื่น ๆ", "อื่น ๆ (ระบุชื่อเอง)"],
  ];
  const headlines = [
    t("สินค้าเป็นกลุ่ม"),
    t("ค่าสินค้าเป็นรายคน"),
    t("ซื้อของกับเพื่อน"),
  ];
  const activeHeadlineIndex = heroHeadlineIndex % headlines.length;
  const currentHeadline = headlines[activeHeadlineIndex];
  const widestHeadline = headlines.reduce(
    (longest, phrase) => (phrase.length > longest.length ? phrase : longest),
    headlines[0],
  );
  const groupMatchesCategory = (group, category) => {
    if (category === "ทั้งหมด") return true;
    const actualCategories = group.categories?.length
      ? group.categories
      : [group.category || listing(group.listingId)?.category].filter(Boolean);
    return category === "อื่น ๆ (ระบุชื่อเอง)"
      ? actualCategories.some((value) => !CREATE_CATEGORY_NAMES.includes(value))
      : actualCategories.includes(category);
  };
  const filteredGroups = activeGroups.filter((group) =>
    groupMatchesCategory(group, selectedHomeGroupCategory),
  );
  const filterPills = (filters, path, type) =>
    `<nav class="home-filter-pills" aria-label="${t("เลือกหมวดหมู่")}">${filters
      .map(([label, category], index) =>
        type === "group"
          ? `<button type="button" data-action="home-group-filter" data-category="${escape(category)}" aria-pressed="${selectedHomeGroupCategory === category}" class="home-filter-pill${selectedHomeGroupCategory === category ? " active" : ""}">${index === 0 ? '<span class="home-filter-dot"></span>' : ""}${t(label)}${index === filters.length - 1 ? '<span class="home-filter-chevron">⌄</span>' : ""}</button>`
          : a(
              !category || category === "ทั้งหมด"
                ? path
                : `${path}?category=${encodeURIComponent(category)}`,
              `${t(label)}${index === filters.length - 1 ? '<span class="home-filter-chevron">⌄</span>' : ""}`,
              `home-filter-pill${index === 0 ? " active" : ""}`,
            ),
      )
      .join("")}</nav>`;
  return `
    <section class="hero home-hero" data-reveal-kind="hero">
      <div class="hero-text">
        <h1><span class="sr-only" data-headline-accessible>${t("หาร")} ${currentHeadline}</span><span class="dynamic-headline headline-loop" aria-hidden="true" data-text-loop="${escape(JSON.stringify(headlines))}" data-static-text="${t("หาร")}"><span class="hero-headline-static">${t("หาร")}</span><span class="headline-rotator-slot"><span class="headline-rotator-measure">${widestHeadline}</span><span class="headline-rotator-window"><span class="headline-rotator-highlight"></span><span class="headline-rotator-current">${currentHeadline}</span><span class="headline-rotator-cursor"></span></span></span></span></h1>
        <p>${t("ชวนเพื่อนหารค่าสินค้าหรือแพ็กเกจ ดูส่วนแบ่งและค่าส่งของแต่ละคนก่อนยืนยัน")}</p>
        <form class="hero-search" id="search-form"><span>${icon("search", 20)}</span><input name="q" placeholder="${t("ค้นหาแอป, เสื้อผ้า, เครื่องสำอาง, อาหาร...")}" aria-label="${t("ค้นหาสินค้าหรือบริการ")}"/><button type="submit">${t("ค้นหา")}</button></form>
        <div class="hero-quick-tags"><span>${t("ค้นหายอดนิยม:")}</span><button type="button" class="hero-tag" data-action="quick-search" data-category="แอปพลิเคชันและเว็บไซต์" data-query="แอปพลิเคชันและเว็บไซต์">${t("แอปพลิเคชันและเว็บไซต์")}</button><button type="button" class="hero-tag" data-action="quick-search" data-category="เสื้อผ้าและแฟชั่น" data-query="เสื้อผ้าและแฟชั่น">${t("เสื้อผ้าและแฟชั่น")}</button><button type="button" class="hero-tag" data-action="quick-search" data-category="เครื่องสำอางและความงาม" data-query="เครื่องสำอางและความงาม">${t("เครื่องสำอางและความงาม")}</button><button type="button" class="hero-tag" data-action="quick-search" data-category="อาหารและเครื่องดื่ม" data-query="อาหารและเครื่องดื่ม">${t("อาหารและเครื่องดื่ม")}</button></div>
        <div class="hero-points"><span>${icon("shield", 16)} ${t("ตรวจสอบยอดก่อนยืนยัน")}</span><span>${icon("calc", 16)} ${t("คำนวณเศษสตางค์เป๊ะ")}</span><span>${icon("users", 16)} ${t("มีกลุ่มพร้อมเข้าร่วม")}</span></div>
      </div>
      <div class="hero-visual" aria-hidden="true">
        <div class="hero-phone-showcase">
          <div class="hero-float-card card-calc"><span class="float-calc-badge">${icon("calc", 14)} ${t("คำนวณเป๊ะ รวมค่าส่งและบริการ")}</span><div class="float-calc-formula"><strong>฿890 ÷ 5 คน</strong><span class="float-calc-eq">=</span><b class="float-calc-res">฿178.00<small>/คน</small></b></div></div>
          <div class="hero-float-card card-notice"><span class="float-dot-live"></span><div class="float-notice-text"><strong>${t("สมาชิกครบ ทุกคนยืนยันยอด")}</strong><small>${t("ตรวจสอบยอดก่อนสั่งซื้อ")}</small></div><span class="float-notice-check">✓</span></div>
          <div class="hero-float-card card-badge"><span class="float-sparkle">${icon("sparkles", 14)}</span><b>${t("ทุกคนเห็นยอดก่อนยืนยัน")}</b></div>
          <div class="hero-phone-frame">
            <div class="hero-phone-island"><span class="hero-phone-lens"></span><span class="hero-phone-sensor"></span></div>
            <div class="hero-phone-screen">
              <div class="hero-phone-bar"><span class="phone-time">09:41</span><span class="phone-icons">5G 📶 98%</span></div>
              <div class="phone-group-badge-row"><span class="phone-tag-pill">${t("กลุ่มยอดนิยม")}</span><span class="phone-status-pill">${t("ว่าง 1 ที่สุดท้าย")}</span></div>
              <h4 class="phone-group-title">${t("หารกล่องข้าวงานอีเวนต์")}</h4>
              <div class="phone-price-box"><div class="phone-price-main"><span class="phone-price-num">฿178.00</span><span class="phone-price-unit">/คน</span></div><span class="phone-save-chip">${t("ตัวอย่างยอดหาร")}</span></div>
              <div class="phone-progress-wrap"><div class="phone-progress-text"><span>${t("สมาชิก {count} / {capacity} คน", { count: 4, capacity: 5 })}</span><b>80%</b></div><div class="phone-track"><span class="phone-bar-fill" style="width: 80%;"></span></div></div>
              <div class="phone-members-list">
                <div class="phone-member-item"><span class="phone-avatar c-blue">ส</span><div class="phone-member-name"><b>${t("สมชาย (หัวหน้ากลุ่ม)")}</b><small>฿178.00</small></div><span class="phone-check-badge">✓ ${t("ยืนยันยอดแล้ว")}</span></div>
                <div class="phone-member-item"><span class="phone-avatar c-mint">M</span><div class="phone-member-name"><b>May</b><small>฿178.00</small></div><span class="phone-check-badge">✓ ${t("ยืนยันยอดแล้ว")}</span></div>
                <div class="phone-member-item"><span class="phone-avatar c-violet">N</span><div class="phone-member-name"><b>Nan</b><small>฿178.00</small></div><span class="phone-check-badge">✓ ${t("ยืนยันยอดแล้ว")}</span></div>
              </div>
              <div class="phone-cta-wrap"><button type="button" class="phone-join-btn"><span>${t("เข้าร่วมกลุ่มนี้")}</span><b>฿178.00</b></button></div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="home-discovery-section home-group-section" data-reveal-kind="deal">
      <div class="home-section-banner"><span class="home-section-icon group">${icon("users", 40)}</span><div><h2>${t("กลุ่มหารของ")} <small>(Group Buying)</small></h2><p>${t("เลือกกลุ่มที่เปิดรับ แล้วดูยอดประมาณต่อคน")}</p></div>${a("/explore", `${t("ดูทั้งหมด")} ${icon("arrow", 18)}`, "home-view-all")}</div>
      ${filterPills(groupFilters, "/explore", "group")}
      ${filteredGroups.length ? `<div class="group-grid home-open-groups-grid">${filteredGroups.slice(0, 3).map(groupCard).join("")}</div>` : `<div class="empty home-section-empty"><h3>${selectedHomeGroupCategory === "ทั้งหมด" ? t("ยังไม่มีกลุ่มที่เปิดรับ") : t("หมวดหมู่นี้ยังไม่มีกลุ่มที่เปิดรับ")}</h3>${selectedHomeGroupCategory !== "ทั้งหมด" ? `<button type="button" class="button outline" data-action="home-group-filter" data-category="ทั้งหมด">${t("ดูกลุ่มทั้งหมด")}</button>` : a("/explore", t("ดูกลุ่มทั้งหมด"), "button outline")}</div>`}
    </section>

    <a class="home-promo-strip group" href="/groups/create" data-reveal-kind="sweep"><span class="home-promo-icon">${icon("users", 42)}</span><span class="home-promo-copy"><strong>${t("เริ่มหารของกับเพื่อน")}</strong><small>${t("เปิดกลุ่มและแบ่งค่าใช้จ่ายกัน")}</small></span><span class="home-promo-art" aria-hidden="true">🛍️</span><span class="home-promo-button">${t("สร้างกลุ่มหารของ")} ${icon("arrow", 18)}</span></a>

    ${whySection()}

    <section class="cta-section home-restored-cta" data-reveal-kind="iris"><div class="cta-banner"><div class="cta-copy"><h2>${t("เริ่มกลุ่มหารของ")}</h2><p>${t("สร้างกลุ่มแล้วชวนเพื่อน หรือเลือกกลุ่มที่ยังเปิดรับสมาชิก")}</p></div><div class="cta-actions">${a("/groups/create", `${icon("plus", 18)} ${t("สร้างกลุ่มใหม่")}`, "button primary")}${a("/explore", t("ดูกลุ่มที่เปิดรับ"), "button outline")}</div></div></section>
  `;
}
/* "Why HarnKhong": the trust story — money waits in the platform pool until members get their item. */
let whyTab = "buyer";
const WHY_STEPS = {
  buyer: [
    ["search", "เลือกกลุ่ม", "เห็นราคาต่อที่นั่งก่อนเข้า"],
    ["check", "ยืนยันยอด", "ตรวจยอดแล้วกดยืนยัน"],
    ["calc", "โอนเข้ากองกลาง", "สแกน QR แล้วแนบสลิป"],
    ["shield", "แอดมินตรวจสลิป", "ยอดไม่ตรงจะถูกตีกลับ"],
    ["package", "ได้ของแล้วกดยืนยัน", "เงินถึงหัวกลุ่มหลังจากนี้"],
  ],
  owner: [
    ["plus", "สร้างกลุ่ม", "ตั้งราคาและจำนวนที่นั่ง"],
    ["link", "แชร์ลิงก์", "ชวนเพื่อนเข้ากลุ่ม"],
    ["users", "สมาชิกโอนครบ", "เงินพักไว้ที่กองกลาง"],
    ["package", "ส่งของให้สมาชิก", "คุณออกเงินซื้อไปก่อน"],
    ["check", "รับเงิน", "เมื่อทุกคนยืนยันว่าได้ของ"],
  ],
};
const WHY_NOTES = {
  buyer: "ถ้ายังไม่ได้ของ เงินของคุณยังอยู่ที่กองกลาง ไม่ถึงมือหัวกลุ่ม",
  owner: "แพลตฟอร์มโอนให้คุณหลังหักค่าคอม 2% คุณไม่ต้องโอนอะไรเข้าระบบ",
};
function whySteps(kind) {
  const steps = WHY_STEPS[kind];
  return `<ol class="why-steps">${steps
    .map(([ic, title, text], i) => `<li class="why-step${i === steps.length - 1 ? " is-key" : ""}" style="--i:${i}"><span class="why-step-icon">${icon(ic, 24)}</span><b>${t(title)}</b><span>${t(text)}</span></li>`)
    .join("")}</ol><p class="why-note">${icon("lock", 16)} ${t(WHY_NOTES[kind])}</p>`;
}
function whyFees() {
  return `<div class="why-fees">
    <div class="why-fee" style="--i:0"><small>${t("ผู้ร่วมซื้อ")}</small><strong>฿0</strong><span>${t("จ่ายแค่ราคาที่นั่ง ไม่มีค่าธรรมเนียม")}</span></div>
    <div class="why-fee" style="--i:1"><small>${t("หัวกลุ่ม")}</small><strong>2%</strong><span>${t("หักจากเงินที่ได้รับ ไม่ต้องโอนเพิ่ม")}</span></div>
    <div class="why-fee is-example" style="--i:2"><small>${t("ตัวอย่าง")}</small><strong>฿50 → ฿49</strong><span>${t("สมาชิกโอน ฿50 หัวกลุ่มได้รับ ฿49")}</span></div>
  </div>`;
}
/* Home sections each have their own entrance, played once when they first scroll into view.
   Later renders (a filter click re-renders the page) show them as they are. */
const revealedKinds = new Set();
let revealObserver = null;
function revealHomeSections() {
  const pending = [...document.querySelectorAll("[data-reveal-kind]:not([data-reveal])")];
  if (!pending.length) return;
  const still = !("IntersectionObserver" in window) || matchMedia("(prefers-reduced-motion: reduce)").matches;
  revealObserver?.disconnect();
  revealObserver = still ? null : new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const el = entry.target;
      revealObserver.unobserve(el);
      revealedKinds.add(el.dataset.revealKind);
      el.dataset.reveal = "in";
    }
  }, { threshold: 0.15, rootMargin: "0px 0px -6% 0px" });
  for (const el of pending) {
    if (still || revealedKinds.has(el.dataset.revealKind)) {
      el.dataset.reveal = "done";
      continue;
    }
    el.dataset.reveal = "pending";
    revealObserver.observe(el);
  }
}
/* Reveal the section once, when it first scrolls into view; later renders show it as is. */
let whyRevealed = false;
function revealWhySection() {
  const section = document.querySelector(".why-section");
  if (!section || section.dataset.reveal) return;
  if (whyRevealed || !("IntersectionObserver" in window) || matchMedia("(prefers-reduced-motion: reduce)").matches) {
    section.dataset.reveal = "done";
    return;
  }
  section.dataset.reveal = "pending";
  const observer = new IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return;
    observer.disconnect();
    whyRevealed = true;
    section.dataset.reveal = "in";
    // After the entrance, tab switches replay the short step stagger without the opening delay.
    setTimeout(() => { section.dataset.reveal = "done"; }, 2200);
  }, { threshold: 0.18 });
  observer.observe(section);
}
function whySection() {
  const tabs = [["buyer", "ผู้ร่วมซื้อ", "users"], ["owner", "หัวกลุ่ม", "user"], ["fee", "ค่าธรรมเนียม", "calc"]];
  const panel = (kind) => (kind === "fee" ? whyFees() : whySteps(kind));
  return `<section class="why-section" aria-labelledby="why-heading">
    <div class="why-top">
      <div class="why-intro">
        <span class="why-kicker">${t("ทำไมต้อง")}</span>
        <h2 id="why-heading">HarnKhong?</h2>
        <p class="why-lead">${t("เงินของคุณไม่ถึงมือหัวกลุ่ม จนกว่าคุณจะได้ของ")}</p>
        <p>${t("ทุกบาทพักไว้ที่กองกลางของแพลตฟอร์ม และปล่อยให้หัวกลุ่มเมื่อสมาชิกยืนยันว่าได้รับสินค้าครบ")}</p>
      </div>
      <ul class="why-points">
        <li style="--i:0">${`<span class="why-point-icon">${icon("lock", 22)}</span>`}<b>${t("เงินพักที่กองกลาง")}</b><span>${t("ไม่โอนตรงให้หัวกลุ่ม ไม่มีใครหอบเงินหนีได้")}</span></li>
        <li style="--i:1">${`<span class="why-point-icon">${icon("shield", 22)}</span>`}<b>${t("แอดมินตรวจทุกสลิป")}</b><span>${t("ยอดไม่ตรงจะถูกตีกลับให้โอนใหม่")}</span></li>
        <li style="--i:2">${`<span class="why-point-icon">${icon("calc", 22)}</span>`}<b>${t("ราคาล็อกก่อนเข้า")}</b><span>${t("เห็นราคาต่อที่นั่งก่อนกด ไม่มีบวกเพิ่มทีหลัง")}</span></li>
      </ul>
    </div>
    <div class="why-flow">
      <div class="why-flow-head">
        <h3>${t("ขั้นตอนการทำรายการ")}</h3>
        <div class="why-tabs" role="tablist" aria-label="${t("ขั้นตอนการทำรายการ")}">${tabs
          .map(([kind, label, ic]) => `<button type="button" role="tab" id="why-tab-${kind}" aria-controls="why-panel-${kind}" aria-selected="${whyTab === kind}" data-action="why-tab" data-tab="${kind}">${icon(ic, 18)} ${t(label)}</button>`)
          .join("")}</div>
      </div>
      ${tabs.map(([kind]) => `<div class="why-panel" role="tabpanel" id="why-panel-${kind}" aria-labelledby="why-tab-${kind}"${whyTab === kind ? "" : " hidden"}>${panel(kind)}</div>`).join("")}
    </div>
  </section>`;
}
function explore() {
  const params = new URLSearchParams(location.search),
    q = (params.get("q") || "").trim(),
    category = params.get("category") || "ทั้งหมด",
    requestedPage = Math.max(
      1,
      Number.parseInt(params.get("page") || "1", 10) || 1,
    );
  const matches = (g) => {
    const p = listing(g.listingId),
      groupCategories = g.categories?.length
        ? g.categories
        : [g.category || p?.category || ""],
      isOther =
        category === "อื่น ๆ (ระบุชื่อเอง)" &&
        groupCategories.some(
          (groupCategory) => !CREATE_CATEGORY_NAMES.includes(groupCategory),
        );
    return (
      (category === "ทั้งหมด" ||
        groupCategories.includes(category) ||
        isOther) &&
      `${g.name} ${groupCategories.join(" ")}`
        .toLowerCase()
        .includes(q.toLowerCase())
    );
  };
  const openGroups = state.groups.filter(
    (g) =>
      g.visibility === "public" &&
      g.status !== "cancelled" &&
      !g.orderId &&
      g.members.length < g.capacity &&
      matches(g),
  );
  const pageSize = 6,
    pageCount = Math.ceil(openGroups.length / pageSize),
    page = Math.min(requestedPage, Math.max(1, pageCount)),
    pageGroups = openGroups.slice((page - 1) * pageSize, page * pageSize);
  const pageHref = (nextPage) => {
    const next = new URLSearchParams();
    if (q) next.set("q", q);
    if (category !== "ทั้งหมด") next.set("category", category);
    if (nextPage > 1) next.set("page", String(nextPage));
    const query = next.toString();
    return `/explore${query ? `?${query}` : ""}`;
  };
  const pageItems =
    pageCount <= 5
      ? Array.from({ length: pageCount }, (_, index) => index + 1)
      : [
          1,
          ...new Set(
            [page - 1, page, page + 1].filter(
              (number) => number > 1 && number < pageCount,
            ),
          ),
          pageCount,
        ].sort((a, b) => a - b);
  const pagination =
    pageCount > 1
      ? `<nav class="pagination" aria-label="${t("การแบ่งหน้า")}"><button type="button" class="pagination-control" data-page="${page - 1}" ${page === 1 ? "disabled" : ""}>${t("ก่อนหน้า")}</button>${pageItems.map((number, index) => `${index && number - pageItems[index - 1] > 1 ? '<span class="pagination-ellipsis" aria-hidden="true">…</span>' : ""}${a(pageHref(number), String(number), `pagination-number${number === page ? " active" : ""}`)}`).join("")}<button type="button" class="pagination-control" data-page="${page + 1}" ${page === pageCount ? "disabled" : ""}>${t("ถัดไป")}</button></nav>`
      : "";
  return `<div class="explore-page">
    ${title(t("กลุ่มที่เปิดรับสมาชิก"), t("ตรวจสอบยอดประมาณ จำนวนที่ว่าง และเงื่อนไขของแต่ละกลุ่มก่อนเข้าร่วม"))}
    <form class="search-bar" id="search-form"><span>${icon("search")}</span><input type="hidden" name="category" value="${escape(category)}"/><input name="q" value="${escape(q)}" placeholder="${t("ค้นหาสินค้าหรือชื่อกลุ่ม")}" aria-label="${t("ค้นหา")}"/><button type="submit">${t("ค้นหากลุ่ม")}</button></form>
    <div class="filter-carousel"><button type="button" class="filter-scroll-button filter-scroll-prev" data-action="scroll-filter" data-direction="prev" aria-label="${t("เลื่อนหมวดหมู่ไปซ้าย")}" hidden><span aria-hidden="true">‹</span></button><nav class="filter-row" aria-label="${t("หมวดหมู่")}">${CATEGORY_NAMES.map((x) => a("/explore?category=" + encodeURIComponent(x) + (q ? "&q=" + encodeURIComponent(q) : ""), t(x), "filter " + (category === x ? "active" : ""))).join("")}</nav><button type="button" class="filter-scroll-button filter-scroll-next" data-action="scroll-filter" data-direction="next" aria-label="${t("เลื่อนหมวดหมู่ไปขวา")}" hidden><span aria-hidden="true">›</span></button></div>
    <section aria-labelledby="open-groups-heading"><div class="section-header"><div><h2 id="open-groups-heading">${t("กลุ่มที่เข้าร่วมได้")} <small>${t("{count} กลุ่ม", { count: openGroups.length })}</small></h2><p>${t("ยอดเป็นประมาณการก่อนเข้าร่วม และจะคำนวณใหม่เมื่อจำนวนสมาชิกเปลี่ยน")}</p></div></div>
      ${openGroups.length ? `<div class="group-grid">${pageGroups.map(groupCard).join("")}</div>${pagination}` : `<div class="empty"><h3>${t("ยังไม่มีกลุ่มที่เปิดรับ")}</h3><p>${t("ลองค้นหาชื่อกลุ่มหรือหมวดอื่น")}</p>${a("/explore", t("ดูทั้งหมด"), "button outline")}</div>`}
    </section>
  </div>`;
}
function legacyProductRoute(id) {
  const product = listing(id);
  if (!product) return notFound();
  if (product.listingType === "secondhand") {
    history.replaceState({}, "", "/");
    return home();
  }
  const mapLat = Number(product.marketCoordinates?.lat),
    mapLng = Number(product.marketCoordinates?.lng);
  const hasMarketCoordinates =
    Number.isFinite(mapLat) &&
    Number.isFinite(mapLng) &&
    Math.abs(mapLat) <= 90 &&
    Math.abs(mapLng) <= 180;
  const locationMap =
    product.area || hasMarketCoordinates
      ? `<section class="secondhand-location-card"><h2>${t("สถานที่ขาย")}</h2>${product.area ? `<p><strong>${t("ตลาดหรือสถานที่ขาย")}:</strong> ${escape(product.area)}</p>` : ""}${product.marketAddress && product.marketAddress !== product.area ? `<p><strong>${t("ที่อยู่โดยประมาณ")}:</strong> ${escape(product.marketAddress)}</p>` : ""}${hasMarketCoordinates ? `<p class="secondhand-location-coordinates">${icon("map-pin", 15)} ${mapLat.toFixed(6)}, ${mapLng.toFixed(6)}</p><a class="secondhand-map-link" href="https://www.openstreetmap.org/?mlat=${encodeURIComponent(mapLat)}&mlon=${encodeURIComponent(mapLng)}#map=19/${encodeURIComponent(mapLat)}/${encodeURIComponent(mapLng)}" target="_blank" rel="noopener noreferrer">${icon("map-pin", 16)} ${t("เปิดตำแหน่งบน OpenStreetMap")}</a><div id="secondhand-detail-map" class="secondhand-location-map" data-lat="${mapLat}" data-lng="${mapLng}" role="application" aria-label="${t("แผนที่ตำแหน่งสินค้า ซูมเข้าออกได้")}"></div>` : `<p class="secondhand-location-map-missing">${t("ผู้ขายยังไม่ได้ปักหมุดบนแผนที่")}</p>`}</section>`
      : "";
  if (product.listingType === "secondhand") {
    const isOwner = !!state.user && state.user.id === product.sellerId;
    const images = product.images || [];
    const contactValue = String(product.contact || "").trim();
    const contactHref = /^[+\d()\s-]+$/.test(contactValue)
      ? `tel:${contactValue.replace(/[^+\d]/g, "")}`
      : `https://line.me/R/ti/p/~${encodeURIComponent(contactValue.replace(/^@/, ""))}`;
    const pickupOptions = [
      "นัดรับ",
      "รับสินค้าเอง",
      "นัดรับและจัดส่ง",
      "รับสินค้าเองหรือจัดส่ง",
    ];
    const shippingOptions = [
      "จัดส่ง",
      "นัดรับและจัดส่ง",
      "รับสินค้าเองหรือจัดส่ง",
    ];
    const supportsPickup = pickupOptions.includes(product.delivery);
    const supportsShipping = shippingOptions.includes(product.delivery);
    const purchaseActions = isOwner
      ? `<div class="secondhand-seller-actions"><button type="button" class="button outline" data-action="secondhand-edit" data-id="${escape(product.id)}">${icon("edit", 18)} ${t("แก้ไขสินค้า")}</button><button type="button" class="button outline danger" data-action="secondhand-delete" data-id="${escape(product.id)}">${icon("trash", 18)} ${t("ลบสินค้า")}</button><button type="button" class="button primary secondhand-boost-button" data-action="secondhand-boost" data-id="${escape(product.id)}">${icon("sparkles", 18)} ${product.boostedUntil && Date.parse(product.boostedUntil) > Date.now() ? t("Boost แล้ว · เหลือ {hours} ชม.", { hours: Math.ceil((Date.parse(product.boostedUntil) - Date.now()) / 3600000) }) : t("Boost ทดลอง 24 ชั่วโมง")}</button></div>`
      : `${supportsPickup ? `<button type="button" class="button outline secondhand-purchase-button" data-action="secondhand-reserve" data-id="${escape(product.id)}">${icon("chat", 18)} ${t("จองสินค้า")}</button>` : ""}${supportsShipping ? `<button type="button" class="button outline secondhand-purchase-button" data-action="secondhand-order" data-id="${escape(product.id)}">${icon("truck", 18)} ${t("สั่งซื้อ")}</button>` : ""}`;
    const galleryMarkup = images.length
      ? `<section class="secondhand-gallery" aria-label="${t("รูปภาพสินค้า")}" data-current="0" data-images="${escape(JSON.stringify(images))}">
      <div class="secondhand-gallery-thumbs">${images
        .slice(0, 3)
        .map(
          (src, index) =>
            `<button type="button" class="secondhand-gallery-thumb ${index === 0 ? "is-active" : ""}" data-action="secondhand-photo" data-index="${index}" aria-label="${t("ดูรูปที่ {number}", { number: index + 1 })}" aria-pressed="${index === 0}"><img src="${src}" alt=""/></button>`,
        )
        .join(
          "",
        )}${images.length > 3 ? `<button type="button" class="secondhand-gallery-more" data-action="secondhand-photo" data-index="3">+${images.length - 3}</button>` : ""}</div>
      <div class="secondhand-listing-hero"><img data-secondhand-main src="${images[0]}" alt="${escape(product.title)}"/>${images.length > 1 ? `<button type="button" class="secondhand-gallery-arrow previous" data-action="secondhand-photo-step" data-direction="-1" aria-label="${t("รูปก่อนหน้า")}">‹</button><button type="button" class="secondhand-gallery-arrow next" data-action="secondhand-photo-step" data-direction="1" aria-label="${t("รูปถัดไป")}">›</button><span class="secondhand-gallery-count" data-secondhand-count>1 / ${images.length}</span>` : ""}<button type="button" class="secondhand-gallery-fullscreen" data-action="secondhand-photo-fullscreen" aria-label="${t("ขยายรูป")}">⛶</button></div>
    </section>`
      : `<div class="secondhand-listing-hero empty">${art(product)}</div>`;
    return `<div class="secondhand-listing-page">${a("/marketplace/secondhand", `← ${t("กลับไปตลาดมือสอง")}`, "listing-back-link")}<div class="secondhand-listing-layout"><main>${galleryMarkup}<section class="secondhand-listing-description"><h2>${icon("copy", 20)} ${t("รายละเอียดสินค้า")}</h2><h3>${escape(product.title)}</h3><p>${escape(product.description || "—")}</p></section></main><aside class="secondhand-listing-aside"><section class="secondhand-listing-summary"><span class="listing-preview-category">${t("ของมือสอง")}</span><div class="secondhand-summary-title"><h1>${escape(product.title)}</h1><button type="button" class="secondhand-share-button" data-action="share-listing" aria-label="${t("แชร์ประกาศ")}">${icon("link", 19)}</button></div><strong class="secondhand-price">${money(product.price)}</strong><div class="secondhand-purchase-actions">${purchaseActions}</div>${isOwner ? "" : `<div class="secondhand-contact-actions"><a class="button primary" href="${escape(contactHref)}" target="${contactHref.startsWith("https:") ? "_blank" : "_self"}" rel="noopener noreferrer">${icon("chat", 18)} ${t("ติดต่อผู้ขาย")}</a></div>`}<div class="secondhand-seller-card"><span class="secondhand-seller-avatar">${escape((product.sellerName || seller(product.sellerId).name || "U").slice(0, 1).toUpperCase())}</span><span><strong>${escape(product.sellerName || seller(product.sellerId).name)}</strong><small>${t("ผู้ขาย")}</small></span><span class="secondhand-seller-chevron">›</span></div></section><section class="secondhand-info-card"><h2>${icon("package", 20)} ${t("ข้อมูลสินค้า")}</h2><dl class="secondhand-product-facts"><div><dt>${t("ประเภทสินค้า")}</dt><dd>${escape(t(product.category))}</dd></div><div><dt>${t("สภาพสินค้า")}</dt><dd>${escape(t(product.condition))}</dd></div><div><dt>${t("จำนวน")}</dt><dd>${t("{count} ชิ้น", { count: product.quantity || 1 })}</dd></div><div><dt>${t("วิธีรับสินค้า")}</dt><dd>${escape(t(product.delivery))}</dd></div></dl></section>${locationMap}</aside></div></div>`;
  }
  const groups = state.groups.filter(
    (g) =>
      g.listingId === id &&
      g.status !== "cancelled" &&
      (g.visibility === "public" || g.members.includes(state.user?.id)),
  );
  const target =
    groups.find((g) => !g.orderId && g.members.length < g.capacity) ||
    groups[0];
  if (target) {
    history.replaceState({}, "", `/groups/${target.id}`);
    return groupPage(target.id);
  }
  return `<div class="empty"><h1>${t("ยังไม่มีกลุ่มสำหรับรายการนี้")}</h1><p>${t("เลือกกลุ่มที่เปิดรับอยู่จากหน้าสำรวจได้เลย")}</p>${a("/explore", t("สำรวจกลุ่ม"), "button primary")}</div>`;
}
/** What someone pays if they join now: a fixed seat for seat-priced groups, the old average otherwise. */
function joinEstimate(g) {
  if (g.costs?.mode === SEAT_MODE) return seatPrice(g.costs, g.capacity, Math.min(g.members.length, g.capacity - 1));
  const count = Math.min(g.capacity, g.members.length + 1);
  return Math.ceil(totalCost(g.costs, count) / count);
}
function paymentSlipForm(id, revision) {
  const localNow = new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
    .toISOString().slice(0, 16);
  return `<div class="group-payment-proof-fields"><label>${t("แนบสลิปโอนเงิน")}<input type="file" accept="image/jpeg,image/png,image/webp" data-payment-slip-input required/><small data-payment-slip-status>${t("ยังไม่ได้เลือกสลิป (ไม่เกิน 8 MB)")}</small></label><label>${t("วันที่และเวลาที่โอนจริง")}<input type="datetime-local" data-payment-transfer-time value="${localNow}" required/></label><button class="button primary full" type="button" data-action="report-group-payment" data-slip-submit data-id="${escape(id)}" data-revision="${Number(revision)}" disabled>${t("แนบสลิปแล้วแจ้งแอดมิน")}</button></div>`;
}

const cycleStatusLabel = {
  awaiting_confirmation: "รอยืนยันยอดรอบนี้",
  confirmed: "ยืนยันครบแล้ว รอชำระ",
  paid: "ชำระครบแล้ว",
  closed: "ปิดรอบแล้ว",
};
const cyclePaymentLabel = {
  reported: "แจ้งโอนแล้ว รอแอดมินตรวจ",
  verified: "ชำระแล้ว",
  rejected: "สลิปไม่ผ่าน กรุณาแนบใหม่",
};
const shortDate = (value) =>
  new Date(value).toLocaleDateString(locale === "en" ? "en-GB" : "th-TH", { day: "numeric", month: "short", year: "numeric" });

function cycleSlipForm(id, cycleNumber) {
  const localNow = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  return `<div class="group-payment-proof-fields"><label>${t("แนบสลิปโอนเงิน")}<input type="file" accept="image/jpeg,image/png,image/webp" data-payment-slip-input required/><small data-payment-slip-status>${t("ยังไม่ได้เลือกสลิป (ไม่เกิน 8 MB)")}</small></label><label>${t("วันที่และเวลาที่โอนจริง")}<input type="datetime-local" data-payment-transfer-time value="${localNow}" required/></label><button class="button primary full" type="button" data-action="report-cycle-payment" data-slip-submit data-id="${escape(id)}" data-cycle="${Number(cycleNumber)}" ${supabaseConfigured ? "disabled" : ""}>${supabaseConfigured ? t("แนบสลิปแล้วแจ้งแอดมิน") : t("แจ้งโอนแล้ว (เดโม)")}</button></div>`;
}

/** Summary card and cycle panel for a monthly group: one confirmation per month, amounts locked per cycle. */
function monthlyGroupView(g, id, { isMember, isOwner, full, locked, estimate }) {
  const me = state.user?.id;
  const cycle = currentCycle(g);
  const inCycle = Boolean(cycle && cycle.members.includes(me));
  const confirmed = inCycle && Boolean(cycle.confirmations[me]);
  const payment = inCycle ? cycle.payments[me] : null;
  const waits = waitsForNextCycle(g, me);
  const myAmount = inCycle ? cycle.amounts[me] : null;
  const summary = `<div class="summary-card"><small>${inCycle && me === cycle.ownerId ? t("ส่วนของคุณเอง (ไม่ต้องโอน)") : inCycle ? t("ยอดของคุณเดือนนี้") : isMember ? t("ราคาต่อที่นั่งต่อเดือน") : t("ราคาต่อที่นั่งต่อเดือน")}</small><strong>${money(inCycle ? myAmount : estimate)}</strong><p>${cycle ? t("รอบที่ {number}: {start} ถึง {end}", { number: cycle.number, start: shortDate(cycle.start), end: shortDate(cycle.end) }) : t("จ่ายรายเดือน เริ่มนับเมื่อเจ้าของกลุ่มเริ่มรอบแรก")}</p>
    <div class="summary-actions">
      ${!isMember && !full && !locked ? a(`/groups/${id}/join`, `<span>${t("เข้าร่วมกลุ่ม")}</span><span class="btn-arrow">${icon("arrow", 18)}</span>`, "button primary full summary-action-btn") : ""}
      ${isOwner && !cycle ? `<button class="button primary full summary-action-btn" data-action="start-cycle" data-id="${escape(id)}"><span>${t("เริ่มรอบแรก")}</span><span class="btn-arrow">${icon("arrow", 18)}</span></button>` : ""}
      ${inCycle && !confirmed && cycle.status !== "closed" ? `<button class="button primary full summary-action-btn" data-action="confirm-cycle" data-id="${escape(id)}" data-cycle="${cycle.number}"><span>${t("ยืนยันยอดเดือนนี้ {amount}", { amount: money(myAmount) })}</span><span class="btn-arrow">${icon("arrow", 18)}</span></button>` : ""}
      ${confirmed ? `<div class="success-line">${icon("check", 18)} ${t("คุณยืนยันยอดรอบนี้แล้ว ยืนยันใหม่เมื่อขึ้นเดือนถัดไป")}</div>` : ""}
      ${waits ? `<div class="summary-info-box"><span class="info-icon">${icon("info", 22)}</span><span class="info-divider"></span><span>${t("คุณเข้าร่วมระหว่างรอบ เริ่มจ่ายรอบถัดไปวันที่ {date}", { date: shortDate(cycle.end) })}</span></div>` : ""}
      ${isMember ? a(`/groups/${id}/chat`, `<span class="summary-btn-left">${icon("chat", 19)} <span>${t("แชทกลุ่ม")}</span></span><span class="btn-arrow">${icon("arrow", 18)}</span>`, "button outline full summary-action-btn") : ""}
      ${isMember && !isOwner ? `<button class="button danger-soft full summary-action-btn" data-action="leave" data-id="${escape(id)}"><span class="summary-btn-left">${icon("back", 19)} <span>${t("ออกจากกลุ่ม")}</span></span><span class="btn-arrow">${icon("arrow", 18)}</span></button>` : ""}
      ${isOwner ? `<button class="button outline full summary-action-btn" data-action="edit-group" data-id="${escape(id)}"><span class="summary-btn-left">${icon("edit", 19)} <span>${t("แก้ไขกลุ่ม")}</span></span><span class="btn-arrow">${icon("arrow", 18)}</span></button>` : ""}
      ${isOwner ? `<button class="button outline full summary-action-btn" data-action="copy-link" data-id="${escape(id)}"><span class="summary-btn-left">${icon("link", 18)} <span>${t("คัดลอกลิงก์เชิญ")}</span></span><span class="btn-arrow">${icon("arrow", 18)}</span></button>` : ""}
    </div></div>`;
  const history = (g.cycles || []).slice(0, -1).reverse().slice(0, 6)
    .map((c) => `<li><span>${t("รอบที่ {number}", { number: c.number })}</span><span>${shortDate(c.start)} – ${shortDate(c.end)}</span><b>${t(cycleStatusLabel[c.closedFrom] || "ปิดรอบแล้ว")}</b></li>`).join("");
  const panel = !cycle
    ? `<section class="group-payment-panel cycle-panel" aria-labelledby="cycle-heading"><span class="chip">${t("รอบรายเดือน")}</span><h2 id="cycle-heading">${t("ยังไม่เริ่มรอบแรก")}</h2><p>${isOwner ? t("กดเริ่มรอบแรกเมื่อพร้อม สมาชิกที่อยู่ในกลุ่มตอนนั้นจะอยู่ในรอบแรก ที่นั่งว่างเจ้าของกลุ่มจ่ายแทน") : t("เจ้าของกลุ่มจะเริ่มรอบแรกเมื่อพร้อม แล้วทุกคนยืนยันยอดเดือนละครั้ง")}</p></section>`
    : `<section class="group-payment-panel cycle-panel" aria-labelledby="cycle-heading"><span class="chip">${t("รอบที่ {number}", { number: cycle.number })}</span><h2 id="cycle-heading">${t(cycleStatusLabel[cycle.status])}</h2><p>${t("{start} ถึง {end} ยอดของรอบนี้ล็อกแล้ว คนเข้าหรือออกระหว่างรอบไม่ทำให้ยอดเปลี่ยน", { start: shortDate(cycle.start), end: shortDate(cycle.end) })}</p>
      <div class="cycle-progress"><span>${t("ยืนยันแล้ว {done} / {count} คน", { done: Object.keys(cycle.confirmations).length, count: cycle.members.length })}</span><span>${t("ชำระแล้ว {done} / {count} คน", { done: cyclePayers(cycle).filter((id) => cycle.payments[id] === "verified").length, count: cyclePayers(cycle).length })}</span></div>
      ${confirmed && me === cycle.ownerId ? ownerCyclePayout(cycle, g) : confirmed ? payment === "verified" ? `<p class="success-line">${icon("check", 18)} ${t("ชำระแล้ว")} ${money(myAmount)}</p>${cycle.receipts?.[me] ? `<p class="success-line">${icon("check", 18)} ${t("คุณยืนยันว่าได้รับสินค้าแล้ว")}</p>` : `<button class="button primary" data-action="confirm-cycle-receipt" data-id="${escape(id)}" data-cycle="${cycle.number}">${icon("check", 18)} ${t("ได้รับสินค้าหรือใช้งานได้แล้ว")}</button>`}` : payment === "reported" ? `<p class="summary-warning">${t(cyclePaymentLabel.reported)} ${money(myAmount)}</p>` : `<div class="cycle-pay"><h3>${payment === "rejected" ? t(cyclePaymentLabel.rejected) : t("โอนค่าเดือนนี้ {amount}", { amount: money(myAmount) })}</h3>${payment === "rejected" && cycle.rejections?.[me] ? `<p>${escape(cycle.rejections[me])}</p>` : ""}${paymentQr()}${cycleSlipForm(id, cycle.number)}</div>` : ""}
      ${history ? `<details class="cycle-history"><summary>${t("รอบที่ผ่านมา")}</summary><ul>${history}</ul></details>` : ""}
    </section>`;
  return { summary, panel };
}
/** The owner's side of a monthly cycle: what members transfer and what reaches the owner after 2%. */
function ownerCyclePayout(cycle, g = null) {
  const payers = cyclePayers(cycle);
  const waived = Boolean(myFeeWaiverUntil());
  const expected = ownerPayout(payers.map((id) => cycle.amounts[id]), { waived });
  const received = ownerPayout(payers.filter((id) => cycle.payments[id] === "verified").map((id) => cycle.amounts[id]), { waived });
  const receiptsDone = payers.filter((id) => cycle.receipts?.[id]).length;
  return `<div class="cycle-pay owner-cycle-payout"><h3>${t("คุณไม่ต้องโอน")}</h3><p>${t("สมาชิกโอนเข้ากองกลางของแพลตฟอร์ม คุณออกเงินซื้อสินค้าไปก่อน เมื่อสมาชิกยืนยันว่าได้รับสินค้าครบ เงินจะโอนให้คุณหลังหักค่าคอม 2%")}</p><dl class="owner-payout-lines"><div><dt>${t("สมาชิกโอนรวม")}</dt><dd>${money(expected.gross)}</dd></div><div><dt>${waived ? t("ค่าคอม 2% (ยกเว้นด้วยโค้ดพิเศษ)") : t("ค่าคอมแพลตฟอร์ม 2%")}</dt><dd>−${money(expected.commission)}</dd></div><div class="is-total"><dt>${t("คุณจะได้รับรอบนี้")}</dt><dd>${money(expected.net)}</dd></div><div><dt>${t("ตรวจแล้ว")}</dt><dd>${money(received.net)}</dd></div><div><dt>${t("ยืนยันรับสินค้า")}</dt><dd>${receiptsDone} / ${payers.length}</dd></div></dl>${payoutAccountReminder()}${g ? payoutsReceivedList(g) : ""}<p>${cycleReleased(cycle) ? t("สมาชิกยืนยันรับครบแล้ว แอดมินจะโอนเงินรอบนี้ให้คุณ") : t("เงินอยู่ในกองกลางจนกว่าสมาชิกที่จ่ายยืนยันว่าได้รับสินค้าครบ")}</p></div>`;
}
function paymentQr() {
  return `<figure class="cycle-qr"><img src="/images/bank-payment-qr.webp" alt="${t("QR บัญชีรับชำระเงิน")}" width="180" height="180" loading="lazy"/><figcaption>${t("สแกนเพื่อโอน แล้วแนบสลิป")}</figcaption></figure>`;
}

function groupPage(id) {
  let g = group(id);
  if (g && !supabaseConfigured && g.billing === "monthly") {
    // Demo mode rolls ended months on view, the way the database does on sync.
    const rolled = rollCycles(g);
    if (rolled !== g) updateGroup((g = rolled));
  }
  if (!g) {
    if (
      supabaseConfigured &&
      new URLSearchParams(location.search).has("invite")
    ) {
      if (state.user)
        return `<div class="empty"><h1>${t("คำเชิญไม่ถูกต้องหรือหมดอายุ")}</h1>${a("/explore", t("สำรวจกลุ่ม"), "button outline")}</div>`;
      sessionStorage.setItem(
        "harn-return",
        location.pathname + location.search,
      );
      return authRequiredView(
        t("คำเชิญเข้าร่วมกลุ่ม"),
        t("เข้าสู่ระบบเพื่อดูรายละเอียดและเข้าร่วมกลุ่มจากลิงก์เชิญ"),
      );
    }
    return notFound();
  }
  const p = listing(g.listingId);
  if (!p) return notFound();
  const groupDetails = g.details || g;
  const groupCategory = g.category || p.category;
  const groupCategories = g.categories?.length ? g.categories : [groupCategory];
  const seatMode = g.costs?.mode === SEAT_MODE;
  const monthly = g.billing === "monthly";
  const costs = costBreakdown(g.costs, seatMode ? g.capacity : g.members.length);
  const sum = costs.total;
  const alloc = shares(g);
  const me = state.user?.id;
  const isMember = g.members.includes(me);
  const isOwner = g.ownerId === me;
  // Seat-priced groups: the owner never transfers; they receive the members' payments minus 2%.
  const ownerSeat = seatMode && isOwner;
  // What the owner gets once every other seat is filled and paid, minus 2% unless the promo waives it.
  const payout = ownerSeat
    ? ownerPayout(Array.from({ length: g.capacity - 1 }, (_, i) => seatPrice(g.costs, g.capacity, i + 1)), { waived: Boolean(myFeeWaiverUntil()) })
    : null;
  const ownSeatShare = ownerSeat ? seatPrice(g.costs, g.capacity, 0) : 0;
  const locked = !!g.orderId;
  const full = g.members.length === g.capacity;
  const approved = g.approvals[me] === g.revision;
  const adminApproved = g.adminApprovedRevision === g.revision;
  const remaining = g.capacity - g.members.length;
  const estimateCount = g.members.length + (isMember || full ? 0 : 1);
  const estimate = seatMode ? joinEstimate(g) : Math.ceil(totalCost(g.costs, estimateCount) / estimateCount);
  const fullEstimate = seatMode ? estimate : Math.ceil(totalCost(g.costs, g.capacity) / g.capacity);
  const allMembersApproved = full && g.members.every((memberId) => g.approvals[memberId] === g.revision);
  const cycle = monthly ? currentCycle(g) : null;
  const status = monthly
    ? !cycle
      ? t("รวบรวมสมาชิก ยังไม่เริ่มรอบแรก")
      : t(cycleStatusLabel[cycle.status] || "รอยืนยันยอดรอบนี้")
    : locked
    ? t("ปิดรับสมาชิก")
    : !full
      ? t("กำลังเปิดรับสมาชิก")
      : allApproved(g)
        ? supabaseConfigured ? t("ยอดกลุ่มพร้อมแล้ว") : t("พร้อมสรุปคำสั่งซื้อ")
        : allMembersApproved
          ? t("รอแอดมินอนุมัติยอดกลุ่ม")
          : t("รอสมาชิกยืนยันยอด");
  const paymentReport = g.paymentReport;
  const hasCurrentPaymentReport = paymentReport && Number(paymentReport.revision) === Number(g.revision);
  const hasVisiblePaymentReport = hasCurrentPaymentReport && ["reported", "verified"].includes(paymentReport.status);
  const paymentStatusState = hasCurrentPaymentReport
    ? paymentReport.status
    : !supabaseConfigured
      ? "demo"
      : !isMember
        ? "not-member"
        : locked
          ? "closed"
          : !approved
            ? "approval-needed"
            : "awaiting-report";
  const paymentStatusCopy = {
    reported: ["แจ้งโอนแล้ว รอแอดมินตรวจยอด", "ระบบส่งรายการให้แอดมินตรวจสอบยอดเงินจริงแล้ว", "กำลังรอตรวจสอบ"],
    verified: ["ตรวจยอดแล้ว", "แอดมินตรวจสอบยอดโอนของคุณแล้ว", "ยืนยันรับเงินแล้ว"],
    rejected: ["ยอดโอนไม่ตรง กรุณาโอนใหม่", paymentReport?.rejection_note ? `${paymentReport.rejection_note} กรุณาโอนยอดให้ถูกต้องอีกครั้งและแนบสลิปใหม่` : "แอดมินปฏิเสธรายการนี้ กรุณาโอนยอดให้ถูกต้องอีกครั้งและแนบสลิปใหม่เพื่อให้ตรวจสอบ", "ต้องโอนใหม่และแจ้งอีกครั้ง"],
    demo: ["ระบบชำระเงินจริงยังไม่พร้อม", "หน้าจอนี้แสดงข้อมูลเดโม ยังไม่มีการตรวจรับเงินจริง", "โหมดเดโม"],
    "not-member": ["ยังไม่ได้เข้าร่วมกลุ่ม", "เข้าร่วมและยืนยันยอดส่วนแบ่งก่อน จึงจะแจ้งชำระเงินได้", "ชำระเงินได้หลังเข้าร่วมกลุ่ม"],
    closed: ["กลุ่มปิดแล้ว", "กลุ่มนี้ปิดรับสมาชิกและการชำระเงินแล้ว", "ปิดรับชำระเงิน"],
    "approval-needed": ["รอยืนยันยอดส่วนแบ่ง", "ยืนยันยอดรอบปัจจุบันก่อน แล้วจึงแจ้งโอนให้แอดมินตรวจได้", "ยังไม่ได้แจ้งโอน"],
    "awaiting-report": ["ยังไม่ได้แจ้งโอน", "หากโอนแล้ว กดแจ้งโอนเพื่อให้แอดมินตรวจยอดเงินจริง", "รอแจ้งโอน"],
  }[paymentStatusState];
  const paymentStatusAmount = hasCurrentPaymentReport
    ? paymentReport.amount_satang
    : isMember
      ? alloc[me]
      : estimate;
  const earlyPaymentReportPanel = !ownerSeat && isMember && supabaseConfigured && approved && !adminApproved && !hasVisiblePaymentReport
    ? hasCurrentPaymentReport
      && paymentReport.status !== "rejected"
      ? `<section class="group-payment-panel" aria-labelledby="group-payment-heading"><div><span class="chip">${t("ชำระเงิน")}</span><h2 id="group-payment-heading">${paymentReport.status === "verified" ? t("ตรวจยอดแล้ว") : t("แจ้งโอนแล้ว รอแอดมินตรวจยอด")}</h2><p>${paymentReport.status === "verified" ? t("แอดมินตรวจสอบยอดโอนของคุณแล้ว") : t("ระบบส่งรายการให้แอดมินตรวจสอบยอดเงินจริงแล้ว")}</p></div><div class="group-payment-reported"><strong>${money(paymentReport.amount_satang)}</strong><span>${paymentReport.status === "verified" ? t("ยืนยันรับเงินแล้ว") : t("กำลังรอตรวจสอบ")}</span></div></section>`
      : `<section class="group-payment-panel" aria-labelledby="group-payment-heading"><div><span class="chip">${t("ชำระเงิน")}</span><h2 id="group-payment-heading">${paymentReport?.status === "rejected" ? t("ยอดโอนไม่ตรง กรุณาโอนใหม่") : t("โอนแล้วใช่ไหม?")}</h2><p>${paymentReport?.status === "rejected" ? t("แอดมินปฏิเสธรายการนี้ กรุณาโอนยอดที่ถูกต้องอีกครั้ง แล้วแนบสลิปใหม่เพื่อให้ตรวจสอบ") : t("ถ้าคุณโอนยอดส่วนนี้แล้ว แจ้งแอดมินให้ตรวจรายการเงินเข้าได้เลย")}</p></div>${paymentSlipForm(id, g.revision)}</section>`
    : "";
  const groupPaymentSection = !ownerSeat && isMember && supabaseConfigured && full && allApproved(g) && Number(alloc[me]) > 0
    ? hasVisiblePaymentReport
      ? ""
      : `<section class="group-payment-panel" aria-labelledby="group-payment-heading"><div><span class="chip">${t("ชำระเงิน")}</span><h2 id="group-payment-heading">${paymentReport?.status === "rejected" ? t("ยอดโอนไม่ตรง กรุณาโอนใหม่") : t("โอนเงินเข้าบัญชี")}</h2><p>${paymentReport?.status === "rejected" ? t("แอดมินปฏิเสธรายการนี้ กรุณาโอนยอดที่ถูกต้องอีกครั้ง แล้วแนบสลิปใหม่เพื่อให้ตรวจสอบ") : t("สแกน QR บัญชีธนาคาร แล้วกดแจ้งโอนหลังโอนเงินจริง เพื่อให้แอดมินตรวจยอด")}</p></div><div class="group-payment-transfer"><div class="bank-payment-qr-frame"><img src="${BANK_PAYMENT_QR_SRC}" alt="${t("QR สำหรับโอนเงินเข้าบัญชี")}"/></div><div><small>${t("ชื่อบัญชีรับโอน")}</small><strong>${BANK_PAYMENT_RECIPIENT}</strong><small>${t("ยอดที่ต้องโอน")}</small><b>${money(alloc[me])}</b>${paymentReport?.status === "rejected" && paymentReport.rejection_note ? `<p class="group-payment-rejection">${escape(paymentReport.rejection_note)}</p>` : ""}${paymentSlipForm(id, g.revision)}</div></div></section>`
    : "";
  const actions = `
    ${!isMember && !full && !locked ? a(`/groups/${id}/join`, `<span>${t("เข้าร่วมกลุ่ม")}</span><span class="btn-arrow">${icon("arrow", 18)}</span>`, "button primary full summary-action-btn") : ""}
    ${isMember && !approved && !locked ? ownerSeat ? `<button class="button primary full summary-action-btn" data-action="approve-owner" data-id="${id}" data-revision="${g.revision}"><span>${t("ยืนยันยอดกลุ่ม")}</span><span class="btn-arrow">${icon("arrow", 18)}</span></button>` : `<button class="button primary full summary-action-btn" data-action="approve" data-id="${id}" data-revision="${g.revision}"><span>${t("ยืนยันยอด {amount}", { amount: money(alloc[me]) })}</span><span class="btn-arrow">${icon("arrow", 18)}</span></button>` : ""}
    ${isMember && approved && !adminApproved ? `<div class="warning summary-warning"><span class="warning-icon">${icon("clock", 18)}</span><span>${full && allMembersApproved ? t("รอแอดมินอนุมัติยอดกลุ่ม") : t("คุณยืนยันยอดแล้ว รอสมาชิกครบ")}</span></div>` : ""}
    ${isMember && approved && adminApproved ? `<div class="success-line">${icon("check", 18)} ${t("คุณยืนยันยอดรอบนี้แล้ว")}</div>` : ""}
    ${seatMode && !isOwner && paymentReport?.status === "verified" ? g.myReceipt ? `<div class="success-line">${icon("check", 18)} ${t("คุณยืนยันว่าได้รับสินค้าแล้ว")}</div>` : `<button class="button primary full summary-action-btn" data-action="confirm-receipt" data-id="${id}"><span>${t("ได้รับสินค้าแล้ว")}</span><span class="btn-arrow">${icon("check", 18)}</span></button><p class="summary-receipt-note">${t("กดเมื่อได้รับสินค้าหรือใช้งานแอปได้แล้ว เงินในกองกลางจะโอนให้เจ้าของกลุ่มเมื่อทุกคนยืนยันครบ")}</p>` : ""}
    ${isMember ? a(`/groups/${id}/chat`, `<span class="summary-btn-left">${icon("chat", 19)} <span>${t("แชทกลุ่ม")}</span></span><span class="btn-arrow">${icon("arrow", 18)}</span>`, "button outline full summary-action-btn") : ""}
    ${isMember && !isOwner && !locked ? `<button class="button danger-soft full summary-action-btn" data-action="leave" data-id="${id}"><span class="summary-btn-left">${icon("back", 19)} <span>${t("ออกจากกลุ่ม")}</span></span><span class="btn-arrow">${icon("arrow", 18)}</span></button>` : ""}
    ${isOwner && !locked ? `<button class="button outline full summary-action-btn" data-action="edit-group" data-id="${id}"><span class="summary-btn-left">${icon("edit", 19)} <span>${t("แก้ไขกลุ่ม")}</span></span><span class="btn-arrow">${icon("arrow", 18)}</span></button>` : ""}
    ${isOwner && !locked ? `<button class="button outline full summary-action-btn" data-action="copy-link" data-id="${id}"><span class="summary-btn-left">${icon("link", 18)} <span>${t("คัดลอกลิงก์เชิญ")}</span></span><span class="btn-arrow">${icon("arrow", 18)}</span></button>` : ""}
    ${locked ? `<div class="summary-info-box"><span class="info-icon">${icon("info", 22)}</span><span class="info-divider"></span><span>${t("กลุ่มถูกล็อกตามยอดคำสั่งซื้อเดโมแล้ว")}</span></div>` : ""}
    ${isMember && !supabaseConfigured ? a(`/orders/${id}`, `<span class="summary-btn-left">${icon("calc", 19)} <span>${t("ดูสรุปคำสั่งซื้อเดโม")}</span></span><span class="btn-arrow">${icon("arrow", 18)}</span>`, "button subtle full summary-action-btn") : ""}
    ${isMember && supabaseConfigured && !full ? `<div class="summary-info-box"><span class="info-icon">${icon("info", 22)}</span><span class="info-divider"></span><span>${t("ยืนยันยอดส่วนแบ่งก่อน เมื่อโอนเงินจริงแล้วแจ้งแอดมินตรวจได้ ส่วนสรุปคำสั่งซื้อรอสมาชิกครบ")}</span></div>` : ""}
  `;
  if (monthly) {
    const view = monthlyGroupView(g, id, { isMember, isOwner, full, locked, estimate });
    return groupPageLayout({ g, p, id, groupDetails, groupCategory, groupCategories, status, full, remaining, isMember, isOwner, locked, costs, sum, seatMode, monthly,
      summaryCard: view.summary, paymentSection: view.panel, paymentStatusCard: "", alloc, me, adminApproved });
  }
  const summaryCard = ownerSeat
    ? `<div class="summary-card owner-payout-card"><small>${t("คุณจะได้รับเมื่อสมาชิกโอนครบ")}</small><strong>${money(payout.net)}</strong><dl class="owner-payout-lines"><div><dt>${t("สมาชิกโอนรวม ({count} ที่นั่ง)", { count: g.capacity - 1 })}</dt><dd>${money(payout.gross)}</dd></div><div><dt>${myFeeWaiverUntil() ? t("ค่าคอม 2% (ยกเว้นด้วยโค้ดพิเศษ)") : t("ค่าคอมแพลตฟอร์ม 2%")}</dt><dd>−${money(payout.commission)}</dd></div><div><dt>${t("ส่วนของคุณเอง (ไม่ต้องโอน)")}</dt><dd>${money(ownSeatShare)}</dd></div></dl>${payoutAccountReminder()}${payoutsReceivedList(g)}<p>${t("สมาชิกโอนเข้ากองกลางของแพลตฟอร์ม คุณออกเงินซื้อสินค้าไปก่อน เมื่อสมาชิกยืนยันว่าได้รับสินค้าครบ เงินจะโอนให้คุณหลังหักค่าคอม 2%")}</p>${actions}</div>`
    : `<div class="summary-card"><small>${isMember ? t("ยอดที่คุณต้องยืนยัน") : full || locked ? t("ประมาณต่อคนปัจจุบัน") : t("ยอดประมาณเมื่อเข้าร่วม")}</small><strong>${money(isMember ? alloc[me] : estimate)}</strong>${!full ? `<div class="summary-future-price"><span>${t("เมื่อครบ {count} คน", { count: g.capacity })}</span><b>${money(fullEstimate)} <small>${t("/คน")}</small></b></div>` : ""}<p>${isMember ? t("ยอดรอบที่ {revision}", { revision: g.revision }) + (approved ? adminApproved ? t(" · คุณยืนยันแล้ว") : full && allMembersApproved ? t(" · รอแอดมินอนุมัติยอดกลุ่ม") : t(" · คุณยืนยันแล้ว รอสมาชิกครบ") : t(" · กรุณาตรวจสอบก่อนยืนยัน")) : full || locked ? t("กลุ่มนี้ยังไม่เปิดรับสมาชิกใหม่") : t("ยอดจะคำนวณใหม่เมื่อคุณเข้าร่วม และสมาชิกทุกคนต้องยืนยันอีกครั้ง")}</p>${actions}${!full ? `<p class="warning summary-warning"><span class="warning-icon">${icon("alert-circle", 20)}</span><span>${t("ยังสั่งซื้อไม่ได้จนกว่าสมาชิกจะครบและยืนยันยอดทุกคน")}</span></p>` : !allApproved(g) && !approved ? `<p class="warning summary-warning"><span class="warning-icon">${icon("alert-circle", 20)}</span><span>${allMembersApproved ? t("รอแอดมินอนุมัติยอดกลุ่ม") : t("รอสมาชิกทุกคนยืนยันยอดรอบล่าสุด")}</span></p>` : ""}</div>`;
  const paymentStatusCard = ownerSeat ? "" : `<section class="group-payment-panel group-payment-status-card is-${paymentStatusState}" aria-labelledby="payment-status-heading"><span class="chip">${t("ชำระเงิน")}</span><h2 id="payment-status-heading">${t(paymentStatusCopy[0])}</h2><p>${escape(t(paymentStatusCopy[1]))}</p><strong>${money(paymentStatusAmount)}</strong><span>${t(paymentStatusCopy[2])}</span></section>`;
  return groupPageLayout({ g, p, id, groupDetails, groupCategory, groupCategories, status, full, remaining, isMember, isOwner, locked, costs, sum, seatMode, monthly,
    summaryCard, paymentSection: earlyPaymentReportPanel || groupPaymentSection, paymentStatusCard, alloc, me, adminApproved });
}
function groupPageLayout({ g, p, id, groupDetails, groupCategory, groupCategories, status, full, remaining, isMember, isOwner, locked, costs, sum, seatMode, monthly, summaryCard, paymentSection, paymentStatusCard, alloc, me, adminApproved }) {
  const monthlyCycle = monthly ? currentCycle(g) : null;
  return `<div class="group-page">
    <nav class="breadcrumb product-breadcrumb" aria-label="${t("เส้นทางนำทาง")}">
      ${a("/explore", t("สำรวจ"))}<span aria-hidden="true">/</span>
      <span aria-current="page">${escape(g.name)}</span>
    </nav>
    <div class="group-detail">
      <main class="group-detail-main">
        <section class="group-identity-card" aria-labelledby="group-title">
          <div class="group-heading-line"><div><h1 id="group-title">${escape(g.name)}</h1><p>${t("หมวดหมู่")}: ${groupCategories.map((category) => escape(t(category))).join(" · ")}</p></div><span class="group-state ${full ? "is-full" : "is-open"}">${status}</span></div>
          <div class="group-product-strip">
            ${p.images?.[0] || g.images?.[0] ? `<div class="group-product-art" role="img" aria-label="${escape(t(groupCategory))}"><img src="${escape(p.images?.[0] || g.images[0])}" alt=""/></div>` : `<div class="group-product-art ${p.productDetails?.type === "digital" ? "is-digital" : ""}" role="img" aria-label="${escape(t(groupCategory))}">${art({ ...p, category: groupCategory })}</div>`}
            <div class="group-product-copy"><span>${t("สินค้าในกลุ่ม")}</span><strong>${escape(p.title || g.name)}</strong><small>${escape(t(groupCategory))}${p.productDetails?.type === "digital" ? ` · ${escape(p.productDetails.platform || "")} ${escape(p.productDetails.serviceType || "")}` : ""}</small>${p.productDetails?.url ? `<a href="${escape(p.productDetails.url)}" target="_blank" rel="noopener noreferrer">${t("เปิดลิงก์สินค้า")}</a>` : ""}</div>
            <div class="group-product-price"><span>${t("ราคาสินค้า")}</span><strong>${money(p.price ?? g.costs.product)}</strong></div>
          </div>
          <div class="group-identity-footer"><span class="chip">${groupDetails.visibilityMode === "private" ? t("ส่วนตัว") : g.visibility === "link" ? t("เฉพาะผู้มีลิงก์") : t("กลุ่มสาธารณะ")}</span>${g.images?.length ? gallery(g.images) : ""}</div>
          <div class="group-created-details">${groupDetails.minimumMembers ? `<span>${t("สมาชิกขั้นต่ำ")}: <strong>${groupDetails.minimumMembers} ${t("คน")}</strong></span>` : ""}${groupDetails.closesAt ? `<span>${t("ปิดรับสมาชิก")}: <strong>${escape(groupDetails.closesAt)}</strong></span>` : ""}${groupDetails.deliveryMethod === "pickup" && groupDetails.pickupLocation ? `<span>${t("สถานที่นัดรับ")}: <strong>${escape(groupDetails.pickupLocation)}</strong></span>` : groupDetails.deliveryMethod ? `<span>${t("วิธีรับสินค้า")}: <strong>${t(({ship_to_owner:"จัดส่งรวม",ship_separately:"จัดส่งแยก",digital:"ส่งมอบสิทธิ์ดิจิทัล",pickup:"นัดรับ"})[groupDetails.deliveryMethod] || "จัดส่งรวม")}</strong></span>` : ""}${groupDetails.digitalHandoff ? `<span>${t("การส่งมอบสิทธิ์")}: <strong>${escape(groupDetails.digitalHandoff)}</strong></span>` : ""}${groupDetails.memberNote ? `<p>${t("หมายเหตุถึงสมาชิก")}: ${escape(groupDetails.memberNote)}</p>` : ""}</div>
        </section>
        <section class="members-card group-members-card" aria-labelledby="members-heading">
          <div class="group-section-head"><div><h2 id="members-heading">${t("สมาชิก {count} / {capacity} คน", { count: g.members.length, capacity: g.capacity })}</h2><p>${status}</p></div><strong>${remaining ? t("ว่าง {count} ที่", { count: remaining }) : t("สมาชิกครบแล้ว")}</strong></div>
          <div class="progress" role="progressbar" aria-label="${t("ความคืบหน้า")}" aria-valuemin="0" aria-valuemax="${g.capacity}" aria-valuenow="${g.members.length}"><span style="width:${(g.members.length / g.capacity) * 100}%"></span></div>
          <div class="group-member-list">${g.members.map((memberId) => { const memberName = name(memberId); const memberProfile = state.profiles?.[memberId] || {}; const memberAvatar = profileAvatarMarkup({ name: memberName, avatar: memberProfile.avatar || memberProfile.avatar_url || "" }); const profileHref = `/profile/member/${encodeURIComponent(memberId)}?group=${encodeURIComponent(id)}`; const memberApproved = monthlyCycle ? Boolean(monthlyCycle.confirmations[memberId]) : g.approvals[memberId] === g.revision; const inThisCycle = !monthlyCycle || monthlyCycle.members.includes(memberId); return `<div class="group-member-row">${a(profileHref, `<span class="avatar small">${memberAvatar}</span><span class="group-member-name"><strong>${escape(memberName)}</strong>${memberId === g.ownerId && !memberName.includes("หัวหน้ากลุ่ม") ? `<small>${t("หัวหน้ากลุ่ม")}</small>` : ""}</span>`, "group-member-person")}<span class="member-approval ${memberApproved && (adminApproved || monthlyCycle) ? "approved" : ""}">${monthlyCycle ? !inThisCycle ? t("เริ่มจ่ายรอบหน้า") : memberApproved ? t("ยืนยันรอบนี้แล้ว") : t("รอยืนยันรอบนี้") : memberApproved ? adminApproved ? t("ยืนยันยอดกลุ่มแล้ว") : t("สมาชิกยืนยันแล้ว") : t("รอยืนยันยอด")}</span><b>${monthlyCycle ? inThisCycle ? money(monthlyCycle.amounts[memberId]) : "–" : money(alloc[memberId])}</b>${isOwner && !locked && memberId !== me ? `<button class="button danger-soft" data-action="kick-member" data-id="${id}" data-member="${memberId}">${t("เตะออก")}</button>` : ""}</div>`; }).join("")}
            ${remaining ? `<div class="group-open-row"><span class="avatar small">${icon("plus", 18)}</span><div><strong>${t("ยังว่างอีก {count} ที่", { count: remaining })}</strong><small>${t("รอสมาชิกเข้าร่วม")}</small></div>${!isMember && !locked ? a(`/groups/${id}/join`, t("เข้าร่วมกลุ่ม"), "button outline") : ""}</div>` : ""}
          </div>
        </section>
        <section class="cost-card group-cost-card" aria-labelledby="cost-heading"><h2 id="cost-heading">${monthly ? t("ค่าใช้จ่ายต่อเดือน") : t("ค่าใช้จ่ายรอบที่ {revision}", { revision: g.revision })}</h2><div><span>${t("ราคาสินค้า")}</span><b>${money(p.price ?? costs.product)}</b></div><div><span>${t("ค่าส่งรวม")}</span><b>${money(groupDetails.shippingTotal ?? costs.delivery)}</b></div>${!seatMode ? `<div><span>${t("ค่าธรรมเนียมแพลตฟอร์ม 2%")}</span><b>${money(costs.service)}</b></div>` : ""}<div class="total"><span>${t("รวมทั้งหมด")}</span><b>${money(sum)}</b></div><p>${seatMode ? t("ราคาต่อที่นั่งคงที่ ผู้ร่วมหารจ่ายเฉพาะราคาที่นั่ง ไม่มีค่าธรรมเนียม แพลตฟอร์มหักค่าคอม 2% จากเงินที่โอนต่อให้เจ้าของกลุ่ม") : t("หารตามจำนวนสมาชิกปัจจุบัน เศษสตางค์จัดสรรตามลำดับที่เข้ากลุ่ม")}</p></section>
    ${paymentSection}
        <details class="group-history"><summary>${t("ประวัติการเปลี่ยนยอด")}</summary>${g.history
          .slice()
          .reverse()
          .map(
            (h) =>
              `<p>${t("รอบ {revision}", { revision: h.revision })} · ${escape(t(h.reason))}</p>`,
          )
          .join("")}</details>
      </main>
      <aside class="group-detail-aside">${summaryCard}
      ${paymentStatusCard}
      </aside>
    </div>
  </div>`;
}
function joinPage(id) {
  const g = group(id);
  if (!g) {
    if (
      supabaseConfigured &&
      new URLSearchParams(location.search).has("invite")
    ) {
      if (!state.user) {
        sessionStorage.setItem(
          "harn-return",
          location.pathname + location.search,
        );
        return authRequiredView(
          t("ยืนยันการเข้าร่วมกลุ่ม"),
          t("เข้าสู่ระบบเพื่อดูรายละเอียดและเข้าร่วมกลุ่มจากลิงก์เชิญ"),
        );
      }
      return `<div class="empty"><h1>${t("คำเชิญไม่ถูกต้องหรือหมดอายุ")}</h1>${a("/explore", t("สำรวจกลุ่ม"), "button outline")}</div>`;
    }
    return notFound();
  }
  if (!requireAuth(`/groups/${id}/join`))
    return authRequiredView(
      t("ยืนยันการเข้าร่วมกลุ่ม"),
      t("เข้าสู่ระบบก่อนเพื่อเข้าร่วมกลุ่มและยืนยันยอด"),
    );
  if (g.members.includes(state.user.id))
    return `<div class="empty"><h1>${t("คุณอยู่ในกลุ่มนี้แล้ว")}</h1>${a(`/groups/${id}`, t("ดูกลุ่ม"), "button primary")}</div>`;
  if (g.members.length >= g.capacity)
    return `<div class="empty"><h1>${t("กลุ่มนี้เต็มแล้ว")}</h1>${a(`/groups/${id}`, t("ดูกลุ่ม"), "button secondary")}</div>`;
  const seatJoin = g.costs?.mode === SEAT_MODE;
  const count = seatJoin ? g.capacity : g.members.length + 1,
    costs = costBreakdown(g.costs, count),
    estimate = seatJoin ? joinEstimate(g) : Math.ceil(costs.total / count);
  return `${title(t("ยืนยันการเข้าร่วม"), escape(g.name))}<div class="narrow"><div class="cost-card"><h2>${escape(g.name)}</h2><div><span>${t("ราคาสินค้า")}</span><b>${money(costs.product)}</b></div><div><span>${costs.deliveryPerMember === null ? t("ค่าส่ง") : t("ค่าส่ง {amount} × {count} คน", { amount: money(costs.deliveryPerMember), count })}</span><b>${money(costs.delivery)}</b></div>${costs.commissionFromOwner ? "" : `<div><span>${costs.deliveryPerMember === null ? t("ค่าบริการ") : t("ค่าธรรมเนียมแอป 2%")}</span><b>${money(costs.service)}</b></div>`}<div class="total"><span>${seatJoin ? t("ราคาที่นั่งของคุณ") : t("ยอดประมาณของคุณ")}</span><b>${money(estimate)}</b></div></div><div class="info-box">${seatJoin ? t("คุณจ่ายเฉพาะราคาที่นั่ง ไม่มีค่าธรรมเนียม ยอดนี้ไม่เปลี่ยนเมื่อมีคนเข้าหรือออก") : t("เมื่อเข้าร่วม ระบบจะคำนวณยอดใหม่และให้สมาชิกทุกคน รวมถึงคุณ ยืนยันยอดรอบใหม่อีกครั้ง ยังไม่มีการเก็บเงินจริง")}</div><button class="button primary full" data-action="join" data-id="${id}">${t("ยืนยันเข้าร่วมกลุ่ม")}</button>${a(`/groups/${id}`, t("กลับไปดูกลุ่ม"), "button outline full")}</div>`;
}
function createPage() {
  if (!requireAuth(location.pathname + location.search))
    return authRequiredView(
      t("สร้างกลุ่มหารใหม่"),
      t("กำหนดจำนวนคนและค่าใช้จ่ายให้ชัดก่อนชวนเพื่อน"),
    );
  const params = new URLSearchParams(location.search),
    requested = params.get("product"),
    allListings = listings(),
    requestedListing = allListings.find((item) => item.id === requested);
  const selected = requestedListing?.id || allListings[0]?.id,
    initialCategory = requestedListing?.category || CREATE_CATEGORY_NAMES[0];
  if (!selectedCreateCategories.length)
    selectedCreateCategories = [initialCategory];
  const selectedCategory = selectedCreateCategories[0],
    selectedListing =
      allListings.find((item) => item.category === selectedCategory) ||
      listing(selected);
  const categoryTags = selectedCreateCategories
    .map(
      (category) =>
        `<button type="button" class="selected-category" data-action="remove-category" data-category="${escape(category)}" aria-label="${t("นำหมวดหมู่ออก {category}", { category: t(category) })}">${escape(t(category))}<span aria-hidden="true">×</span></button>`,
    )
    .join("");
  const today = new Date();
  const groupDateMin = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  return `${title(t("สร้างกลุ่มหารของ"), t("ชวนเพื่อนมาหารค่าใช้จ่าย เห็นยอดต่อคนก่อนสร้างกลุ่ม"))}<div class="create-group-layout"><form class="form-panel create-group-form" id="create-form" novalidate>
    <input type="hidden" name="requestId" value="${crypto.randomUUID()}"/><input type="hidden" name="listingId" value="${selectedListing?.id || selected || ""}"/><input type="hidden" name="category" value="${escape(selectedCategory)}"/>
    <nav class="create-stepper" aria-label="${t("ขั้นตอนการสร้างกลุ่ม")}">${[[1,"ข้อมูลสินค้า"],[2,"ตั้งค่ากลุ่ม"],[3,"สรุปกลุ่ม"]].map(([step,label])=>`<button type="button" data-action="create-step" data-step="${step}" aria-current="${createGroupStep===step?"step":"false"}" class="${createGroupStep===step?"active":""}"><span>${step}</span>${t(label)}</button>`).join("")}</nav>
    <section class="create-step-panel" data-create-step-panel="1" ${createGroupStep===1?"":"hidden"}>
      <div class="create-form-section"><h2>${icon("package",20)} ${t("ข้อมูลสินค้า")}</h2><fieldset class="product-type-picker"><legend>${t("ประเภทสินค้า")} <b>*</b></legend><label><input type="radio" name="productType" value="physical" checked/><span>${icon("package",20)}<strong>${t("สินค้าทั่วไป")}</strong><small>${t("มีการจัดส่ง")}</small></span></label><label><input type="radio" name="productType" value="digital"/><span>${icon("lock",20)}<strong>${t("สินค้าดิจิทัล")}</strong><small>${t("แอป / Subscription")}</small></span></label></fieldset>
      <div class="image-editor"><h3>${t("รูปสินค้า")} <b class="required-mark">*</b><small>${t("ต้องเพิ่มอย่างน้อย 1 รูป · สูงสุด 4 รูป")}</small></h3><label class="image-upload create-group-dropzone"><span class="create-group-upload-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V4m0 0L8 8m4-4 4 4"/><path d="M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/></svg></span><strong>${t("คลิกเพื่ออัปโหลด หรือลากรูปมาวาง")}</strong><small>${t("JPG, PNG หรือ WebP · ไม่เกิน 5 MB ต่อรูป · ระบบย่อรูปให้อัตโนมัติ")}</small><span class="create-group-browse">${icon("plus",16)} ${t("เลือกไฟล์")}</span><input id="group-images" type="file" accept="image/jpeg,image/png,image/webp" multiple aria-label="${t("เลือกรูปสินค้า")}"/></label><div id="image-draft">${gallery(groupImages,true)}</div><p id="image-upload-status" role="status"></p></div>
      <label>${t("ชื่อสินค้า")} <b>*</b><input name="productTitle" maxlength="100" required value="${escape(selectedListing?.title || "")}" placeholder="${t("เช่น คีย์บอร์ดสำหรับทำงาน")}"/></label>
      <label>${t("ลิงก์สินค้า")} <small>${t("ไม่บังคับ")}</small><input name="productUrl" type="url" maxlength="500" placeholder="https://"/></label>
      <label>${t("รายละเอียดสินค้า")} <small>${t("ไม่บังคับ")}</small><textarea name="productDescription" maxlength="1000" placeholder="${t("รายละเอียดหรือเงื่อนไขที่สมาชิกควรรู้")}">${escape(selectedListing?.description || "")}</textarea></label>
      <fieldset class="category-picker"><legend>${t("หมวดหมู่สินค้า")} <b>*</b></legend><div class="selected-categories" id="selected-categories">${categoryTags}</div><div class="category-options">${CREATE_CATEGORY_NAMES.map((category) => `<button type="button" class="category-option ${selectedCreateCategories.includes(category) ? "selected" : ""}" data-action="toggle-category" data-category="${escape(category)}" aria-pressed="${selectedCreateCategories.includes(category)}">${t(category)}</button>`).join("")}</div></fieldset>
      <label id="other-category-wrap" ${selectedCreateCategories.includes("อื่น ๆ (ระบุชื่อเอง)") ? "" : "hidden"}>${t("ระบุชื่อหมวดหมู่")}<input name="otherCategory" maxlength="60" ${selectedCreateCategories.includes("อื่น ๆ (ระบุชื่อเอง)") ? "required" : ""} placeholder="${t("ระบุชื่อหมวดหมู่")}"/></label>
      <div class="digital-product-fields" id="digital-product-fields" hidden><label>${t("แพลตฟอร์ม")} <b>*</b><select name="digitalPlatform"><option value="">${t("เลือกแพลตฟอร์ม")}</option>${["iOS","Android","Windows","macOS","Website"].map(x=>`<option>${x}</option>`).join("")}</select></label><div class="form-grid"><label>${t("ประเภทบริการ")} <b>*</b><select name="digitalService"><option value="">${t("เลือกประเภท")}</option>${["Subscription","License","In-app Purchase"].map(x=>`<option>${x}</option>`).join("")}</select></label><label>${t("ระยะเวลาใช้งาน")} <b>*</b><input name="usageDuration" maxlength="60" placeholder="${t("เช่น 1 เดือน")}"/></label></div><div class="form-grid"><label>${t("สิทธิ์ที่แชร์ได้")} <b>*</b><input name="sharedSeats" type="number" min="2" max="20" value="2"/></label><label>${t("เงื่อนไขการแชร์")} <small>${t("ไม่บังคับ")}</small><input name="sharingConditions" maxlength="300" placeholder="${t("เช่น ใช้ได้พร้อมกัน 2 เครื่อง")}"/></label></div></div></div>
      <div class="create-step-actions"><span></span><button type="button" class="button primary" data-action="create-step" data-step="2">${t("ต่อไป: ตั้งค่ากลุ่ม")} ${icon("arrow",18)}</button></div>
    </section>
    <section class="create-step-panel" data-create-step-panel="2" ${createGroupStep===2?"":"hidden"}>
      <div class="create-form-section"><h2>${icon("users",20)} ${t("ตั้งค่ากลุ่ม")}</h2><label>${t("ชื่อกลุ่ม")} <b>*</b><input name="name" maxlength="70" required placeholder="${t("เช่น หารค่าสมัครกับเพื่อน")}"/></label><div class="form-grid"><label>${t("สมาชิกขั้นต่ำ")} <b>*</b><input name="minimumMembers" type="number" min="2" max="6" value="3" required/></label><label>${t("สมาชิกสูงสุด")} <b>*</b><input name="capacity" type="number" min="2" max="6" value="4" required/></label></div><label>${t("วันปิดรับสมาชิก")} <b>*</b><input name="closesAt" type="date" min="${groupDateMin}" required/></label><fieldset class="visibility-picker"><legend>${t("การมองเห็นกลุ่ม")}</legend>${[["public","สาธารณะ"],["link","เฉพาะผู้มีลิงก์"],["private","ส่วนตัว"]].map(([value,label])=>`<label><input type="radio" name="visibilityMode" value="${value}" ${value==="public"?"checked":""}/><span>${t(label)}</span></label>`).join("")}</fieldset><fieldset class="visibility-picker billing-picker"><legend>${t("รูปแบบการจ่าย")} <b>*</b></legend><label><input type="radio" name="billing" value="one_time" checked/><span>${t("รอบเดียวจบ")}</span></label><label><input type="radio" name="billing" value="monthly"/><span>${t("จ่ายรายเดือน")}</span></label><small>${t("รายเดือน: ยอดต่อที่นั่งคงที่ทุกเดือน ทุกคนยืนยันเดือนละครั้ง")}</small></fieldset><label>${t("หมายเหตุถึงสมาชิก")} <small>${t("ไม่บังคับ")}</small><textarea name="memberNote" maxlength="500" placeholder="${t("เช่น นัดโอนภายใน 2 วันหลังครบจำนวน")}"></textarea></label></div>
      <div class="create-form-section"><h2>${icon("calc",20)} ${t("ค่าใช้จ่าย")}</h2><div class="form-grid"><label>${t("ราคาสินค้ารวม (บาท)")} <b>*</b><input name="product" type="number" inputmode="decimal" min="0.01" step="0.01" value="${bahtInput(selectedListing?.price || 0)}" required/></label><label id="shipping-total-wrap">${t("ค่าจัดส่งรวม (บาท)")}<input name="shippingTotal" type="number" inputmode="decimal" min="0" step="0.01" value="0.00"/></label></div><p class="create-fee-note">${t("ผู้ร่วมหารจ่ายเฉพาะราคาที่นั่ง แพลตฟอร์มหักค่าคอม 2% จากเงินที่สมาชิกโอน ก่อนโอนต่อให้คุณ")}</p><div class="preview-cost" id="create-preview"></div></div>
      <section class="create-form-section" id="physical-delivery-section"><h2>${icon("truck",20)} ${t("การรับสินค้า")}</h2><fieldset class="delivery-picker">${[["ship_to_owner","จัดส่งรวมมาที่ผู้สร้างกลุ่ม แล้วนัดรับ"],["ship_separately","จัดส่งแยกให้สมาชิกแต่ละคน"],["pickup","นัดรับด้วยตนเอง"]].map(([value,label],i)=>`<label><input type="radio" name="deliveryMethod" value="${value}" ${i===0?"checked":""}/><span>${t(label)}</span></label>`).join("")}</fieldset><label id="pickup-location-wrap" hidden>${t("สถานที่นัดรับ")} <b>*</b><input name="pickupLocation" maxlength="180" placeholder="${t("ระบุสถานที่นัดรับ")}"/></label></section>
      <section class="create-form-section digital-handoff" id="digital-handoff-section" hidden><h2>${icon("lock",20)} ${t("การส่งมอบสิทธิ์ดิจิทัล")}</h2><p>${t("ระบุวิธีส่งมอบหลังกลุ่มยืนยันยอด")}</p><textarea name="digitalHandoff" maxlength="500" placeholder="${t("เช่น ส่งคำเชิญทางอีเมลหลังชำระเงิน")}"></textarea></section>
      <div class="create-step-actions"><button type="button" class="button outline" data-action="create-step" data-step="1">${t("ย้อนกลับ")}</button><button type="button" class="button primary" data-action="create-step" data-step="3">${t("ตรวจสอบสรุป")} ${icon("arrow",18)}</button></div>
    </section>
    <section class="create-step-panel create-review-panel" data-create-step-panel="3" ${createGroupStep===3?"":"hidden"}><div class="create-form-section"><h2>${icon("check",20)} ${t("ตรวจสอบก่อนสร้างกลุ่ม")}</h2><p>${t("ตรวจดูข้อมูลสินค้า จำนวนสมาชิก และยอดต่อคนให้เรียบร้อย")}</p><div id="create-review-summary"></div><div class="info-box">${t("การสร้างกลุ่มยังไม่มีการเรียกเก็บเงิน ระบบจะแสดงยอดให้สมาชิกยืนยันก่อนดำเนินการ")}</div><p id="create-error" class="create-error" role="alert" hidden></p></div><div class="create-step-actions"><button type="button" class="button outline" data-action="create-step" data-step="2">${t("ย้อนกลับ")}</button><button class="button primary" type="submit">${t("สร้างกลุ่ม")}</button></div></section>
  </form><aside class="create-group-summary" aria-live="polite"><div class="create-summary-heading"><h2>${t("สรุปกลุ่ม")}</h2>${icon("package",28)}</div><div class="create-summary-product"><div id="create-summary-image">${groupImages[0]?`<img src="${groupImages[0]}" alt=""/>`:icon("package",32)}</div><div><strong id="summary-product-title">${escape(selectedListing?.title || t("ชื่อสินค้า"))}</strong><small id="summary-product-category">${escape(t(selectedCategory))}</small></div></div><dl><div><dt>${t("ราคาสินค้า")}</dt><dd id="summary-product-price">—</dd></div><div id="summary-shipping-row"><dt>${t("ค่าจัดส่ง")}</dt><dd id="summary-shipping">—</dd></div><div><dt>${t("ค่าคอม 2% (หักจากเงินที่คุณได้รับ)")}</dt><dd id="summary-fee">—</dd></div><div class="summary-per-person"><dt>${t("ประมาณต่อคน")}</dt><dd id="summary-per-person">—</dd></div><div><dt>${t("สมาชิก")}</dt><dd id="summary-members">—</dd></div><div><dt>${t("ปิดรับสมาชิก")}</dt><dd id="summary-deadline">—</dd></div><div><dt>${t("วิธีรับ")}</dt><dd id="summary-delivery">—</dd></div><div><dt>${t("การมองเห็น")}</dt><dd id="summary-visibility">—</dd></div></dl><p>${t("ยอดต่อคนเป็นประมาณการเมื่อสมาชิกครบ")}</p></aside></div>`;
}
function secondhandCheckoutPage(id) {
  if (!requireAuth(`/checkout/secondhand/${encodeURIComponent(id)}`))
    return authRequiredView(
      t("สั่งซื้อสินค้า"),
      t("เข้าสู่ระบบก่อนสั่งซื้อสินค้า"),
    );
  const product = listing(id);
  if (!product || product.listingType !== "secondhand") return notFound();
  const pickup = [
    "นัดรับ",
    "รับสินค้าเอง",
    "นัดรับและจัดส่ง",
    "รับสินค้าเองหรือจัดส่ง",
  ].includes(product.delivery);
  const shipping = [
    "จัดส่ง",
    "นัดรับและจัดส่ง",
    "รับสินค้าเองหรือจัดส่ง",
  ].includes(product.delivery);
  const deliveryOptions = `${pickup ? `<option value="นัดรับ">${t("รับสินค้าเอง")}</option>` : ""}${shipping ? `<option value="จัดส่ง">${t("จัดส่ง")}</option>` : ""}`;
  const address = state.user?.address || {};
  const addressParts = [
    [t("บ้านเลขที่"), address.houseNo],
    [t("หมู่"), address.villageNo],
    [t("ซอย"), address.alley],
    [t("ถนน"), address.road],
    [t("ตำบล"), address.subdistrict],
    [t("อำเภอ"), address.district],
    [t("จังหวัด"), address.province],
    [t("รหัสไปรษณีย์"), address.postalCode],
  ].filter(([, value]) => String(value || "").trim());
  const reference = demoReference(),
    expires = Date.now() + 8 * 60 * 60 * 1000;
  const orderNumber = `HK${new Date().toISOString().slice(2, 10).replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "").slice(0, 6).toUpperCase()}`;
  const coverImage = product.images?.[0] || product.image;
  const itemImage = coverImage
    ? `<img src="${escape(coverImage)}" alt="${escape(product.title)}"/>`
    : `<div class="checkout-product-art">${art(product)}</div>`;
  return `<div class="group-checkout-page secondhand-market-checkout"><div class="checkout-page-head"><div><span class="chip">${t("ตลาดมือสอง")}</span><h1>${t("สั่งซื้อสินค้า")}</h1></div>${a(`/products/${encodeURIComponent(product.id)}`, `← ${t("กลับไปดูสินค้า")}`, "checkout-back-link")}</div><div class="checkout-steps"><span class="active">1 · ${t("ตรวจสอบข้อมูล")}</span><i></i><span>2 · ${t("ชำระเงิน")}</span><i></i><span>3 · ${t("เสร็จสิ้น")}</span></div><form id="secondhand-checkout-form" data-id="${escape(product.id)}" data-price="${Number(product.price) || 0}" data-seller="${escape(product.sellerId)}" data-reference="${escape(reference)}" data-order-number="${escape(orderNumber)}" data-expires="${expires}" class="checkout-layout"><div class="checkout-info-column"><section class="checkout-panel"><h3>${icon("map-pin", 20)} ${t("ที่อยู่ในการจัดส่ง")}</h3><div class="checkout-address"><div class="checkout-address-contact"><strong>${escape(state.user?.name || "—")}</strong><span>${escape(address.phone || "—")}</span></div>${addressParts.length ? `<div class="checkout-address-details">${addressParts.map(([label, value]) => `<span><small>${escape(label)}</small><b>${escape(value)}</b></span>`).join("")}</div>` : `<p>${t("ยังไม่ได้ระบุที่อยู่")} · ${a("/profile", t("เพิ่มที่อยู่"), "checkout-address-edit")}</p>`}${addressParts.length ? a("/profile", t("แก้ไขที่อยู่"), "checkout-address-edit") : ""}</div></section><section class="checkout-panel"><h3>${icon("package", 20)} ${t("รายละเอียดสินค้า")}</h3><div class="checkout-product">${itemImage}<div><strong>${escape(product.title)}</strong><span>${t("สภาพ")}: ${escape(t(product.condition || "—"))}</span><span>${t("คำอธิบาย")}: ${escape(product.description || "—")}</span><label>${t("จำนวนสินค้า")}<input name="quantity" type="number" min="1" max="${Math.max(1, Number(product.quantity) || 1)}" value="1" required/></label><label>${t("วิธีรับสินค้า")}<select name="delivery" required>${deliveryOptions}</select></label></div><b>${money(product.price)}</b></div></section><section class="checkout-panel checkout-note"><h3>${icon("edit", 20)} ${t("หมายเหตุถึงผู้ขาย")}</h3><textarea name="note" maxlength="200" placeholder="${t("เช่น นัดรับ / ขอรูปเพิ่มเติม / สอบถามสภาพสินค้า...")}" aria-label="${t("หมายเหตุถึงผู้ขาย")}"></textarea><small>0 / 200</small></section></div><section class="checkout-panel checkout-pay-panel"><h3>${icon("package", 22)} ${t("ชำระเงิน")}</h3><p>${t("สแกน QR เพื่อชำระค่าสินค้า")}</p><div class="checkout-qr-row bank-transfer-qr-row"><div class="bank-payment-qr-frame"><img src="${BANK_PAYMENT_QR_SRC}" alt="${t("QR สำหรับโอนเงินเข้าบัญชี")}"/></div><div class="checkout-bank"><span>${t("ชื่อบัญชีรับโอน")}</span><strong>${BANK_PAYMENT_RECIPIENT}</strong><small>${t("โอนตามยอดชำระทั้งหมดด้านล่าง")}</small></div></div><div class="checkout-amount"><span>${t("ยอดชำระทั้งหมด")}</span><strong id="secondhand-checkout-total">${money(product.price)}</strong></div><div class="demo-expiry-box"><span>${t("กรุณาชำระภายใน")}<b>8 ${t("ชั่วโมง")}</b></span><strong class="demo-countdown">08 : 00 : 00</strong></div><small class="demo-expired-message" hidden>${t("หมดเวลาชำระเงิน กรุณาสร้างคำสั่งซื้อใหม่")}</small><small class="checkout-reference">${t("รหัสอ้างอิง")}: ${escape(reference)}</small><p class="payment-next-step-note">${t("หลังสร้างคำสั่งซื้อ ระบบจะแสดง QR ตัวกลางสำหรับขั้นตอนยืนยันแบบ Demo")}</p><button class="button primary full checkout-confirm-button" type="submit">${icon("check", 20)} ${t("ยืนยันการสั่งซื้อ")}</button></section></form></div>`;
}
function secondhandPaymentPendingPage() {
  let pending = null;
  try {
    pending = JSON.parse(
      sessionStorage.getItem("harnkhong-secondhand-pending") || "null",
    );
  } catch {
    /* Treat missing session data as no pending order. */
  }
  if (
    !pending?.orderNumber ||
    !pending?.listingId ||
    !Number.isFinite(Number(pending.expiresAt))
  )
    return notFound();
  const product = listing(pending.listingId) || pending;
  const image = pending.image || product.images?.[0] || product.image;
  const itemImage = image
    ? `<img src="${escape(image)}" alt="${escape(pending.title || product.title)}"/>`
    : `<div class="pending-order-image-placeholder">${icon("package", 34)}</div>`;
  const total = Number(pending.total) || 0;
  return `<section class="secondhand-pending-page"><div class="pending-page-decoration" aria-hidden="true">${icon("package", 150)}</div><header class="pending-page-heading"><span class="pending-payment-icon"><svg viewBox="0 0 96 76" fill="none" aria-hidden="true"><rect x="6" y="8" width="70" height="48" rx="8" stroke="currentColor" stroke-width="5"/><path d="M8 23h66M18 38h18M18 47h10" stroke="currentColor" stroke-width="5" stroke-linecap="round"/></svg>${icon("clock", 34)}</span><h1>${t("รอชำระเงิน")}</h1><p>${t("กรุณาชำระเงินและยืนยันยอดภายใน 8 ชั่วโมง")}<br/>${t("หลังจากสร้างคำสั่งซื้อ")}</p></header><article class="pending-order-card"><div class="pending-order-number"><strong>${t("เลขที่คำสั่งซื้อ")}</strong><b>${escape(pending.orderNumber)}</b></div><div class="pending-order-item">${itemImage}<div><strong>${escape(pending.title || product.title)}</strong><small>${pending.condition ? `${t("สภาพ")}: ${escape(t(pending.condition))} · ` : ""}${money(pending.unitPrice || product.price)} · ${t("{count} ชิ้น", { count: pending.quantity || 1 })}</small>${pending.description ? `<small>${t("คำอธิบาย")}: ${escape(pending.description)}</small>` : ""}</div><b>${money(total)}</b></div><div class="pending-order-total"><strong>${t("ยอดชำระทั้งหมด")}</strong><b>${money(total)}</b></div><div class="pending-order-countdown"><span>${icon("clock", 22)} ${t("เหลือเวลาชำระ")}</span><strong data-pending-deadline="${Number(pending.expiresAt)}">08:00:00</strong></div><p class="pending-order-expired" hidden>${t("หมดเวลาชำระเงิน กรุณาสร้างคำสั่งซื้อใหม่")}</p><section class="pending-payment-section"><h2>${t("ชำระเงินด้วย QR")}</h2><div class="pending-payment-qr-grid"><div class="pending-qr-card"><div class="bank-payment-qr-frame"><img src="${BANK_PAYMENT_QR_SRC}" alt="${t("QR สำหรับโอนเงินเข้าบัญชี")}"/></div><div><strong>${t("QR สำหรับโอนเงิน")}</strong><span>${t("ชื่อบัญชีรับโอน")}</span><b>${BANK_PAYMENT_RECIPIENT}</b><small>${money(total)} · ${t("รหัสอ้างอิง")}: ${escape(pending.reference || pending.orderNumber)}</small></div></div><div class="pending-qr-card pending-demo-qr-card"><img id="secondhand-pending-demo-qr" data-reference="${escape(pending.reference || pending.orderNumber)}" data-amount="${total}" data-expires="${Number(pending.expiresAt)}" data-listing-id="${escape(pending.listingId)}" data-order-number="${escape(pending.orderNumber)}" alt="${t("QR ตัวกลางสำหรับยืนยันคำสั่งซื้อแบบ Demo")}"/><div><strong>${t("QR ตัวกลาง (Demo)")}</strong><span>${t("สแกนเพื่อเปิดขั้นตอนยืนยันในระบบจำลอง")}</span><small>${t("QR นี้ใช้เปิดหน้าตรวจสอบและยืนยันสถานะคำสั่งซื้อ")}</small></div></div></div></section></article><div class="pending-order-actions">${a("/", `${icon("home", 20)} ${t("ไปหน้าแรก")}`, "button outline")}${a("/my-orders", `${icon("package", 20)} ${t("ไปหน้าคำสั่งซื้อของฉัน")}`, "button primary")}</div></section>`;
}
function secondhandPurchaseSuccessPage(listingId, orderNumber, amount, paidAt) {
  const product = listing(listingId) || {};
  const image = product.images?.[0] || product.image;
  const itemImage = image
    ? `<img src="${escape(image)}" alt="${escape(product.title || t("สินค้า"))}"/>`
    : `<div class="success-order-image-placeholder">${icon("package", 30)}</div>`;
  const dateText = new Date(Number(paidAt) || Date.now()).toLocaleString(
    locale === "en" ? "en-GB" : "th-TH",
    { dateStyle: "medium", timeStyle: "short" },
  );
  const confettiColors = [
    "#ff5918",
    "#ffc12e",
    "#1dbb22",
    "#27a9ed",
    "#ff6fa9",
  ];
  const confetti = Array.from({ length: 18 }, (_, index) => {
    const angle = (Math.PI * 2 * index) / 18,
      distance = 34 + (index % 3) * 11;
    return `<i class="success-confetti-piece" style="--x:${Math.round(Math.cos(angle) * distance)}px;--y:${Math.round(Math.sin(angle) * distance)}px;--r:${index * 47}deg;--c:${confettiColors[index % confettiColors.length]}" aria-hidden="true"></i>`;
  }).join("");
  return `<section class="secondhand-success-page"><div class="success-page-decoration" aria-hidden="true">${icon("package", 150)}</div><header class="success-page-heading"><span class="success-bag-icon" aria-hidden="true"><span class="success-confetti" aria-hidden="true">${confetti}</span><svg viewBox="0 0 120 120" fill="none"><path d="M31 43h58l5 63H26l5-63Z" stroke="currentColor" stroke-width="7" stroke-linejoin="round"/><path d="M43 45V33a17 17 0 0 1 34 0v12" stroke="currentColor" stroke-width="7" stroke-linecap="round"/><circle cx="87" cy="85" r="22" fill="currentColor"/><path d="m77 85 7 7 13-15" stroke="white" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><path d="M98 21v-9m15 17 8-5m-25-8 5-8" stroke="currentColor" stroke-width="5" stroke-linecap="round"/></svg></span><h1>${t("สั่งซื้อสำเร็จ!")}</h1><p>${t("ขอบคุณสำหรับการสั่งซื้อ คุณได้ชำระเงินเรียบร้อยแล้ว")}</p></header><article class="success-order-card"><div class="success-order-number"><strong>${t("เลขที่คำสั่งซื้อ")}</strong><b>${escape(orderNumber)}</b></div><div class="success-order-item">${itemImage}<div><strong>${escape(product.title || t("สินค้า"))}${product.listingType === "secondhand" ? ` (${t("มือสอง")})` : ""}</strong>${product.condition ? `<small>${t("สภาพ")}: ${escape(t(product.condition))}</small>` : ""}${product.description ? `<small>${t("คำอธิบาย")}: ${escape(product.description)}</small>` : ""}</div><b>${money(amount)}</b></div><div class="success-order-total"><strong>${t("ยอดชำระทั้งหมด")}</strong><b>${money(amount)}</b></div><div class="success-payment-status"><span class="success-check">✓</span><div><strong>${t("ชำระเงินแล้ว")}</strong><small>${t("วันที่ชำระ")}: ${escape(dateText)}</small></div></div></article><div class="success-order-actions">${a("/", `${icon("home", 20)} ${t("ไปหน้าแรก")}`, "button outline")}${a("/my-orders", `${icon("package", 20)} ${t("ไปหน้าคำสั่งซื้อของฉัน")}`, "button primary")}</div></section>`;
}
function secondhandPaymentApprovalPage(
  reference,
  amount,
  expires,
  listingId,
  orderNumber,
  expired,
) {
  const product = listing(listingId) || {};
  const image = product.images?.[0] || product.image;
  const itemImage = image
    ? `<img src="${escape(image)}" alt="${escape(product.title || t("สินค้า"))}"/>`
    : `<div class="success-order-image-placeholder">${icon("package", 30)}</div>`;
  return `<section class="secondhand-payment-approval-page"><article class="secondhand-payment-approval-card">${itemImage}<h1>${expired ? t("QR หมดอายุแล้ว") : t("ยืนยันการชำระเงิน")}</h1><p>${expired ? t("QR นี้หมดเวลายืนยันแล้ว กรุณาสร้างคำสั่งซื้อใหม่") : t("ตรวจสอบสินค้าและยอดชำระก่อนยืนยัน")}</p><div class="approval-order-row"><span>${t("สินค้า")}</span><strong>${escape(product.title || t("สินค้า"))}</strong></div><div class="approval-order-row"><span>${t("เลขที่คำสั่งซื้อ")}</span><strong>${escape(orderNumber)}</strong></div><div class="approval-order-amount"><span>${t("ยอดชำระทั้งหมด")}</span><strong>${money(amount)}</strong></div><div class="demo-pending-status"><span>${t("สถานะการยืนยัน")}</span><b>${t("รอยืนยัน")}</b></div>${expired ? "" : `<button type="button" class="button primary full" data-action="accept-demo-amount" data-ref="${escape(reference)}" data-amount="${amount}" data-expires="${expires}" data-secondhand="${escape(listingId)}">${t("ยืนยันการชำระเงิน")}</button>`}</article></section>`;
}
function initializeSecondhandPendingCountdown() {
  clearInterval(secondhandPendingTimer);
  const clock = document.querySelector("[data-pending-deadline]");
  if (!clock) return;
  const expiresAt = Number(clock.dataset.pendingDeadline),
    expired = document.querySelector(".pending-order-expired");
  const tick = () => {
    const remaining = Math.max(0, expiresAt - Date.now()),
      seconds = Math.floor(remaining / 1000);
    clock.textContent = `${String(Math.floor(seconds / 3600)).padStart(2, "0")}:${String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
    if (!remaining) {
      if (expired) expired.hidden = false;
      clearInterval(secondhandPendingTimer);
    }
  };
  tick();
  secondhandPendingTimer = setInterval(tick, 1000);
}
async function initializeSecondhandPendingQr() {
  const qr = document.querySelector("#secondhand-pending-demo-qr");
  if (!qr) return;
  try {
    qr.src = await QRCode.toDataURL(
      demoAcceptUrl(qr.dataset.reference, qr.dataset.amount, {
        expires: Number(qr.dataset.expires),
        secondhandListing: qr.dataset.listingId,
        orderNumber: qr.dataset.orderNumber,
      }).href,
      {
        errorCorrectionLevel: "M",
        margin: 2,
        width: 320,
        color: { dark: "#092847", light: "#ffffff" },
      },
    );
  } catch {
    /* Keep the payment instructions visible if QR rendering fails. */
  }
}

function newProduct() {
  const editMatch = location.pathname.match(
    /^\/seller\/products\/([^/]+)\/edit$/,
  );
  if (!requireAuth(editMatch ? location.pathname : "/seller/products/new"))
    return authRequiredView(
      t("ลงประกาศขาย"),
      t("เข้าสู่ระบบเพื่อเริ่มลงขายสินค้ามือสอง"),
    );
  const editing = editMatch ? listing(decodeURIComponent(editMatch[1])) : null;
  if (editMatch && (!editing || editing.sellerId !== state.user?.id))
    return notFound();
  const categories = [
    "เสื้อผ้าและแฟชั่น",
    "อุปกรณ์อิเล็กทรอนิกส์และไอที",
    "ของใช้ทั่วไป",
    "กีฬาและงานอดิเรก",
    "โมเดล / งานศิลปะ",
    "อื่น ๆ (ระบุชื่อเอง)",
  ];
  return `<div class="listing-create-page"><div class="listing-create-heading"><div>${a(editing ? `/products/${encodeURIComponent(editing.id)}` : "/profile", `← ${t("กลับ")}`, "listing-back-link")}<h1>${t(editing ? "แก้ไขประกาศสินค้า" : "ลงขายสินค้ามือสอง")}</h1><p>${t("กรอกข้อมูลสินค้าให้ครบ เพื่อให้ผู้ซื้อเห็นภาพและติดต่อคุณได้ง่าย")}</p></div><span class="listing-create-step">${t("ประกาศขาย · Marketplace")}</span></div>
    <form id="product-form" class="listing-create-layout" data-editing-id="${escape(editing?.id || "")}">
      <div class="listing-create-main">
        <section class="listing-form-card listing-photos-card"><div class="listing-card-heading"><span class="listing-card-number">01</span><div><h2>${t("รูปภาพสินค้า")}</h2><p>${t("เพิ่มรูปได้สูงสุด 6 รูป รูปแรกจะเป็นภาพหน้าปก")}</p></div></div><label class="listing-upload-zone" for="listing-images"><span class="listing-upload-icon">${icon("plus", 22)}</span><strong>${t("เพิ่มรูปสินค้า")}</strong><small>${t("JPG, PNG หรือ WebP · ไม่เกิน 5 MB ต่อรูป")}</small><input id="listing-images" type="file" accept="image/jpeg,image/png,image/webp" multiple/></label><div class="listing-image-thumbnails" id="listing-image-draft">${listingImages.map((src, index) => `<div class="listing-image-thumb ${index === 0 ? "is-cover" : ""}"><button type="button" data-action="listing-cover" data-index="${index}" aria-label="${index === 0 ? t("ภาพหน้าปก") : t("เลือกเป็นภาพหน้าปก")}"><img src="${src}" alt=""/><span>${index === 0 ? t("หน้าปก") : t("ตั้งเป็นหน้าปก")}</span></button><button class="listing-image-delete" type="button" data-action="listing-image-remove" data-index="${index}" aria-label="${t("ลบรูปที่ {number}", { number: index + 1 })}">×</button></div>`).join("")}</div><p class="listing-field-status" id="listing-image-status" role="status"></p></section>
        <section class="listing-form-card"><div class="listing-card-heading"><span class="listing-card-number">02</span><div><h2>${t("ข้อมูลสินค้า")}</h2><p>${t("ระบุชื่อ หมวดหมู่ และรายละเอียดของสินค้า")}</p></div></div><label>${t("ชื่อสินค้า")}<input name="title" maxlength="100" required placeholder="${t("เช่น เสื้อแจ็กเก็ตยีนส์มือสอง")}"/></label><label>${t("หมวดหมู่สินค้า")}<select name="category" required>${categories.map((c) => `<option value="${escape(c)}">${t(c)}</option>`).join("")}</select></label><label>${t("รายละเอียดสินค้า")}<textarea name="description" rows="5" maxlength="1200" required placeholder="${t("อธิบายการใช้งาน สภาพสินค้า ตำหนิ และข้อมูลเพิ่มเติม")}"></textarea><small class="listing-input-hint">${t("แจ้งตำหนิหรือร่องรอยการใช้งานให้ชัดเจน เพื่อให้ผู้ซื้อมั่นใจ")}</small></label></section>
        <section class="listing-form-card"><div class="listing-card-heading"><span class="listing-card-number">03</span><div><h2>${t("ราคาและสภาพสินค้า")}</h2><p>${t("กำหนดราคาขายและเลือกสภาพที่ตรงกับสินค้ามากที่สุด")}</p></div></div><div class="listing-form-row"><label>${t("ราคาขาย")}<div class="listing-price-input"><input name="price" inputmode="decimal" required placeholder="0.00"/><span>${t("บาท")}</span></div></label><label>${t("สภาพสินค้า")}<select name="condition" required><option value="">${t("เลือกสภาพสินค้า")}</option><option value="มือหนึ่ง">${t("มือหนึ่ง")}</option><option value="สภาพดี">${t("สภาพดี")}</option><option value="มีตำหนิ">${t("มีตำหนิ")}</option></select></label></div><label>${t("จำนวนสินค้า")}<input name="quantity" type="number" min="1" max="9999" step="1" value="1" required/><small class="listing-input-hint">${t("จำนวนชิ้นที่มีขาย")}</small></label></section>
        <section class="listing-form-card"><div class="listing-card-heading"><span class="listing-card-number">04</span><div><h2>${t("การรับสินค้าและช่องทางติดต่อ")}</h2><p>${t("แจ้งวิธีรับสินค้าและช่องทางที่ผู้ซื้อจะติดต่อคุณ")}</p></div></div><fieldset class="listing-radio-group"><legend>${t("วิธีรับสินค้า")}</legend><label class="listing-radio-option"><input type="radio" name="delivery" value="นัดรับ" checked/><span><strong>${t("รับสินค้าเอง")}</strong><small>${t("นัดหมายสถานที่และเวลารับสินค้า")}</small></span></label><label class="listing-radio-option"><input type="radio" name="delivery" value="จัดส่ง"/><span><strong>${t("จัดส่ง")}</strong><small>${t("ส่งสินค้าตามที่อยู่ผู้ซื้อ")}</small></span></label><label class="listing-radio-option"><input type="radio" name="delivery" value="นัดรับและจัดส่ง"/><span><strong>${t("รับสินค้าเองหรือจัดส่ง")}</strong><small>${t("ให้ผู้ซื้อเลือกวิธีที่สะดวก")}</small></span></label></fieldset><div id="listing-area-wrap" class="listing-location-fields"><label for="listing-market-name">${t("ตลาดหรือสถานที่ขาย")}<input id="listing-market-name" name="area" maxlength="120" required placeholder="${t("เช่น ตลาดนัดจตุจักร หรือชื่อตลาดใกล้คุณ")}"/><small class="listing-input-hint">${t("พิมพ์ชื่อตลาดหรือพิกัด เช่น 13.636065, 100.770565 แล้วกดค้นหา")}</small></label><div class="listing-map-search-row"><button type="button" class="button outline" data-action="listing-map-search">${icon("search", 16)} ${t("ค้นหาบน OpenStreetMap")}</button><small>${t("แตะบนแผนที่หรือขยับหมุดเพื่อเลือกตำแหน่ง")}</small></div><div id="listing-map-canvas" class="listing-map-canvas" role="application" aria-label="${t("แผนที่เลือกตำแหน่งตลาด")}"></div><p id="listing-map-status" class="listing-map-status" role="status"></p><input type="hidden" name="latitude"/><input type="hidden" name="longitude"/><input type="hidden" name="marketAddress"/></div><label>${t("ช่องทางติดต่อผู้ขาย")}<input name="contact" maxlength="120" required placeholder="${t("เช่น LINE ID หรือเบอร์โทรศัพท์")}"/></label></section>
        <div class="listing-submit-row"><small>${t("ตรวจสอบรายละเอียดและภาพตัวอย่างก่อนลงประกาศ")}</small><button class="button primary listing-publish-button" type="submit">${t(editing ? "บันทึกการแก้ไข" : "ลงประกาศขาย")}</button></div>
      </div>
      <aside class="listing-preview-card"><div class="listing-preview-heading"><span>${t("ตัวอย่างประกาศ")}</span><small>${t("แสดงตัวอย่างก่อนเผยแพร่")}</small></div><div id="listing-preview-content" class="listing-preview-content"><div class="listing-preview-image empty">${icon("package", 32)}<span>${t("รูปสินค้าจะแสดงที่นี่")}</span></div><div class="listing-preview-copy"><span class="listing-preview-category">${t(categories[0])}</span><h3>${t("ชื่อสินค้าของคุณ")}</h3><strong>฿0.00</strong><div class="listing-preview-meta"><span>${t("เลือกสภาพสินค้า")}</span><span>${t("นัดรับ")}</span></div><p>${t("รายละเอียดสินค้าจะปรากฏในส่วนนี้")}</p></div></div><div class="listing-preview-tip">${icon("shield", 18)}<span>${t("รายละเอียดที่ชัดเจนช่วยให้ผู้ซื้อมั่นใจก่อนติดต่อ")}</span></div></aside>
    </form></div>`;
}
function secondhandMarketPage() {
  const params = new URLSearchParams(location.search);
  const query = String(params.get("q") || "").trim();
  const selectedCategory = params.get("category") || "ทั้งหมด";
  const items = listings()
    .filter(
      (item) => item.listingType === "secondhand" && item.active !== false,
    )
    .sort((left, right) => {
      const leftBoosted = Date.parse(left.boostedUntil || "") > Date.now();
      const rightBoosted = Date.parse(right.boostedUntil || "") > Date.now();
      return Number(rightBoosted) - Number(leftBoosted);
    });
  const baseCategories = [
    "เสื้อผ้าและแฟชั่น",
    "อุปกรณ์อิเล็กทรอนิกส์และไอที",
    "ของใช้ทั่วไป",
    "กีฬาและงานอดิเรก",
    "โมเดล / งานศิลปะ",
  ];
  const categories = [
    "ทั้งหมด",
    ...new Set([
      ...baseCategories,
      ...items.map((item) => item.category).filter(Boolean),
    ]),
  ];
  const normalizedQuery = query.toLocaleLowerCase();
  const filteredItems = items.filter((item) => {
    const text =
      `${item.title || ""} ${item.category || ""} ${item.description || ""} ${item.sellerName || ""} ${item.area || ""} ${item.marketAddress || ""}`.toLocaleLowerCase();
    return (
      (selectedCategory === "ทั้งหมด" || item.category === selectedCategory) &&
      (!normalizedQuery || text.includes(normalizedQuery))
    );
  });
  const marketHref = (category, q = query) => {
    const next = new URLSearchParams();
    if (q) next.set("q", q);
    if (category && category !== "ทั้งหมด") next.set("category", category);
    const search = next.toString();
    return `/marketplace/secondhand${search ? `?${search}` : ""}`;
  };
  const categoryFilters = `<div class="filter-carousel"><button type="button" class="filter-scroll-button filter-scroll-prev" data-action="scroll-filter" data-direction="prev" aria-label="${t("เลื่อนหมวดหมู่ไปซ้าย")}" hidden><span aria-hidden="true">‹</span></button><nav class="filter-row" aria-label="${t("หมวดหมู่สินค้า")}">${categories.map((category) => a(marketHref(category), t(category), `filter ${selectedCategory === category ? "active" : ""}`)).join("")}</nav><button type="button" class="filter-scroll-button filter-scroll-next" data-action="scroll-filter" data-direction="next" aria-label="${t("เลื่อนหมวดหมู่ไปขวา")}" hidden><span aria-hidden="true">›</span></button></div>`;
  const listingCards = filteredItems
    .map((item) =>
      a(
        `/products/${item.id}`,
        `${item.images?.[0] ? `<img src="${item.images[0]}" alt="${escape(item.title)}" loading="lazy"/>` : `<div class="secondhand-market-placeholder">${icon("package", 30)}</div>`}<div class="secondhand-market-card-copy">${item.boostedUntil && Date.parse(item.boostedUntil) > Date.now() ? `<span class="secondhand-boost-badge">${icon("sparkles", 13)} ${t("Boost")}</span>` : ""}<span>${escape(t(item.category))}</span><h3>${escape(item.title)}</h3><strong>${money(item.price)}</strong><small>${escape(t(item.condition))} · ${escape(t(item.delivery))}</small></div>`,
        "secondhand-market-card",
      ),
    )
    .join("");
  return `${title(t("ตลาดมือสอง"), t("ดูประกาศสินค้าและข้อมูลผู้ขาย"))}<section class="secondhand-market"><form class="search-bar secondhand-market-search" id="secondhand-search-form"><span>${icon("search", 22)}</span><input type="hidden" name="category" value="${escape(selectedCategory)}"/><input name="q" value="${escape(query)}" placeholder="${t("ค้นหาชื่อสินค้า หมวดหมู่ หรือรายละเอียด")}" aria-label="${t("ค้นหาสินค้าในตลาดมือสอง")}"/><button type="submit">${t("ค้นหาสินค้า")}</button></form>${categoryFilters}<div class="section-header"><h2>${query || selectedCategory !== "ทั้งหมด" ? t("ผลการค้นหา") : t("ประกาศขายล่าสุด")} <small>${filteredItems.length}</small></h2>${a("/seller/products/new", `${icon("plus", 17)} ${t("ลงขายมือสอง")}`, "button primary")}</div>${filteredItems.length ? `<div class="secondhand-market-grid">${listingCards}</div>` : `<div class="empty secondhand-market-empty"><div class="secondhand-market-placeholder">${icon("search", 34)}</div><h3>${t("ไม่พบสินค้าที่ค้นหา")}</h3><p>${t("ลองเปลี่ยนคำค้นหาหรือเลือกหมวดหมู่อื่น")}</p>${a("/marketplace/secondhand", t("ล้างตัวกรอง"), "button outline")}</div>`}</section>`;
}
function syncCreateCategoryUI() {
  const form = document.querySelector("#create-form");
  if (!form) return;
  const primary = form.querySelector('[name="category"]'),
    first = selectedCreateCategories[0] || "";
  primary.value = first;
  const tags = form.querySelector("#selected-categories");
  tags.innerHTML =
    selectedCreateCategories
      .map(
        (category) =>
          `<button type="button" class="selected-category" data-action="remove-category" data-category="${escape(category)}" aria-label="${t("นำหมวดหมู่ออก {category}", { category: t(category) })}">${escape(t(category))}<span aria-hidden="true">×</span></button>`,
      )
      .join("") ||
    `<span class="category-selection-hint">${t("เลือกอย่างน้อย 1 หมวดหมู่")}</span>`;
  form.querySelectorAll('[data-action="toggle-category"]').forEach((button) => {
    const active = selectedCreateCategories.includes(button.dataset.category);
    button.classList.toggle("selected", active);
    button.setAttribute("aria-pressed", String(active));
  });
  const otherSelected = selectedCreateCategories.includes(
      "อื่น ๆ (ระบุชื่อเอง)",
    ),
    otherWrap = form.querySelector("#other-category-wrap"),
    otherInput = form.querySelector('[name="otherCategory"]');
  otherWrap.hidden = !otherSelected;
  otherInput.required = otherSelected;
  const listingsForCategory = listings().filter(
      (item) => item.category === first,
    ),
    nextListing = listingsForCategory[0] || listings()[0];
  if (nextListing) {
    form.querySelector('[name="listingId"]').value = nextListing.id;
    form.querySelector('[name="product"]').value = bahtInput(nextListing.price);
  }
  updatePreview();
}
function getCreateCategoryValues(form) {
  return selectedCreateCategories
    .map((category) =>
      category === "อื่น ๆ (ระบุชื่อเอง)"
        ? String(new FormData(form).get("otherCategory") || "").trim()
        : category,
    )
    .filter(Boolean);
}
function authPage(register = false) {
  if (authModalActive) return "";
  if (mockupCurrentStep !== 3) mockupCurrentStep = register ? 2 : 1;
  return `<div class="auth-page-wrapper">${renderPhoneMockup(mockupCurrentStep === 3 ? 3 : register ? 2 : 1, false)}<a href="/" data-link class="auth-return-link">← ${t("กลับสู่หน้าหลัก HarnKhong")}</a></div>`;
}
function myGroups() {
  if (!requireAuth("/my-groups"))
    return authRequiredView(
      t("กลุ่มของฉัน"),
      t(
        "ติดตามสมาชิกและยอดที่ต้องยืนยันในแต่ละกลุ่ม เข้าสู่ระบบหรือลงทะเบียนเพื่อเริ่มต้น",
      ),
    );
  const gs = state.groups.filter((g) => g.members.includes(state.user.id));
  return `${title(t("กลุ่มของฉัน"), t("ติดตามสมาชิกและยอดที่ต้องยืนยันในแต่ละกลุ่ม"))}<div class="section-header"><h2>${t("{count} กลุ่ม", { count: gs.length })}</h2>${a("/groups/create", `${icon("plus", 18)} ${t("สร้างกลุ่ม")}`, "button secondary")}</div>${gs.length ? `<div class="group-grid">${gs.map(groupCard).join("")}</div>` : `<div class="empty"><h2>${t("ยังไม่มีกลุ่มที่เข้าร่วม")}</h2><p>${t("ลองสำรวจสินค้าที่อยากหารก่อน")}</p>${a("/explore", t("ไปสำรวจ"), "button primary")}</div>`}`;
}
function getGroupMessages(groupId) {
  const defaultGroupMessages = {
    g1: [
      {
        id: "gm1",
        sender: "นที",
        senderId: "u2",
        text: "สวัสดีครับทุกคน มีใครพร้อมโอนเงินรอบนี้บ้างครับ",
        time: "14:20",
      },
      {
        id: "gm2",
        sender: "พิม",
        senderId: "u3",
        text: "เราพร้อมโอนค่ะ รอของครบคน",
        time: "14:25",
      },
    ],
  };
  try {
    const raw = localStorage.getItem(`hk_group_chat_${groupId}`);
    if (raw) return JSON.parse(raw);
  } catch {}
  return defaultGroupMessages[groupId] || [];
}
function rememberGroupMessages(groupId, messages) {
  groupMessageCache.set(groupId, messages);
  if (!supabaseConfigured) {
    try {
      localStorage.setItem(
        `hk_group_chat_${groupId}`,
        JSON.stringify(messages),
      );
    } catch {}
  }
}
function groupMessageSyncError(error) {
  if (error?.code === "42P01" || error?.code === "PGRST205")
    return t("ไม่พบตาราง group_messages ใน Supabase กรุณาเชื่อมโปรเจกต์แล้วรัน npx supabase db push");
  if (error?.code === "42501")
    return t("บัญชีนี้ไม่มีสิทธิ์อ่านแชตกลุ่ม กรุณาตรวจสอบการเป็นสมาชิกและนโยบาย RLS");
  if (error?.code === "PGRST200")
    return t("Supabase ยังไม่พบความสัมพันธ์โปรไฟล์ผู้ส่ง กรุณา reload schema cache");
  return t("แชตกลุ่มยังซิงก์ไม่ได้ กรุณาตรวจสอบการตั้งค่าฐานข้อมูล");
}
async function refreshGroupChatMessages(groupId, { rerender = true } = {}) {
  if (!supabaseConfigured || !state.user || groupChatPollId !== groupId) return;
  try {
    const messages = await loadGroupMessages(groupId);
    const previous = groupMessageCache.get(groupId) || [];
    const changed =
      messages.length !== previous.length ||
      messages.some((message, index) => message.id !== previous[index]?.id);
    groupMessageCache.set(groupId, messages);
    groupMessageLoadState.set(groupId, "loaded");
    groupMessageErrors.delete(groupId);
    if (changed && rerender && location.pathname === `/groups/${groupId}/chat`)
      render();
  } catch (error) {
    const firstFailure = !groupMessageErrors.has(groupId);
    groupMessageLoadState.set(groupId, "error");
    groupMessageErrors.set(groupId, error);
    console.warn("Unable to load group messages", error);
    if (
      firstFailure &&
      rerender &&
      location.pathname === `/groups/${groupId}/chat`
    )
      render();
  }
}
function startGroupChatSync(groupId) {
  if (!supabaseConfigured) {
    if (groupChatPollTimer) {
      clearInterval(groupChatPollTimer);
      groupChatPollTimer = null;
    }
    groupChatPollId = null;
    return;
  }
  if (groupChatPollId === groupId) return;
  if (groupChatPollTimer) clearInterval(groupChatPollTimer);
  groupChatPollId = groupId;
  if (groupMessageLoadState.get(groupId) !== "loaded")
    void refreshGroupChatMessages(groupId, { rerender: false }).then(() => {
      if (location.pathname === `/groups/${groupId}/chat`) render();
    });
  groupChatPollTimer = setInterval(
    () => void refreshGroupChatMessages(groupId),
    3000,
  );
}
async function refreshSecondhandChatMessages(conversationId, rerender = false) {
  try {
    const messages = await loadSecondhandMessages(
      conversationId,
      state.user?.id,
    );
    const cacheKey = secondhandChatCacheKey(conversationId);
    const previous = secondhandChatMessages.get(cacheKey) || [];
    const changed =
      messages.length !== previous.length ||
      messages.at(-1)?.id !== previous.at(-1)?.id;
    secondhandChatMessages.set(cacheKey, messages);
    if (rerender && changed && location.pathname.startsWith("/chat/")) render();
  } catch (error) {
    console.error("Could not load marketplace chat", error);
  }
}
function startSecondhandChatSync(conversationId) {
  if (!supabaseConfigured || !conversationId) return;
  if (secondhandChatPollId === conversationId) return;
  if (secondhandChatPollTimer) clearInterval(secondhandChatPollTimer);
  secondhandChatPollId = conversationId;
  void refreshSecondhandChatMessages(conversationId, true);
  secondhandChatPollTimer = setInterval(
    () => void refreshSecondhandChatMessages(conversationId, true),
    4000,
  );
}
/** A steady colour per name, so each conversation keeps its own avatar tint. */
function avatarHue(text = "") {
  let hash = 0;
  for (const ch of String(text)) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
  return 190 + (hash % 70); // blues through teals and indigos
}
function chatAvatar(name, label = name) {
  return `<span class="avatar chat-avatar" style="--hue:${avatarHue(name)}">${escape(String(label).slice(0, 1).toUpperCase())}</span>`;
}
function chatWorkspaceSidebar(selectedHref = "") {
  const userId = state.user.id;
  if (
    supabaseConfigured &&
    secondhandConversationListLoadedFor !== userId &&
    secondhandConversationListLoadingFor !== userId
  ) {
    secondhandConversationListLoadingFor = userId;
    void loadSecondhandConversations(userId)
      .then((rows) => {
        if (state.user?.id === userId) {
          secondhandConversationRows = rows;
          secondhandConversationListLoadedFor = userId;
        }
      })
      .catch((error) => {
        console.error("Could not load marketplace conversations", error);
        if (state.user?.id === userId)
          secondhandConversationListLoadedFor = userId;
      })
      .finally(() => {
        if (secondhandConversationListLoadingFor === userId)
          secondhandConversationListLoadingFor = null;
        if (state.user?.id === userId && (location.pathname === "/chat" || location.pathname.startsWith("/chat/") || /^\/groups\/[^/]+\/chat$/.test(location.pathname)))
          render();
      });
  }
  const myGroups = state.groups.filter((g) => g.members.includes(userId));
  const isSelected = (href) =>
    selectedHref === href ||
    (!href.includes("?") && selectedHref.split("?")[0] === href);
  const marketplaceThreads = secondhandConversationRows
    .filter(
      (conversation) =>
        conversation.buyer_id === userId || conversation.seller_id === userId,
    )
    .map((conversation) => {
      const peerId =
        conversation.buyer_id === userId
          ? conversation.seller_id
          : conversation.buyer_id;
      const product = listing(conversation.listing_id);
      const peerName =
        conversation.seller_id === userId
          ? state.profiles?.[peerId]?.name || t("ผู้ซื้อ")
          : product?.sellerName || seller(peerId).name || t("ผู้ขาย");
      const href = `/chat/${encodeURIComponent(peerId)}?product=${encodeURIComponent(conversation.listing_id)}&conversation=${encodeURIComponent(conversation.id)}`;
      return a(
        href,
        `${chatAvatar(peerName)}<span><b>${escape(product?.title || t("ประกาศขาย"))}</b><small>${escape(peerName)} · ${t("แชทสินค้า")}</small></span>`,
        `chat-entry${isSelected(href) ? " active" : ""}`,
      );
    })
    .join("");
  const groupThreads = myGroups
    .map((g) => {
      const msgs = supabaseConfigured
        ? groupMessageCache.get(g.id) || []
        : getGroupMessages(g.id);
      const lastMsg = msgs.at(-1);
      const href = `/groups/${g.id}/chat`;
      return a(
        href,
        `${chatAvatar(g.name)}<span><b>${escape(g.name)}</b><small>${escape(lastMsg?.text || lastMsg?.body || t("เริ่มคุยกับสมาชิกในกลุ่มได้ที่นี่"))}</small></span>`,
        `chat-entry${isSelected(href) ? " active" : ""}`,
      );
    })
    .join("");
  const sellerThreads = Object.keys(state.conversations)
    .map((id) => {
      const contact = seller(id);
      const messages = state.conversations[id];
      const href = `/chat/${id}`;
      return a(
        href,
        `${chatAvatar(contact.name, contact.initials)}<span><b>${escape(contact.name)}</b><small>${escape(messages.at(-1)?.body || t("เริ่มต้นสนทนา"))}</small></span>`,
        `chat-entry${isSelected(href) ? " active" : ""}`,
      );
    })
    .join("");

  return `<aside class="chat-sidebar" aria-label="${t("รายการแชต")}">
    <div class="chat-sidebar-head"><h1>${t("แชต")}</h1><a href="/my-groups" data-link class="chat-sidebar-action" aria-label="${t("กลุ่มของฉัน")}">${icon("users", 20)}</a></div>
    <label class="chat-search">${icon("search", 18)}<input type="search" data-chat-search placeholder="${t("ค้นหาแชต")}" aria-label="${t("ค้นหาแชต")}" autocomplete="off"/></label>
    <div class="chat-list-scroll">
      ${groupThreads ? `<h2 class="chat-list-label">${t("แชทกลุ่มของฉัน")}</h2>${groupThreads}` : ""}
      ${marketplaceThreads ? `<h2 class="chat-list-label">${t("แชทสินค้า")}</h2>${marketplaceThreads}` : ""}
      ${sellerThreads ? `<h2 class="chat-list-label">${t("แชตกับผู้ขาย")}</h2>${sellerThreads}` : ""}
      ${!groupThreads && !marketplaceThreads && !sellerThreads ? `<div class="chat-list-empty"><span>${icon("chat", 24)}</span><strong>${t("ยังไม่มีการสนทนา")}</strong><small>${t("เริ่มแชตจากกลุ่มหรือหน้าสินค้าที่สนใจ")}</small></div>` : ""}
      <p class="chat-search-empty" hidden>${t("ไม่พบแชตที่ค้นหา")}</p>
    </div>
  </aside>`;
}

function chatList() {
  if (!requireAuth("/chat"))
    return authRequiredView(
      t("แชตกับผู้ขาย"),
      t("เข้าสู่ระบบเพื่อดูประวัติการสนทนาและติดต่อร้านค้า"),
    );
  return `<section class="chat-workspace" aria-label="${t("แชต")}">
    ${chatWorkspaceSidebar()}
    <div class="chat-workspace-pane chat-workspace-empty"><span class="chat-empty-ring">${icon("chat", 44)}</span><h2>${t("ข้อความของคุณ")}</h2><p>${t("เลือกกลุ่มหรือผู้ติดต่อจากรายการด้านซ้ายเพื่อเริ่มคุย")}</p>${a("/my-groups", t("ไปที่กลุ่มของฉัน"), "button primary")}</div>
  </section>`;
}
function groupChatPage(id) {
  const g = group(id);
  if (!g) return notFound();
  if (!state.user || !g.members.includes(state.user.id)) return notFound();
  startGroupChatSync(id);
  const p = listing(g.listingId);
  const me = state.user?.id;
  const isMember = g.members.includes(me);
  const msgs = supabaseConfigured
    ? groupMessageCache.get(id) || []
    : getGroupMessages(id);
  const destination = `/groups/${id}`;
  return `<section class="chat-workspace" data-active="true" aria-label="${t("แชต")}">
  ${chatWorkspaceSidebar(`/groups/${id}/chat`)}
  <div class="chat-workspace-pane chat-workspace-active">
  <div class="chat-shell group-chat-shell">
    <div class="chat-head group-chat-head">
      <a href="/chat" class="chat-mobile-back" aria-label="${t("รายการแชต")}">${icon("back", 22)}</a>
      ${chatAvatar(g.name)}
      <div class="group-chat-meta">
        <div class="group-chat-title-row">
          <h1>${escape(g.name)}</h1>
          <span class="group-chat-badge">${icon("users", 14)} ${g.members.length}/${g.capacity}</span>
        </div>
        <small>${t("แชทจำลองสำหรับสมาชิกในกลุ่ม")}</small>
      </div>
      ${a(destination, `${icon("info", 18)} <span>${t("ดูกลุ่ม")}</span>`, "button subtle group-chat-view-btn")}
    </div>
    ${p ? `<div class="chat-product">${t("กลุ่ม")}: ${a(destination, escape(g.name))} · <strong style="color:var(--primary-600);">${money(g.costs.product)}</strong></div>` : ""}
    <div class="messages group-messages">
      ${
        msgs.length
          ? msgs
              .map((m) => {
                const isMine = m.senderId === me;
                const avatar = m.avatar || (isMine ? state.user?.avatar : "");
                const avatarMarkup =
                  avatar && /^(https?:|data:image\/)/i.test(avatar)
                    ? `<img src="${escape(avatar)}" alt=""/>`
                    : escape((m.sender || "?").slice(0, 1));
                return `<div class="group-msg-row ${isMine ? "mine" : "theirs"}">
          <span class="avatar tiny group-message-avatar" aria-label="${escape(m.sender || t("สมาชิกในกลุ่ม"))}">${avatarMarkup}</span>
          <div class="group-msg-col">
            <div class="group-msg-sender">${escape(m.sender || t("สมาชิกในกลุ่ม"))}</div>
            <div class="bubble ${isMine ? "mine" : "theirs"}">${escape(m.text || m.body || "")}</div>
            <time class="group-msg-time">${escape(m.time || "")}</time>
          </div>
        </div>`;
              })
              .join("")
          : `<div class="chat-empty">${icon("chat", 32)}<p><strong>${t("เริ่มคุยกับสมาชิกในกลุ่มได้ที่นี่")}</strong></p><small>${t("พูดคุย ปรึกษาเรื่องสินค้า นัดรับ หรือแชร์รายละเอียดกับสมาชิกในกลุ่มได้ที่นี่")}</small></div>`
      }
    </div>
    ${supabaseConfigured && groupMessageErrors.has(id) ? `<div class="group-chat-sync-error" role="alert">${groupMessageSyncError(groupMessageErrors.get(id))} <button type="button" class="button outline" data-action="retry-group-messages" data-id="${escape(id)}">${t("ลองอีกครั้ง")}</button></div>` : ""}
    ${
      isMember
        ? `<form id="group-chat-form" data-id="${id}" class="chat-input group-chat-input">
      <input name="body" maxlength="500" required placeholder="${t("พิมพ์ข้อความถึงสมาชิกในกลุ่ม...")}" aria-label="${t("ข้อความ")}" autocomplete="off"/>
      <button class="chat-send" type="submit" aria-label="${t("ส่ง")}">${icon("arrow", 20)}</button>
    </form>`
        : ""
    }
  </div></div></section>`;
}
function chatPage(id) {
  if (!requireAuth(location.pathname + location.search))
    return authRequiredView(
      t("แชตกับผู้ขาย"),
      t("เข้าสู่ระบบเพื่อเริ่มต้นการสนทนากับร้านค้านี้"),
    );
  const params = new URLSearchParams(location.search);
  const productId = params.get("product");
  const conversationId = params.get("conversation");
  const marketplaceChat = Boolean(
    productId && (conversationId || params.has("listingChat")),
  );
  const threadKey = conversationId || `secondhand-${productId}-${id}`;
  if (conversationId) startSecondhandChatSync(conversationId);
  const product = productId ? listing(productId) : null;
  const peerName =
    marketplaceChat && product?.sellerId === state.user.id
      ? t("ผู้ซื้อ")
      : seller(id).name;
  const peerInitial = peerName.slice(0, 1).toUpperCase();
  const msgs = marketplaceChat
    ? conversationId && supabaseConfigured
      ? secondhandChatMessages.get(secondhandChatCacheKey(conversationId)) || []
      : state.conversations[threadKey] || []
    : state.conversations[id] || [];
  const selectedHref = location.pathname + location.search;
  return `<section class="chat-workspace" data-active="true" aria-label="${t("แชต")}">
    ${chatWorkspaceSidebar(selectedHref)}
    <div class="chat-workspace-pane chat-workspace-active">
      <div class="chat-shell"><div class="chat-head"><a href="/chat" class="chat-mobile-back" aria-label="${t("รายการแชต")}">${icon("back", 22)}</a>${chatAvatar(peerName, peerInitial)}<div><h1>${escape(peerName)}</h1><small>${marketplaceChat ? t("แชทสินค้า") : t("แชตจำลอง · ไม่ส่งถึงผู้ขายจริง")}</small></div></div>${product ? `<div class="chat-product">${t(marketplaceChat ? "กำลังคุยเรื่องสินค้า" : "กำลังสอบถามเรื่อง")} ${a(`/products/${productId}`, escape(product.title || t("สินค้า")))}</div>` : ""}<div class="messages">${msgs.length ? msgs.map((m) => `<div class="bubble ${m.from === "me" ? "mine" : "theirs"}">${escape(m.body)}</div>`).join("") : `<div class="chat-empty">${t("เริ่มคุยเรื่องสินค้า เงื่อนไขรับของ หรือค่าส่งได้ที่นี่")}</div>`}</div><form id="chat-form" data-id="${marketplaceChat ? threadKey : id}" ${marketplaceChat ? `data-marketplace="true" data-conversation="${escape(conversationId || "")}" data-product="${escape(productId)}" data-peer="${escape(id)}"` : ""} class="chat-input"><input name="body" maxlength="500" required placeholder="${t(marketplaceChat ? "พิมพ์ข้อความ" : "พิมพ์ข้อความเดโม...")}" aria-label="${t("ข้อความ")}"/><button class="chat-send" type="submit" aria-label="${t("ส่ง")}">${icon("arrow", 20)}</button></form></div>
    </div>
  </section>`;
}
function notifications() {
  if (!requireAuth("/notifications"))
    return authRequiredView(
      t("การแจ้งเตือน"),
      t("เข้าสู่ระบบเพื่อดูการแจ้งเตือนกิจกรรมและยอดสมาชิก"),
    );
  const notes = state.notifications.filter(
    (n) => n.recipient === state.user.id,
  );
  return `${title(t("การแจ้งเตือน"), t("เหตุการณ์ในกลุ่มและข้อความจำลองของคุณ"))}<div class="narrow">${notes.length ? notes.map((n) => `<button class="notification ${n.read ? "" : "unread"}" data-action="open-notice" data-id="${n.id}"><span class="notice-dot"></span><span><b>${escape(n.title)}</b><small>${escape(n.body)}</small></span>${icon("arrow", 18)}</button>`).join("") : `<div class="empty"><h2>${t("ยังไม่มีการแจ้งเตือน")}</h2><p>${t("เมื่อมีสมาชิกหรือยอดเปลี่ยน รายการจะปรากฏที่นี่")}</p>${a("/explore", t("สำรวจสินค้า"), "button secondary")}</div>`}</div>`;
}
function subscriptionStatusSection(sub, { current, pending, active, endsAt, daysLeft }) {
  const payments = sub?.payments || [];
  const showForm = plusPaymentOpen && !pending;
  // A Free member who has never paid sees nothing here until they press "สมัคร Plus".
  if (!showForm && !pending && !active && !payments.length && sub?.status !== "expired") return "";
  const label = { reported: "รอแอดมินตรวจ", verified: "ยืนยันแล้ว", rejected: "ไม่ผ่าน" };
  const rejected = payments.find((p) => p.status === "rejected" && !payments.some((q) => q.status !== "rejected" && q.reportedAt > p.reportedAt));
  return `<section class="subscription-status group-payment-panel" id="plus-payment" aria-labelledby="plus-status-heading">
    <span class="chip">${current === "plus" ? "Plus" : "Free"}</span>
    <h2 id="plus-status-heading">${active ? t("Plus ใช้งานอยู่") : pending ? t("รอแอดมินตรวจสลิป") : sub?.status === "expired" ? t("Plus หมดอายุแล้ว") : t("สมัคร Plus ฿49 ต่อเดือน")}</h2>
    <p>${active ? t("รอบปัจจุบัน {start} ถึง {end} เหลือ {days} วัน ต่ออายุก่อนหมดได้ เดือนใหม่จะต่อจากวันสิ้นสุดเดิม", { start: shortDate(sub.periodStart), end: shortDate(endsAt), days: daysLeft }) : pending ? t("ได้รับสลิปแล้ว แอดมินตรวจแล้ว Plus จะเริ่มใช้งานทันที") : t("โอน ฿49 ตาม QR แล้วแนบสลิป แอดมินตรวจแล้วเริ่มนับ 1 เดือนจากวันที่ยืนยัน หมดอายุแล้วกลับเป็น Free อัตโนมัติ")}</p>
    ${rejected && !pending ? `<p class="summary-warning">${t("สลิปก่อนหน้าไม่ผ่าน")}${rejected.note ? `: ${escape(rejected.note)}` : ""}</p>` : ""}
    ${pending
      ? !supabaseConfigured ? `<button class="button outline" data-action="demo-verify-subscription">${t("ยืนยันสลิป (แอดมินเดโม)")}</button>` : ""
      : showForm
        ? `<div class="cycle-pay"><strong class="plus-amount">${money(PLUS_PRICE_SATANG)}</strong>${paymentQr()}${subscriptionSlipForm()}</div><button type="button" class="button subtle" data-action="close-plus-payment">${t("ยกเลิก")}</button>`
        : ""}
    ${payments.length ? `<details class="cycle-history"><summary>${t("ประวัติการชำระ")}</summary><ul>${payments.map((p) => `<li><span>${shortDate(p.reportedAt)}</span><span>${p.coversFrom ? `${shortDate(p.coversFrom)} – ${shortDate(p.coversTo)}` : "–"}</span><b>${t(label[p.status] || p.status)}</b></li>`).join("")}</ul></details>` : ""}
  </section>`;
}
/** Bottom of /subscription: enter a code; HARN-WITH-JINN waives the 2% commission for 2 months. */
function promoSection() {
  const until = myFeeWaiverUntil();
  const used = supabaseConfigured ? (state.remoteSubscription?.promoCodes || []).length > 0 : Boolean(state.promos?.[state.user?.id]);
  return `<section class="promo-section" aria-labelledby="promo-heading"><h2 id="promo-heading">${icon("sparkles", 20)} ${t("โค้ดส่วนลด")}</h2>${
    until
      ? `<div class="promo-success" role="status"><strong>${t("ยินดีด้วย! คุณได้รับโค้ดพิเศษ")}</strong><p>${t("ไม่เสียค่าธรรมเนียมเว็บ 2% ถึงวันที่ {date}", { date: shortDate(until) })}</p></div>`
      : used
        ? `<p class="promo-note">${t("โค้ดพิเศษของคุณหมดอายุแล้ว")}</p>`
        : !state.user
          ? `<p class="promo-note">${t("เข้าสู่ระบบเพื่อกรอกโค้ดส่วนลด")}</p>`
          : `<p class="promo-note">${t("มีโค้ดส่วนลด? กรอกเพื่อรับสิทธิ์ยกเว้นค่าธรรมเนียมเว็บ")}</p><div class="promo-form"><input id="promo-code-input" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="40" placeholder="${t("กรอกโค้ด")}" aria-label="${t("โค้ดส่วนลด")}"/><button type="button" class="button primary" data-action="redeem-promo">${t("ใช้โค้ด")}</button></div>`
  }</section>`;
}
function subscriptionSlipForm() {
  const localNow = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  return `<div class="group-payment-proof-fields"><label>${t("แนบสลิปโอนเงิน")}<input type="file" accept="image/jpeg,image/png,image/webp" data-payment-slip-input required/><small data-payment-slip-status>${t("ยังไม่ได้เลือกสลิป (ไม่เกิน 8 MB)")}</small></label><label>${t("วันที่และเวลาที่โอนจริง")}<input type="datetime-local" data-payment-transfer-time value="${localNow}" required/></label><button class="button primary full" type="button" data-action="report-subscription-payment" data-slip-submit disabled>${t("แนบสลิปแล้วแจ้งแอดมิน")}</button></div>`;
}
// The Plus transfer form stays hidden until the member chooses to subscribe or renew.
let plusPaymentOpen = false;
/** One plan card: name, a price that counts up, what is included, the action and a short note. */
function pricingCard({ index, name, price, popular = false, tagline, features, current, action, note }) {
  return `<article class="hk-plan ${popular ? "is-popular" : "is-side"} ${current ? "is-current" : ""}" style="--plan-index:${index}">
    ${popular ? `<span class="hk-plan-badge">${icon("sparkles", 14)} ${t("ยอดนิยม")}</span>` : ""}
    <p class="hk-plan-name">${escape(name)}</p>
    <div class="hk-plan-price"><strong><span aria-hidden="true">฿</span><span data-count-to="${Number(price)}">${Number(price)}</span><span class="sr-only">${money(price * 100)}</span></strong><span>/ ${t("เดือน")}</span></div>
    <p class="hk-plan-billing">${price ? t("ชำระรายเดือน") : t("ไม่มีค่าใช้จ่าย")}</p>
    <p class="hk-plan-tagline">${escape(tagline)}</p>
    <ul class="hk-plan-features">${features.map((feature) => `<li>${icon("check", 16)}<span>${escape(feature)}</span></li>`).join("")}</ul>
    <hr/>
    ${action}
    <p class="hk-plan-note">${escape(note)}</p>
    ${current ? `<span class="hk-plan-current">${t("แพ็กเกจปัจจุบัน")}</span>` : ""}
  </article>`;
}
/** Prices count up from zero the first time the cards appear (skipped for reduced motion). */
function animatePricing() {
  const root = document.querySelector("[data-pricing]");
  if (!root || root.dataset.animated) return;
  root.dataset.animated = "1";
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  root.querySelectorAll("[data-count-to]").forEach((el) => {
    const target = Number(el.dataset.countTo) || 0;
    if (!target) return;
    const start = performance.now(), duration = 700;
    const step = (now) => {
      const progress = Math.min(1, (now - start) / duration);
      el.textContent = String(Math.round(target * (1 - Math.pow(1 - progress, 3))));
      if (progress < 1) requestAnimationFrame(step);
    };
    el.textContent = "0";
    setTimeout(() => requestAnimationFrame(step), 350);
  });
}
function subscriptionPage() {
  const current = subscriptionFor();
  const sub = mySubscription();
  const pending = sub?.status === "pending_payment" || (sub?.payments || []).some((p) => p.status === "reported");
  const active = current === "plus";
  const endsAt = sub?.periodEnd;
  const daysLeft = active && endsAt ? Math.max(0, Math.ceil((new Date(endsAt) - Date.now()) / 86400000)) : 0;
  const features = [
    [t("ค้นหาและเข้าร่วมกลุ่ม"), true, true],
    [t("คำนวณยอดหาร"), true, true],
    [t("ดูสถานะชำระเงิน"), true, true],
    [
      t("จัดการกลุ่มพร้อมกัน"),
      t("{count} กลุ่ม", { count: 2 }),
      t("{count} กลุ่ม", { count: 5 }),
    ],
    [t("แจ้งเตือนวันครบกำหนด"), true, true],
    [t("แจ้งเตือนซ้ำแบบกำหนดเอง"), false, true],
    [t("รายงานค่าใช้จ่าย"), t("พื้นฐาน"), t("ละเอียด")],
    [t("ส่งออก CSV"), false, true],
    [t("สร้างกลุ่มจากข้อมูลเดิม"), false, true],
    [t("AI วิเคราะห์ค่าใช้จ่าย"), false, t("จำกัดโควตา")],
  ];
  const mark = (value) =>
    value === true
      ? `<span class="subscription-check" aria-label="${t("รวมในแพ็กเกจ")}">✓</span>`
      : value === false
        ? '<span class="subscription-dash">—</span>'
        : `<strong>${escape(value)}</strong>`;
  return `<section class="subscription-page">
    <header class="subscription-hero"><div class="subscription-hero-copy"><span class="subscription-badge">${t("แพ็กเกจ")}</span><h1>${t("เลือกแพ็กเกจ")}</h1><p>${t("เริ่มด้วยแพ็กเกจฟรี หรือเลือกแพ็กเกจ Plus")}</p></div><div class="subscription-hero-art" aria-hidden="true"><span class="subscription-art-card"><i>●　━　 + ฿120</i><i>●　━　 - ฿65</i><i>●　━　 - ฿42</i></span><span class="subscription-art-coin">฿</span><span class="subscription-art-spark">✦</span></div></header>
    <div class="hk-pricing" data-pricing>
      ${pricingCard({
        index: 0,
        name: "Free",
        price: 0,
        tagline: t("ใช้งานแพ็กเกจหลักได้ฟรี"),
        features: features.filter(([, free]) => free !== false).map(([label, free]) => (free === true ? label : `${label} ${free}`)),
        current: current === "free",
        action: `<button class="button outline full" disabled>${current === "free" ? t("ใช้งานแพ็กเกจนี้อยู่") : t("กลับเป็น Free เมื่อ Plus หมดอายุ")}</button>`,
        note: t("เหมาะสำหรับเริ่มต้น"),
      })}
      ${pricingCard({
        index: 1,
        name: "Plus",
        price: 49,
        popular: true,
        tagline: t("เครื่องมือเพิ่มเติมเพื่อจัดการกลุ่มได้มากขึ้น"),
        features: features.map(([label, , plus]) => (plus === true ? label : `${label} ${plus}`)),
        current: current === "plus",
        action: !state.user
          ? a("/login", t("เข้าสู่ระบบเพื่อสมัคร Plus"), "button primary full")
          : pending
            ? `<button class="button primary full" disabled>${t("รอแอดมินตรวจสลิป")}</button>`
            : `<button type="button" class="button primary full" data-action="open-plus-payment">${active ? t("ต่ออายุอีก 1 เดือน") : t("สมัคร Plus")} ${icon("arrow", 18)}</button>`,
        note: active
          ? t("ใช้งานถึง {date} (เหลือ {days} วัน)", { date: shortDate(endsAt), days: daysLeft })
          : t("ชำระรายเดือนด้วยการโอนและแนบสลิป แอดมินตรวจแล้วเริ่มใช้งานทันที"),
      })}
    </div>
    ${state.user ? subscriptionStatusSection(sub, { current, pending, active, endsAt, daysLeft }) : ""}
    <section class="subscription-comparison"><h2>${t("เปรียบเทียบแพ็กเกจ")}</h2><div class="subscription-table-wrap"><table class="subscription-table"><thead><tr><th scope="col">${t("ฟีเจอร์")}</th><th scope="col">Free</th><th scope="col">Plus</th></tr></thead><tbody>${features.map(([label, free, plus]) => `<tr><th scope="row">${escape(label)}</th><td>${mark(free)}</td><td>${mark(plus)}</td></tr>`).join("")}</tbody></table></div></section>
    ${promoSection()}
  </section>`;
}
function accountOrderRow(o) {
  const p = listing(o.listingId);
  const payment = o.payments?.[state.user.id] || {
    amountSatang: 0,
    status: "unpaid",
  };
  const isPhysical = p ? p.kind === "สินค้า" : true;
  const orderDate =
    o.createdAt || (o.history && o.history[0]?.at) || new Date().toISOString();
  const d = new Date(orderDate);
  const pad = (n) => String(n).padStart(2, "0");
  const dateStr = `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

  let titleText = "";
  let statusTone = "default";
  let descText = "";

  if (o.status === "refunded" || o.refund) {
    titleText = t("ยกเลิกแล้ว");
    statusTone = "cancelled";
    descText =
      t("เหตุผล ถูกยกเลิกโดยระบบแล้ว") +
      (o.refund?.note ? ` (${o.refund.note})` : "");
  } else if (o.status === "completed" || o.status === "delivered") {
    titleText = t("คำสั่งซื้อสำเร็จแล้ว");
    statusTone = "completed";
    const reviewDeadline = `${pad(d.getDate() + 14 > 28 ? 7 : d.getDate() + 14)}-${pad((d.getMonth() + 2) % 12 || 12)}-${d.getFullYear()}`;
    descText = t("โปรดรีวิวสินค้าก่อนวันที่ {date} และรับคะแนนพิเศษ", {
      date: reviewDeadline,
    });
  } else if (o.status === "shipped") {
    titleText = t("กำลังจัดส่งพัสดุ");
    statusTone = "shipped";
    const carrier = o.shipment?.carrier || t("ขนส่ง");
    const trackingNumber = o.shipment?.trackingNumber || "";
    descText = trackingNumber
      ? t(
          "พัสดุถูกส่งมอบให้ {carrier} เรียบร้อยแล้ว (เลขพัสดุ: {trackingNumber})",
          { carrier, trackingNumber },
        )
      : t("พัสดุกำลังจัดส่ง");
  } else if (o.status === "preparing_order") {
    titleText = t("ผู้ขายกำลังจัดเตรียมพัสดุ");
    statusTone = "preparing";
    descText = t("ผู้ขายกำลังจัดเตรียมสินค้าเพื่อส่งมอบให้บริษัทขนส่ง");
  } else {
    titleText = t("รอชำระเงิน / ยืนยันยอด");
    statusTone = "pending";
    descText = t("รอสมาชิกในกลุ่มแจ้งชำระและตรวจยอดเดโม");
  }

  const thumbImg = p?.image
    ? `<img src="${p.image}" alt="${escape(t(p.title))}" class="order-card-thumb-img"/>`
    : p
      ? art(p)
      : `<div class="order-card-thumb-fallback">${icon("package", 32)}</div>`;

  return `<article class="order-update-card ${statusTone}">
    <a href="/orders/${o.groupId}" data-link class="order-update-card-link">
      <div class="order-update-content">
        <div class="order-update-head">
          <strong class="order-update-title">${escape(titleText)}</strong>
          ${isPhysical ? `<span class="order-kind-pill physical">${icon("package", 13)} ${t("สินค้าพัสดุ")}</span>` : `<span class="order-kind-pill digital">${t("บริการ/ดิจิทัล")}</span>`}
        </div>
        <p class="order-update-desc">${escape(descText)}</p>
        <div class="order-update-footer">
          <time class="order-update-time">${dateStr}</time>
          <span class="order-update-price">${money(payment.amountSatang)}</span>
          <span class="order-update-btn">${isPhysical && ["shipped", "delivered", "completed"].includes(o.status) ? t("ติดตามพัสดุ") : t("ดูคำสั่งซื้อ")} ${icon("arrow", 14)}</span>
        </div>
      </div>
      <div class="order-update-thumb" role="img" aria-label="${escape(t(p?.title || t("รายการสินค้า")))}">
        ${thumbImg}
      </div>
    </a>
  </article>`;
}
function myOrdersPage() {
  if (!requireAuth("/my-orders"))
    return authRequiredView(
      t("อัปเดตคำสั่งซื้อ"),
      t("เข้าสู่ระบบเพื่อดูคำสั่งซื้อเดโมของคุณ"),
    );
  const orders = state.orders
    .filter(
      (o) =>
        o &&
        typeof o === "object" &&
        o.members?.includes(state.user.id) &&
        o.payments?.[state.user.id],
    )
    .sort(
      (a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0),
    );
  return `<div class="account-page account-orders-page">${title(t("อัปเดตคำสั่งซื้อ"), t("รายการและสถานะการชำระเงินในโหมดเดโม"))}<section class="account-card"><div class="account-card-heading"><h2>${t("รายการทั้งหมด")}</h2>${a("/profile", t("กลับไปบัญชีของฉัน"), "button subtle")}</div>${orders.length ? `<div class="order-updates-grid">${orders.map(accountOrderRow).join("")}</div>` : `<div class="account-empty"><span>${icon("calc", 26)}</span><strong>${t("ยังไม่มีคำสั่งซื้อเดโม")}</strong><p>${t("เมื่อกลุ่มครบและสรุปคำสั่งซื้อ รายการจะปรากฏที่นี่")}</p>${a("/my-groups", t("ดูกลุ่มของฉัน"), "button outline")}</div>`}</section></div>`;
}
function profile() {
  if (!requireAuth("/profile"))
    return authRequiredView(
      t("บัญชีของฉัน"),
      t("เข้าสู่ระบบหรือลงทะเบียนเพื่อจัดการข้อมูลส่วนตัว"),
    );
  const sellerRole = state.user.role === "seller";
  const mine = state.groups.filter((g) => g.members.includes(state.user.id));
  const orders = state.orders
    .filter(
      (o) =>
        o &&
        typeof o === "object" &&
        o.members?.includes(state.user.id) &&
        o.payments?.[state.user.id],
    )
    .sort(
      (a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0),
    );
  const unpaid = orders.filter(
    (o) =>
      o.status === "pending_payment" &&
      o.payments?.[state.user.id]?.status === "unpaid",
  );
  const verified = orders.filter(
    (o) => o.payments?.[state.user.id]?.status === "verified",
  );
  const sumPayments = (entries) =>
    entries.reduce(
      (sum, o) => sum + (o.payments[state.user.id]?.amountSatang || 0),
      0,
    );
  const unpaidAmount = sumPayments(unpaid);
  const verifiedAmount = sumPayments(verified);
  const avatar = profileAvatarMarkup(state.user);
  const stat = (iconName, label, value, sub, tone) =>
    `<div class="account-stat"><span class="account-stat-icon ${tone}">${icon(iconName, 22)}</span><div><small>${label}</small><strong>${value}</strong><span>${sub}</span></div></div>`;
  const shortcut = (href, iconName, label, sub, tone) =>
    a(
      href,
      `<span class="account-shortcut-icon ${tone}">${icon(iconName, 21)}</span><span><strong>${label}</strong><small>${sub}</small></span>${icon("arrow", 18)}`,
      "account-shortcut",
    );
  return `<div class="account-page account-dashboard">
    <div class="account-dashboard-layout">
      <aside class="account-dashboard-sidebar"><div class="account-profile-badge"><div id="profile-lanyard-badge"></div></div></aside>
      <header class="account-dashboard-heading">${title(t("บัญชีของฉัน"), t(supabaseConfigured ? "จัดการโปรไฟล์และกลุ่มของคุณ" : "จัดการบทบาทและทดลองใช้งานหลายบัญชี"))}${a("/subscription", `${icon("sparkles", 20)} <span><strong>${t("แพ็กเกจสมาชิก")}</strong><small>${subscriptionFor() === "plus" ? t("Plus · 49 บาท/เดือน") : t("Free · ใช้งานฟรี")}</small></span>${icon("arrow", 18)}`, "account-shortcut subscription-account-link")}</header>
      <main class="account-dashboard-content">
    <div class="account-layout">
      <div class="account-main">
        <section class="account-card account-overview" aria-labelledby="account-name">
          <div class="account-profile-line"><span class="avatar large">${avatar}</span><div class="account-profile-identity"><h2 id="account-name">${escape(state.user.name)}</h2><p>${sellerRole ? t("บัญชีผู้ขายเดโม") : t(supabaseConfigured ? "สมาชิก" : "สมาชิกเดโม")}</p><div class="account-profile-actions"><button class="button outline" data-action="edit-profile">${icon("settings", 17)} ${t("ตั้งค่าบัญชี")}</button>${supabaseConfigured && ADMIN_ACCOUNT_EMAILS.includes(state.user.email?.trim().toLowerCase()) ? a("/admin", "Admin", "button outline") : ""}${supabaseConfigured ? `<button class="button subtle" data-action="logout">${t("ออกจากระบบ")}</button>` : ""}</div></div></div>
          <div class="account-demo-note">${icon("shield", 21)}<div><strong>${t("ความปลอดภัยของเว็บไซต์")}</strong><p>${t(supabaseConfigured ? "ข้อมูลส่วนตัวและการทำรายการของคุณได้รับการปกป้อง เพื่อให้ใช้งานได้อย่างปลอดภัยและมั่นใจ" : "บัญชีตัวอย่างเก็บข้อมูลไว้ในเบราว์เซอร์นี้เท่านั้น")}</p></div></div>
        </section>
        <section class="account-card account-summary" aria-labelledby="account-summary-title"><div class="account-card-heading"><div><h2 id="account-summary-title">${t("สรุปข้อมูลของฉัน")}</h2><p>${t("ยอดยืนยันกลุ่มและคำสั่งซื้อโดยรวม")}</p></div>${a("/my-groups", t("ดูกลุ่มของฉัน"), "button subtle")}</div><div class="account-summary-grid"><div class="account-summary-tile blue"><span class="account-summary-icon">${icon("users", 22)}</span><div><span>${t("กลุ่มที่เข้าร่วม")}</span><strong>${mine.length}</strong><small>${t("กลุ่ม")}</small></div></div><div class="account-summary-tile mint"><span class="account-summary-icon">${icon("calc", 22)}</span><div><span>${t("คำสั่งซื้อเดิม")}</span><strong>${orders.length}</strong><small>${t("รายการ")}</small></div></div><div class="account-summary-tile violet"><span class="account-summary-icon">${icon("calc", 22)}</span><div><span>${t("ยอดค้างชำระ")}</span><strong>${money(unpaidAmount)}</strong><small>${t("เดโมเท่านั้น")}</small></div></div><div class="account-summary-tile mint"><span class="account-summary-icon">${icon("check", 22)}</span><div><span>${t("ยอดชำระเสร็จแล้ว")}</span><strong>${money(verifiedAmount)}</strong><small>${t("เดโมเท่านั้น")}</small></div></div></div></section>
        ${
          supabaseConfigured
            ? ""
            : `<details class="account-card account-test-tools"><summary>${t("เครื่องมือทดสอบบัญชี")}</summary><p>${t("ใช้ทดสอบการยืนยันยอดของสมาชิกแต่ละคน")}</p><div class="account-switch"><button data-action="switch-user" data-id="demo-owner" class="button outline">${escape(demoNames["demo-owner"])}</button>${Object.entries(
                demoNames,
              )
                .filter(([id]) => id !== "demo-owner")
                .map(
                  ([id, n]) =>
                    `<button data-action="switch-user" data-id="${id}" class="button outline">${escape(n)}</button>`,
                )
                .join(
                  "",
                )}<button data-action="switch-user" data-id="demo-seller" class="button outline">${t("ผู้ขายเดโม")} · ${escape(seller("s1").name)}</button><button data-action="switch-user" data-id="demo-seller-s2" class="button outline">${t("ผู้ขายเดโม")} · ${escape(seller("s2").name)}</button></div><div class="account-test-actions"><button class="button subtle" data-action="logout">${t("ออกจากระบบเดโม")}</button><button class="button subtle" data-action="reset-demo">${t("เริ่มข้อมูลเดโมใหม่")}</button></div></details>`
        }
      </div>
      <aside class="account-aside">
        ${payoutAccountCard()}
        <section class="account-card account-orders" id="account-orders" aria-labelledby="account-orders-title"><div class="account-card-heading"><h2 id="account-orders-title">${t("อัปเดตคำสั่งซื้อ")}</h2>${a("/my-orders", `${t("ดูทั้งหมด")} ${icon("arrow", 17)}`, "account-all-link")}</div>${orders.length ? `<div class="order-updates-grid">${orders.slice(0, 3).map(accountOrderRow).join("")}</div>` : `<div class="account-empty"><span>${icon("calc", 26)}</span><strong>${t("ยังไม่มีคำสั่งซื้อเดโม")}</strong><p>${t("เมื่อกลุ่มครบและสรุปคำสั่งซื้อ รายการจะปรากฏที่นี่")}</p>${a("/my-groups", t("ดูกลุ่มของฉัน"), "button outline")}</div>`}</section>
        <section class="account-card account-shortcuts" aria-labelledby="account-shortcuts-title"><h2 id="account-shortcuts-title">${t("ทางลัด")}</h2><div class="account-shortcut-grid">${shortcut("/my-groups", "users", t("กลุ่มของฉัน"), t("ดูและจัดการกลุ่มที่เข้าร่วม"), "blue")}${shortcut("/notifications", "bell", t("การแจ้งเตือน"), t("อัปเดตยอดและกิจกรรม"), "amber")}${shortcut("/explore", "search", t("สำรวจสินค้า"), t("ค้นหาสินค้าและเข้าร่วมกลุ่ม"), "violet")}${shortcut("/my-orders", "check", t("รายการชำระเดโม"), t("ดูสถานะคำสั่งซื้อของฉัน"), "mint")}</div></section>
      </aside>
      </div>
    </main>
    </div>${profileDialog()}
  </div>`;
}
function profileBadgeFace(user, back = false) {
  const e = React.createElement;
  const joinedGroups = (state.groups || []).filter(
    (group) =>
      Array.isArray(group.members) &&
      group.members.includes(user.id) &&
      group.status !== "cancelled",
  );
  const base = {
    position: "relative",
    boxSizing: "border-box",
    width: "100%",
    height: "100%",
    padding: "24px 22px",
    display: "flex",
    flexDirection: "column",
    color: "#102f5b",
    background: back
      ? "linear-gradient(155deg, #f8fbff 0%, #eaf2ff 100%)"
      : "linear-gradient(155deg, #ffffff 0%, #f2efff 100%)",
  };
  const labelStyle = {
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: ".14em",
    textTransform: "uppercase",
    color: "#56708e",
  };
  if (back) {
    return e(
      "div",
      { style: base },
      e("span", { style: labelStyle }, t("กลุ่มที่เข้าร่วมตอนนี้")),
      joinedGroups.length
        ? e(
            "div",
            {
              style: {
                display: "grid",
                gap: 9,
                margin: "12px 0 auto",
                maxHeight: 340,
                overflow: "hidden",
              },
            },
            ...joinedGroups.slice(0, 6).map((group) =>
              e(
                "div",
                {
                  key: group.id,
                  style: {
                    border: "1px solid rgba(16,47,91,.12)",
                    borderRadius: 10,
                    padding: "9px 11px",
                    background: "rgba(255,255,255,.56)",
                    fontSize: 14,
                    lineHeight: 1.35,
                    overflowWrap: "anywhere",
                  },
                },
                group.name || t("กลุ่มไม่มีชื่อ"),
              ),
            ),
            joinedGroups.length > 6
              ? e(
                  "small",
                  { style: { color: "#56708e" } },
                  t("และอีก {count} กลุ่ม", { count: joinedGroups.length - 6 }),
                )
              : null,
          )
        : e(
            "p",
            {
              style: {
                fontSize: 15,
                lineHeight: 1.55,
                overflowWrap: "anywhere",
                margin: "12px 0 auto",
              },
            },
            t("ยังไม่ได้เข้าร่วมกลุ่ม"),
          ),
      e(
        "div",
        {
          style: {
            borderTop: "1px solid rgba(16,47,91,.18)",
            paddingTop: 12,
          },
        },
        e("span", { style: labelStyle }, t("สถานะสมาชิก")),
        e(
          "strong",
          { style: { display: "block", marginTop: 5, fontSize: 16 } },
          user.role === "seller" ? t("ผู้ขาย") : t("สมาชิก HarnKhong"),
        ),
        e(
          "small",
          { style: { display: "block", marginTop: 9, color: "#56708e" } },
          t("แตะบัตรเพื่อพลิกกลับ"),
        ),
      ),
    );
  }
  const avatarSrc = profileAvatarSrc(user.avatar);
  return e(
    "div",
    { style: base },
    e(
      "div",
      {
        "aria-hidden": true,
        style: {
          position: "absolute",
          inset: "auto 0 0",
          height: 96,
          overflow: "hidden",
          pointerEvents: "none",
        },
      },
      e(
        "svg",
        {
          viewBox: "0 0 320 96",
          preserveAspectRatio: "none",
          style: { position: "absolute", inset: 0, width: "100%", height: "100%" },
        },
        e("path", {
          d: "M0 82 C65 68 107 92 170 65 C222 42 264 12 320 18 L320 96 L0 96 Z",
          fill: "#e9e5ff",
        }),
        e("path", {
          d: "M0 96 C72 80 117 95 191 71 C243 54 278 38 320 43 L320 96 Z",
          fill: "#dcd6ff",
          opacity: 0.85,
        }),
      ),
      e(
        "svg",
        {
          viewBox: "0 0 64 64",
          fill: "none",
          stroke: "#fff",
          strokeWidth: 4,
          strokeLinecap: "round",
          strokeLinejoin: "round",
          style: { position: "absolute", width: 54, height: 54, right: 20, bottom: 13, opacity: 0.9 },
        },
        e("path", { d: "M7 11h7l6 30h29l7-22H18" }),
        e("path", { d: "M22 27h29M25 20l3 21m15-21-3 21" }),
        e("circle", { cx: 26, cy: 51, r: 3.5, fill: "#fff", stroke: "none" }),
        e("circle", { cx: 47, cy: 51, r: 3.5, fill: "#fff", stroke: "none" }),
      ),
    ),
    e(
      "div",
      { style: { position: "relative", zIndex: 1, display: "flex", alignItems: "center", gap: 8 } },
      e("img", {
        src: "/images/harnkhong-logo.png",
        alt: "",
        style: { width: 38, height: 38, objectFit: "contain" },
      }),
      e(
        "strong",
        { style: { fontSize: 14, letterSpacing: "-.02em" } },
        "HarnKhong",
      ),
    ),
    e(
      "div",
      {
        style: {
          display: "grid",
          placeItems: "center",
          width: 76,
          height: 76,
          margin: "20px 0 0",
          overflow: "hidden",
          borderRadius: "50%",
          background: "#c9f1e7",
          color: "#087e68",
          fontSize: 30,
          fontWeight: 700,
        },
      },
      avatarSrc
        ? e("img", {
            src: avatarSrc,
            alt: "",
            style: { width: "100%", height: "100%", objectFit: "cover" },
          })
        : user.name?.slice(0, 1) || "?",
    ),
    e(
      "div",
      { style: { position: "relative", zIndex: 1, marginTop: 24 } },
      e("span", { style: labelStyle }, t("โปรไฟล์สมาชิก")),
      e(
        "strong",
        {
          style: {
            display: "block",
            marginTop: 7,
            fontSize: 24,
            lineHeight: 1.15,
            overflowWrap: "anywhere",
          },
        },
        user.name,
      ),
    ),
    e(
      "div",
      {
        style: {
          position: "relative",
          zIndex: 1,
          borderTop: "1px solid rgba(16,47,91,.16)",
          marginTop: 18,
          paddingTop: 14,
        },
      },
      e("span", { style: labelStyle }, t("แนะนำตัว")),
      e(
        "p",
        {
          style: {
            margin: "6px 0 0",
            fontSize: 13,
            lineHeight: 1.5,
            overflowWrap: "anywhere",
            whiteSpace: "pre-wrap",
          },
        },
        user.bio || t("ยังไม่ได้เพิ่มคำแนะนำตัว"),
      ),
    ),
    e(
      "div",
      {
        style: {
          position: "relative",
          zIndex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          marginTop: "auto",
          borderTop: "1px solid rgba(16,47,91,.16)",
          paddingTop: 12,
        },
      },
      e("span", { style: { ...labelStyle, letterSpacing: ".04em" } }, t("เรตโปรไฟล์")),
      e(
        "div",
        { style: { textAlign: "right" } },
        e("strong", { style: { display: "block", fontSize: 13 } }, "— / 5"),
        e("small", { style: { color: "#56708e", fontSize: 9 } }, t("ยังไม่มีรีวิว")),
      ),
    ),
  );
}
function myProfilePage() {
  if (!requireAuth("/profile/me"))
    return authRequiredView(
      t("หน้าโปรไฟล์ของฉัน"),
      t("เข้าสู่ระบบเพื่อดูหน้าโปรไฟล์ของคุณ"),
    );
  const user = state.user;
  const avatar = profileAvatarMarkup(user);
  return `<div class="my-profile-page">
    ${title(t("หน้าโปรไฟล์ของฉัน"), t("ข้อมูลที่แสดงบนบัตรสมาชิกของคุณ"))}
    <div class="my-profile-actions">${a("/profile", `← ${t("กลับไปบัญชีของฉัน")}`, "button subtle")}<button class="button outline" data-action="edit-profile">${icon("settings", 17)} ${t("แก้ไขโปรไฟล์")}</button></div>
    <div class="my-profile-layout">
      <section class="my-profile-badge-panel" aria-label="${t("บัตรโปรไฟล์คล้องสาย")}"><div id="profile-lanyard-badge"></div></section>
      <section class="my-profile-details" aria-labelledby="my-profile-details-heading"><div class="my-profile-user-heading"><span class="avatar large">${avatar}</span><div><h2 id="my-profile-details-heading">${escape(user.name)}</h2><p>${escape(user.email || "—")}</p></div></div><dl><div><dt>${t("ชื่อ")}</dt><dd>${escape(user.name)}</dd></div><div><dt>${t("อีเมล")}</dt><dd>${escape(user.email || "—")}</dd></div><div><dt>${t("เรตโปรไฟล์")}</dt><dd><span class="my-profile-rating-empty">— / 5 · ${t("ยังไม่มีรีวิว")}</span><small>${t("คะแนนจะแสดงเมื่อมีรีวิวจากผู้ใช้")}</small></dd></div></dl>${user.bio ? `<div class="my-profile-bio"><h3>${t("เกี่ยวกับฉัน")}</h3><p>${escape(user.bio)}</p></div>` : `<div class="my-profile-bio is-empty"><h3>${t("เกี่ยวกับฉัน")}</h3><p>${t("เพิ่มคำแนะนำตัวได้จากปุ่มแก้ไขโปรไฟล์")}</p></div>`}</section>
    </div>
  </div>`;
}
function memberProfilePage(memberId) {
  const groupId = new URLSearchParams(location.search).get("group");
  const currentGroup = group(groupId);
  if (!requireAuth(location.pathname + location.search))
    return authRequiredView(
      t("โปรไฟล์สมาชิก"),
      t("เข้าสู่ระบบเพื่อดูโปรไฟล์สมาชิกในกลุ่ม"),
    );
  if (
    !currentGroup ||
    !state.user ||
    !currentGroup.members.includes(state.user.id) ||
    !currentGroup.members.includes(memberId)
  )
    return notFound();
  const profile =
    memberId === state.user.id
      ? state.user
      : state.profiles?.[memberId] || { id: memberId, name: name(memberId) };
  const memberName = profile.name || name(memberId);
  const avatar = profileAvatarMarkup({
    name: memberName,
    avatar: profile.avatar || profile.avatar_url || "",
  });
  return `<section class="member-profile-page">
    ${a(`/groups/${encodeURIComponent(currentGroup.id)}`, `← ${t("กลับไปดูกลุ่ม")}`, "button subtle")}
    <article class="member-profile-card">
      <header class="member-profile-heading"><span class="avatar large">${avatar}</span><div><span class="member-profile-kicker">${t("สมาชิกในกลุ่ม")}</span><h1>${escape(memberName)}</h1><p>${escape(currentGroup.name)}</p></div></header>
      <section class="member-profile-bio"><h2>${t("เกี่ยวกับฉัน")}</h2><p>${escape(profile.bio || t("ยังไม่ได้เพิ่มคำแนะนำตัว"))}</p></section>
      <div class="member-profile-rating"><span>${t("เรตโปรไฟล์")}</span><div><strong>— / 5</strong><small>${t("ยังไม่มีรีวิว")}</small></div></div>
      <footer class="member-profile-actions">${a(`/groups/${encodeURIComponent(currentGroup.id)}/chat`, `${icon("chat", 18)} ${t("แชทกลุ่ม")}`, "button primary")}${a(`/groups/${encodeURIComponent(currentGroup.id)}`, t("ดูกลุ่ม"), "button outline")}</footer>
    </article>
  </section>`;
}
function sellerOrders() {
  const orders = state.orders.filter(
    (o) => o && typeof o === "object" && orderPermissions(o, state.user).seller,
  );
  return `<section class="activity seller-orders"><h2>${t("คำสั่งซื้อของร้าน")}</h2>${orders.length ? orders.map((o) => a(`/orders/${o.groupId}`, `<b>${escape(group(o.groupId)?.name || o.id)}</b><span>${orderStatus(o.status)}</span>`, "profile-link")).join("") : `<p>${t("ยังไม่มีคำสั่งซื้อของร้าน")}</p>`}</section>`;
}
function sellerDashboard() {
  if (!requireAuth("/seller/dashboard"))
    return authRequiredView(
      t("แดชบอร์ดผู้ขาย"),
      t("เข้าสู่ระบบเพื่อจัดการประกาศของคุณ"),
    );
  const items = listings().filter(
    (item) =>
      item.listingType === "secondhand" && item.sellerId === state.user.id,
  );
  return `<section class="seller-listings-page">${title(t("สินค้าของฉัน"), t("จัดการประกาศขายและโปรโมทสินค้า"))}<div class="seller-listings-toolbar">${a("/marketplace/secondhand", t("กลับไปตลาดมือสอง"), "button outline")}${a("/seller/products/new", t("ลงขายสินค้าใหม่"), "button primary")}</div>${items.length ? `<div class="seller-listings-grid">${items.map((item) => `<article class="seller-listing-card">${item.images?.[0] ? `<img src="${escape(item.images[0])}" alt=""/>` : `<div class="secondhand-market-placeholder">${icon("package", 30)}</div>`}<div><h2>${escape(item.title)}</h2><strong>${money(item.price)}</strong><p>${item.boostedUntil && Date.parse(item.boostedUntil) > Date.now() ? t("Boost แล้ว · เหลือ {hours} ชม.", { hours: Math.ceil((Date.parse(item.boostedUntil) - Date.now()) / 3600000) }) : t("ยังไม่ได้ Boost")}</p><div class="secondhand-seller-actions"><a class="button outline" href="/products/${encodeURIComponent(item.id)}" data-link>${t("ดูประกาศ")}</a><button class="button outline" data-action="secondhand-edit" data-id="${escape(item.id)}">${t("แก้ไข")}</button></div></div></article>`).join("")}</div>` : `<div class="empty"><h2>${t("ยังไม่มีประกาศสินค้า")}</h2><p>${t("ลงประกาศสินค้าแรกของคุณเพื่อเริ่มขายในตลาดมือสอง")}</p>${a("/seller/products/new", t("ลงขายสินค้า"), "button primary")}</div>`}</section>`;
}
function orderHistory(order) {
  return `<section class="activity"><h2>${t("ประวัติคำสั่งซื้อ")}</h2><ol class="order-timeline">${order.history
    .map(
      (
        h,
      ) => `<li><strong>${t("orderEvent_" + h.type)}</strong><p>${escape(actorName(h.actorId))} · <time datetime="${escape(h.at)}">${escape(dateTime(h.at))}</time></p>
    ${h.memberId ? `<p>${escape(actorName(h.memberId))}</p>` : ""}
    ${typeof h.newState === "string" ? `<p>${h.previousState ? escape(h.type === "payment_status_changed" || h.type === "payment_reported" ? paymentStatus(h.previousState) : orderStatus(h.previousState)) + " → " : ""}${escape(h.type === "payment_status_changed" || h.type === "payment_reported" ? paymentStatus(h.newState) : orderStatus(h.newState))}</p>` : ""}
    ${h.type === "shipment_updated" ? `<p>${escape(h.previousState?.trackingNumber || h.previousState?.url || "—")} → ${escape(h.newState.carrier)} ${escape(h.newState.trackingNumber || h.newState.url)}</p>` : ""}
    ${h.inspection ? `<p>${t("สิ้นสุดตรวจรับ")}: ${escape(dateTime(h.inspection.deadline))}</p>` : ""}
    ${h.amountSatang !== undefined ? `<p>${money(h.amountSatang)} · ${t("จำลองเท่านั้น")}</p>` : ""}
    ${h.disputeId ? `<small>${t("รหัสข้อพิพาท")}: ${escape(h.disputeId)}</small>` : ""}${h.note ? `<p class="user-content">${escape(h.note)}</p>` : ""}</li>`,
    )
    .join("")}</ol></section>`;
}
function disputePanel(order, permissions) {
  return `<section class="activity"><h2>${t("ข้อพิพาท")}</h2>${
    order.disputes.length
      ? order.disputes
          .map(
            (
              d,
            ) => `<article class="dispute-entry"><h3>${t("disputeReason_" + d.reason)} · ${t("disputeStatus_" + d.status)}</h3>
    <p>${t("ผู้รายงาน")}: ${escape(actorName(d.reporterId))} · ${escape(dateTime(d.createdAt))}</p><p class="user-content">${escape(d.description)}</p>
    ${d.evidence ? `<p class="user-content">${t("หลักฐานอ้างอิง")}: ${escape(d.evidence)}</p>` : ""}
    ${d.proposals.map((p) => `<div class="info-box"><b>${t("resolution_" + p.decision)} · ${t("proposal_" + p.status)}</b><p class="user-content">${escape(p.note)}</p><small>${escape(actorName(p.proposerId))} · ${escape(dateTime(p.proposedAt))}</small></div>`).join("")}
    ${d.resolution ? `<p>${t("ยอมรับโดย")}: ${escape(actorName(d.resolution.resolverId))} · ${escape(dateTime(d.resolution.resolvedAt))}</p>` : ""}
    ${d.status === "open" && permissions.propose ? `<form id="resolution-form" data-id="${order.id}" data-dispute="${d.id}" class="form-panel"><label>${t("ผลลัพธ์ที่เสนอ")}<select name="decision"><option value="resume">${t("resolution_resume")}</option><option value="refund">${t("resolution_refund")}</option></select></label><label>${t("เหตุผลการตัดสินใจ")}<textarea name="note" required maxlength="1000"></textarea></label><p>${t("คืนเงินจำลองนับเฉพาะยอดที่ตรวจยืนยันเดโมแล้ว")}</p><button class="button primary" type="submit">${t("เสนอผลลัพธ์ให้ผู้รายงาน")}</button></form>` : ""}
    ${d.status === "resolution_proposed" && permissions.respond ? `<div class="order-actions"><button class="button primary" data-action="resolution-response" data-id="${order.id}" data-dispute="${d.id}" data-accept="true">${t("ยอมรับผลลัพธ์")}</button><button class="button outline" data-action="resolution-response" data-id="${order.id}" data-dispute="${d.id}" data-accept="false">${t("ไม่ยอมรับผลลัพธ์")}</button></div>` : ""}
    </article>`,
          )
          .join("")
      : `<p>${t("ยังไม่มีข้อพิพาท")}</p>`
  }
    ${permissions.dispute ? `<details><summary>${t("แจ้งปัญหาคำสั่งซื้อ")}</summary><form id="dispute-form" data-id="${order.id}" class="form-panel"><label>${t("เหตุผล")}<select name="reason" required><option value="">${t("เลือกเหตุผล")}</option>${DISPUTE_REASONS.map((reason) => `<option value="${reason}">${t("disputeReason_" + reason)}</option>`).join("")}</select></label><label>${t("รายละเอียดปัญหา")}<textarea name="description" required maxlength="1000"></textarea></label><label>${t("หลักฐานอ้างอิง (ข้อความ ไม่อัปโหลดไฟล์)")}<textarea name="evidence" maxlength="1000"></textarea></label><button class="button primary" type="submit">${t("ส่งรายงานปัญหา")}</button></form></details>` : ""}
    </section>`;
}
function renderPhysicalShipmentTracker(order, p, permissions, id) {
  let currentStep = 1;
  if (["completed", "delivered"].includes(order.status) || order.deliveredAt) {
    currentStep = 5;
  } else if (order.status === "shipped") {
    currentStep = order.shipment?.trackingNumber ? 4 : 3;
  } else if (order.status === "preparing_order") {
    currentStep = 2;
  } else if (["payment_secured", "inspection_period"].includes(order.status)) {
    currentStep = order.status === "inspection_period" ? 5 : 2;
  }

  const steps = [
    { num: 1, title: t("ชำระเงินเรียบร้อย"), icon: "check" },
    { num: 2, title: t("ผู้ขายเตรียมพัสดุ"), icon: "package" },
    { num: 3, title: t("ขนส่งรับพัสดุ"), icon: "truck" },
    { num: 4, title: t("กำลังนำส่งพัสดุ"), icon: "arrow" },
    { num: 5, title: t("พัสดุจัดส่งสำเร็จ"), icon: "check" },
  ];

  const carrier = order.shipment?.carrier || "";
  const trackingNumber = order.shipment?.trackingNumber || "";

  let trackingUrl = order.shipment?.url || "";
  if (!trackingUrl && trackingNumber) {
    if (/flash/i.test(carrier))
      trackingUrl = `https://www.flashexpress.co.th/tracking/?se=${encodeURIComponent(trackingNumber)}`;
    else if (/kerry|kex/i.test(carrier))
      trackingUrl = `https://th.kerryexpress.com/th/track/?track=${encodeURIComponent(trackingNumber)}`;
    else if (/ไปรษณีย์|ems|thai/i.test(carrier))
      trackingUrl = `https://track.thailandpost.co.th/?trackNumber=${encodeURIComponent(trackingNumber)}`;
    else if (/j&t|jtexpress/i.test(carrier))
      trackingUrl = `https://www.jtexpress.co.th/index/query/gzquery.html?bills=${encodeURIComponent(trackingNumber)}`;
  }

  const addr = state.user?.address;
  const addressDisplay =
    addr && addr.province
      ? `
    <div class="tracker-address-card">
      <div class="tracker-address-head">
        <span class="tracker-address-icon">${icon("map-pin", 18)}</span>
        <strong>${t("ที่อยู่จัดส่งพัสดุ")}</strong>
      </div>
      <p class="tracker-address-text">
        <strong>${escape(state.user.name)}</strong> (${t("เบอร์ติดต่อ")}: ${escape(addr.phone || "—")})<br/>
        ${escape(addr.houseNo || "")} ${addr.villageNo ? "หมู่ " + escape(addr.villageNo) : ""}
        ${addr.alley ? "ซ. " + escape(addr.alley) : ""} ${addr.road ? "ถ. " + escape(addr.road) : ""}
        ต.${escape(addr.subdistrict || "")} อ.${escape(addr.district || "")} จ.${escape(addr.province || "")} ${escape(addr.postalCode || "")}
      </p>
    </div>
  `
      : `
    <div class="tracker-address-card">
      <div class="tracker-address-head">
        <span class="tracker-address-icon">${icon("map-pin", 18)}</span>
        <strong>${t("ที่อยู่จัดส่งพัสดุ")}</strong>
      </div>
      <p class="tracker-address-text">${t("ที่อยู่ตัวแทนรับพัสดุประจำกลุ่ม")} (${escape(t(p?.terms || t("สินค้าเป็นแพ็กเดียว สมาชิกตกลงการแบ่งรับกันในกลุ่ม")))})</p>
    </div>
  `;

  const timelineMilestones = [];
  if (["completed", "delivered"].includes(order.status) || order.deliveredAt) {
    timelineMilestones.push({
      time: order.deliveredAt || new Date().toISOString(),
      title: t("พัสดุส่งถึงผู้รับเรียบร้อยแล้ว มีผู้รับลงชื่อรับของ"),
      status: "done",
    });
  }
  if (currentStep >= 4) {
    timelineMilestones.push({
      time:
        order.shipment?.updatedAt ||
        order.shipment?.shippedAt ||
        new Date().toISOString(),
      title: t("พนักงานขนส่งกำลังนำจ่ายพัสดุให้คุณ"),
      status: currentStep === 4 ? "active" : "done",
    });
  }
  if (currentStep >= 3) {
    timelineMilestones.push({
      time: order.shipment?.shippedAt || new Date().toISOString(),
      title: `${t("บริษัทขนส่งเข้ารับพัสดุจากร้านค้าแล้ว")} (${escape(carrier || t("ขนส่ง"))})`,
      status: currentStep === 3 ? "active" : "done",
    });
  }
  if (currentStep >= 2) {
    timelineMilestones.push({
      time:
        order.history?.find(
          (h) =>
            h.type === "order_status_changed" &&
            h.newState === "preparing_order",
        )?.at ||
        order.createdAt ||
        new Date().toISOString(),
      title: t("ผู้ขายบรรจุสินค้าลงกล่องและออกหมายเลขพัสดุ"),
      status: currentStep === 2 ? "active" : "done",
    });
  }
  timelineMilestones.push({
    time: order.createdAt || new Date().toISOString(),
    title: t("ชำระเงินเรียบร้อย"),
    status: "done",
  });

  return `<section class="order-tracker-card" aria-labelledby="tracker-title">
    <div class="tracker-header">
      <div class="tracker-title-wrap">
        <span class="tracker-badge"><span class="pulse-dot"></span> ${t("สินค้าจริง (Physical)")}</span>
        <h2 id="tracker-title">${icon("truck", 22)} ${t("ตัวติดตามการจัดส่งพัสดุ")}</h2>
      </div>
      <span class="tracker-status-tag ${order.status}">${orderStatus(order.status)}</span>
    </div>

    <!-- Visual 5-Step Stepper -->
    <div class="tracker-stepper" role="progressbar" aria-valuenow="${currentStep}" aria-valuemin="1" aria-valuemax="5">
      ${steps
        .map((st, idx) => {
          const isDone = st.num < currentStep;
          const isActive = st.num === currentStep;
          const statusClass = isDone
            ? "is-done"
            : isActive
              ? "is-active"
              : "is-pending";
          return `
          <div class="tracker-step ${statusClass}">
            <div class="tracker-step-node">
              <span class="tracker-step-icon">${icon(isDone ? "check" : st.icon, 18)}</span>
            </div>
            <span class="tracker-step-title">${st.title}</span>
            ${idx < steps.length - 1 ? `<div class="tracker-step-connector ${isDone ? "is-done" : ""}"></div>` : ""}
          </div>
        `;
        })
        .join("")}
    </div>

    <!-- Carrier & Tracking Info Box -->
    ${
      order.shipment
        ? `
      <div class="tracker-carrier-box">
        <div class="tracker-carrier-left">
          <span class="carrier-badge ${carrier.toLowerCase().replace(/[^a-z]/g, "")}">
            ${icon("truck", 16)} <strong>${escape(carrier || t("ขนส่ง"))}</strong>
          </span>
          <div class="tracking-code-group">
            <small class="tracking-label">${t("เลขพัสดุ")}</small>
            <strong class="tracking-code">${escape(trackingNumber || "—")}</strong>
          </div>
        </div>
        <div class="tracker-carrier-actions">
          ${
            trackingNumber
              ? `
            <button type="button" class="button outline copy-tracking-btn" data-action="copy-tracking" data-tracking="${escape(trackingNumber)}">
              ${icon("copy", 16)} <span>${t("คัดลอกเลขพัสดุ")}</span>
            </button>
          `
              : ""
          }
          ${
            trackingUrl
              ? `
            <a href="${escape(trackingUrl)}" target="_blank" rel="noopener noreferrer" class="button primary track-external-btn">
              ${t("เปิดเว็บตรวจสอบสถานะขนส่ง")} ${icon("arrow", 16)}
            </a>
          `
              : ""
          }
        </div>
      </div>
    `
        : `
      <div class="tracker-empty-shipment">
        <div class="tracker-empty-icon">${icon("package", 28)}</div>
        <div>
          <strong>${t("ยังไม่มีข้อมูลจัดส่ง")}</strong>
          <p>${t("ผู้ขายจะกรอกหมายเลขพัสดุและบริษัทขนส่งเมื่อจัดส่งสินค้า")}</p>
        </div>
      </div>
    `
    }

    <!-- Recipient Address Card -->
    ${addressDisplay}

    <!-- Timeline of Shipping Checkpoints -->
    <div class="tracker-timeline-section">
      <h3 class="tracker-timeline-heading">${icon("clock", 18)} ${t("ไทม์ไลน์การเดินทางของพัสดุ")}</h3>
      <ol class="tracker-timeline-list">
        ${timelineMilestones
          .map(
            (m) => `
          <li class="tracker-timeline-item ${m.status}">
            <span class="tracker-timeline-dot"></span>
            <div class="tracker-timeline-body">
              <strong>${escape(m.title)}</strong>
              <time datetime="${escape(m.time)}">${escape(dateTime(m.time))}</time>
            </div>
          </li>
        `,
          )
          .join("")}
      </ol>
    </div>

    <!-- Seller Shipping Update Form -->
    ${
      permissions.shipment
        ? `
      <details class="seller-shipping-accordion">
        <summary class="seller-shipping-summary">
          ${icon("edit", 16)} <strong>${t("บันทึกข้อมูลการจัดส่งพัสดุ")} (${t("สำหรับผู้ขาย")})</strong>
        </summary>
        <form id="shipment-form" class="form-panel" data-id="${id}">
          <label>${t("เลือกบริษัทขนส่ง")}
            <select name="carrier" id="shipment-carrier-select">
              <option value="Flash Express" ${carrier === "Flash Express" ? "selected" : ""}>Flash Express ⚡</option>
              <option value="Kerry Express" ${carrier === "Kerry Express" ? "selected" : ""}>Kerry Express 📦</option>
              <option value="ไปรษณีย์ไทย EMS" ${carrier === "ไปรษณีย์ไทย EMS" ? "selected" : ""}>ไปรษณีย์ไทย EMS 📮</option>
              <option value="J&T Express" ${carrier === "J&T Express" ? "selected" : ""}>J&T Express 🚚</option>
              <option value="Shopee Xpress" ${carrier === "Shopee Xpress" ? "selected" : ""}>Shopee Xpress 🛍️</option>
              <option value="อื่น ๆ" ${carrier && !["Flash Express", "Kerry Express", "ไปรษณีย์ไทย EMS", "J&T Express", "Shopee Xpress"].includes(carrier) ? "selected" : ""}>อื่น ๆ (ระบุเอง)</option>
            </select>
          </label>
          <label>${t("เลขพัสดุ")}
            <input name="trackingNumber" id="shipment-tracking-input" placeholder="เช่น TH0402948291A" maxlength="500" value="${escape(trackingNumber)}"/>
          </label>
          <label>${t("ลิงก์เว็บขนส่ง (อัตโนมัติหรือระบุเอง)")}
            <input name="url" id="shipment-url-input" type="url" placeholder="https://..." maxlength="500" value="${escape(order.shipment?.url || "")}"/>
          </label>
          <p class="field-help">${t("กรอกเลขติดตามหรือลิงก์อย่างน้อยหนึ่งช่อง")}</p>
          <button class="button primary" type="submit">${t("บันทึกการจัดส่งเดโม")}</button>
        </form>
      </details>
    `
        : ""
    }
  </section>`;
}
function orderPage(id) {
  const g = group(id);
  if (!g) return notFound();
  if (!requireAuth(`/orders/${id}`))
    return authRequiredView(
      t("สรุปคำสั่งซื้อเดโม"),
      t("เข้าสู่ระบบเพื่อดูสรุปคำสั่งซื้อ"),
    );
  if (supabaseConfigured)
    return `<div class="empty"><h1>${t("ขั้นตอนคำสั่งซื้อยังไม่เชื่อม")}</h1><p>${t("กลุ่มนี้ใช้ Supabase แต่คำสั่งซื้อและการชำระเงินยังเป็นเดโม จึงยังเปิดขั้นตอนนี้ไม่ได้")}</p>${a(`/groups/${id}`, t("กลับไปดูกลุ่ม"), "button outline")}</div>`;
  const order = orderFor(id),
    permissions = order ? orderPermissions(order, state.user) : null;
  if (
    order && order.status !== "waiting_for_members"
      ? !permissions.view
      : !g.members.includes(state.user.id)
  )
    return `<div class="empty"><h1>${t("orderUnauthorized")}</h1>${a("/my-groups", t("กลุ่มของฉัน"), "button secondary")}</div>`;
  const model = order && order.status !== "waiting_for_members" ? order : g,
    alloc = shares(model),
    costs = costBreakdown(model.costs, model.members.length),
    ready = allApproved(g);
  const action = (next, label) =>
    `<button class="button primary" data-action="order-transition" data-id="${id}" data-next="${next}">${t(label)}</button>`;
  const p = listing(g.listingId);
  const isPhysical = p ? p.kind === "สินค้า" : true;
  return `${title(t("สรุปคำสั่งซื้อเดโม"), escape(g.name))}<div class="narrow order-detail">
    <div class="info-box">${t("เดโมเท่านั้น: HarnKhong ไม่รับฝาก ถือ โอน หรือคืนเงินจริง ไม่มีการตรวจสอบธนาคาร")}</div>
    <div class="cost-card"><h2>${t("ค่าใช้จ่าย")}</h2><div><span>${t("สินค้า")}</span><b>${money(costs.product)}</b></div><div><span>${costs.deliveryPerMember === null ? t("ค่าส่ง") : t("ค่าส่ง {amount} × {count} คน", { amount: money(costs.deliveryPerMember), count: model.members.length })}</span><b>${money(costs.delivery)}</b></div>${costs.commissionFromOwner ? "" : `<div><span>${costs.deliveryPerMember === null ? t("ค่าบริการ") : t("ค่าธรรมเนียมแอป 2%")}</span><b>${money(costs.service)}</b></div>`}<div class="total"><span>${t("รวม")}</span><b>${money(costs.total)}</b></div><h3>${t("ส่วนแบ่งสมาชิก")}</h3>${model.members.map((memberId) => `<div><span>${escape(actorName(memberId))}</span><b>${money(alloc[memberId])}</b></div>`).join("")}</div>
    ${
      !order || order.status === "waiting_for_members"
        ? `<section class="form-panel"><h2>${g.members.length < g.capacity ? orderStatus("waiting_for_members") : t("รอยืนยันยอด")}</h2><p>${ready ? t("สมาชิกครบและยืนยันยอดรอบล่าสุดทุกคนแล้ว") : t("ยังสรุปไม่ได้: ต้องมีสมาชิกครบและยืนยันยอดรอบล่าสุดทุกคน")}</p>
    ${g.ownerId === state.user.id ? `<form id="order-form" data-id="${id}"><label>${t("ระยะตรวจรับเดโม (ชั่วโมง)")}<input name="hours" type="number" min="1" max="720" value="24" required/></label><button class="button primary full" type="submit" ${ready ? "" : "disabled"}>${t("บันทึกคำสั่งซื้อเดโม")}</button></form>` : `<p>${t("หัวหน้ากลุ่มเป็นผู้สร้างคำสั่งซื้อ")}</p>`}</section>`
        : `
    <section class="activity"><h2>${t("สถานะคำสั่งซื้อ")}: ${orderStatus(order.status)}</h2><p>${t("ยืนยันยอดเงินแยกจากการแจ้งชำระและการตรวจยอดเดโม")}</p>
    ${order.status === "pending_payment" ? `<p>${t("orderPaymentPending")}</p>` : ""}${order.status === "disputed" ? `<p class="warning">${t("orderDisputeUnresolved")}</p>` : ""}
    <div class="order-actions">${permissions.prepare ? action("preparing_order", "เริ่มเตรียมสินค้าเดโม") : ""}${permissions.deliver ? action("delivered", "ยืนยันว่าได้รับสินค้า (เดโม)") : ""}${permissions.inspect ? action("inspection_period", "เริ่มระยะตรวจรับเดโม") : ""}</div>
    ${order.inspection ? `<p>${t("เริ่มตรวจรับ")}: ${escape(dateTime(order.inspection.startedAt))}</p><p>${t("สิ้นสุดตรวจรับ")}: ${escape(dateTime(order.inspection.deadline))}</p>` : ""}
    ${order.status === "inspection_period" ? `<p>${t("ไม่มีการจบคำสั่งซื้อหรือปล่อยเงินอัตโนมัติ")}</p>${permissions.leader ? `<button class="button primary" data-action="order-transition" data-id="${id}" data-next="completed" ${permissions.complete ? "" : "disabled"}>${t("จบคำสั่งซื้อเดโม")}</button><p>${permissions.complete ? "" : t("orderInspectionActive")}</p>` : ""}` : ""}
    ${order.refund ? `<div class="info-box">${t("บันทึกผลคืนเงินจำลองแล้ว ไม่ได้คืนเงินจริง")}: ${money(order.refund.amountSatang)}<p>${t("คืนเงินจำลองนับเฉพาะยอดที่ตรวจยืนยันเดโมแล้ว")}</p><p class="user-content">${escape(order.refund.note)}</p></div>` : ""}</section>
    <section class="activity"><h2>${t("สถานะการชำระจำลอง")}</h2><p>${t("ไม่มีหลักฐานยืนยันธุรกรรมธนาคาร ทุกการตรวจยอดเป็นการจำลอง")}</p><div class="order-payments">${order.members
      .map((memberId) => {
        const payment = order.payments[memberId];
        return `<article><b>${escape(actorName(memberId))} · ${money(payment.amountSatang)}</b><p>${paymentStatus(payment.status)}</p>
      ${permissions.reportPayment && state.user.id === memberId ? `<button class="button outline" data-action="payment-open" data-id="${id}">${t("เปิด QR จำลองและแจ้งชำระ")}</button>` : ""}
      ${permissions.verifyPayment && payment.status === "payment_reported" ? `<button class="button outline" data-action="payment-update" data-id="${id}" data-member="${escape(memberId)}" data-next="verification_pending">${t("รับเรื่องตรวจยอดเดโม")}</button>` : ""}
      ${permissions.verifyPayment && payment.status === "verification_pending" ? `<div class="order-actions"><button class="button outline" data-action="payment-update" data-id="${id}" data-member="${escape(memberId)}" data-next="verified">${t("ยืนยันตรวจยอด (จำลองเท่านั้น)")}</button><button class="button subtle" data-action="payment-update" data-id="${id}" data-member="${escape(memberId)}" data-next="unpaid">${t("ให้แจ้งชำระใหม่")}</button></div>` : ""}</article>`;
      })
      .join("")}</div></section>
    ${
      isPhysical
        ? renderPhysicalShipmentTracker(order, p, permissions, id)
        : `
    <section class="activity"><h2>${t("การจัดส่ง")}</h2><p>${t("ข้อมูลจัดส่งกรอกเองในเดโม ยังไม่ตรวจสอบกับขนส่ง")}</p>
    ${order.shipment ? `<p>${t("ผู้ขนส่ง")}: ${escape(order.shipment.carrier || "—")}</p><p>${t("เลขติดตาม")}: ${escape(order.shipment.trackingNumber || "—")}</p>${order.shipment.url ? `<p><a href="${escape(order.shipment.url)}" target="_blank" rel="noopener noreferrer">${t("เปิดลิงก์ติดตามที่ผู้ขายกรอก")}</a></p>` : ""}<p>${t("ส่งเมื่อ")}: ${escape(dateTime(order.shipment.shippedAt))}</p>` : `<p>${t("ยังไม่มีข้อมูลจัดส่ง")}</p>`}
    ${order.deliveredAt ? `<p>${t("ยืนยันรับเมื่อ")}: ${escape(dateTime(order.deliveredAt))}</p>` : ""}
    ${permissions.shipment ? `<form id="shipment-form" class="form-panel" data-id="${id}"><label>${t("ผู้ขนส่ง")}<input name="carrier" maxlength="500" value="${escape(order.shipment?.carrier || "")}"/></label><label>${t("เลขติดตาม")}<input name="trackingNumber" maxlength="500" value="${escape(order.shipment?.trackingNumber || "")}"/></label><label>${t("ลิงก์ติดตาม (http หรือ https)")}<input name="url" type="url" maxlength="500" value="${escape(order.shipment?.url || "")}"/></label><p>${t("กรอกเลขติดตามหรือลิงก์อย่างน้อยหนึ่งช่อง")}</p><button class="button primary" type="submit">${t("บันทึกการจัดส่งเดโม")}</button></form>` : ""}</section>`
    }
    ${disputePanel(order, permissions)}${orderHistory(order)}`
    }
    ${order?.legacy ? `<p class="warning">${t("นำเข้าคำสั่งซื้อเก่าโดยไม่ถือว่าเคยชำระเงินแล้ว")}</p>` : ""}
    ${permissions?.reportPayment ? paymentDialog(order, demoReference()) : ""}${a(`/groups/${id}`, t("กลับไปดูกลุ่ม"), "button outline full")}</div>`;
}
function notFound() {
  return `<div class="empty"><h1>${t("ไม่พบหน้านี้")}</h1><p>${t("ลิงก์อาจไม่ถูกต้องหรือรายการถูกลบ")}</p>${a("/", t("กลับหน้าแรก"), "button primary")}</div>`;
}
function route() {
  const path = decodeURIComponent(location.pathname);
  if (
    path === "/marketplace/secondhand" ||
    path.startsWith("/seller/") ||
    path.startsWith("/checkout/secondhand/")
  ) {
    history.replaceState({}, "", "/");
    return home();
  }
  if (path === "/") return home();
  if (path === "/explore") return explore();
  if (path === "/demo-accept")
    return demoApprovalPage(
      new URLSearchParams(location.search).get("accepted") === "1",
    );
  if (path === "/subscription") return subscriptionPage();
  if (/^\/products\/[^/]+$/.test(path))
    return legacyProductRoute(path.split("/")[2]);
  if (/^\/groups\/[^/]+\/join$/.test(path)) return joinPage(path.split("/")[2]);
  if (/^\/groups\/[^/]+\/chat$/.test(path))
    return groupChatPage(path.split("/")[2]);
  if (path === "/groups/create") return createPage();
  if (/^\/groups\/[^/]+$/.test(path)) return groupPage(path.split("/")[2]);
  if (path === "/login") return authPage();
  if (path === "/register") return authPage(true);
  if (path === "/my-groups") return myGroups();
  if (path === "/my-orders") return myOrdersPage();
  if (path === "/chat") return chatList();
  if (/^\/chat\/[^/]+$/.test(path)) return chatPage(path.split("/")[2]);
  if (path === "/notifications") return notifications();
  if (/^\/profile\/member\/[^/]+$/.test(path))
    return memberProfilePage(path.split("/")[3]);
  if (path === "/profile/me") return myProfilePage();
  if (path === "/profile") return profile();
  if (/^\/shops\/[^/]+$/.test(path)) return shopPage(path.split("/")[2]);
  if (/^\/orders\/[^/]+$/.test(path)) return orderPage(path.split("/")[2]);
  return notFound();
}
function updateFilterCarousel() {
  const carousel = document.querySelector(".filter-carousel"),
    row = carousel?.querySelector(".filter-row");
  if (!row) return;
  const previous = row.scrollLeft > 2,
    next = row.scrollLeft + row.clientWidth < row.scrollWidth - 2;
  carousel.classList.toggle("can-scroll-prev", previous);
  carousel.classList.toggle("can-scroll-next", next);
  carousel.querySelector(".filter-scroll-prev").hidden = !previous;
  carousel.querySelector(".filter-scroll-next").hidden = !next;
}
function groupsLoadingSkeleton() {
  const isHome = location.pathname === "/",
    isExplore = location.pathname === "/explore",
    count = isHome ? 3 : 6;
  const skeletonCard = () =>
    `<article class="groups-skeleton-card" aria-hidden="true"><span class="skeleton-block skeleton-media"></span><div class="groups-skeleton-content"><div class="groups-skeleton-topline"><span class="skeleton-block skeleton-category"></span><span class="skeleton-block skeleton-pill"></span></div><span class="skeleton-block skeleton-title"></span><span class="skeleton-block skeleton-description"></span><div class="groups-skeleton-price"><div><span class="skeleton-block skeleton-price-label"></span><span class="skeleton-block skeleton-price-main"></span></div><div><span class="skeleton-block skeleton-price-label"></span><span class="skeleton-block skeleton-price-sub"></span></div></div><div class="groups-skeleton-members"><span class="skeleton-block skeleton-member-label"></span><span class="skeleton-block skeleton-progress"></span></div><span class="skeleton-block skeleton-leader"></span><span class="skeleton-block skeleton-terms"></span><span class="skeleton-block skeleton-button"></span><span class="skeleton-block skeleton-share"></span></div></article>`;
  return `<section class="groups-loading" role="status" aria-live="polite" aria-busy="true" aria-label="${t("กำลังโหลดกลุ่มจาก Supabase")}">
    <span class="sr-only">${t("กำลังโหลดกลุ่มจาก Supabase")}</span>
    ${isHome ? `<div class="home-hero-skeleton" aria-hidden="true"><div class="home-hero-skeleton-copy"><span class="skeleton-block hero-skeleton-title"></span><span class="skeleton-block hero-skeleton-copy-line"></span><span class="skeleton-block hero-skeleton-copy-line short"></span><span class="skeleton-block hero-skeleton-search"></span><div class="hero-skeleton-tags"><span class="skeleton-block"></span><span class="skeleton-block"></span><span class="skeleton-block"></span></div><span class="skeleton-block hero-skeleton-points"></span></div><span class="skeleton-block home-hero-skeleton-visual"></span></div>` : ""}
    ${isHome ? `<div class="groups-skeleton-heading"><span class="skeleton-block skeleton-heading-title"></span><span class="skeleton-block skeleton-heading-subtitle"></span></div>` : isExplore ? `<div class="groups-skeleton-page-heading"><span class="skeleton-block skeleton-page-title"></span><span class="skeleton-block skeleton-heading-subtitle"></span></div><span class="skeleton-block skeleton-search"></span><div class="groups-skeleton-filters">${Array.from({ length: 5 }, () => `<span class="skeleton-block skeleton-filter"></span>`).join("")}</div><div class="groups-skeleton-heading"><span class="skeleton-block skeleton-heading-title"></span><span class="skeleton-block skeleton-heading-subtitle"></span></div>` : ""}
    <div class="groups-skeleton-grid ${isHome ? "is-home" : isExplore ? "is-explore" : ""}" aria-hidden="true">${Array.from({ length: count }, skeletonCard).join("")}</div>
  </section>`;
}
function render() {
  if (location.pathname === "/admin" || location.pathname.startsWith("/admin/")) {
    doodleFooterRoot?.unmount();
    doodleFooterRoot = null;
    profileBadgeRoot?.unmount();
    profileBadgeRoot = null;
    adminPageModulePromise ||= import("./admin.js");
    adminPageModulePromise.then((module) => {
      adminPageModule = module;
      if (location.pathname === "/admin" || location.pathname.startsWith("/admin/"))
        module.mountAdminPage({ supabase, supabaseConfigured });
    });
    return;
  }
  adminPageModule?.unmountAdminPage();
  const createGroupRoute = location.pathname === "/groups/create";
  if (
    !/^\/groups\/[^/]+\/chat$/.test(location.pathname) &&
    groupChatPollTimer
  ) {
    clearInterval(groupChatPollTimer);
    groupChatPollTimer = null;
    groupChatPollId = null;
  }
  if (
    !(
      location.pathname.startsWith("/chat/") &&
      new URLSearchParams(location.search).has("conversation")
    ) &&
    secondhandChatPollTimer
  ) {
    clearInterval(secondhandChatPollTimer);
    secondhandChatPollTimer = null;
    secondhandChatPollId = null;
  }
  document.documentElement.dataset.theme = theme;
  document.body.classList.toggle("mobile-menu-open", mobileMenuOpen);
  const headerScrolled = window.scrollY > 10;
  const unread = state.user
    ? state.notifications.filter(
        (n) => n.recipient === state.user.id && !n.read,
      ).length
    : 0;
  const nav = [
    ["/", "home", t("หน้าแรก")],
    ["/explore", "search", t("หารของ")],
    ["/my-groups", "users", t("กลุ่มของฉัน")],
    ["/chat", "chat", t("แชต")],
    ["/profile", "user", t("บัญชี")],
    ["/subscription", "sparkles", t("แพ็กเกจ")],
  ];
  const desktopNav = nav.slice(0, 4);
  const bottomNav = nav.filter(([href]) => href !== "/subscription");

  doodleFooterRoot?.unmount();
  doodleFooterRoot = null;
  profileBadgeRoot?.unmount();
  profileBadgeRoot = null;

  document.querySelector("#app").innerHTML = `
    ${icons}
    <header class="site-header${headerScrolled ? " is-scrolled" : ""}${mobileMenuOpen ? " menu-open" : ""}">
      <div class="header-inner">
        ${a("/", `<img class="logo-mark" src="/images/harnkhong-logo.png" alt=""/><span class="logo-text">HarnKhong<small>${t("หารของด้วยกัน")}</small></span>`, "brand")}
        <nav class="desktop-nav" aria-label="${t("เมนูหลัก")}">
          ${desktopNav.map(([href, , label]) => a(href, label, "nav-link " + (location.pathname === href || (href === "/profile" && location.pathname.startsWith("/profile/")) || (href === "/marketplace/secondhand" && location.pathname.startsWith("/checkout/secondhand/")) ? "active" : ""))).join("")}
        </nav>
        <div class="header-actions">
          ${/^\/groups\/[^/]+$/.test(location.pathname) ? "" : `<div class="header-create-menu-wrap"><button type="button" class="button primary header-create-btn" data-action="listing-menu-toggle" aria-expanded="${listingMenuOpen}" aria-haspopup="menu">${icon("plus", 18)} ${t("สร้างกลุ่มหารของ")}</button>${listingMenuOpen ? `<div class="header-create-dropdown" role="menu">${a("/groups/create", `<span class="header-create-option-icon">${icon("users", 20)}</span><span><strong>${t("สร้างกลุ่มหารของ")}</strong><small>${t("ชวนคนร่วมซื้อ")}</small></span>`, "header-create-option")}</div>` : ""}</div>`}
          ${a("/notifications", `${icon("bell", 22)}<span class="sr-only">${t("การแจ้งเตือน")}</span>${unread ? `<i>${unread}</i>` : ""}`, "icon-button header-notifications-btn")}
          ${state.user ? `<div class="profile-menu-wrap"><button type="button" class="profile-pill" data-action="profile-menu-toggle" aria-expanded="${profileMenuOpen}" aria-haspopup="menu"><span class="avatar tiny">${profileAvatarMarkup(state.user)}</span><span class="header-user-name">${escape(state.user.name)}</span><span class="profile-menu-chevron" aria-hidden="true">⌄</span></button>${profileMenuOpen ? `<div class="profile-dropdown" role="menu"><div class="profile-dropdown-heading"><strong>${escape(state.user.name)}</strong><small>${escape(state.user.email || "")}</small></div>${a("/profile", `${icon("user", 18)}<span>${t("บัญชี")}</span>`, "profile-dropdown-link")}${a("/chat", `${icon("chat", 18)}<span>${t("แชตกลุ่ม")}</span>`, "profile-dropdown-link")}${a("/notifications", `${icon("bell", 18)}<span>${t("การแจ้งเตือน")}</span>${unread ? `<i>${unread}</i>` : ""}`, "profile-dropdown-link")}<button type="button" role="menuitem" class="profile-dropdown-link" data-action="theme-toggle"><span class="profile-dropdown-theme-icon" aria-hidden="true">${theme === "dark" ? "☀" : "☾"}</span><span>${theme === "dark" ? t("โหมดสว่าง") : t("โหมดมืด")}</span><small class="profile-dropdown-state">${theme === "dark" ? t("เปิด") : t("ปิด")}</small></button></div>` : ""}</div>` : `<div class="profile-menu-wrap"><button type="button" class="profile-pill profile-menu-guest" data-action="profile-menu-toggle" aria-label="${t("เมนูบัญชี")}" aria-expanded="${profileMenuOpen}" aria-haspopup="menu">${icon("user", 18)}<span class="profile-menu-chevron" aria-hidden="true">⌄</span></button>${profileMenuOpen ? `<div class="profile-dropdown" role="menu"><div class="profile-dropdown-heading"><strong>${t("บัญชี")}</strong><small>${t("เข้าสู่ระบบเพื่อใช้งานบัญชี แชต และการแจ้งเตือน")}</small></div>${a("/profile", `${icon("user", 18)}<span>${t("บัญชี")}</span>`, "profile-dropdown-link")}${a("/chat", `${icon("chat", 18)}<span>${t("แชตกลุ่ม")}</span>`, "profile-dropdown-link")}${a("/notifications", `${icon("bell", 18)}<span>${t("การแจ้งเตือน")}</span>`, "profile-dropdown-link")}<button type="button" role="menuitem" class="profile-dropdown-link" data-action="theme-toggle"><span class="profile-dropdown-theme-icon" aria-hidden="true">${theme === "dark" ? "☀" : "☾"}</span><span>${theme === "dark" ? t("โหมดสว่าง") : t("โหมดมืด")}</span><small class="profile-dropdown-state">${theme === "dark" ? t("เปิด") : t("ปิด")}</small></button><button type="button" role="menuitem" class="profile-dropdown-link" data-action="open-auth" data-step="1">${icon("user", 18)}<span>${t("เข้าสู่ระบบ")}</span></button></div>` : ""}</div><button type="button" class="button primary header-login-btn" data-action="open-auth" data-step="1">${icon("user", 18)} ${t("เข้าสู่ระบบ")}</button>`}
          <button type="button" class="icon-button mobile-menu-toggle" data-action="mobile-menu-toggle" aria-label="${mobileMenuOpen ? t("ปิดเมนู") : t("เปิดเมนู")}" aria-expanded="${mobileMenuOpen}" aria-controls="mobile-menu"><span></span><span></span></button>
        </div>
      </div>
      <div class="mobile-menu${mobileMenuOpen ? " is-open" : ""}" id="mobile-menu" aria-hidden="${!mobileMenuOpen}">
        <nav aria-label="${t("เมนูหลัก")}">
          ${nav.map(([href, ic, label]) => a(href, `${icon(ic, 21)}<span>${label}</span>`, location.pathname === href || (href === "/profile" && location.pathname.startsWith("/profile/")) ? "active" : "")).join("")}
        </nav>
        <div class="mobile-menu-actions">
          ${/^\/groups\/[^/]+$/.test(location.pathname) ? "" : a("/groups/create", `${icon("plus", 18)} ${t("เปิดกลุ่ม")}`, "button primary")}
          ${state.user ? a("/profile", `${icon("user", 18)} ${t("บัญชี")}`, "button outline") : `<button type="button" class="button primary" data-action="open-auth" data-step="1">${icon("user", 18)} ${t("เข้าสู่ระบบ")}</button>`}
        </div>
      </div>
    </header>

    <main class="main-wrap${location.pathname === "/" ? " home-main" : ""}" id="main">${groupsLoading && !createGroupRoute ? groupsLoadingSkeleton() : groupsError && !createGroupRoute ? `<div class="empty"><h2>${t("โหลดกลุ่มไม่สำเร็จ")}</h2><p>${escape(authErrorMessage(groupsError))}</p><details class="load-error-details"><summary>${t("รายละเอียดข้อผิดพลาด")}</summary><code>${escape(`${groupsError?.code || groupsError?.name || "Error"}: ${groupsError?.message || "ไม่มีรายละเอียด"}`)}</code></details><button class="button primary" data-action="refresh-groups">${t("ลองอีกครั้ง")}</button></div>` : `${groupsLoading ? `<section class="create-load-warning" role="status"><strong>${t("กำลังโหลดกลุ่มจาก Supabase")}</strong></section>` : ""}${groupsError ? `<section class="create-load-warning" role="alert"><div><strong>${t("โหลดข้อมูลกลุ่มไม่สำเร็จ")}</strong><p>${escape(authErrorMessage(groupsError))}</p><details class="load-error-details"><summary>${t("รายละเอียดข้อผิดพลาด")}</summary><code>${escape(`${groupsError?.code || groupsError?.name || "Error"}: ${groupsError?.message || "ไม่มีรายละเอียด"}`)}</code></details></div><button class="button outline" data-action="refresh-groups">${t("ลองอีกครั้ง")}</button></section>` : ""}${route()}`}</main>

    <nav class="bottom-nav" aria-label="${t("เมนูด้านล่าง")}">
      ${bottomNav.map(([href, ic, label]) => a(href, `${icon(ic, 22)}<span>${label}</span>`, location.pathname === href || (href === "/profile" && location.pathname.startsWith("/profile/")) ? "active" : "")).join("")}
    </nav>


    <div id="interactive-footer"></div>

    ${authModalActive ? `<dialog class="auth-modal-overlay" id="auth-modal-overlay" aria-label="${t("เข้าสู่ระบบ")}">${renderPhoneMockup(mockupCurrentStep, true)}</dialog>` : ""}
  `;

  if (["/profile", "/profile/me"].includes(location.pathname) && state.user) {
    const badgeMount = document.querySelector("#profile-lanyard-badge");
    if (badgeMount) {
      profileBadgeRoot = createRoot(badgeMount);
      profileBadgeRoot.render(
        React.createElement(LanyardBadge, {
          front: profileBadgeFace(state.user),
          back: profileBadgeFace(state.user, true),
          strapText: "HarnKhong",
          strapLabel: t("โปรไฟล์สมาชิก"),
          strapColor: "#0868d8",
          inkColor: "#ffffff",
          cardColor: "#f5f9ff",
          flipButton: false,
          cardWidth: 320,
          height: "760px",
          className: "hk-lanyard",
          ariaLabel: t("แตะหรือกด Enter ที่บัตรเพื่อพลิกดูอีกด้าน"),
        }),
      );
    }
  }

  initializeListingEditor();
  initializeListingMap();
  void initializeSecondhandDetailMap();
  initializeSecondhandCheckout();
  initializeSecondhandPendingCountdown();
  void initializeSecondhandPendingQr();
  animatePricing();
  revealWhySection();
  revealHomeSections();

  const footerMount = document.querySelector("#interactive-footer");
  if (footerMount) {
    const quickLinks = [
      { label: t("สำรวจสินค้า"), href: "/explore" },
      ...(/^\/groups\/[^/]+$/.test(location.pathname)
        ? []
        : [{ label: t("เปิดกลุ่มใหม่"), href: "/groups/create" }]),
      { label: t("กลุ่มของฉัน"), href: "/my-groups" },
      { label: t("แชตติดต่อผู้ขาย"), href: "/chat" },
    ];
    const categoryLinks = [
      {
        label: t("แอปพลิเคชันและเว็บไซต์"),
        href:
          "/explore?category=" + encodeURIComponent("แอปพลิเคชันและเว็บไซต์"),
      },
      {
        label: t("ของใช้ทั่วไป"),
        href: "/explore?category=" + encodeURIComponent("ของใช้ทั่วไป"),
      },
      {
        label: t("สินค้าขายส่ง"),
        href: "/explore?category=" + encodeURIComponent("สินค้าขายส่ง"),
      },
      {
        label: t("บริการทั่วไป"),
        href: "/explore?category=" + encodeURIComponent("บริการทั่วไป"),
      },
      { label: t("หมวดทั้งหมด"), href: "/explore" },
    ];
    const helpLinks = [
      {
        label: t("เข้าสู่ระบบ"),
        href: "#login",
        onClick: () => openAuthModal(1),
      },
      {
        label: t("สมัครสมาชิก"),
        href: "#register",
        onClick: () => openAuthModal(2),
      },
      ...(!supabaseConfigured
        ? [
            {
              label: t("รีเซ็ตข้อมูลเดโม"),
              href: "#reset-demo",
              onClick: () => {
                if (confirm(t("ล้างข้อมูลเดโมในเบราว์เซอร์นี้และเริ่มใหม่?"))) {
                  state = initialState();
                  save();
                  go("/");
                  alertMessage(t("เริ่มข้อมูลเดโมใหม่แล้ว"));
                }
              },
            },
          ]
        : []),
    ];
    doodleFooterRoot = createRoot(footerMount);
    doodleFooterRoot.render(
      React.createElement(DoodleCrewFooter, {
        wordmark: "HARNKHONG",
        brand: "HarnKhong",
        blurb: t(
          "สร้างกลุ่มหารค่าสินค้าหรือแพ็กเกจ ดูส่วนแบ่งและค่าส่งของสมาชิกก่อนยืนยันยอด",
        ),
        tagline: t("สร้างกลุ่มหารของและตรวจสอบยอดก่อนยืนยัน"),
        columns: [
          { title: t("เมนูด่วน"), links: quickLinks },
          { title: t("หมวดหมู่"), links: categoryLinks },
          { title: t("ช่วยเหลือ"), links: helpLinks },
        ],
        actions: [
          {
            label: t("เข้าสู่ระบบ"),
            variant: "outline",
            icon: "sparkle",
            onClick: () => openAuthModal(1),
          },
          {
            label: t("สมัครสมาชิก"),
            variant: "solid",
            icon: "heart",
            onClick: () => openAuthModal(2),
          },
        ],
        copyright: t("© 2026 HarnKhong"),
        legal: [{ label: t("💡 โหมดต้นแบบจำลอง (MVP Demo) เพื่อการทดสอบ UX") }],
        socials: [],
        preset: "auto",
        palette: {
          background: "var(--bg-card, #ffffff)",
          ink: "var(--ink, #102a43)",
          accent: "var(--blue, #0868ce)",
        },
        fontFamily: '"Plus Jakarta Sans", "IBM Plex Sans Thai", sans-serif',
        serifFamily: '"IBM Plex Sans Thai", sans-serif',
        tracking: -0.045,
        height: "760px",
        className: "harnkhong-doodle-footer",
      }),
    );
  }

  startHeroHeadlineLoop();
  initHeroPhoneParallax();
  const demoExpiry = document.querySelector("[data-demo-expiry]");
  if (demoExpiry)
    startDemoCountdown(demoExpiry, Number(demoExpiry.dataset.demoExpiry));
  if (document.querySelector("#create-form")) {
    updateCreateFormUI();
    updatePreview();
  }
  const filterRow = document.querySelector(".filter-row");
  if (filterRow) {
    filterRow.addEventListener("scroll", updateFilterCarousel, {
      passive: true,
    });
    updateFilterCarousel();
  }
  const authDialog = document.querySelector("#auth-modal-overlay");
  if (authDialog) {
    authDialog.showModal();
    authDialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      closeAuthModal();
    });
  }
  document.documentElement.lang = locale;
  document.title = "HarnKhong — " + t("หารของด้วยกัน");
  document.querySelector('meta[name="description"]').content = t(
    "แพลตฟอร์มหารของและบริการที่โปร่งใส",
  );
  document
    .querySelectorAll('[data-action="toggle-mockup-pw"]')
    .forEach((button) =>
      button.setAttribute("aria-label", t("แสดงหรือซ่อนรหัสผ่าน")),
    );
  document
    .querySelector('.header-actions a[href="/notifications"]')
    .setAttribute("aria-label", t("การแจ้งเตือน"));
  const accountMenu = document.querySelector(".profile-dropdown");
  if (accountMenu) {
    const planStatus =
      subscriptionFor() === "plus"
        ? t("Plus · 49 บาท/เดือน")
        : t("Free · ใช้งานฟรี");
    accountMenu
      .querySelector('a[href="/profile"]')
      ?.insertAdjacentHTML(
        "afterend",
        `<a href="/subscription" data-link class="profile-dropdown-link subscription-dropdown-link">${icon("sparkles", 18)}<span>${t("แพ็กเกจสมาชิก")}</span><small class="profile-dropdown-state">${planStatus}</small></a>`,
      );
    accountMenu.insertAdjacentHTML(
      "beforeend",
      `<label class="profile-dropdown-locale">${t("ภาษา")}<select id="locale-select" aria-label="${t("ภาษา")}"><option value="th" ${locale === "th" ? "selected" : ""}>ไทย</option><option value="en" ${locale === "en" ? "selected" : ""}>English</option></select></label>`,
    );
  }
}
const formCosts = (d) => ({
  product: parseBaht(d.get("product") || "0"),
  delivery: Math.ceil(
    parseBaht(d.get("shippingTotal") || "0") /
      Math.max(1, Number(d.get("capacity")) || 1),
  ),
  mode: SEAT_MODE,
});
window.addEventListener("resize", updateFilterCarousel, { passive: true });
function updateCreateFormUI() {
  const form = document.querySelector("#create-form");
  if (!form) return;
  const digital = form.querySelector('[name="productType"]:checked')?.value === "digital";
  const digitalFields = form.querySelector("#digital-product-fields");
  const deliverySection = form.querySelector("#physical-delivery-section");
  const handoffSection = form.querySelector("#digital-handoff-section");
  const pickup = form.querySelector('[name="deliveryMethod"]:checked')?.value === "pickup";
  if (digitalFields) digitalFields.hidden = !digital;
  if (deliverySection) deliverySection.hidden = digital;
  if (handoffSection) handoffSection.hidden = !digital;
  const shippingTotalWrap = form.querySelector("#shipping-total-wrap");
  if (shippingTotalWrap) shippingTotalWrap.hidden = digital;
  const summaryShippingRow = document.querySelector("#summary-shipping-row");
  if (summaryShippingRow) summaryShippingRow.hidden = digital;
  const pickupLocationWrap = form.querySelector("#pickup-location-wrap");
  if (pickupLocationWrap) pickupLocationWrap.hidden = digital || !pickup;
  for (const name of ["digitalPlatform", "digitalService", "usageDuration"]) {
    const field = form.querySelector(`[name="${name}"]`);
    if (field) field.required = digital;
  }
  const pickupLocation = form.querySelector('[name="pickupLocation"]');
  if (pickupLocation) pickupLocation.required = !digital && pickup;
  const productType = form.querySelector('[name="productType"]:checked')?.value || "physical";
  form.dataset.productType = productType;
}
function updateCreateStep(step) {
  const form = document.querySelector("#create-form");
  if (!form) return;
  createGroupStep = step;
  form.querySelectorAll("[data-create-step-panel]").forEach((panel) => {
    panel.hidden = Number(panel.dataset.createStepPanel) !== step;
  });
  form.querySelectorAll(".create-stepper [data-step]").forEach((button) => {
    const active = Number(button.dataset.step) === step;
    button.classList.toggle("active", active);
    button.setAttribute("aria-current", active ? "step" : "false");
  });
  form.querySelector("#create-error").hidden = true;
  if (step === 3) updatePreview();
  form.querySelector(`[data-create-step-panel="${step}"] h2`)?.focus({ preventScroll: true });
  window.scrollTo({ top: document.querySelector(".create-group-layout")?.offsetTop || 0, behavior: "smooth" });
}
function validateCreatePanel(step) {
  const form = document.querySelector("#create-form");
  const panel = form?.querySelector(`[data-create-step-panel="${step}"]`);
  if (!form || !panel) return true;
  if (step === 1 && !groupImages.length) {
    alertWarning(t("เพิ่มรูปสินค้าอย่างน้อย 1 รูป"));
    form.querySelector("#group-images")?.focus();
    return false;
  }
      const invalid = [...panel.querySelectorAll("[required]")].find((field) => !field.checkValidity());
  if (invalid) {
    invalid.reportValidity();
    invalid.focus();
    return false;
  }
  if (step === 1 && !selectedCreateCategories.length) {
    alertWarning(t("เลือกอย่างน้อย 1 หมวดหมู่"));
    return false;
  }
  if (step === 2) {
    const data = new FormData(form);
    const closesAt = String(data.get("closesAt") || "");
    const today = new Date();
    const todayLocal = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    if (closesAt < todayLocal) {
      const deadline = form.querySelector('[name="closesAt"]');
      deadline.setCustomValidity(t("วันปิดรับสมาชิกต้องไม่ย้อนหลัง"));
      deadline.reportValidity();
      deadline.focus();
      deadline.setCustomValidity("");
      return false;
    }
    if (Number(data.get("minimumMembers")) > Number(data.get("capacity"))) {
      const min = form.querySelector('[name="minimumMembers"]');
      min.setCustomValidity(t("สมาชิกขั้นต่ำต้องไม่มากกว่าสมาชิกสูงสุด"));
      min.reportValidity();
      min.focus();
      min.setCustomValidity("");
      return false;
    }
    try {
      parseBaht(data.get("product"));
      parseBaht(data.get("shippingTotal") || "0");
    } catch (error) {
      alertError(errorMessage(error));
      return false;
    }
  }
  return true;
}
function updatePreview() {
  const f = document.querySelector("#create-form"),
    box = document.querySelector("#create-preview");
  if (!f || !box) return;
  try {
    const d = new FormData(f),
      count = assertCapacity(Number(d.get("capacity"))),
      costs = costBreakdown(formCosts(d), count),
      moneyOrZero = (value) => money(Number.isFinite(value) ? value : 0);
    const seat = seatPrice(formCosts(d), count, count - 1);
    box.innerHTML = `<small>${d.get("billing") === "monthly" ? t("ราคาต่อที่นั่งต่อเดือน") : t("ราคาต่อที่นั่ง")}</small><strong>${moneyOrZero(seat)} ${t("/ คน")}</strong><p>${t("รวมค่าส่งและค่าธรรมเนียมแพลตฟอร์ม 2% แล้ว")}</p>`;
    const put = (selector, value) => { const el = document.querySelector(selector); if (el) el.textContent = value; };
    put("#summary-product-title", d.get("productTitle") || t("ชื่อสินค้า"));
    put("#summary-product-category", selectedCreateCategories.map((x) => t(x)).join(" · ") || t("หมวดหมู่สินค้า"));
    put("#summary-product-price", moneyOrZero(costs.product));
    put("#summary-shipping", moneyOrZero(parseBaht(d.get("shippingTotal") || "0")));
    // What the platform keeps when every other seat is filled and paid: 2% of each member payment.
    const commission = ownerPayout(Array.from({ length: count - 1 }, (_, i) => seatPrice(formCosts(d), count, i + 1))).commission;
    put("#summary-fee", moneyOrZero(commission));
    put("#summary-per-person", `${moneyOrZero(seat)} / ${t("คน")}`);
    put("#summary-members", `${d.get("minimumMembers") || "2"}–${count} ${t("คน")}`);
    put("#summary-deadline", d.get("closesAt") || "—");
    const deliveryLabels = { ship_to_owner: "จัดส่งรวม", ship_separately: "จัดส่งแยก", pickup: "นัดรับ" };
    put("#summary-delivery", f.dataset.productType === "digital" ? t("ส่งมอบสิทธิ์ดิจิทัล") : t(deliveryLabels[d.get("deliveryMethod")] || "จัดส่งรวม"));
    put("#summary-visibility", t(({ public: "สาธารณะ", link: "เฉพาะผู้มีลิงก์", private: "ส่วนตัว" })[d.get("visibilityMode")] || "สาธารณะ"));
    const image = document.querySelector("#create-summary-image");
    if (image) image.innerHTML = groupImages[0] ? `<img src="${groupImages[0]}" alt=""/>` : icon("package", 32);
    const review = f.querySelector("#create-review-summary");
    if (review) review.innerHTML = `<strong>${escape(d.get("productTitle") || t("ชื่อสินค้า"))}</strong><p>${escape(d.get("name") || "—")} · ${escape(t(deliveryLabels[d.get("deliveryMethod")] || "จัดส่งรวม"))}</p><b>${moneyOrZero(seat)} / ${t("คน")}</b>`;
  } catch (e) {
    box.innerHTML = `<small>${escape(errorMessage(e))}</small>`;
  }
}

const storageError = (error) =>
  error?.name === "QuotaExceededError"
    ? t("พื้นที่ในเครื่องไม่พอ ข้อมูลเดิมยังอยู่ กรุณาลดจำนวนรูปแล้วลองใหม่")
    : errorMessage(error);
function renderListingImages() {
  const holder = document.querySelector("#listing-image-draft");
  if (!holder) return;
  holder.innerHTML = listingImages
    .map(
      (src, index) =>
        `<div class="listing-image-thumb ${index === 0 ? "is-cover" : ""}"><button type="button" data-action="listing-cover" data-index="${index}" aria-label="${index === 0 ? t("ภาพหน้าปก") : t("เลือกเป็นภาพหน้าปก")}"><img src="${src}" alt=""/><span>${index === 0 ? t("หน้าปก") : t("ตั้งเป็นหน้าปก")}</span></button><button class="listing-image-delete" type="button" data-action="listing-image-remove" data-index="${index}" aria-label="${t("ลบรูปที่ {number}", { number: index + 1 })}">×</button></div>`,
    )
    .join("");
}
function initializeListingEditor() {
  const form = document.querySelector("#product-form");
  if (!form) return;
  const deliveryOptions = form.querySelector(".listing-radio-group");
  if (!form.querySelector('[name="deliveryFee"]'))
    deliveryOptions?.insertAdjacentHTML(
      "afterend",
      `<div class="listing-shipping-fee" id="listing-shipping-fee" hidden><label>${t("ค่าส่งสินค้า (บาท)")}<input name="deliveryFee" type="number" inputmode="decimal" min="0" step="0.01" value="0.00"/><small class="listing-input-hint">${t("คิดค่าส่งหนึ่งครั้งต่อคำสั่งซื้อ")}</small></label></div>`,
    );
  const match = location.pathname.match(/^\/seller\/products\/([^/]+)\/edit$/);
  if (!match) {
    updateListingDeliveryUI(form);
    return;
  }
  if (form.dataset.initialized) return;
  const product = listing(decodeURIComponent(match[1]));
  if (!product || product.sellerId !== state.user?.id) return;
  form.dataset.initialized = "true";
  form.dataset.existingImages = JSON.stringify(product.images || []);
  listingImages = [...(product.images || [])];
  for (const [name, value] of Object.entries({
    title: product.title,
    category: product.category,
    description: product.description,
    price: bahtInput(product.price),
    deliveryFee: bahtInput(product.deliveryFee || 0),
    condition: product.condition,
    quantity: product.quantity || 1,
    area: product.area || "",
    contact: product.contact || "",
    latitude: product.marketCoordinates?.lat ?? "",
    longitude: product.marketCoordinates?.lng ?? "",
    marketAddress: product.marketAddress || "",
  })) {
    const input = form.elements.namedItem(name);
    if (input && input.type !== "radio") input.value = value;
  }
  const delivery = [...form.querySelectorAll('[name="delivery"]')].find(
    (input) => input.value === product.delivery,
  );
  if (delivery) delivery.checked = true;
  renderListingImages();
  updateListingDeliveryUI(form);
  updateListingPreview();
}
function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (leafletLoaderPromise) return leafletLoaderPromise;
  leafletLoaderPromise = new Promise((resolve, reject) => {
    if (!document.querySelector("#leaflet-css")) {
      const css = document.createElement("link");
      css.id = "leaflet-css";
      css.rel = "stylesheet";
      css.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.append(css);
    }
    const script = document.createElement("script");
    script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    script.async = true;
    script.onload = () =>
      window.L ? resolve(window.L) : reject(new Error("leafletLoadFailed"));
    script.onerror = () => reject(new Error("leafletLoadFailed"));
    document.head.append(script);
  });
  return leafletLoaderPromise;
}
async function initializeListingMap() {
  const canvas = document.querySelector("#listing-map-canvas");
  if (!canvas) return;
  const status = document.querySelector("#listing-map-status");
  try {
    const L = await loadLeaflet();
    if (!canvas.isConnected) return;
    if (listingMap && listingMap.getContainer() === canvas) {
      listingMap.invalidateSize();
      return;
    }
    if (listingMap) listingMap.remove();
    listingMap = L.map(canvas, { scrollWheelZoom: false }).setView(
      [15.87, 100.99],
      6,
    );
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
    }).addTo(listingMap);
    const form = document.querySelector("#product-form");
    const lat = Number(form.querySelector('[name="latitude"]').value),
      lng = Number(form.querySelector('[name="longitude"]').value);
    if (
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      form.querySelector('[name="latitude"]').value
    ) {
      const point = [lat, lng];
      listingMap.setView(point, 16);
      setListingMapPoint({ lat, lng }, false);
    }
    listingMap.on("click", (event) => setListingMapPoint(event.latlng, true));
    status.textContent = t(
      "พิมพ์ชื่อตลาดแล้วกดค้นหา หรือแตะแผนที่เพื่อปักหมุด",
    );
    listingMapReady = true;
  } catch (error) {
    console.warn("Unable to load OpenStreetMap", error);
    if (status?.isConnected)
      status.textContent = t("โหลดแผนที่ไม่สำเร็จ ลองโหลดหน้าอีกครั้ง");
  }
}
async function initializeSecondhandDetailMap() {
  const canvas = document.querySelector("#secondhand-detail-map");
  if (!canvas) {
    secondhandDetailMap?.remove();
    secondhandDetailMap = null;
    return;
  }
  try {
    const L = await loadLeaflet();
    if (!canvas.isConnected) return;
    secondhandDetailMap?.remove();
    const lat = Number(canvas.dataset.lat),
      lng = Number(canvas.dataset.lng);
    secondhandDetailMap = L.map(canvas, {
      zoomControl: true,
      dragging: false,
      touchZoom: false,
      doubleClickZoom: false,
      scrollWheelZoom: false,
      boxZoom: false,
      keyboard: false,
      tap: false,
    }).setView([lat, lng], 18);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      minZoom: 5,
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
    }).addTo(secondhandDetailMap);
    L.marker([lat, lng], {
      interactive: false,
      keyboard: false,
      draggable: false,
    }).addTo(secondhandDetailMap);
  } catch (error) {
    console.warn("Unable to load secondhand listing map", error);
    if (canvas.isConnected)
      canvas.innerHTML = `<p class="secondhand-location-map-missing">${t("โหลดแผนที่ไม่สำเร็จ ลองโหลดหน้าอีกครั้ง")}</p>`;
  }
}
function setListingMapPoint(point, reverseGeocode = false) {
  const form = document.querySelector("#product-form");
  if (!form || !listingMap || !window.L) return;
  const position = { lat: Number(point.lat), lng: Number(point.lng) };
  if (!listingMapMarker) {
    listingMapMarker = window.L.marker([position.lat, position.lng], {
      draggable: true,
      title: t("ตำแหน่งตลาดหรือสถานที่ขาย"),
    }).addTo(listingMap);
    listingMapMarker.on("dragend", (event) =>
      setListingMapPoint(event.target.getLatLng(), true),
    );
  } else listingMapMarker.setLatLng([position.lat, position.lng]);
  listingMap.panTo([position.lat, position.lng]);
  form.querySelector('[name="latitude"]').value = position.lat.toFixed(6);
  form.querySelector('[name="longitude"]').value = position.lng.toFixed(6);
  if (reverseGeocode) form.querySelector('[name="marketAddress"]').value = "";
  const areaInput = form.querySelector('[name="area"]');
  areaInput.dataset.pinnedQuery = areaInput.value.trim();
  form.querySelector("#listing-map-status").textContent =
    `${t("ปักหมุดแล้ว")} ${position.lat.toFixed(5)}, ${position.lng.toFixed(5)}`;
  updateListingPreview();
  if (reverseGeocode) {
    const requestId = ++listingMapRequestId;
    requestOsmGeocoder(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${position.lat}&lon=${position.lng}&accept-language=th`,
    )
      .then((data) => {
        if (
          requestId !== listingMapRequestId ||
          !form.isConnected ||
          !data?.display_name
        )
          return;
        form.querySelector('[name="marketAddress"]').value = data.display_name;
        form.querySelector("#listing-map-status").textContent =
          `${t("ปักหมุดแล้ว")}: ${data.display_name}`;
      })
      .catch(() => {});
  }
}
async function requestOsmGeocoder(url) {
  const delay = Math.max(0, 1100 - (Date.now() - lastOsmRequestAt));
  if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
  lastOsmRequestAt = Date.now();
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error("osmGeocoderRequestFailed");
  return response.json();
}
async function searchListingMapLocation() {
  const form = document.querySelector("#product-form"),
    status = document.querySelector("#listing-map-status"),
    query = form?.querySelector('[name="area"]')?.value.trim();
  if (!query) {
    status.textContent = t("พิมพ์ชื่อตลาดหรือสถานที่ก่อนค้นหา");
    form?.querySelector('[name="area"]')?.focus();
    return;
  }
  const coordinateMatch = query.match(
    /^\s*\(?\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)?\s*$/,
  );
  if (coordinateMatch) {
    const lat = Number(coordinateMatch[1]),
      lng = Number(coordinateMatch[2]);
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      status.textContent = t("พิกัดไม่ถูกต้อง กรุณาใส่ละติจูดก่อนลองจิจูด");
      return;
    }
    const requestId = ++listingMapRequestId;
    status.textContent = t("กำลังปักหมุดจากพิกัด…");
    await initializeListingMap();
    if (requestId !== listingMapRequestId || !listingMap) return;
    form.querySelector('[name="area"]').dataset.pinnedQuery = query;
    form.querySelector('[name="marketAddress"]').value = "";
    listingMap.setView([lat, lng], 17);
    setListingMapPoint({ lat, lng }, true);
    status.textContent = `${t("ปักหมุดแล้ว")} ${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    return;
  }
  const requestId = ++listingMapRequestId;
  status.textContent = t("กำลังค้นหาตำแหน่ง…");
  try {
    await initializeListingMap();
    const alias = SAMUT_PRAKAN_MARKET_ALIASES.find((entry) =>
      entry.match.test(query),
    );
    const queryVariants = [...(alias?.queries || []), query];
    let result = null;
    for (const variant of [...new Set(queryVariants)]) {
      const results = await requestOsmGeocoder(
        `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=5&countrycodes=th&accept-language=th&q=${encodeURIComponent(variant)}`,
      );
      if (requestId !== listingMapRequestId) return;
      result = (results || [])[0] || null;
      if (result) break;
    }
    if (!result) {
      status.textContent = t("ไม่พบสถานที่นี้ ลองพิมพ์ชื่ออื่นหรือปักหมุดเอง");
      return;
    }
    const position = { lat: Number(result.lat), lng: Number(result.lon) };
    form.querySelector('[name="marketAddress"]').value = result.display_name;
    form.querySelector('[name="area"]').dataset.pinnedQuery = query;
    listingMap.setView([position.lat, position.lng], 16);
    setListingMapPoint(position, false);
    status.textContent = `${t("ปักหมุดแล้ว")}: ${result.display_name}`;
  } catch (error) {
    if (requestId === listingMapRequestId)
      status.textContent = t("ค้นหาสถานที่ไม่สำเร็จ ลองอีกครั้ง");
  }
}
function updateListingDeliveryUI(form) {
  if (!form) return;
  const delivery =
      form.querySelector('[name="delivery"]:checked')?.value || "นัดรับ",
    wrap = form.querySelector("#listing-area-wrap"),
    area = form.querySelector('[name="area"]');
  const pickup = delivery !== "จัดส่ง";
  const shippingFee = delivery !== "นัดรับ";
  wrap.hidden = !pickup;
  area.required = pickup;
  const feeWrap = form.querySelector("#listing-shipping-fee");
  const feeInput = form.querySelector('[name="deliveryFee"]');
  if (feeWrap) feeWrap.hidden = !shippingFee;
  if (feeInput) feeInput.required = shippingFee;
  updateListingPreview();
}
function updateListingPreview() {
  const form = document.querySelector("#product-form"),
    box = document.querySelector("#listing-preview-content");
  if (!form || !box) return;
  const d = new FormData(form),
    title = String(d.get("title") || "").trim(),
    price = String(d.get("price") || "").trim(),
    condition = d.get("condition"),
    category = d.get("category"),
    delivery = d.get("delivery"),
    description = String(d.get("description") || "").trim(),
    area = String(d.get("area") || "").trim();
  const lat = form.querySelector('[name="latitude"]')?.value,
    lng = form.querySelector('[name="longitude"]')?.value;
  box.innerHTML = `${listingImages[0] ? `<div class="listing-preview-image"><img src="${listingImages[0]}" alt=""/></div>` : `<div class="listing-preview-image empty">${icon("package", 32)}<span>${t("รูปสินค้าจะแสดงที่นี่")}</span></div>`}<div class="listing-preview-copy"><span class="listing-preview-category">${escape(category ? t(category) : t("หมวดหมู่สินค้า"))}</span><h3>${escape(title || t("ชื่อสินค้าของคุณ"))}</h3><strong>฿${escape(price || "0.00")}</strong><div class="listing-preview-meta"><span>${escape(condition ? t(condition) : t("เลือกสภาพสินค้า"))}</span><span>${escape(delivery ? t(delivery) : t("นัดรับ"))}</span></div>${delivery !== "จัดส่ง" && area ? `<small class="listing-preview-area">${icon("map-pin", 14)} ${escape(area)}${lat && lng ? ` · ${t("ปักหมุดแล้ว")}` : ""}</small>` : ""}<p>${escape(description || t("รายละเอียดสินค้าจะปรากฏในส่วนนี้"))}</p></div>`;
}
function updateAvatarPreview() {
  const el = document.querySelector("#profile-avatar-preview");
  if (el) {
    const src = profileAvatarSrc(profileAvatar);
    el.innerHTML = src
      ? `<img src="${escape(src)}" alt=""/>`
      : escape(state.user.name.slice(0, 1));
  }
}
document.addEventListener("change", async (e) => {
  const input = e.target,
    isGroup = input.id === "group-images",
    isAvatar = input.id === "profile-avatar",
    isListing = input.id === "listing-images";
  if (input.matches?.("[data-payment-slip-input]")) {
    const panel = input.closest(".group-payment-panel, .checkout-pay-panel"),
      submit = panel?.querySelector("[data-slip-submit]"),
      status = panel?.querySelector("[data-payment-slip-status]"),
      file = input.files?.[0],
      validTypes = ["image/jpeg", "image/png", "image/webp"];
    if (file && (!validTypes.includes(file.type) || file.size > 8 * 1024 * 1024)) {
      input.value = "";
      if (status) status.textContent = t("กรุณาเลือกไฟล์ JPG, PNG หรือ WebP ขนาดไม่เกิน 8 MB");
    } else if (status) {
      status.textContent = file ? file.name : t("ยังไม่ได้เลือกสลิป (ไม่เกิน 8 MB)");
    }
    if (submit) submit.disabled = !file;
    return;
  }
  if (input.name === "method" && input.closest("#payout-account-form")) {
    input.closest("#payout-account-form").dataset.method = input.value;
    return;
  }
  if (input.closest("#create-form")) {
    updateCreateFormUI();
    updatePreview();
  }
  const checkoutForm = input.closest("#secondhand-checkout-form");
  if (checkoutForm) {
    updateSecondhandCheckoutSummary(checkoutForm);
    void refreshSecondhandCheckoutQr(checkoutForm);
  }
  if (!isGroup && !isAvatar && !isListing) {
    if (input.name === "delivery" && input.closest("#product-form"))
      updateListingDeliveryUI(input.closest("form"));
    return;
  }
  const files = [...input.files];
  if (!files.length) return;
  const status = document.querySelector(
    isGroup
      ? "#image-upload-status"
      : isListing
        ? "#listing-image-status"
        : "#avatar-status",
  );
  const form = input.closest("form"),
    submit = form.querySelector('[type="submit"]');
  try {
    if (isGroup && groupImages.length + files.length > MAX_GROUP_IMAGES)
      throw Error(t("เพิ่มรูปได้สูงสุด 4 รูป"));
    if (isListing && listingImages.length + files.length > 6)
      throw Error(t("เพิ่มรูปได้สูงสุด 6 รูป"));
    if (isGroup || isListing) imagesLoading = true;
    else avatarLoading = true;
    input.disabled = true;
    submit.disabled = true;
    status.textContent = t("กำลังเตรียมรูป กรุณารอสักครู่");
    const images = [];
    for (const file of files) images.push(await readLocalImage(file));
    if (!input.isConnected) return;
    if (isGroup) {
      groupImages.push(...images);
      document.querySelector("#image-draft").innerHTML = gallery(
        groupImages,
        true,
      );
      updatePreview();
    } else if (isListing) {
      listingImages.push(...images);
      renderListingImages();
      updateListingPreview();
    } else {
      profileAvatar = images[0];
      updateAvatarPreview();
    }
    status.textContent = isListing
      ? t("เพิ่มรูปแล้ว รูปแรกจะแสดงเป็นภาพหน้าปก")
      : isAvatar
        ? t("รูปพร้อมแล้ว จะบันทึกพร้อมโปรไฟล์")
        : t("รูปพร้อมแล้ว จะบันทึกพร้อมกลุ่ม");
  } catch (err) {
    status.textContent = storageError(err);
  } finally {
    if (isGroup || isListing) imagesLoading = false;
    else avatarLoading = false;
    input.value = "";
    input.disabled = false;
    submit.disabled = false;
  }
});
document.addEventListener("dragover", (e) => {
  const target = e.target.closest(".image-upload");
  if (target) {
    e.preventDefault();
    target.classList.add("is-dragging");
  }
});
document.addEventListener("dragleave", (e) => {
  const target = e.target.closest(".image-upload");
  if (target && !target.contains(e.relatedTarget))
    target.classList.remove("is-dragging");
});
document.addEventListener("drop", (e) => {
  const target = e.target.closest(".image-upload");
  if (!target) return;
  e.preventDefault();
  target.classList.remove("is-dragging");
  const input = target.querySelector('input[type="file"]');
  if (!input || !e.dataTransfer?.files?.length) return;
  input.files = e.dataTransfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
});
document.addEventListener("change", (e) => {
  if (e.target.id === "shipment-carrier-select") {
    const form = e.target.form;
    const tracking = form
      ?.querySelector('[name="trackingNumber"]')
      ?.value.trim();
    const urlInput = form?.querySelector('[name="url"]');
    if (urlInput && tracking) {
      if (e.target.value === "Flash Express")
        urlInput.value = `https://www.flashexpress.co.th/tracking/?se=${encodeURIComponent(tracking)}`;
      else if (e.target.value === "Kerry Express")
        urlInput.value = `https://th.kerryexpress.com/th/track/?track=${encodeURIComponent(tracking)}`;
      else if (e.target.value === "ไปรษณีย์ไทย EMS")
        urlInput.value = `https://track.thailandpost.co.th/?trackNumber=${encodeURIComponent(tracking)}`;
      else if (e.target.value === "J&T Express")
        urlInput.value = `https://www.jtexpress.co.th/index/query/gzquery.html?bills=${encodeURIComponent(tracking)}`;
    }
    return;
  }
  if (e.target.name === "otherCategory") {
    const form = e.target.form;
    if (
      form?.querySelector('[name="category"]')?.value === "อื่น ๆ (ระบุชื่อเอง)"
    )
      updatePreview();
    return;
  }
  if (e.target.id !== "locale-select") return;
  if (imagesLoading || avatarLoading) {
    e.target.value = locale;
    alertWarning(t("กำลังเตรียมรูป กรุณารอสักครู่"));
    return;
  }
  // Rerender labels without discarding drafts, password visibility, or the current auth step.
  const controls = [...document.querySelectorAll("input,textarea,select")];
  const focus = controls.indexOf(document.activeElement),
    scrollY = window.scrollY;
  const drafts = controls.map((el) => ({
    value: el.value,
    checked: el.checked,
    type: el.type,
    start: el.selectionStart,
    end: el.selectionEnd,
  }));
  const openDialogs = [...document.querySelectorAll("dialog[open]")].map(
    (el) => el.id,
  );
  const authStep = document.querySelector(".mockup-screen.active")
    ? mockupCurrentStep
    : null;
  locale = e.target.value === "en" ? "en" : "th";
  try {
    localStorage.setItem(LOCALE_KEY, locale);
  } catch {
    /* Language still works for this session. */
  }
  render();
  const nextControls = [...document.querySelectorAll("input,textarea,select")];
  nextControls.forEach((el, i) => {
    const draft = drafts[i];
    if (!draft) return;
    if (el instanceof HTMLInputElement) el.type = draft.type;
    if (draft.type !== "file") el.value = draft.value;
    el.checked = draft.checked;
    if (draft.start !== null && draft.start !== undefined)
      el.setSelectionRange(draft.start, draft.end);
  });
  if (authStep) setMockupStep(authStep);
  openDialogs.forEach((id) => {
    const dialog = document.getElementById(id);
    if (dialog && !dialog.open) dialog.showModal();
  });
  if (openDialogs.includes("profile-dialog")) updateAvatarPreview();
  updatePreview();
  nextControls[focus]?.focus({ preventScroll: true });
  window.scrollTo(0, scrollY);
});
document.addEventListener("click", async (e) => {
  const overlay = e.target.closest("#auth-modal-overlay");
  if (overlay && e.target === overlay) {
    const r = overlay.getBoundingClientRect();
    if (
      e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < r.top ||
      e.clientY > r.bottom
    ) {
      closeAuthModal();
      return;
    }
  }
  const link = e.target.closest("a[data-link]");
  if (link) {
    e.preventDefault();
    const href = link.getAttribute("href");
    if (link.classList.contains("demo-login-link"))
      sessionStorage.setItem(
        "harn-return",
        location.pathname + location.search,
      );
    if (link.closest(".mobile-menu")) {
      mobileMenuOpen = false;
      document.body.classList.remove("mobile-menu-open");
    }
    if (!state.user && isAuthRequired(href)) {
      sessionStorage.setItem("harn-return", href);
      openAuthModal(1);
      return;
    }
    go(href);
    return;
  }
  const pageButton = e.target.closest(".pagination-control[data-page]");
  if (pageButton && !pageButton.disabled) {
    const params = new URLSearchParams(location.search);
    params.set("page", pageButton.dataset.page);
    go(`/explore?${params.toString()}`);
    window.scrollTo(0, document.querySelector(".explore-page")?.offsetTop || 0);
    return;
  }
  if (
    (profileMenuOpen && !e.target.closest(".profile-menu-wrap")) ||
    (listingMenuOpen && !e.target.closest(".header-create-menu-wrap"))
  ) {
    profileMenuOpen = false;
    listingMenuOpen = false;
    render();
  }
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const action = btn.dataset.action,
    id = btn.dataset.id,
    actionSession = activeSupabaseSession;
  try {
    if (action === "create-step") {
      const targetStep = Number(btn.dataset.step);
      if (targetStep < createGroupStep || validateCreatePanel(createGroupStep))
        updateCreateStep(targetStep);
    } else if (action === "profile-menu-toggle") {
      profileMenuOpen = !profileMenuOpen;
      render();
      return;
    }
    if (action === "listing-menu-toggle") {
      listingMenuOpen = !listingMenuOpen;
      render();
      return;
    }
    if (action === "why-tab") {
      whyTab = btn.dataset.tab || "buyer";
      const section = btn.closest(".why-section");
      section?.querySelectorAll('[role="tab"]').forEach((tab) => tab.setAttribute("aria-selected", String(tab === btn)));
      section?.querySelectorAll(".why-panel").forEach((panel) => { panel.hidden = panel.id !== `why-panel-${whyTab}`; });
      return;
    }
    if (action === "home-group-filter") {
      selectedHomeGroupCategory = btn.dataset.category || "ทั้งหมด";
      render();
      return;
    }
    if (action === "scroll-filter") {
      const row = btn.closest(".filter-carousel")?.querySelector(".filter-row");
      row?.scrollBy({
        left:
          (btn.dataset.direction === "next" ? 1 : -1) *
          Math.max(180, row.clientWidth * 0.7),
        behavior: "smooth",
      });
    } else if (action === "copy-tracking") {
      const code = btn.dataset.tracking;
      if (code) {
        try {
          await navigator.clipboard.writeText(code);
          const span = btn.querySelector("span");
          if (span) {
            const orig = span.textContent;
            span.textContent = t("คัดลอกแล้ว!");
            btn.classList.add("copied");
            setTimeout(() => {
              span.textContent = orig;
              btn.classList.remove("copied");
            }, 2000);
          }
        } catch {
          alertMessage(`${t("เลขพัสดุ")}: ${code}`);
        }
      }
    } else if (action === "quick-search") {
      if (btn.dataset.category) {
        go("/explore?category=" + encodeURIComponent(btn.dataset.category));
      } else {
        go("/explore?q=" + encodeURIComponent(btn.dataset.query || ""));
      }
    } else if (action === "open-auth") {
      const step = Number(btn.dataset.step) || 1;
      if (
        !sessionStorage.getItem("harn-return") &&
        !isAuthRequired(location.pathname)
      ) {
        sessionStorage.setItem(
          "harn-return",
          location.pathname + location.search,
        );
      }
      openAuthModal(step);
    } else if (action === "close-auth") {
      closeAuthModal();
    } else if (action === "mockup-step") {
      setMockupStep(Number(btn.dataset.step), btn);
    } else if (action === "request-password-reset") {
      const emailEl = document.getElementById("mockup-login-email");
      const email = String(emailEl?.value || "").trim();
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        setFieldError(emailEl, t("กรุณากรอกอีเมลให้ถูกต้องก่อนขอรีเซ็ตรหัสผ่าน"));
        emailEl?.focus();
        return;
      }
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: location.origin,
      });
      if (error) throw error;
      alertMessage(t("หากอีเมลนี้มีบัญชีอยู่ ระบบส่งลิงก์ตั้งรหัสผ่านแล้ว กรุณาตรวจกล่องจดหมาย"));
    } else if (action === "mockup-autofill" && !supabaseConfigured) {
      fillMockupDemo();
    } else if (action === "mockup-social") {
      if (supabaseConfigured)
        throw new Error(t("โปรดเข้าสู่ระบบด้วย Google ผ่านปุ่ม Supabase Auth"));
      const user = demoAccount(
        state.profiles,
        "google.demo@example.com",
        "Google Demo",
      );
      if (user.address) finishAuth(user);
      else {
        tempSignupData = user;
        setMockupStep(3, btn);
      }
    } else if (action === "supabase-google") {
      if (!supabaseConfigured || !googleAuthAvailable)
        throw Object.assign(new Error(), { code: "googleProviderDisabled" });
      const redirectTo =
        location.origin +
        ((sessionStorage.getItem("harn-return") || "/").startsWith("/")
          ? sessionStorage.getItem("harn-return") || "/"
          : "/");
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo, queryParams: { prompt: "select_account" } },
      });
      if (error) throw error;
    } else if (action === "close-dialog") {
      btn.closest("dialog")?.close();
    } else if (action === "edit-profile") {
      if (avatarLoading) return;
      profileAvatar = state.user.avatar || "";
      const dialog = document.querySelector("#profile-dialog");
      dialog.querySelector("form").reset();
      updateAvatarPreview();
      dialog.querySelector("[data-dialog-feedback]")?.remove();
      dialog.querySelector("#bio-counter").textContent =
        `${(state.user.bio || "").length} / 160`;
      dialog.querySelector("#avatar-status").textContent = "";
      dialog.showModal();
    } else if (action === "avatar-remove") {
      if (avatarLoading) return;
      profileAvatar = "";
      updateAvatarPreview();
    } else if (action === "gallery-select") {
      const galleryEl = btn.closest(".group-gallery"),
        index = Number(btn.dataset.index);
      if (btn.dataset.editable) {
        if (imagesLoading) return;
        const [cover] = groupImages.splice(index, 1);
        if (cover) groupImages.unshift(cover);
        document.querySelector("#image-draft").innerHTML = gallery(
          groupImages,
          true,
        );
      } else {
        galleryEl.querySelector(".gallery-main img").src =
          btn.querySelector("img").src;
        galleryEl.querySelector(".gallery-main img").alt = t(
          "ดูรูปที่ {number}",
          { number: index + 1 },
        );
        galleryEl.querySelector(".gallery-counter").textContent =
          `${index + 1} / ${galleryEl.querySelectorAll('[data-action="gallery-select"]').length}`;
        galleryEl
          .querySelectorAll('[data-action="gallery-select"]')
          .forEach((button) =>
            button.setAttribute("aria-pressed", String(button === btn)),
          );
      }
    } else if (
      action === "secondhand-photo" ||
      action === "secondhand-photo-step"
    ) {
      const galleryEl = btn.closest(".secondhand-gallery"),
        images = JSON.parse(galleryEl?.dataset.images || "[]");
      if (!galleryEl || !images.length) return;
      const current = Number(galleryEl.dataset.current || 0);
      const next =
        action === "secondhand-photo-step"
          ? (current + Number(btn.dataset.direction) + images.length) %
            images.length
          : Number(btn.dataset.index);
      galleryEl.dataset.current = String(next);
      const mainImage = galleryEl.querySelector("[data-secondhand-main]");
      mainImage.src = images[next];
      mainImage.alt = t("ดูรูปที่ {number}", { number: next + 1 });
      const countLabel = galleryEl.querySelector("[data-secondhand-count]");
      if (countLabel) countLabel.textContent = `${next + 1} / ${images.length}`;
      galleryEl
        .querySelectorAll(".secondhand-gallery-thumb")
        .forEach((thumb, index) => {
          const selected = index === next;
          thumb.classList.toggle("is-active", selected);
          thumb.setAttribute("aria-pressed", String(selected));
        });
    } else if (action === "secondhand-photo-fullscreen") {
      await btn
        .closest(".secondhand-gallery")
        ?.querySelector(".secondhand-listing-hero")
        ?.requestFullscreen?.();
    } else if (action === "secondhand-edit") {
      const product = listing(id);
      if (!product || product.sellerId !== state.user?.id)
        throw new Error(t("แก้ไขได้เฉพาะประกาศของคุณ"));
      go(`/seller/products/${encodeURIComponent(id)}/edit`);
    } else if (action === "secondhand-delete") {
      const product = listing(id);
      if (!product || product.sellerId !== state.user?.id)
        throw new Error(t("ลบได้เฉพาะประกาศของคุณ"));
      if (!confirm(t("ยืนยันลบประกาศ {title}?", { title: product.title })))
        return;
      if (supabaseConfigured)
        await deleteSupabaseSecondhandListing(id, product, state.user);
      state = {
        ...state,
        remoteListings: state.remoteListings.filter((item) => item.id !== id),
        customListings: state.customListings.filter((item) => item.id !== id),
      };
      save(state);
      go("/marketplace/secondhand");
      alertMessage(t("ลบประกาศแล้ว"));
    } else if (action === "secondhand-boost") {
      const product = listing(id);
      if (!product || product.sellerId !== state.user?.id)
        throw new Error(t("Boost ได้เฉพาะประกาศของคุณ"));
      const boostedUntil = new Date(
        Date.now() + 24 * 60 * 60 * 1000,
      ).toISOString();
      const savedListing = supabaseConfigured
        ? await boostSupabaseSecondhandListing(id, state.user, boostedUntil)
        : { ...product, boostedUntil };
      state = {
        ...state,
        remoteListings: state.remoteListings.map((item) =>
          item.id === id ? savedListing : item,
        ),
        customListings: state.customListings.map((item) =>
          item.id === id ? savedListing : item,
        ),
      };
      save(state);
      render();
      alertMessage(t("Boost ทดลองแล้ว แสดงเด่น 24 ชั่วโมง"));
    } else if (action === "secondhand-reserve") {
      const product = listing(btn.dataset.id);
      if (!product) throw new Error(t("ไม่พบประกาศนี้"));
      if (!requireAuth(`/products/${encodeURIComponent(product.id)}`)) return;
      if (product.sellerId === state.user.id)
        throw new Error(t("ไม่สามารถจองสินค้าของตัวเองได้"));
      const initialMessage = t(
        "สนใจจองสินค้า {title} รบกวนแจ้งรายละเอียดการรับสินค้าด้วย",
        { title: product.title },
      );
      if (supabaseConfigured) {
        const conversation = await startSecondhandConversation(
          product.id,
          state.user,
          product.sellerId,
        );
        const existingMessages = await loadSecondhandMessages(
          conversation.id,
          state.user.id,
        );
        if (!existingMessages.length)
          existingMessages.push(
            await sendSecondhandMessage(
              conversation.id,
              state.user,
              initialMessage,
            ),
          );
        secondhandChatMessages.set(
          secondhandChatCacheKey(conversation.id),
          existingMessages,
        );
        go(
          `/chat/${encodeURIComponent(product.sellerId)}?product=${encodeURIComponent(product.id)}&conversation=${encodeURIComponent(conversation.id)}`,
        );
      } else {
        const threadKey = `secondhand-${product.id}-${product.sellerId}`;
        state.conversations[threadKey] ??= [
          { from: "me", body: initialMessage, at: new Date().toISOString() },
        ];
        save();
        go(
          `/chat/${encodeURIComponent(product.sellerId)}?product=${encodeURIComponent(product.id)}&listingChat=1&thread=${encodeURIComponent(threadKey)}`,
        );
      }
    } else if (action === "secondhand-order") {
      const product = listing(btn.dataset.id);
      if (!product) throw new Error(t("ไม่พบประกาศนี้"));
      if (!requireAuth(`/products/${encodeURIComponent(product.id)}`)) return;
      if (product.sellerId === state.user.id)
        throw new Error(t("ไม่สามารถสั่งซื้อสินค้าของตัวเองได้"));
      go(`/checkout/secondhand/${encodeURIComponent(product.id)}`);
    } else if (action === "share-listing") {
      const shareData = { title: document.title, url: location.href };
      if (navigator.share) await navigator.share(shareData);
      else {
        await navigator.clipboard.writeText(location.href);
        alertMessage(t("คัดลอกลิงก์ประกาศแล้ว"));
      }
    } else if (action === "image-remove") {
      if (imagesLoading) return;
      groupImages.splice(Number(btn.dataset.index), 1);
      document.querySelector("#image-draft").innerHTML = gallery(
        groupImages,
        true,
      );
    } else if (action === "toggle-category" || action === "remove-category") {
      const category = btn.dataset.category;
      if (action === "toggle-category")
        selectedCreateCategories = selectedCreateCategories.includes(category)
          ? selectedCreateCategories.filter((item) => item !== category)
          : [...selectedCreateCategories, category];
      else
        selectedCreateCategories = selectedCreateCategories.filter(
          (item) => item !== category,
        );
      syncCreateCategoryUI();
    } else if (action === "listing-cover") {
      const [image] = listingImages.splice(Number(btn.dataset.index), 1);
      if (image) listingImages.unshift(image);
      renderListingImages();
      updateListingPreview();
    } else if (action === "listing-image-remove") {
      listingImages.splice(Number(btn.dataset.index), 1);
      renderListingImages();
      updateListingPreview();
    } else if (action === "listing-map-search")
      await searchListingMapLocation();
    else if (action === "payment-open") {
      if (!orderPermissions(orderFor(id), state.user).reportPayment)
        throw Object.assign(new Error(), { code: "orderUnauthorized" });
      const dialog = document.querySelector("#payment-dialog");
      dialog.showModal();
      const qr = dialog.querySelector("#payment-qr"),
        expires = Date.now() + 5 * 60 * 60 * 1000;
      qr.dataset.expires = String(expires);
      const url = demoAcceptUrl(qr.dataset.reference, qr.dataset.amount, {
        expires,
      });
      qr.src = await QRCode.toDataURL(url.href, {
        errorCorrectionLevel: "M",
        margin: 2,
        width: 420,
        color: { dark: "#092847", light: "#ffffff" },
      });
      startDemoCountdown(dialog, expires);
    } else if (action === "toggle-mockup-pw") {
      const form = btn.closest("form") || document;
      const targetInput =
        form.querySelector(`#${btn.dataset.target}`) ||
        document.getElementById(btn.dataset.target);
      if (targetInput) {
        targetInput.type =
          targetInput.type === "password" ? "text" : "password";
      }
    } else if (action === "theme-toggle") {
      theme = theme === "dark" ? "light" : "dark";
      try {
        localStorage.setItem(THEME_KEY, theme);
      } catch {
        /* Apply the selected theme for this page view. */
      }
      document.documentElement.dataset.theme = theme;
      render();
    } else if (action === "mobile-menu-toggle") {
      mobileMenuOpen = !mobileMenuOpen;
      render();
    } else if (action === "reset-demo") {
      if (supabaseConfigured)
        throw Object.assign(new Error(), { code: "supabaseDemoResetDisabled" });
      if (!confirm(t("ล้างข้อมูลเดโมในเบราว์เซอร์นี้และเริ่มใหม่?"))) return;
      state = initialState();
      save();
      go("/");
      alertMessage(t("เริ่มข้อมูลเดโมใหม่แล้ว"));
    } else if (action === "refresh-groups") {
      await refreshSupabaseGroups();
    } else if (action === "open-plus-payment" || action === "close-plus-payment") {
      plusPaymentOpen = action === "open-plus-payment";
      render();
      if (plusPaymentOpen)
        document.querySelector("#plus-payment")?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    } else if (action === "report-subscription-payment") {
      if (!state.user) throw Object.assign(new Error(), { code: "orderUnauthorized" });
      const panel = btn.closest(".group-payment-panel"),
        file = panel?.querySelector("[data-payment-slip-input]")?.files?.[0],
        transferTime = panel?.querySelector("[data-payment-transfer-time]")?.value,
        transferredAt = new Date(transferTime || "");
      if (!file || !["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 8 * 1024 * 1024)
        throw new Error(t("กรุณาแนบสลิป JPG, PNG หรือ WebP ขนาดไม่เกิน 8 MB"));
      if (!transferTime || Number.isNaN(transferredAt.valueOf()) || transferredAt > new Date(Date.now() + 10 * 60 * 1000))
        throw new Error(t("กรุณาระบุวันและเวลาที่โอนให้ถูกต้อง"));
      btn.disabled = true;
      btn.textContent = t("กำลังอัปโหลดสลิป…");
      if (supabaseConfigured) {
        await reportSupabaseSubscriptionPayment(state.user.id, file, transferredAt.toISOString());
        state.remoteSubscription = await loadSupabaseSubscription();
      } else {
        const current = state.subscriptions?.[state.user.id] || emptySubscription(state.user.id);
        save({
          ...state,
          subscriptions: {
            ...(state.subscriptions || {}),
            [state.user.id]: reportSubscriptionPayment(current, { id: crypto.randomUUID(), slipPath: file.name, transferredAt: transferredAt.toISOString() }),
          },
        });
      }
      plusPaymentOpen = false;
      render();
      alertMessage(t("ส่งสลิปแล้ว แอดมินตรวจแล้ว Plus จะเริ่มใช้งาน"));
    } else if (action === "demo-verify-subscription") {
      if (supabaseConfigured || !state.user) throw Object.assign(new Error(), { code: "orderUnauthorized" });
      const current = state.subscriptions?.[state.user.id];
      const pendingPayment = current?.payments.find((p) => p.status === "reported");
      if (!pendingPayment) throw new Error(t("ไม่มีสลิปที่รอตรวจ"));
      save({
        ...state,
        subscriptions: { ...state.subscriptions, [state.user.id]: verifySubscriptionPayment(current, pendingPayment.id) },
      });
      render();
      alertMessage(t("ยืนยันสลิปแล้ว Plus ใช้งานได้ 1 เดือน"));
    } else if (action === "retry-group-messages") {
      groupMessageLoadState.delete(id);
      groupMessageErrors.delete(id);
      void refreshGroupChatMessages(id, { rerender: true });
    } else if (action === "join") {
      if (supabaseConfigured) {
        const token = new URLSearchParams(location.search).get("invite");
        await joinSupabaseGroup(id, token);
        if (!(await refreshSupabaseGroups(actionSession))) return;
        go(`/groups/${id}`);
        alertMessage(t("เข้าร่วมกลุ่มแล้ว กรุณายืนยันยอดใหม่"));
      } else {
        const g = joinGroup(group(id), state.user.id);
        updateGroup(g);
        g.members.forEach((u) =>
          notice(
            t("ยอดกลุ่มเปลี่ยน"),
            t("มีสมาชิกใหม่ กรุณายืนยันยอดรอบ {revision}", {
              revision: g.revision,
            }),
            `/groups/${id}`,
            u,
          ),
        );
        if (g.members.length === g.capacity)
          g.members.forEach((u) =>
            notice(
              t("กลุ่มครบสมาชิก"),
              t("รอทุกคนยืนยันยอดก่อนสรุปคำสั่งซื้อ"),
              `/groups/${id}`,
              u,
            ),
          );
        go(`/groups/${id}`);
        alertMessage(t("เข้าร่วมกลุ่มแล้ว กรุณายืนยันยอดใหม่"));
      }
    } else if (action === "leave") {
      const current = group(id);
      if (!current) return;
      const currentShare = shares(current)[state.user?.id] || 0;
      document.querySelector("#leave-group-dialog")?.remove();
      document.body.insertAdjacentHTML(
        "beforeend",
        leaveGroupDialog(current, currentShare),
      );
      const dialog = document.querySelector("#leave-group-dialog");
      dialog.addEventListener("close", () => dialog.remove(), { once: true });
      dialog.addEventListener("click", (e) => {
        if (e.target === dialog) dialog.close();
      });
      dialog.showModal();
    } else if (action === "confirm-leave") {
      const dialog =
        btn.closest("dialog") || document.querySelector("#leave-group-dialog");
      if (dialog) dialog.close();
      const current = group(id);
      if (!current) return;
      if (supabaseConfigured) {
        await leaveSupabaseGroup(id);
        if (!(await refreshSupabaseGroups(actionSession))) return;
      } else {
        const g = leaveGroup(current, state.user.id);
        updateGroup(g);
        g.members.forEach((u) =>
          notice(
            t("สมาชิกออกจากกลุ่ม"),
            t("ยอดเปลี่ยน กรุณายืนยันใหม่"),
            `/groups/${id}`,
            u,
          ),
        );
      }
      go("/my-groups");
      alertMessage(t("ออกจากกลุ่มแล้ว"));
    } else if (action === "kick-member") {
      const current = group(id),
        memberId = btn.dataset.member;
      if (
        !current ||
        current.ownerId !== state.user?.id ||
        !current.members.includes(memberId)
      )
        return;
      if (
        !confirm(
          t("ยืนยันเตะสมาชิก {name} ออกจากห้อง?", { name: name(memberId) }),
        )
      )
        return;
      if (supabaseConfigured) {
        await removeSupabaseGroupMember(id, memberId);
        if (!(await refreshSupabaseGroups(actionSession))) return;
      } else {
        updateGroup(leaveGroup(current, memberId));
        current.members
          .filter((u) => u !== memberId)
          .forEach((u) =>
            notice(
              t("สมาชิกออกจากกลุ่ม"),
              t("ยอดเปลี่ยน กรุณายืนยันใหม่"),
              `/groups/${id}`,
              u,
            ),
          );
      }
      render();
      alertMessage(t("นำสมาชิกออกจากห้องแล้ว ยอดและการยืนยันถูกอัปเดต"));
    } else if (action === "report-group-payment") {
      const current = group(id),
        revision = Number(btn.dataset.revision),
        panel = btn.closest(".group-payment-panel"),
        fileInput = panel?.querySelector("[data-payment-slip-input]"),
        transferTime = panel?.querySelector("[data-payment-transfer-time]")?.value,
        file = fileInput?.files?.[0];
      if (!supabaseConfigured || !current || !state.user || !current.members.includes(state.user.id))
        throw Object.assign(new Error(), { code: "orderUnauthorized" });
      if (current.approvals[state.user.id] !== revision)
        throw new Error(t("กรุณายืนยันยอดรอบปัจจุบันก่อนแจ้งโอน"));
      if (Number(current.revision) !== revision)
        throw new Error(t("ยอดส่วนแบ่งเปลี่ยนแล้ว กรุณาตรวจสอบใหม่"));
      if (!file || !["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 8 * 1024 * 1024)
        throw new Error(t("กรุณาแนบสลิป JPG, PNG หรือ WebP ขนาดไม่เกิน 8 MB"));
      const transferredAt = new Date(transferTime || "");
      if (!transferTime || Number.isNaN(transferredAt.valueOf()) || transferredAt > new Date(Date.now() + 10 * 60 * 1000))
        throw new Error(t("กรุณาระบุวันและเวลาที่โอนให้ถูกต้อง"));
      if (!confirm(t("ยืนยันว่าโอนเงินจริงตามยอดรอบนี้แล้วใช่ไหม? แนบสลิปเพื่อส่งให้แอดมินตรวจ"))) return;
      btn.disabled = true;
      btn.textContent = t("กำลังอัปโหลดสลิป…");
      const extension = ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" })[file.type];
      const slipPath = `${state.user.id}/${id}/${revision}/${crypto.randomUUID()}.${extension}`;
      const { error: uploadError } = await supabase.storage.from("group-payment-slips").upload(slipPath, file, {
        cacheControl: "3600", upsert: false, contentType: file.type,
      });
      if (uploadError) throw uploadError;
      try {
        await reportSupabaseGroupPayment(id, revision, slipPath, transferredAt.toISOString());
      } catch (error) {
        await supabase.storage.from("group-payment-slips").remove([slipPath]);
        throw error;
      }
      if (!(await refreshSupabaseGroups(actionSession))) return;
      render();
      alertMessage(t("แจ้งโอนแล้ว แอดมินจะตรวจสอบยอดเงินจริง"));
    } else if (action === "start-cycle") {
      const current = group(id);
      if (!current || current.ownerId !== state.user?.id)
        throw Object.assign(new Error(), { code: "orderUnauthorized" });
      if (!confirm(t("เริ่มรอบแรกตอนนี้ใช่ไหม? ยอดของสมาชิกที่อยู่ในกลุ่มจะถูกล็อกเป็นเวลา 1 เดือน")))
        return;
      if (supabaseConfigured) {
        await startSupabaseCycle(id);
        if (!(await refreshSupabaseGroups(actionSession))) return;
      } else {
        updateGroup(startFirstCycle(current, state.user.id));
      }
      render();
      alertMessage(t("เริ่มรอบแรกแล้ว ให้สมาชิกยืนยันยอดเดือนนี้"));
    } else if (action === "confirm-cycle") {
      const current = group(id),
        number = Number(btn.dataset.cycle),
        cycle = current && currentCycle(current);
      if (!cycle || !cycle.members.includes(state.user?.id))
        throw Object.assign(new Error(), { code: "orderUnauthorized" });
      if (!confirm(t("ยืนยันยอดเดือนนี้ {amount} ใช่ไหม? ยืนยันได้ครั้งเดียวต่อรอบ", { amount: money(cycle.amounts[state.user.id]) })))
        return;
      if (supabaseConfigured) {
        await confirmSupabaseCycle(id, number);
        if (!(await refreshSupabaseGroups(actionSession))) return;
      } else {
        updateGroup(confirmCycle(current, state.user.id, number));
      }
      render();
      alertMessage(t("ยืนยันยอดเดือนนี้แล้ว"));
    } else if (action === "report-cycle-payment") {
      const current = group(id),
        number = Number(btn.dataset.cycle),
        cycle = current && currentCycle(current),
        panel = btn.closest(".group-payment-panel"),
        file = panel?.querySelector("[data-payment-slip-input]")?.files?.[0],
        transferTime = panel?.querySelector("[data-payment-transfer-time]")?.value;
      if (!cycle || !cycle.confirmations[state.user?.id])
        throw new Error(t("กรุณายืนยันยอดเดือนนี้ก่อนแจ้งโอน"));
      const transferredAt = new Date(transferTime || "");
      if (!transferTime || Number.isNaN(transferredAt.valueOf()) || transferredAt > new Date(Date.now() + 10 * 60 * 1000))
        throw new Error(t("กรุณาระบุวันและเวลาที่โอนให้ถูกต้อง"));
      if (supabaseConfigured) {
        if (!file || !["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 8 * 1024 * 1024)
          throw new Error(t("กรุณาแนบสลิป JPG, PNG หรือ WebP ขนาดไม่เกิน 8 MB"));
        btn.disabled = true;
        btn.textContent = t("กำลังอัปโหลดสลิป…");
        await reportSupabaseCyclePayment(id, number, state.user.id, file, transferredAt.toISOString());
        if (!(await refreshSupabaseGroups(actionSession))) return;
        alertMessage(t("แจ้งโอนแล้ว แอดมินจะตรวจสอบยอดเงินจริง"));
      } else {
        // Demo mode has no admin: the transfer counts as verified straight away.
        updateGroup(recordCyclePayment(current, state.user.id, number, "verified", cycle.amounts[state.user.id]));
        alertMessage(t("บันทึกการชำระแล้ว (โหมดเดโม)"));
      }
      render();
    } else if (action === "open-payout-slip") {
      const path = btn.dataset.path || "";
      if (!supabaseConfigured || !path.startsWith(`${state.user?.id}/`))
        throw Object.assign(new Error(), { code: "orderUnauthorized" });
      const win = window.open("about:blank", "_blank");
      const url = await openPayoutSlip(path);
      if (win) win.location.href = url;
      else location.href = url;
    } else if (action === "confirm-receipt") {
      const current = group(id);
      if (!current || !current.members.includes(state.user?.id) || current.ownerId === state.user.id)
        throw Object.assign(new Error(), { code: "orderUnauthorized" });
      if (!confirm(t("ยืนยันว่าได้รับสินค้าหรือใช้งานได้แล้วใช่ไหม? ยืนยันแล้วเงินของคุณจะถูกโอนให้เจ้าของกลุ่มเมื่อทุกคนยืนยันครบ")))
        return;
      if (!supabaseConfigured) throw new Error(t("ยืนยันรับสินค้าได้เมื่อเชื่อมต่อระบบชำระเงินจริง"));
      await confirmSupabaseReceipt(id);
      if (!(await refreshSupabaseGroups(actionSession))) return;
      render();
      alertMessage(t("ยืนยันรับสินค้าแล้ว ขอบคุณครับ"));
    } else if (action === "confirm-cycle-receipt") {
      const current = group(id),
        number = Number(btn.dataset.cycle);
      if (!current || !current.members.includes(state.user?.id))
        throw Object.assign(new Error(), { code: "orderUnauthorized" });
      if (!confirm(t("ยืนยันว่าได้รับสินค้าหรือใช้งานได้แล้วใช่ไหม? ยืนยันแล้วเงินของคุณจะถูกโอนให้เจ้าของกลุ่มเมื่อทุกคนยืนยันครบ")))
        return;
      if (supabaseConfigured) {
        await confirmSupabaseCycleReceipt(id, number);
        if (!(await refreshSupabaseGroups(actionSession))) return;
      } else {
        updateGroup(confirmCycleReceipt(current, state.user.id, number));
      }
      render();
      alertMessage(t("ยืนยันรับสินค้าแล้ว ขอบคุณครับ"));
    } else if (action === "redeem-promo") {
      if (!state.user) throw Object.assign(new Error(), { code: "orderUnauthorized" });
      const code = String(document.querySelector("#promo-code-input")?.value || "").trim();
      if (!code) throw new Error(t("กรุณากรอกโค้ดส่วนลด"));
      if (supabaseConfigured) {
        btn.disabled = true;
        try {
          await redeemSupabasePromo(code);
          state.remoteSubscription = await loadSupabaseSubscription();
        } finally {
          btn.disabled = false; // a wrong code can be fixed and tried again
        }
      } else {
        const promo = redeemPromo(state.promos?.[state.user.id], code);
        save({ ...state, promos: { ...(state.promos || {}), [state.user.id]: promo } });
      }
      render();
      alertMessage(t("ยินดีด้วย! คุณได้รับโค้ดพิเศษ ไม่เสียค่าธรรมเนียมเว็บ 2% เป็นเวลา 2 เดือน"));
    } else if (action === "approve-owner") {
      const current = group(id),
        revision = Number(btn.dataset.revision);
      if (!current || current.ownerId !== state.user?.id)
        throw Object.assign(new Error(), { code: "orderUnauthorized" });
      if (!confirm(t("ยืนยันยอดกลุ่มรอบนี้ใช่ไหม? คุณไม่ต้องโอนเงิน สมาชิกจะโอนเข้าบัญชีแพลตฟอร์ม")))
        return;
      if (supabaseConfigured) {
        await approveSupabaseGroup(id, revision);
        if (!(await refreshSupabaseGroups(actionSession))) return;
      } else {
        updateGroup(approve(current, state.user.id, revision));
      }
      render();
      alertMessage(t("ยืนยันยอดกลุ่มแล้ว"));
    } else if (action === "approve") {
      const current = group(id);
      if (!current || !current.members.includes(state.user?.id))
        throw Object.assign(new Error(), { code: "orderUnauthorized" });
      const amount = shares(current)[state.user.id];
      const product = listing(current.listingId);
      document.body.insertAdjacentHTML(
        "beforeend",
        shareApprovalDialog(amount, current, product),
      );
      const dialog = document.querySelector("#share-approval-dialog");
      dialog.addEventListener("close", () => dialog.remove(), { once: true });
      dialog.showModal();
    } else if (action === "confirm-share-amount") {
      const current = group(id),
        revision = Number(btn.dataset.revision);
      if (!current || !current.members.includes(state.user?.id))
        throw Object.assign(new Error(), { code: "orderUnauthorized" });
      if (Number(current.revision) !== revision)
        throw new Error(t("ยอดส่วนแบ่งเปลี่ยนแล้ว กรุณาตรวจสอบใหม่"));
      // Check the slip before approving, so a bad file never leaves a half-done report.
      const slip = slipFromPanel(btn.closest(".checkout-pay-panel"), { required: supabaseConfigured });
      if (supabaseConfigured) {
        btn.disabled = true;
        btn.textContent = t("กำลังส่งสลิป…");
        if (current.approvals[state.user.id] !== revision) await approveSupabaseGroup(id, revision);
        await reportGroupSlip(id, revision, slip.file, slip.transferredAt);
        if (!(await refreshSupabaseGroups(actionSession))) return;
      } else {
        const next = approve(current, state.user.id, revision);
        updateGroup(next);
        if (allApproved(next))
          next.members.forEach((member) =>
            notice(
              t("ยืนยันยอดครบแล้ว"),
              t("สมาชิกยืนยันยอดส่วนแบ่งครบแล้ว"),
              `/orders/${id}`,
              member,
            ),
          );
      }
      btn.closest("dialog")?.close();
      render();
      alertMessage(supabaseConfigured ? t("ส่งสลิปแล้ว แอดมินจะตรวจสอบยอดเงินจริง") : t("ยืนยันยอดส่วนแบ่งแล้ว"));
    } else if (action === "copy-link") {
      const current = group(id);
      if (!current) throw new Error(t("ไม่พบกลุ่ม"));
      const token =
        supabaseConfigured && current.visibility === "link"
          ? await getSupabaseInvite(id)
          : null;
      const inviteUrl = new URL(
        `/groups/${encodeURIComponent(id)}`,
        location.href,
      );
      if (token) inviteUrl.searchParams.set("invite", token);
      const value = inviteUrl.href;
      let copied = false;
      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(value);
          copied = true;
        } catch {
          /* Try the legacy clipboard API below. */
        }
      }
      if (!copied) {
        const input = document.createElement("textarea");
        input.value = value;
        input.setAttribute("readonly", "");
        input.style.position = "fixed";
        input.style.left = "0";
        input.style.top = "0";
        input.style.opacity = "0";
        document.body.append(input);
        input.focus();
        input.select();
        input.setSelectionRange(0, input.value.length);
        copied = document.execCommand("copy");
        input.remove();
      }
      if (!copied) throw new Error(t("คัดลอกลิงก์ไม่สำเร็จ"));
      alertMessage(t("คัดลอกลิงก์เชิญแล้ว"));
    } else if (action === "open-notice") {
      const n = state.notifications.find((x) => x.id === id);
      n.read = true;
      save();
      go(n.href);
    } else if (action === "logout") {
      authSessionSync?.invalidate();
      if (supabaseConfigured) {
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
      }
      state.user = null;
      state.groups = supabaseConfigured ? [] : state.groups;
      state.profiles = supabaseConfigured ? {} : state.profiles;
      save();
      if (supabaseConfigured) await syncSupabaseSession(null);
      go("/");
      alertMessage(t("ออกจากระบบแล้ว"));
    } else if (action === "switch-user") {
      if (supabaseConfigured)
        throw Object.assign(new Error(), { code: "orderUnauthorized" });
      const user =
        state.profiles?.[id] ||
        (["demo-seller", "demo-seller-s2"].includes(id)
          ? {
              id,
              name: seller(id === "demo-seller" ? "s1" : "s2").name,
              role: "seller",
              sellerId: id === "demo-seller" ? "s1" : "s2",
            }
          : { id, name: demoNames[id], role: "member" });
      save({ ...state, user });
      render();
      alertMessage(t("สลับบัญชีทดสอบแล้ว"));
    } else if (action === "payment-report") {
      if (!confirm(t("ยืนยันแจ้งชำระจำลอง ไม่ใช่หลักฐานการโอนเงินจริง?")))
        return;
      orderChanged(
        reportPayment(orderFor(id), state.user),
        t("แจ้งชำระแล้ว รอหัวหน้ากลุ่มตรวจยอดเดโม"),
      );
    } else if (action === "accept-demo-amount") {
      const acceptedAt = Date.now(),
        reference = btn.dataset.ref,
        amount = Number(btn.dataset.amount),
        expires = Number(btn.dataset.expires),
        groupId = btn.dataset.group,
        revision = Number(btn.dataset.revision);
      if (expires && acceptedAt >= expires) {
        alertWarning(t("QR หมดอายุแล้ว"));
        render();
        return;
      }
      if (groupId && supabaseConfigured) {
        if (!state.user)
          throw Object.assign(new Error(), { code: "orderUnauthorized" });
        await approveSupabaseGroup(groupId, revision);
        await refreshSupabaseGroups(actionSession);
      } else if (groupId) {
        const current = group(groupId);
        if (current && current.members.includes(state.user?.id)) {
          const next = approve(current, state.user.id, revision);
          updateGroup(next);
          if (allApproved(next))
            next.members.forEach((member) =>
              notice(
                t("ยืนยันยอดครบแล้ว"),
                t("กลุ่มพร้อมดูสรุปคำสั่งซื้อเดโม"),
                `/orders/${groupId}`,
                member,
              ),
            );
        }
      }
      localStorage.setItem(
        `harnkhong-demo-acceptance:${reference}`,
        JSON.stringify({ amount, acceptedAt }),
      );
      const params = new URLSearchParams(location.search);
      params.set("ref", reference);
      params.set("amount", String(amount));
      params.set("accepted", "1");
      history.replaceState({}, "", `/demo-accept?${params.toString()}`);
      render();
      window.scrollTo(0, 0);
    } else if (action === "payment-update") {
      let note = "";
      if (btn.dataset.next === "unpaid") {
        note = prompt(t("เหตุผลที่ต้องแจ้งชำระใหม่"));
        if (note === null) return;
      } else if (
        !confirm(
          t("การตรวจยอดนี้เป็นการจำลอง ไม่ได้ตรวจสอบธนาคาร ยืนยันดำเนินการ?"),
        )
      )
        return;
      orderChanged(
        updatePayment(
          orderFor(id),
          state.user,
          btn.dataset.member,
          btn.dataset.next,
          { note },
        ),
        t("บันทึกสถานะการชำระจำลองแล้ว"),
      );
    } else if (action === "order-transition") {
      if (
        !confirm(
          t("ยืนยันเปลี่ยนสถานะคำสั่งซื้อเดโม? ไม่มีการโอนหรือปล่อยเงินจริง"),
        )
      )
        return;
      orderChanged(
        transitionOrder(orderFor(id), state.user, btn.dataset.next),
        btn.dataset.next === "completed"
          ? t("จบคำสั่งซื้อเดโมแล้ว ไม่มีการปล่อยเงินจริง")
          : t("บันทึกสถานะคำสั่งซื้อเดโมแล้ว"),
      );
    } else if (action === "resolution-response") {
      if (
        !confirm(
          t("ยืนยันตอบข้อเสนอแก้ไขข้อพิพาทนี้? ผลคืนเงินเป็นเพียงบันทึกจำลอง"),
        )
      )
        return;
      const next = respondToResolution(
        orderFor(id),
        state.user,
        btn.dataset.dispute,
        btn.dataset.accept === "true",
      );
      orderChanged(
        next,
        next.status === "refunded"
          ? t("บันทึกผลคืนเงินจำลองแล้ว ไม่ได้คืนเงินจริง")
          : t("บันทึกคำตอบข้อเสนอแล้ว"),
      );
    } else if (action === "edit-group") {
      const g = group(id), details = g.details || {};
      if (!g || g.ownerId !== state.user?.id) throw Error(t("เฉพาะหัวหน้ากลุ่มแก้ไขได้"));
      const dialog = document.createElement("dialog");
      dialog.className = "form-dialog edit-group-dialog";
      dialog.innerHTML = `<form id="edit-group-form" data-id="${escape(id)}"><div class="dialog-heading"><div><h2>${t("แก้ไขกลุ่ม")}</h2><p>${t("แก้ไขข้อมูลที่สมาชิกเห็นในกลุ่ม")}</p></div><button type="button" class="dialog-close" data-action="close-dialog" aria-label="${t("ปิด")}">✕</button></div><label>${t("ชื่อกลุ่ม")}<input name="name" required maxlength="70" value="${escape(g.name)}"/></label><label>${t("สมาชิกขั้นต่ำ")}<input name="minimumMembers" type="number" min="2" max="${g.capacity}" required value="${Number(details.minimumMembers || 2)}"/></label><label>${t("วันปิดรับสมาชิก")}<input name="closesAt" type="date" required value="${escape(details.closesAt || "")}"/></label><label>${t("ค่าส่งต่อคน (บาท)")}<input name="delivery" inputmode="decimal" required value="${bahtInput(g.costs.delivery)}"/></label><label>${t("การมองเห็นกลุ่ม")}<select name="visibilityMode"><option value="public" ${details.visibilityMode === "public" || (!details.visibilityMode && g.visibility === "public") ? "selected" : ""}>${t("สาธารณะ")}</option><option value="link" ${details.visibilityMode === "link" || (!details.visibilityMode && g.visibility === "link") ? "selected" : ""}>${t("เฉพาะผู้มีลิงก์")}</option><option value="private" ${details.visibilityMode === "private" ? "selected" : ""}>${t("ส่วนตัว")}</option></select></label><label>${t("หมายเหตุถึงสมาชิก")}<textarea name="memberNote" maxlength="500">${escape(details.memberNote || "")}</textarea></label><div data-dialog-feedback class="dialog-feedback" role="alert" hidden></div><div class="dialog-actions"><button type="button" class="button outline" data-action="close-dialog">${t("ยกเลิก")}</button><button type="submit" class="button primary">${t("บันทึกการแก้ไข")}</button></div></form>`;
      document.body.append(dialog);
      dialog.addEventListener("close", () => dialog.remove(), { once: true });
      dialog.showModal();
      dialog.querySelector('[name="name"]')?.focus();
    } else if (action === "transfer") {
      const g = group(id),
        members = g.members.filter((u) => u !== state.user.id);
      if (!members.length) throw Error(t("ยังไม่มีสมาชิกให้โอนสิทธิ์"));
      document.querySelector("#transfer-group-dialog")?.remove();
      document.body.insertAdjacentHTML("beforeend", transferGroupDialog(g));
      const dialog = document.querySelector("#transfer-group-dialog");
      dialog.addEventListener("close", () => dialog.remove(), { once: true });
      dialog.addEventListener("click", (e) => {
        if (e.target === dialog) dialog.close();
      });
      dialog.showModal();
    }
  } catch (err) {
    if (supabaseConfigured) {
      if (actionSession !== activeSupabaseSession) return;
      try {
        await refreshSupabaseGroups(actionSession);
      } catch {
        /* Keep the explicit mutation error visible. */
      }
    }
    alertError(
      supabaseConfigured ? authErrorMessage(err) : errorMessage(err),
    );
  }
});
document.addEventListener("submit", async (e) => {
  const f = e.target;
  if (f.id !== "edit-group-form") return;
  e.preventDefault();
  const groupId = f.dataset.id;
  const g = group(groupId);
  const data = new FormData(f);
  const name = String(data.get("name") || "").trim();
  const minimumMembers = Number(data.get("minimumMembers"));
  const closesAt = String(data.get("closesAt") || "");
  const visibilityMode = String(data.get("visibilityMode") || "public");
  const today = new Date();
  const todayLocal = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const button = f.querySelector('[type="submit"]');
  try {
    if (!g || g.ownerId !== state.user?.id) throw Error(t("เฉพาะหัวหน้ากลุ่มแก้ไขได้"));
    if (!f.reportValidity()) return;
    if (!name || name.length > 70 || minimumMembers < 2 || minimumMembers > g.capacity || closesAt < todayLocal)
      throw Error(t("กรุณาตรวจสอบชื่อกลุ่ม จำนวนสมาชิก และวันปิดรับ"));
    if (! ["public", "link", "private"].includes(visibilityMode)) throw Error(t("การมองเห็นกลุ่มไม่ถูกต้อง"));
    const delivery = parseBaht(data.get("delivery"));
    if (button) button.disabled = true;
    const details = {
      ...(g.details || {}),
      minimumMembers,
      closesAt,
      visibilityMode,
      memberNote: String(data.get("memberNote") || "").trim(),
    };
    if (supabaseConfigured) {
      await updateSupabaseGroupDetails(groupId, { name, details, visibility: visibilityMode === "public" ? "public" : "link", delivery });
      if (!(await refreshSupabaseGroups(activeSupabaseSession))) return;
    } else {
      const next = changeCosts(g, state.user.id, { delivery });
      Object.assign(next, { name, details, visibility: visibilityMode === "public" ? "public" : "link" });
      updateGroup(next);
      render();
    }
    document.querySelector(".edit-group-dialog")?.close();
    alertMessage(t("บันทึกการแก้ไขกลุ่มแล้ว สมาชิกต้องยืนยันยอดรอบใหม่"));
  } catch (error) {
    const feedback = f.querySelector("[data-dialog-feedback]");
    if (feedback) {
      feedback.hidden = false;
      feedback.textContent = errorMessage(error);
    }
  } finally {
    if (button?.isConnected) button.disabled = false;
  }
});

document.addEventListener("submit", async (e) => {
  const f = e.target,
    actionSession = activeSupabaseSession;
  if (f.id === "secondhand-checkout-form") {
    e.preventDefault();
    try {
      if (f.dataset.submitted === "true" || f.dataset.submitting === "true")
        return;
      f.dataset.submitting = "true";
      const submitButton = f.querySelector('[type="submit"]');
      if (submitButton) submitButton.disabled = true;
      const product = listing(f.dataset.id),
        data = new FormData(f);
      const quantity = Number(data.get("quantity"));
      const delivery = String(data.get("delivery") || "");
      if (
        !product ||
        !Number.isInteger(quantity) ||
        quantity < 1 ||
        quantity > (Number(product.quantity) || 1)
      )
        throw new Error(t("จำนวนสินค้าไม่ถูกต้อง"));
      if (!["นัดรับ", "จัดส่ง"].includes(delivery))
        throw new Error(t("กรุณาเลือกวิธีรับสินค้า"));
      const shippingFee =
        delivery === "จัดส่ง" ? Number(product.deliveryFee) || 0 : 0;
      const amountSatang = Number(product.price) * quantity + shippingFee;
      if (!Number.isSafeInteger(amountSatang) || amountSatang < 0)
        throw new Error(t("ยอดสั่งซื้อไม่ถูกต้อง"));
      const createdAt = Date.now(),
        expiresAt = createdAt + 8 * 60 * 60 * 1000;
      const orderNumber = f.dataset.orderNumber;
      let orderId = "";
      if (supabaseConfigured) {
        const savedOrder = await createSupabaseSecondhandOrder(
          product,
          state.user,
          quantity,
          delivery,
        );
        orderId = savedOrder.id;
      } else {
        state.secondhandOrders ??= [];
        orderId = crypto.randomUUID();
        state.secondhandOrders.unshift({
          id: orderId,
          orderNumber,
          listingId: product.id,
          buyerId: state.user.id,
          sellerId: product.sellerId,
          title: product.title,
          unitPrice: product.price,
          quantity,
          shippingFee,
          total: amountSatang,
          delivery,
          status: "pending_payment",
          createdAt: new Date(createdAt).toISOString(),
          expiresAt: new Date(expiresAt).toISOString(),
        });
        save();
      }
      sessionStorage.setItem(
        "harnkhong-secondhand-pending",
        JSON.stringify({
          orderId,
          orderNumber,
          reference: f.dataset.reference,
          listingId: product.id,
          title: product.title,
          image: product.images?.[0] || product.image || "",
          condition: product.condition || "",
          description: product.description || "",
          unitPrice: Number(product.price),
          quantity,
          shippingFee,
          total: amountSatang,
          delivery,
          expiresAt,
        }),
      );
      f.dataset.submitted = "true";
      go(`/checkout/secondhand/${encodeURIComponent(product.id)}/pending`);
    } catch (error) {
      f.dataset.submitting = "false";
      const submitButton = f.querySelector('[type="submit"]');
      if (submitButton) submitButton.disabled = false;
      alertError(errorMessage(error));
    }
    return;
  }
  if (f.id === "transfer-group-form") {
    e.preventDefault();
    try {
      const id = f.dataset.id,
        memberId = new FormData(f).get("memberId"),
        g = group(id),
        dialog = f.closest("dialog");
      if (
        !g ||
        g.ownerId !== state.user?.id ||
        !g.members.includes(memberId) ||
        memberId === state.user.id
      )
        throw new Error(t("โอนหัวหน้ากลุ่มไม่ได้"));
      if (supabaseConfigured) {
        await transferSupabaseGroup(id, memberId);
        if (!(await refreshSupabaseGroups(actionSession))) return;
      } else updateGroup(transferOwner(g, state.user.id, memberId));
      dialog?.close();
      render();
      alertMessage(t("โอนหัวหน้ากลุ่มแล้ว"));
    } catch (err) {
      if (supabaseConfigured) {
        if (actionSession !== activeSupabaseSession) return;
        try {
          await refreshSupabaseGroups(actionSession);
        } catch {
          /* Keep the explicit mutation error visible. */
        }
      }
      alertError(
        supabaseConfigured ? authErrorMessage(err) : errorMessage(err),
      );
    }
    return;
  }
});
document.addEventListener("input", (e) => {
  if (e.target?.matches?.("[data-chat-search]")) {
    const query = e.target.value.trim().toLocaleLowerCase();
    const list = e.target.closest(".chat-sidebar")?.querySelector(".chat-list-scroll");
    const entries = [...(list?.querySelectorAll(".chat-entry") || [])];
    let visibleCount = 0;
    entries.forEach((entry) => {
      const matches = !query || entry.textContent.toLocaleLowerCase().includes(query);
      entry.hidden = !matches;
      if (matches) visibleCount += 1;
    });
    const empty = list?.querySelector(".chat-search-empty");
    if (empty) empty.hidden = !query || visibleCount > 0;
  }
  if (
    e.target &&
    e.target.classList &&
    e.target.classList.contains("input-error")
  ) {
    clearFieldError(e.target);
  }
});
document.addEventListener("submit", async (e) => {
  const f = e.target,
    actionSession = activeSupabaseSession;
  if (
    ["mockup-login-form", "mockup-signup-form", "mockup-address-form", "mockup-reset-password-form"].includes(
      f.id,
    )
  ) {
    e.preventDefault();
    clearFormErrors(f);
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    try {
      if (f.id === "mockup-login-form") {
        const emailEl = document.getElementById("mockup-login-email");
        const pwEl = document.getElementById("mockup-login-pw");
        const email = emailEl ? emailEl.value.trim() : "";
        const password = pwEl ? pwEl.value : "";
        let firstError = null;
        if (!email) {
          setFieldError(emailEl, t("กรุณากรอกอีเมล"));
          firstError = firstError || emailEl;
        } else if (!emailPattern.test(email) || email.length > 254) {
          setFieldError(
            emailEl,
            t("รูปแบบอีเมลไม่ถูกต้อง เช่น name@example.com"),
          );
          firstError = firstError || emailEl;
        }
        if (!password) {
          setFieldError(pwEl, t("กรุณากรอกรหัสผ่าน"));
          firstError = firstError || pwEl;
        }
        if (firstError) {
          firstError.focus();
          return;
        }
        if (supabaseConfigured) {
          const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password,
          });
          if (error) throw error;
          await syncSupabaseSession(data.session);
        } else {
          const user = demoAccount(state.profiles, email);
          if (user.address) finishAuth(user);
          else {
            tempSignupData = user;
            setMockupStep(3, f);
          }
        }
      } else if (f.id === "mockup-reset-password-form") {
        const passwordEl = document.getElementById("mockup-reset-password");
        const confirmEl = document.getElementById("mockup-reset-password-confirm");
        const password = String(passwordEl?.value || "");
        const confirm = String(confirmEl?.value || "");
        let firstError = null;
        if (password.length < 8) {
          setFieldError(passwordEl, t("รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร"));
          firstError = passwordEl;
        }
        if (!confirm) {
          setFieldError(confirmEl, t("กรุณายืนยันรหัสผ่านใหม่"));
          firstError = firstError || confirmEl;
        } else if (password !== confirm) {
          setFieldError(confirmEl, t("รหัสผ่านไม่ตรงกัน"));
          firstError = firstError || confirmEl;
        }
        if (firstError) {
          firstError.focus();
          return;
        }
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        passwordRecoveryPending = false;
        authModalActive = false;
        mockupCurrentStep = 1;
        await syncSupabaseSession(activeSupabaseSession);
        alertMessage(t("ตั้งรหัสผ่านใหม่แล้ว ตอนนี้เข้าได้ทั้งอีเมลและ Google"));
      } else if (f.id === "mockup-signup-form") {
        const nameEl = document.getElementById("mockup-signup-name");
        const emailEl = document.getElementById("mockup-signup-email");
        const pwEl = document.getElementById("mockup-signup-pw");
        const confirmEl = document.getElementById("mockup-signup-confirm-pw");
        const name = nameEl ? nameEl.value.trim() : "";
        const email = emailEl ? emailEl.value.trim() : "";
        const password = pwEl ? pwEl.value : "";
        const confirm = confirmEl ? confirmEl.value : "";
        let firstError = null;
        if (!name) {
          setFieldError(nameEl, t("กรุณากรอกชื่อ"));
          firstError = firstError || nameEl;
        }
        if (!email) {
          setFieldError(emailEl, t("กรุณากรอกอีเมล"));
          firstError = firstError || emailEl;
        } else if (!emailPattern.test(email) || email.length > 254) {
          setFieldError(
            emailEl,
            t("รูปแบบอีเมลไม่ถูกต้อง เช่น name@example.com"),
          );
          firstError = firstError || emailEl;
        }
        if (!password) {
          setFieldError(pwEl, t("กรุณากรอกรหัสผ่าน"));
          firstError = firstError || pwEl;
        } else if (password.length < 4) {
          setFieldError(pwEl, t("รหัสผ่านต้องมีอย่างน้อย 4 ตัวอักษร"));
          firstError = firstError || pwEl;
        }
        if (!confirm) {
          setFieldError(confirmEl, t("กรุณายืนยันรหัสผ่าน"));
          firstError = firstError || confirmEl;
        } else if (password !== confirm) {
          setFieldError(confirmEl, t("รหัสผ่านไม่ตรงกัน"));
          firstError = firstError || confirmEl;
        }
        if (firstError) {
          firstError.focus();
          return;
        }
        if (supabaseConfigured) {
          const { data, error } = await supabase.auth.signUp({
            email,
            password,
            options: {
              data: { display_name: name },
              emailRedirectTo: location.href,
            },
          });
          if (error) throw error;
          if (!data.session) {
            authModalActive = false;
            mockupCurrentStep = 1;
            render();
            alertMessage(t("ตรวจอีเมลเพื่อยืนยันบัญชีก่อนเข้าสู่ระบบ"));
            return;
          }
          await syncSupabaseSession(data.session);
        } else {
          tempSignupData = demoAccount(state.profiles, email, name);
          setMockupStep(3, f);
        }
      } else if (f.id === "mockup-address-form") {
        const requiredFields = [
          ["house-no", t("กรุณากรอกข้อมูลนี้")],
          ["province", t("กรุณากรอกข้อมูลนี้")],
          ["district", t("กรุณากรอกข้อมูลนี้")],
          ["subdistrict", t("กรุณากรอกข้อมูลนี้")],
          ["postal-code", t("กรุณากรอกข้อมูลนี้")],
          ["phone", t("กรุณากรอกข้อมูลนี้")],
        ];
        let firstError = null;
        for (const [fieldId, msg] of requiredFields) {
          const el = document.getElementById("mockup-" + fieldId);
          if (el) {
            const val = el.value.trim();
            if (!val) {
              setFieldError(el, msg);
              firstError = firstError || el;
            } else if (fieldId === "postal-code" && !/^[0-9]{5}$/.test(val)) {
              setFieldError(el, t("รหัสไปรษณีย์ต้องเป็นตัวเลข 5 หลัก"));
              firstError = firstError || el;
            } else if (fieldId === "phone" && !/^[0-9 -]{9,12}$/.test(val)) {
              setFieldError(el, t("กรุณากรอกเบอร์มือถือที่ถูกต้อง"));
              firstError = firstError || el;
            }
          }
        }
        if (firstError) {
          firstError.focus();
          return;
        }
        if (supabaseConfigured) {
          if (!state.user?.id)
            throw Object.assign(new Error(), { code: "orderUnauthorized" });
          const address = Object.fromEntries(
            [
              "house-no",
              "village-no",
              "province",
              "district",
              "subdistrict",
              "alley",
              "road",
              "postal-code",
              "phone",
            ].map((key) => [
              key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()),
              document.getElementById("mockup-" + key).value.trim(),
            ]),
          );
          await saveAuthenticatedAddress(state.user.id, address);
          finishAuth({ ...state.user, address });
        } else {
          if (!tempSignupData.email) {
            setMockupStep(2, f);
            return;
          }
          const address = Object.fromEntries(
            [
              "id-card",
              "house-no",
              "village-no",
              "province",
              "district",
              "subdistrict",
              "alley",
              "road",
              "postal-code",
              "phone",
            ].map((key) => [
              key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()),
              document.getElementById("mockup-" + key).value.trim(),
            ]),
          );
          finishAuth({ ...tempSignupData, address });
        }
      }
    } catch (err) {
      if (
        err?.code === "prototypeInvalidEmail" ||
        err?.message?.includes("InvalidEmail")
      ) {
        const emailEl = f.querySelector('input[type="email"]');
        if (emailEl) {
          setFieldError(
            emailEl,
            t("รูปแบบอีเมลไม่ถูกต้อง เช่น name@example.com"),
          );
          emailEl.focus();
          return;
        }
      } else if (
        err?.code === "authPasswordMismatch" ||
        err?.message?.includes("รหัสผ่านไม่ตรงกัน")
      ) {
        const confirmEl = f.querySelector("#mockup-signup-confirm-pw");
        if (confirmEl) {
          setFieldError(confirmEl, t("รหัสผ่านไม่ตรงกัน"));
          confirmEl.focus();
          return;
        }
      }
      alertError(
        supabaseConfigured ? authErrorMessage(err) : storageError(err),
      );
    }
  } else if (f.id === "payout-account-form") {
    e.preventDefault();
    if (!state.user) throw Object.assign(new Error(), { code: "orderUnauthorized" });
    const d = new FormData(f),
      method = d.get("method") === "bank" ? "bank" : "promptpay",
      digits = (value) => String(value || "").replace(/[^0-9]/g, ""),
      account = {
        method,
        accountName: String(d.get("accountName") || "").trim(),
        promptpayId: method === "promptpay" ? digits(d.get("promptpayId")) : "",
        bankName: method === "bank" ? String(d.get("bankName") || "") : "",
        accountNumber: method === "bank" ? digits(d.get("accountNumber")) : "",
      };
    try {
      if (account.accountName.length < 2) throw new Error(t("กรุณากรอกชื่อบัญชี"));
      if (method === "promptpay" && !/^(0\d{9}|\d{13})$/.test(account.promptpayId))
        throw new Error(t("PromptPay ต้องเป็นเบอร์มือถือ 10 หลัก หรือเลขบัตรประชาชน 13 หลัก"));
      if (method === "bank" && !/^\d{10,15}$/.test(account.accountNumber))
        throw new Error(t("เลขบัญชีต้องเป็นตัวเลข 10–15 หลัก"));
      if (supabaseConfigured) {
        await saveSupabasePayoutAccount(account);
        state.remotePayoutAccount = await loadSupabasePayoutAccount(state.user.id);
      } else {
        save({
          ...state,
          payoutAccounts: {
            ...(state.payoutAccounts || {}),
            [state.user.id]: { method, promptpay_id: account.promptpayId || null, bank_name: account.bankName || null, account_number: account.accountNumber || null, account_name: account.accountName, updated_at: new Date().toISOString() },
          },
        });
      }
      render();
      alertMessage(t("บันทึกบัญชีรับเงินแล้ว"));
    } catch (err) {
      alertError(supabaseConfigured ? authErrorMessage(err) : errorMessage(err));
    }
  } else if (f.id === "profile-form") {
    e.preventDefault();
    try {
      if (avatarLoading) throw Error(t("กำลังเตรียมรูป กรุณารอสักครู่"));
      const d = new FormData(f);
      if (supabaseConfigured) {
        const name = String(d.get("name") || "").trim(),
          bio = String(d.get("bio") || "").trim();
        if (!name || name.length > 70 || bio.length > 160)
          throw Object.assign(new Error(), { code: "prototypeInvalidProfile" });
        const userId = state.user.id;
        let avatarPath = state.user.avatar || null;
        let uploadedAvatarPath = null;
        if (isLocalImage(profileAvatar)) {
          const blob = await (await fetch(profileAvatar)).blob();
          uploadedAvatarPath = `${userId}/${crypto.randomUUID()}.jpg`;
          const { error: uploadError } = await supabase.storage
            .from("avatars")
            .upload(uploadedAvatarPath, blob, {
              cacheControl: "3600",
              contentType: "image/jpeg",
              upsert: false,
            });
          if (uploadError) throw uploadError;
          avatarPath = uploadedAvatarPath;
        } else if (!profileAvatar) {
          avatarPath = null;
        }
        const { data: profile, error } = await supabase
          .from("profiles")
          .update({ display_name: name, bio, avatar_url: avatarPath })
          .eq("id", userId)
          .select("display_name,bio,avatar_url")
          .single();
        if (error) {
          if (uploadedAvatarPath)
            await supabase.storage.from("avatars").remove([uploadedAvatarPath]);
          throw error;
        }
        if (state.user?.id !== userId) return;
        const oldAvatarPath = state.user.avatar;
        state = {
          ...state,
          user: {
            ...state.user,
            name: profile.display_name,
            bio: profile.bio,
            avatar: profile.avatar_url || "",
          },
        };
        if (
          oldAvatarPath &&
          oldAvatarPath !== profile.avatar_url &&
          oldAvatarPath.startsWith(`${userId}/`)
        )
          await supabase.storage.from("avatars").remove([oldAvatarPath]);
        render();
        alertMessage(t("บันทึกโปรไฟล์แล้ว"));
        return;
      }
      const user = editProfile(state.user, {
        name: d.get("name"),
        email: d.get("email"),
        bio: d.get("bio"),
        avatar: profileAvatar,
      });
      if (
        user.email &&
        Object.values(state.profiles || {}).some(
          (profile) =>
            profile.id !== user.id &&
            profile.email?.toLowerCase() === user.email,
        )
      )
        throw Error(t("อีเมลนี้ใช้กับบัญชีเดโมอื่นแล้ว"));
      save({
        ...state,
        user,
        profiles: { ...state.profiles, [user.id]: user },
      });
      render();
      alertMessage(t("บันทึกโปรไฟล์แล้ว"));
    } catch (err) {
      alertError(storageError(err));
    }
  } else if (f.id === "secondhand-search-form") {
    e.preventDefault();
    const data = new FormData(f),
      params = new URLSearchParams();
    const query = String(data.get("q") || "").trim(),
      category = String(data.get("category") || "ทั้งหมด");
    if (query) params.set("q", query);
    if (category !== "ทั้งหมด") params.set("category", category);
    const search = params.toString();
    go(`/marketplace/secondhand${search ? `?${search}` : ""}`);
  } else if (f.id === "search-form") {
    e.preventDefault();
    {
      const data = new FormData(f),
        category = data.get("category");
      go(
        "/explore?q=" +
          encodeURIComponent(String(data.get("q") || "").trim()) +
          (category ? "&category=" + encodeURIComponent(category) : ""),
      );
    }
  } else if (f.id === "create-form") {
    e.preventDefault();
    try {
      const d = new FormData(f);
      if (createGroupStep !== 3) {
        if (!validateCreatePanel(1)) return updateCreateStep(1);
        if (!validateCreatePanel(2)) return updateCreateStep(2);
        updateCreateStep(3);
        return;
      }
      if (!validateCreatePanel(1)) return updateCreateStep(1);
      if (!validateCreatePanel(2)) return updateCreateStep(2);
      if (imagesLoading) throw Error(t("กำลังเตรียมรูป กรุณารอสักครู่"));
      if (!groupImages.length) {
        updateCreateStep(1);
        alertWarning(t("เพิ่มรูปสินค้าอย่างน้อย 1 รูป"));
        f.querySelector("#group-images")?.focus();
        return;
      }
      if (!state.user)
        throw Object.assign(new Error(), { code: "orderUnauthorized" });
      const categories = [...new Set(getCreateCategoryValues(f))];
      if (!categories.length) throw new Error(t("เลือกอย่างน้อย 1 หมวดหมู่"));
      if (categories.some((category) => category.length > 60))
        throw new Error(t("ชื่อหมวดหมู่ต้องไม่เกิน 60 ตัวอักษร"));
      const productType = d.get("productType") === "digital" ? "digital" : "physical";
      const requestId = String(d.get("requestId") || crypto.randomUUID());
      const productId = `custom-${requestId}`;
      const category = categories[0] === "อื่น ๆ (ระบุชื่อเอง)"
        ? String(d.get("otherCategory") || "").trim()
        : categories[0];
      const productDetails = {
        type: productType,
        url: String(d.get("productUrl") || "").trim(),
        platform: String(d.get("digitalPlatform") || ""),
        serviceType: String(d.get("digitalService") || ""),
        duration: String(d.get("usageDuration") || "").trim(),
        sharedSeats: Number(d.get("sharedSeats") || 0),
        sharingConditions: String(d.get("sharingConditions") || "").trim(),
      };
      const product = {
        id: productId,
        sellerId: state.user.id,
        sellerName: state.user.name,
        title: String(d.get("productTitle") || "").trim(),
        category,
        kind: productType === "digital" ? "บริการ" : "สินค้า",
        price: parseBaht(d.get("product")),
        art: "custom",
        mark: productType === "digital" ? "" : "หาร",
        description: String(d.get("productDescription") || "").trim(),
        terms: productType === "digital"
          ? `${productDetails.platform} · ${productDetails.serviceType} · ${productDetails.duration}${productDetails.sharingConditions ? ` · ${productDetails.sharingConditions}` : ""}`
          : "",
        images: [...groupImages],
        productDetails,
      };
      const visibilityMode = String(d.get("visibilityMode") || "public");
      const visibility = visibilityMode === "public" ? "public" : "link";
      const groupDetails = {
        minimumMembers: Number(d.get("minimumMembers")),
        closesAt: String(d.get("closesAt") || ""),
        memberNote: String(d.get("memberNote") || "").trim(),
        visibilityMode,
        product: productDetails,
        shippingTotal: productType === "physical" ? parseBaht(d.get("shippingTotal") || "0") : 0,
        deliveryMethod: productType === "digital" ? "digital" : String(d.get("deliveryMethod") || "ship_to_owner"),
        pickupLocation: String(d.get("pickupLocation") || "").trim(),
        digitalHandoff: String(d.get("digitalHandoff") || "").trim(),
      };
      const billing = d.get("billing") === "monthly" ? "monthly" : "one_time";
      if (!supabaseConfigured) {
        const plan = effectivePlan(state.subscriptions?.[state.user.id]);
        // Seeded demo groups do not count; only groups this person opened with the form.
        const open = state.groups.filter((g) => g.openedWithForm && g.ownerId === state.user.id && g.status !== "cancelled").length;
        if (open >= groupLimit(state.subscriptions?.[state.user.id]))
          throw new Error(plan === "plus" ? t("เปิดกลุ่มได้สูงสุด 5 กลุ่มในแพ็กเกจ Plus") : t("แพ็กเกจ Free เปิดกลุ่มได้ 2 กลุ่ม อัปเกรดเป็น Plus เพื่อเปิดได้ 5 กลุ่ม"));
      }
      if (supabaseConfigured) {
        const groupId = await createSupabaseGroup({
          product,
          details: { ...groupDetails, billing },
          name: d.get("name"),
          categories,
          images: groupImages,
          visibility,
          capacity: Number(d.get("capacity")),
          price: product.price,
          delivery: formCosts(d).delivery,
          requestId,
        });
        if (!(await refreshSupabaseGroups(actionSession))) return;
        groupImages = [];
        selectedCreateCategories = [];
        createGroupStep = 1;
        go(`/groups/${groupId}`);
        alertMessage(t("สร้างกลุ่มแล้ว"));
        return;
      }
      const g = createGroup({
        id: "g" + Date.now(),
        listingId: productId,
        name: d.get("name"),
        ownerId: state.user.id,
        visibility,
        capacity: Number(d.get("capacity")),
        costs: formCosts(d),
        billing,
      });
      const groupCategories = categories.includes("อื่น ๆ (ระบุชื่อเอง)")
        ? [...categories.filter((item) => item !== "อื่น ๆ (ระบุชื่อเอง)"), category]
        : categories;
      g.category = groupCategories[0];
      g.categories = groupCategories;
      g.images = [...groupImages];
      g.openedWithForm = true;
      Object.assign(g, groupDetails);
      const notification = {
        id: crypto.randomUUID(),
        recipient: state.user.id,
        title: t("สร้างกลุ่มแล้ว"),
        body: t("ชวนสมาชิกเข้าร่วมเพื่อเริ่มหารค่าใช้จ่าย"),
        href: `/groups/${g.id}`,
        read: false,
        at: new Date().toISOString(),
      };
      save({
        ...state,
        customListings: [product, ...(state.customListings || [])],
        groups: [g, ...state.groups],
        notifications: [notification, ...state.notifications],
      });
      groupImages = [];
      selectedCreateCategories = [];
      createGroupStep = 1;

      go(`/groups/${g.id}`);
      alertMessage(t("สร้างกลุ่มแล้ว"));
    } catch (err) {
      const errorBox = f.querySelector("#create-error");
      const message = supabaseConfigured ? authErrorMessage(err) : storageError(err);
      if (errorBox && createGroupStep === 3) {
        errorBox.textContent = message;
        errorBox.hidden = false;
      }
      alertError(message);
    }
  } else if (f.id === "group-chat-form") {
    e.preventDefault();
    const id = f.dataset.id,
      body = (new FormData(f).get("body") || "").trim();
    if (!body) return;
    try {
      const myMsg = await sendGroupMessage(id, state.user, body);
      const current = supabaseConfigured
        ? groupMessageCache.get(id) || []
        : getGroupMessages(id);
      const next = [...current, myMsg];
      if (supabaseConfigured) groupMessageCache.set(id, next);
      else rememberGroupMessages(id, next);
      render();
    } catch (error) {
      alertError(
        supabaseConfigured ? authErrorMessage(error) : errorMessage(error),
      );
    }
  } else if (f.id === "chat-form") {
    e.preventDefault();
    const id = f.dataset.id,
      body = new FormData(f).get("body").trim();
    if (!body) return;
    if (f.dataset.marketplace === "true") {
      try {
        if (f.dataset.conversation && supabaseConfigured) {
          const message = await sendSecondhandMessage(
            f.dataset.conversation,
            state.user,
            body,
          );
          const cacheKey = secondhandChatCacheKey(f.dataset.conversation);
          secondhandChatMessages.set(cacheKey, [
            ...(secondhandChatMessages.get(cacheKey) || []),
            message,
          ]);
        } else {
          state.conversations[id] ??= [];
          state.conversations[id].push({
            from: "me",
            body,
            at: new Date().toISOString(),
          });
          state.conversations[id].push({
            from: "seller",
            body: t(
              "ขอบคุณที่ติดต่อค่ะ นี่คือคำตอบจำลอง กรุณาตรวจสอบรายละเอียดสินค้าก่อนตกลงจริง",
            ),
            at: new Date().toISOString(),
          });
          save();
        }
        render();
      } catch (error) {
        alertError(
          supabaseConfigured ? authErrorMessage(error) : errorMessage(error),
        );
      }
      return;
    }
    state.conversations[id] ??= [];
    state.conversations[id].push({
      from: "me",
      body,
      at: new Date().toISOString(),
    });
    state.conversations[id].push({
      from: "seller",
      body: t(
        "ขอบคุณที่ติดต่อค่ะ นี่คือคำตอบจำลอง กรุณาตรวจสอบรายละเอียดสินค้าก่อนตกลงจริง",
      ),
      at: new Date().toISOString(),
    });
    save();
    notice(
      t("ผู้ขายตอบข้อความ"),
      t("มีข้อความตอบกลับจำลองจาก {name}", { name: seller(id).name }),
      `/chat/${id}`,
    );
    render();
  } else if (
    ["order-form", "shipment-form", "dispute-form", "resolution-form"].includes(
      f.id,
    )
  ) {
    e.preventDefault();
    try {
      const id = f.dataset.id,
        d = new FormData(f),
        current = orderFor(id);
      let next,
        feedback = t("บันทึกสถานะคำสั่งซื้อเดโมแล้ว");
      if (f.id === "order-form") {
        const g = group(id),
          options = { hours: Number(d.get("hours")) };
        if (!confirm(t("สร้างคำสั่งซื้อเดโมและล็อกสมาชิกกับยอดที่ยืนยันแล้ว?")))
          return;
        next = current
          ? activateOrder(current, g, listing(g.listingId), state.user, options)
          : createOrder(g, listing(g.listingId), state.user, options);
      } else if (f.id === "shipment-form") {
        next = updateShipment(current, state.user, {
          carrier: d.get("carrier"),
          trackingNumber: d.get("trackingNumber"),
          url: d.get("url"),
        });
      } else if (f.id === "dispute-form") {
        if (
          !confirm(
            t(
              "ยืนยันส่งรายงาน? คำสั่งซื้อจะหยุดรอแก้ไขข้อพิพาท และไม่มีการคืนเงินอัตโนมัติ",
            ),
          )
        )
          return;
        next = openDispute(current, state.user, {
          reason: d.get("reason"),
          description: d.get("description"),
          evidence: d.get("evidence"),
        });
        feedback = t("เปิดข้อพิพาทแล้ว คำสั่งซื้อหยุดรอการแก้ไข");
      } else {
        if (
          !confirm(t("ยืนยันเสนอผลลัพธ์? ต้องรอผู้รายงานยอมรับก่อนปิดเรื่อง"))
        )
          return;
        next = proposeResolution(current, state.user, f.dataset.dispute, {
          decision: d.get("decision"),
          note: d.get("note"),
        });
        feedback = t("เสนอผลลัพธ์แล้ว รอผู้รายงานยอมรับ");
      }
      orderChanged(next, feedback);
    } catch (err) {
      alertError(errorMessage(err));
    }
  } else if (f.id === "product-form") {
    e.preventDefault();
    try {
      const d = new FormData(f),
        delivery = d.get("delivery"),
        area = String(d.get("area") || "").trim(),
        contact = String(d.get("contact") || "").trim(),
        latitude = d.get("latitude"),
        longitude = d.get("longitude"),
        marketAddress = String(d.get("marketAddress") || "").trim();
      if (imagesLoading) throw Error(t("กำลังเตรียมรูป กรุณารอสักครู่"));
      if (!listingImages.length)
        throw Error(t("เพิ่มรูปสินค้าอย่างน้อย 1 รูป"));
      const coordinates =
        latitude && longitude
          ? { lat: Number(latitude), lng: Number(longitude) }
          : null;
      if (delivery !== "จัดส่ง" && !coordinates)
        throw Error(t("เลือกตำแหน่งตลาดบนแผนที่ก่อนลงประกาศ"));
      if (delivery !== "จัดส่ง" && !marketAddress)
        throw Error(t("กำลังตรวจสอบพิกัด รอสักครู่แล้วลองลงประกาศอีกครั้ง"));
      const quantity = Number(d.get("quantity") || 1);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 9999)
        throw Error(t("กรุณาระบุจำนวนสินค้า 1 ถึง 9999 ชิ้น"));
      const editingId = f.dataset.editingId || "";
      const p = {
        id: editingId || "p" + Date.now(),
        title: String(d.get("title") || "").trim(),
        category: d.get("category"),
        kind: "สินค้า",
        listingType: "secondhand",
        condition: d.get("condition"),
        quantity,
        delivery,
        deliveryFee:
          delivery !== "นัดรับ" ? parseBaht(d.get("deliveryFee") || "0") : 0,
        area,
        marketAddress,
        marketCoordinates: coordinates,
        contact,
        images: [...listingImages],
        price: parseBaht(d.get("price")),
        sellerId: sellerIdFor(state.user),
        art: "custom",
        mark: "มือ2",
        description: String(d.get("description") || "").trim(),
        terms: `${delivery}${area ? ` · ${area}` : ""}`,
      };
      p.existingImages = editingId
        ? JSON.parse(f.dataset.existingImages || "[]")
        : [];
      p.sellerId ||= state.user.id;
      if (
        !p.title ||
        !p.description ||
        !p.condition ||
        !p.contact ||
        (delivery !== "จัดส่ง" && !area)
      )
        throw Error(t("กรุณากรอกข้อมูลที่จำเป็นให้ครบ"));
      if (supabaseConfigured) {
        const savedListing = editingId
          ? await updateSupabaseSecondhandListing(editingId, p, state.user)
          : await createSupabaseSecondhandListing(p, state.user);
        state = {
          ...state,
          remoteListings: [
            savedListing,
            ...state.remoteListings.filter(
              (item) => item.id !== savedListing.id,
            ),
          ],
        };
      } else if (editingId) {
        save({
          ...state,
          customListings: state.customListings.map((item) =>
            item.id === editingId ? { ...item, ...p } : item,
          ),
        });
      } else save({ ...state, customListings: [p, ...state.customListings] });
      listingImages = [];
      listingMap?.remove();
      listingMap = null;
      listingMapMarker = null;
      listingMapReady = false;
      go(`/products/${p.id}`);
      alertMessage(t(editingId ? "บันทึกการแก้ไขแล้ว" : "ลงประกาศขายแล้ว"));
    } catch (err) {
      alertError(
        supabaseConfigured
          ? secondhandSaveErrorMessage(err)
          : storageError(err),
      );
    }
  }
});
document.addEventListener("input", (e) => {
  if (e.target.closest("#secondhand-checkout-form")) {
    const form = e.target.closest("#secondhand-checkout-form");
    updateSecondhandCheckoutSummary(form);
    void refreshSecondhandCheckoutQr(form);
  }
  if (
    e.target.name === "trackingNumber" &&
    e.target.closest("#shipment-form")
  ) {
    const form = e.target.closest("#shipment-form");
    const carrier = form?.querySelector('[name="carrier"]')?.value;
    const urlInput = form?.querySelector('[name="url"]');
    const tracking = e.target.value.trim();
    if (
      urlInput &&
      tracking &&
      (!urlInput.value || urlInput.dataset.autoFilled)
    ) {
      if (carrier === "Flash Express") {
        urlInput.value = `https://www.flashexpress.co.th/tracking/?se=${encodeURIComponent(tracking)}`;
        urlInput.dataset.autoFilled = "1";
      } else if (carrier === "Kerry Express") {
        urlInput.value = `https://th.kerryexpress.com/th/track/?track=${encodeURIComponent(tracking)}`;
        urlInput.dataset.autoFilled = "1";
      } else if (carrier === "ไปรษณีย์ไทย EMS") {
        urlInput.value = `https://track.thailandpost.co.th/?trackNumber=${encodeURIComponent(tracking)}`;
        urlInput.dataset.autoFilled = "1";
      } else if (carrier === "J&T Express") {
        urlInput.value = `https://www.jtexpress.co.th/index/query/gzquery.html?bills=${encodeURIComponent(tracking)}`;
        urlInput.dataset.autoFilled = "1";
      }
    }
  }
  if (e.target.closest("#create-form")) updatePreview();
  if (e.target.closest("#product-form")) updateListingPreview();
  if (
    e.target.name === "area" &&
    e.target.closest("#product-form") &&
    e.target.dataset.pinnedQuery !== e.target.value.trim()
  ) {
    const form = e.target.closest("form");
    form.querySelector('[name="latitude"]').value = "";
    form.querySelector('[name="longitude"]').value = "";
    form.querySelector('[name="marketAddress"]').value = "";
    listingMapMarker?.remove();
    listingMapMarker = null;
    const mapStatus = form.querySelector("#listing-map-status");
    if (mapStatus)
      mapStatus.textContent = t("กดค้นหาบนแผนที่เพื่อปักตำแหน่งของชื่อตลาดนี้");
    updateListingPreview();
  }
  if (e.target.name === "bio" && e.target.closest("#profile-form"))
    document.querySelector("#bio-counter").textContent =
      `${e.target.value.length} / 160`;
  if (e.target.id === "mockup-id-card") {
    let val = e.target.value.replace(/\D/g, "");
    if (val.length > 13) val = val.substring(0, 13);
    let f = "";
    if (val.length > 0) f += val.substring(0, 1);
    if (val.length > 1) f += "-" + val.substring(1, 5);
    if (val.length > 5) f += "-" + val.substring(5, 10);
    if (val.length > 10) f += "-" + val.substring(10, 12);
    if (val.length > 12) f += "-" + val.substring(12, 13);
    e.target.value = f;
  }
  if (e.target.id === "mockup-phone") {
    let val = e.target.value.replace(/\D/g, "");
    if (val.length > 10) val = val.substring(0, 10);
    let f = "";
    if (val.length > 0) f += val.substring(0, 3);
    if (val.length > 3) f += "-" + val.substring(3, 6);
    if (val.length > 6) f += "-" + val.substring(6, 10);
    e.target.value = f;
  }
});

function authErrorMessage(error) {
  const code = error?.code || "";
  const message = String(error?.message || "").toLowerCase();
  if (code === "PGRST204" || code === "42703" || message.includes("column groups.details") || message.includes("column products.details"))
    return t("ฐานข้อมูลยังไม่รองรับข้อมูลกลุ่มใหม่ กรุณาติดตั้ง migration ล่าสุดแล้วโหลดหน้านี้ใหม่");
  if (error?.code === "secondhandListingDeleteNotAllowed")
    return t("ลบประกาศไม่สำเร็จ ตรวจสอบสิทธิ์ผู้ขายแล้วลองอีกครั้ง");
  if (message.includes("boosted_until"))
    return t(
      "ฟีเจอร์ Boost ยังไม่พร้อม กรุณารัน migration ตลาดมือสองล่าสุดของ Supabase",
    );
  if (
    message.includes("secondhand_conversations") ||
    message.includes("secondhand_messages") ||
    message.includes("secondhand_orders")
  )
    return t(
      "ฐานข้อมูลแชทหรือคำสั่งซื้อมือสองยังไม่พร้อม กรุณารัน migration ล่าสุดของ Supabase",
    );
  if (error?.code === "groupTotalMismatch")
    return t("ข้อมูลยอดจากฐานข้อมูลไม่ตรงกับสูตรแอป กรุณาติดต่อผู้ดูแล");
  if (
    code === "PGRST202" &&
    (message.includes("remove_group_member") ||
      message.includes("delete_group"))
  )
    return t(
      "ฐานข้อมูลยังไม่มีระบบจัดการห้อง กรุณารัน migration ล่าสุดของ Supabase",
    );
  if (message.includes("group_locked"))
    return t(
      "ฐานข้อมูลยังใช้กติกาเตะสมาชิกเวอร์ชันเก่า กรุณารัน migration ล่าสุดของ Supabase",
    );
  if (
    error?.code === "groupHasMembers" ||
    message.includes("group_has_members")
  )
    return t("ลบห้องได้เฉพาะเมื่อไม่มีสมาชิกคนอื่นอยู่");
  if (
    error?.code === "groupTotalOutOfRange" ||
    message.includes("group_total_out_of_range")
  )
    return t("ยอดรวมเกินขอบเขตที่รองรับ");
  if (message.includes("invite_invalid"))
    return t("คำเชิญไม่ถูกต้องหรือหมดอายุ");
  if (message.includes("full_group")) return t("กลุ่มเต็มแล้ว");
  if (message.includes("invalid_promptpay")) return t("PromptPay ต้องเป็นเบอร์มือถือ 10 หลัก หรือเลขบัตรประชาชน 13 หลัก");
  if (message.includes("invalid_account_number")) return t("เลขบัญชีต้องเป็นตัวเลข 10–15 หลัก");
  if (message.includes("invalid_account_name")) return t("กรุณากรอกชื่อบัญชี");
  if (message.includes("set_my_payout_account") || message.includes("payout_accounts"))
    return t("ฐานข้อมูลยังไม่รองรับบัญชีรับเงิน กรุณารัน migration 20261120140000_owner_payout_accounts.sql");
  if (message.includes("promo_invalid")) return t("โค้ดไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง");
  if (message.includes("promo_already_used")) return t("คุณใช้โค้ดนี้ไปแล้ว");
  if (message.includes("promo_sold_out")) return t("โค้ดนี้ครบ 50 สิทธิ์แล้ว");
  if (message.includes("payment_not_verified")) return t("ยืนยันรับสินค้าได้หลังแอดมินตรวจการชำระของคุณแล้ว");
  if (message.includes("owner_receives_payout")) return t("เจ้าของกลุ่มไม่ต้องโอน ระบบจะโอนเงินจากสมาชิกให้หลังหักค่าคอม 2%");
  if (message.includes("group_limit_reached"))
    return t("เปิดกลุ่มได้สูงสุดตามแพ็กเกจแล้ว (Free 2 กลุ่ม, Plus 5 กลุ่ม)");
  if (message.includes("already_confirmed")) return t("คุณยืนยันรอบนี้แล้ว");
  if (message.includes("not_in_cycle")) return t("คุณเริ่มจ่ายในรอบถัดไป");
  if (message.includes("stale_cycle")) return t("รอบเปลี่ยนแล้ว กรุณาโหลดข้อมูลล่าสุด");
  if (message.includes("cycle_started")) return t("กลุ่มเริ่มรอบไปแล้ว");
  if (message.includes("confirm_first")) return t("กรุณายืนยันยอดเดือนนี้ก่อนแจ้งโอน");
  if (message.includes("payment_pending")) return t("มีสลิปที่รอตรวจอยู่แล้ว");
  if (message.includes("already_member")) return t("คุณเป็นสมาชิกกลุ่มนี้แล้ว");
  if (message.includes("owner_must_transfer"))
    return t("หัวหน้ากลุ่มต้องโอนสิทธิ์ก่อนออก");
  if (message.includes("owner_only"))
    return t("เฉพาะหัวหน้ากลุ่มแก้ไขค่าใช้จ่ายได้");
  if (message.includes("stale_revision"))
    return t("ยอดมีการเปลี่ยน กรุณาโหลดข้อมูลล่าสุด");
  if (message.includes("failed to fetch") || message.includes("networkerror"))
    return t(
      "เชื่อมต่อ Supabase ไม่สำเร็จ กรุณาตรวจอินเทอร์เน็ตแล้วลองอีกครั้ง",
    );
  if (code === "authPasswordMismatch")
    return t("รหัสผ่านและการยืนยันรหัสผ่านไม่ตรงกัน");
  if (code === "googleProviderDisabled")
    return t("ยังไม่ได้เปิดใช้ Google OAuth");
  if (
    code === "invalid_credentials" ||
    message.includes("invalid login credentials")
  )
    return t("อีเมลหรือรหัสผ่านไม่ถูกต้อง");
  if (
    code === "user_already_exists" ||
    message.includes("user already registered")
  )
    return t("อีเมลนี้มีบัญชีแล้ว กรุณาเข้าสู่ระบบ");
  if (code === "email_not_confirmed" || message.includes("email not confirmed"))
    return t("กรุณายืนยันอีเมลก่อนเข้าสู่ระบบ");
  if (code === "weak_password" || message.includes("password should be"))
    return t("รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร");
  if (error?.code === "orderUnauthorized") return t("orderUnauthorized");
  // Payment slips (group checkout, monthly cycles, Plus).
  if (code === "PGRST202" || message.includes("could not find the function"))
    return t("ฐานข้อมูลยังไม่มีฟังก์ชันที่ใช้ กรุณารัน migration ล่าสุดของ Supabase");
  if (message.includes("bucket not found"))
    return t("ยังไม่มีที่เก็บสลิปใน Supabase กรุณารัน migration ล่าสุด");
  if (message.includes("row-level security") || message.includes("row level security"))
    return t("ไม่มีสิทธิ์อัปโหลดสลิปของยอดรอบนี้ กรุณายืนยันยอดล่าสุดก่อนแล้วลองใหม่");
  if (message.includes("not_approved_group_member"))
    return t("กรุณายืนยันยอดรอบปัจจุบันก่อนแจ้งโอน");
  if (message.includes("invalid_transfer_time")) return t("กรุณาระบุวันและเวลาที่โอนให้ถูกต้อง");
  if (message.includes("payment_slip_missing") || message.includes("invalid_payment_slip_path"))
    return t("อัปโหลดสลิปไม่สำเร็จ กรุณาเลือกไฟล์ใหม่แล้วลองอีกครั้ง");
  if (message.includes("group_unavailable")) return t("ไม่พบกลุ่มนี้ หรือกลุ่มถูกยกเลิกแล้ว");
  if (message.includes("payload too large") || message.includes("maximum allowed size"))
    return t("ไฟล์ใหญ่เกินไป กรุณาใช้รูปไม่เกิน 8 MB");
  // Unknown: keep the real reason visible so it can be reported.
  const detail = [error?.code, error?.message].filter(Boolean).join(": ").slice(0, 160);
  return detail ? `${t("เกิดข้อผิดพลาด กรุณาลองใหม่")} (${detail})` : t("เกิดข้อผิดพลาด กรุณาลองใหม่");
}

function secondhandSaveErrorMessage(error) {
  const code = error?.code || "";
  const message = String(error?.message || "").toLowerCase();
  if (
    code === "PGRST205" ||
    message.includes("secondhand_listings") ||
    message.includes("bucket not found") ||
    message.includes("secondhand-listings")
  ) {
    return t(
      "ระบบฐานข้อมูลยังไม่ได้เปิดใช้การบันทึกตลาดมือสอง กรุณารัน migration ล่าสุดของ Supabase",
    );
  }
  if (message.includes("row-level security") || code === "42501")
    return t("ไม่มีสิทธิ์บันทึกประกาศ กรุณาเข้าสู่ระบบใหม่แล้วลองอีกครั้ง");
  return authErrorMessage(error);
}

async function fetchSupabaseState(authUser) {
  const inviteToken = new URLSearchParams(location.search).get("invite");
  const routeGroup = location.pathname.match(
    /^\/groups\/([^/]+)(?:\/join)?$/,
  )?.[1];
  const user = authUser ? await loadAuthenticatedUser(authUser) : null;
  let snapshot;
  try {
    snapshot = await loadSupabaseGroups();
    // Months roll over lazily: close ended cycles of my monthly groups, then reload once.
    const nowIso = new Date().toISOString();
    const due = authUser
      ? snapshot.groups.filter((g) => g.billing === "monthly" && g.members.includes(authUser.id) && currentCycle(g)?.end <= nowIso)
      : [];
    if (due.length) {
      await Promise.all(due.map((g) => syncSupabaseCycles(g.id)));
      snapshot = await loadSupabaseGroups();
    }
    snapshot.subscription = authUser ? await loadSupabaseSubscription().catch(() => null) : null;
    snapshot.payoutAccount = authUser ? await loadSupabasePayoutAccount(authUser.id).catch(() => null) : null;
  } catch (error) {
    const loadError = new Error(error?.message || t("โหลดข้อมูลกลุ่มไม่สำเร็จ"), {
      cause: error,
    });
    loadError.name = error?.name || "GroupLoadError";
    loadError.code = error?.code;
    loadError.details = error?.details;
    loadError.hint = error?.hint;
    loadError.authenticatedUser = user;
    throw loadError;
  }
  if (authUser && inviteToken && routeGroup) {
    try {
      const invite = await resolveSupabaseInvite(
        routeGroup,
        inviteToken,
        authUser.id,
      );
      if (invite) {
        snapshot.groups = [
          invite.group,
          ...snapshot.groups.filter((group) => group.id !== invite.group.id),
        ];
        Object.assign(snapshot.names, invite.names);
      }
    } catch (error) {
      if (
        !String(error?.message || "")
          .toLowerCase()
          .includes("invite_invalid")
      )
        throw error;
    }
  }
  return { user, snapshot };
}

async function refreshSupabaseGroups(session = activeSupabaseSession) {
  if (!supabaseConfigured) return;
  if (session !== activeSupabaseSession) return;
  const snapshot = await syncSupabaseSession(session);
  if (groupsError) throw groupsError;
  return snapshot;
}

function beginSupabaseSession(session) {
  authSessionSync.invalidate();
  activeSupabaseSession = session;
  if ((state.user?.id || null) !== (session?.user?.id || null)) {
    state = { ...state, user: null, groups: [], profiles: {} };
    secondhandConversationRows = [];
    secondhandConversationListLoadingFor = null;
    secondhandConversationListLoadedFor = null;
    tempSignupData = {};
    authModalActive = false;
    mockupCurrentStep = 1;
  }
  groupsLoading = true;
  groupsError = null;
  render();
}

if (supabaseConfigured) {
  authSessionSync = createAuthSessionSync({
    loadUser: fetchSupabaseState,
    applyUser: (result) => {
      state = {
        ...state,
        user: result.user,
        groups: result.snapshot.groups,
        profiles: result.snapshot.names,
        remoteListings: result.snapshot.listings,
        remoteSellers: result.snapshot.sellers,
        remoteSubscription: result.snapshot.subscription || null,
        remotePayoutAccount: result.snapshot.payoutAccount || null,
      };
      groupsLoading = false;
      groupsError = null;
      if (passwordRecoveryPending) {
        passwordRecoveryPending = false;
        authModalActive = true;
        mockupCurrentStep = 4;
        render();
        return result.snapshot;
      }
      if (result.user && !result.user.address) {
        tempSignupData = result.user;
        mockupCurrentStep = 3;
        authModalActive = true;
        render();
        return result.snapshot;
      }
      if (
        result.user &&
        (["/login", "/register"].includes(location.pathname) ||
          (!location.pathname.startsWith("/admin") &&
            Boolean(sessionStorage.getItem("harn-return"))))
      )
        finishAuth(result.user);
      else {
        if (!result.user) {
          authModalActive = false;
          tempSignupData = {};
        }
        render();
      }
      return result.snapshot;
    },
    onError: (error) => {
      console.error("Unable to load Supabase groups", error);
      const authenticatedUser = error?.authenticatedUser || null;
      state = {
        ...state,
        user: authenticatedUser,
        groups: [],
        profiles: authenticatedUser
          ? {
              ...state.profiles,
              [authenticatedUser.id]: {
                id: authenticatedUser.id,
                name: authenticatedUser.name,
              },
            }
          : {},
      };
      groupsLoading = false;
      groupsError = error;
      render();
      alertError(authErrorMessage(error));
    },
  });
  syncSupabaseSession = (session) => {
    beginSupabaseSession(session);
    return authSessionSync.sync(session);
  };
}

if (typeof document !== "undefined") {
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && mobileMenuOpen) {
      mobileMenuOpen = false;
      document.body.classList.remove("mobile-menu-open");
      render();
    }
  });
  window.addEventListener(
    "scroll",
    () => {
      const header = document.querySelector(".site-header");
      if (!header) return;
      header.classList.toggle("is-scrolled", window.scrollY > 10);
    },
    { passive: true },
  );
  window.addEventListener("popstate", render);
}
render();
if (supabaseConfigured) {
  refreshAuthProviders().then(() => {
    if (
      authModalActive ||
      location.pathname === "/login" ||
      location.pathname === "/register"
    )
      render();
  });
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY") passwordRecoveryPending = true;
    beginSupabaseSession(session);
    const sync = () => {
      if (activeSupabaseSession === session) void authSessionSync.sync(session);
    };
    if (event !== "INITIAL_SESSION") setTimeout(sync, 0);
    else sync();
  });
}
