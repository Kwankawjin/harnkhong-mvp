Warning: truncated output (original token count: 100158)
Total output lines: 6432

import "./style.css";
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
} from "./domain.js";
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
  deleteSupabaseGroup,
  getSupabaseInvite,
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
    if (g.orderId || g.costs?.mode === "per_member_v2") return g;
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
const subscriptionKey = "harnkhong-subscription-v1";
function subscriptionFor(userId = state.user?.id) {
  try {
    return (
      JSON.parse(localStorage.getItem(subscriptionKey) || "{}")[userId] ||
      "free"
    );
  } catch {
    return "free";
  }
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

 …84158 tokens truncated…      ...state.user,
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
      alertMessage(storageError(err));
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
        alertMessage(t("เพิ่มรูปสินค้าอย่างน้อย 1 รูป"));
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
      if (supabaseConfigured) {
        const groupId = await createSupabaseGroup({
          product,
          details: groupDetails,
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
      });
      const groupCategories = categories.includes("อื่น ๆ (ระบุชื่อเอง)")
        ? [...categories.filter((item) => item !== "อื่น ๆ (ระบุชื่อเอง)"), category]
        : categories;
      g.category = groupCategories[0];
      g.categories = groupCategories;
      g.images = [...groupImages];
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
      if (errorBox && createGroupStep === 3) {
        errorBox.textContent = storageError(err);
        errorBox.hidden = false;
      } else alertMessage(storageError(err));
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
      alertMessage(
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
        alertMessage(
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
      alertMessage(errorMessage(err));
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
      alertMessage(
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
  return t("เกิดข้อผิดพลาด กรุณาลองใหม่");
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
      alertMessage(authErrorMessage(error));
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

