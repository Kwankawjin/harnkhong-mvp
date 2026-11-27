/**
 * Phone notifications (Web Push). The site registers /sw.js, asks permission, and saves this
 * device's push subscription on the account. The database then sends a push for payments due,
 * cycle changes, chat messages, request-marketplace offers and admin announcements.
 *
 * iPhone/iPad only allow push for a site added to the Home Screen (iOS 16.4+), so pushSupport()
 * tells the page when to show "add to Home Screen" instead of the switch.
 */

/** Base64url VAPID public key -> Uint8Array for PushManager.subscribe. */
export function urlBase64ToUint8Array(base64) {
  const padded = String(base64 || "").trim() + "=".repeat((4 - (String(base64 || "").trim().length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

/** Whether this looks like an iPhone/iPad (iPadOS reports itself as a Mac with touch). */
export function isIos(nav = globalThis.navigator) {
  if (!nav) return false;
  const ua = nav.userAgent || "";
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && Number(nav.maxTouchPoints) > 1);
}

/** Opened from the Home Screen icon rather than in a browser tab. */
export function isStandalone(win = globalThis.window) {
  if (!win) return false;
  return Boolean(win.matchMedia?.("(display-mode: standalone)").matches || win.navigator?.standalone === true);
}

/**
 * What this device can do:
 * - "unconfigured": the site has no VAPID key yet
 * - "unsupported": the browser has no Web Push
 * - "install": iPhone/iPad in Safari: add to Home Screen first
 * - "denied": the person blocked notifications in settings
 * - "ready": can be switched on
 */
export function pushSupport({ vapidKey, win = globalThis.window } = {}) {
  if (!vapidKey) return "unconfigured";
  if (!win) return "unsupported";
  const nav = win.navigator;
  const hasApis = Boolean(nav && "serviceWorker" in nav && "PushManager" in win && "Notification" in win);
  if (isIos(nav) && !isStandalone(win)) return "install";
  if (!hasApis) return "unsupported";
  if (win.Notification.permission === "denied") return "denied";
  return "ready";
}

/** The fields stored for one device, from a PushSubscription. */
export function subscriptionRecord(subscription) {
  const json = typeof subscription?.toJSON === "function" ? subscription.toJSON() : subscription || {};
  const endpoint = String(json.endpoint || "");
  const p256dh = String(json.keys?.p256dh || "");
  const auth = String(json.keys?.auth || "");
  if (!endpoint.startsWith("https://") || !p256dh || !auth) throw new Error("INVALID_PUSH_SUBSCRIPTION");
  return { endpoint, p256dh, auth };
}

export function createPush({ supabase, vapidKey, onChange = () => {} }) {
  let registration = null;
  let subscribed = false;

  const support = () => pushSupport({ vapidKey });

  async function register() {
    if (registration || !("serviceWorker" in navigator)) return registration;
    try {
      registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      navigator.serviceWorker.addEventListener("message", (event) => {
        if (event.data?.type === "push-subscription-changed") void refresh().catch(() => {});
      });
    } catch (error) {
      console.error("Service worker registration failed", error);
    }
    return registration;
  }

  async function currentSubscription() {
    const reg = await register();
    if (!reg?.pushManager) return null;
    return reg.pushManager.getSubscription();
  }

  async function save(subscription) {
    const record = subscriptionRecord(subscription);
    const { error } = await supabase.rpc("save_push_subscription", {
      p_endpoint: record.endpoint,
      p_p256dh: record.p256dh,
      p_auth: record.auth,
      p_user_agent: String(navigator.userAgent || "").slice(0, 300),
    });
    if (error) throw error;
  }

  /** Re-check after sign-in: keeps a granted device saved on the signed-in account. */
  async function refresh() {
    if (support() !== "ready") {
      subscribed = false;
      onChange();
      return subscribed;
    }
    const subscription = await currentSubscription();
    subscribed = Boolean(subscription && Notification.permission === "granted");
    if (subscribed) await save(subscription).catch((error) => console.error("Could not save push subscription", error));
    onChange();
    return subscribed;
  }

  /** Ask permission (must run from a tap) and save this device. */
  async function enable() {
    if (support() !== "ready") throw new Error("PUSH_NOT_READY");
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      onChange();
      throw new Error(permission === "denied" ? "PUSH_DENIED" : "PUSH_DISMISSED");
    }
    const reg = await register();
    if (!reg) throw new Error("PUSH_NOT_READY");
    await navigator.serviceWorker.ready;
    let subscription = await reg.pushManager.getSubscription();
    if (!subscription)
      subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      });
    await save(subscription);
    subscribed = true;
    onChange();
    return true;
  }

  async function disable() {
    const subscription = await currentSubscription();
    if (subscription) {
      const endpoint = subscription.endpoint;
      await subscription.unsubscribe().catch(() => {});
      await supabase.rpc("delete_push_subscription", { p_endpoint: endpoint });
    }
    subscribed = false;
    onChange();
  }

  /** Send a test push to every device on this account. */
  async function test() {
    const { error } = await supabase.rpc("send_test_push");
    if (error) throw error;
  }

  /** Clear the red count on the Home Screen icon once notifications are seen. */
  function clearBadge() {
    try { navigator.clearAppBadge?.(); } catch { /* not supported */ }
  }

  return {
    register,
    refresh,
    enable,
    disable,
    test,
    clearBadge,
    support,
    get subscribed() {
      return subscribed;
    },
  };
}
