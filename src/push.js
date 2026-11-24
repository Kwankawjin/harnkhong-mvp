/**
 * Web Push on this device: service worker registration, subscribe/unsubscribe, and keeping the
 * subscription tied to the signed-in account. The VAPID private key never reaches the browser;
 * the public key comes from the `push` Edge Function.
 *
 * Permission is only ever requested from a button the person pressed (enablePush).
 */

/** What this browser can do. Pure, so it can be tested with a fake environment. */
export function pushEnvironment(env = globalThis) {
  const nav = env.navigator || {};
  const ua = String(nav.userAgent || "");
  const ios = /iPad|iPhone|iPod/.test(ua) || (nav.platform === "MacIntel" && nav.maxTouchPoints > 1);
  const standalone =
    nav.standalone === true || Boolean(env.matchMedia?.("(display-mode: standalone)")?.matches);
  const secure = env.isSecureContext !== false;
  const supported =
    secure && "serviceWorker" in nav && "PushManager" in env && "Notification" in env;
  return { ios, standalone, secure, supported, android: /Android/i.test(ua) };
}

/**
 * The state shown to the person:
 * unsupported | needs-install (iPhone/iPad not opened from the Home Screen) | denied | off | on
 */
export function pushStatus(environment, permission, hasSubscription) {
  if (environment.ios && !environment.standalone) return "needs-install";
  if (!environment.supported) return "unsupported";
  if (permission === "denied") return "denied";
  return permission === "granted" && hasSubscription ? "on" : "off";
}

/** Short, non-identifying description of this device, stored with the subscription. */
export function deviceInfo(environment, ua = globalThis.navigator?.userAgent || "") {
  const browser = /Edg\//.test(ua) ? "Edge" : /SamsungBrowser/.test(ua) ? "Samsung Internet"
    : /CriOS|Chrome\//.test(ua) ? "Chrome" : /FxiOS|Firefox\//.test(ua) ? "Firefox"
    : /Safari\//.test(ua) ? "Safari" : "Browser";
  const platform = environment.ios ? "ios" : environment.android ? "android"
    : /Windows/.test(ua) ? "windows" : /Mac OS X/.test(ua) ? "macos" : /Linux/.test(ua) ? "linux" : "other";
  return { platform, browser, standalone: environment.standalone };
}

export function urlBase64ToUint8Array(value) {
  const base64 = (value + "=".repeat((4 - (value.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** Plain-object form of a PushSubscription (keys are base64url). */
export function subscriptionKeys(subscription) {
  const json = subscription?.toJSON?.() || {};
  return { endpoint: json.endpoint, p256dh: json.keys?.p256dh, auth: json.keys?.auth };
}

let registration = null;

/** Register the service worker on page load. Never asks for permission. */
export async function registerServiceWorker() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    return registration;
  } catch (error) {
    console.warn("service worker registration failed", error);
    return null;
  }
}

async function readyRegistration() {
  if (!("serviceWorker" in navigator)) return null;
  return registration || (await registerServiceWorker()) || navigator.serviceWorker.ready;
}

export async function currentSubscription() {
  const reg = await readyRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

export async function currentPushStatus() {
  const environment = pushEnvironment();
  if (!environment.supported) return pushStatus(environment, "default", false);
  const subscription = await currentSubscription().catch(() => null);
  return pushStatus(environment, Notification.permission, Boolean(subscription));
}

function fail(code) {
  return Object.assign(new Error(code), { code });
}

async function invokePush(supabase, action) {
  const { data, error } = await supabase.functions.invoke("push", { body: { action } });
  if (error) {
    let detail = "";
    try { detail = (await error.context?.json?.())?.error || ""; } catch { /* no body */ }
    throw fail(detail === "push_not_configured" ? "push_not_configured" : "push_server_error");
  }
  return data;
}

async function saveSubscription(supabase, subscription, environment) {
  const keys = subscriptionKeys(subscription);
  const { error } = await supabase.rpc("save_push_subscription", {
    p_endpoint: keys.endpoint,
    p_p256dh: keys.p256dh,
    p_auth: keys.auth,
    p_device_info: deviceInfo(environment),
  });
  if (error) throw fail("push_save_failed");
}

/** Turn notifications on for this device. Call only from a click handler. */
export async function enablePush(supabase) {
  const environment = pushEnvironment();
  if (environment.ios && !environment.standalone) throw fail("push_needs_install");
  if (!environment.supported) throw fail("push_unsupported");
  // Ask first, while still inside the click (iOS requires the user gesture).
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw fail(permission === "denied" ? "push_denied" : "push_dismissed");
  const reg = await readyRegistration();
  if (!reg) throw fail("push_unsupported");
  const { publicKey } = await invokePush(supabase, "public-key");
  let subscription = await reg.pushManager.getSubscription();
  const key = urlBase64ToUint8Array(publicKey);
  // A subscription made with another server key cannot receive our pushes: replace it.
  const sameKey = (existing) => {
    const current = existing?.options?.applicationServerKey;
    if (!current) return true;
    const bytes = new Uint8Array(current);
    return bytes.length === key.length && bytes.every((b, i) => b === key[i]);
  };
  if (subscription && !sameKey(subscription)) {
    await subscription.unsubscribe().catch(() => {});
    subscription = null;
  }
  subscription ||= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await saveSubscription(supabase, subscription, environment);
  return "on";
}

/** Turn notifications off for this device (other devices keep theirs). */
export async function disablePush(supabase) {
  const subscription = await currentSubscription().catch(() => null);
  if (!subscription) return "off";
  const { endpoint } = subscriptionKeys(subscription);
  if (supabase) {
    const { error } = await supabase.rpc("delete_push_subscription", { p_endpoint: endpoint });
    if (error) throw fail("push_save_failed");
  }
  await subscription.unsubscribe().catch(() => {});
  return "off";
}

/** Stop pushes to this device for the account that is signing out; keeps the browser permission. */
export async function forgetDeviceForAccount(supabase) {
  try {
    const subscription = await currentSubscription();
    if (!subscription || !supabase) return;
    await supabase.rpc("delete_push_subscription", { p_endpoint: subscriptionKeys(subscription).endpoint });
    await subscription.unsubscribe();
  } catch {
    /* signing out must not fail because of push */
  }
}

/**
 * After sign-in or page load: if this device already has permission and a subscription, make
 * sure it belongs to the signed-in account (it may have been renewed by the browser).
 */
export async function syncPushSubscription(supabase) {
  try {
    const environment = pushEnvironment();
    if (!supabase || !environment.supported || Notification.permission !== "granted") return;
    const subscription = await currentSubscription();
    if (subscription) await saveSubscription(supabase, subscription, environment);
  } catch {
    /* best effort */
  }
}

export async function sendTestPush(supabase) {
  return invokePush(supabase, "test");
}

/** Messages from the service worker (a tapped notification) ask the app to open a page. */
export function listenForNotificationClicks(openPath) {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  navigator.serviceWorker.addEventListener("message", (event) => {
    const data = event.data || {};
    if (data.type === "harnkhong:open" && typeof data.url === "string" && /^\/(?!\/)/.test(data.url)) openPath(data.url);
  });
}
