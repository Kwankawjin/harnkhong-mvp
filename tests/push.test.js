import test from "node:test";
import assert from "node:assert/strict";
import { urlBase64ToUint8Array, isIos, isStandalone, pushSupport, subscriptionRecord } from "../src/push.js";

const browser = ({ ua = "Mozilla/5.0 (Linux; Android 14) Chrome/130", touch = 5, standalone = false, permission = "default", apis = true } = {}) => {
  const win = {
    navigator: { userAgent: ua, maxTouchPoints: touch, standalone },
    matchMedia: () => ({ matches: standalone }),
    Notification: { permission },
  };
  if (apis) {
    win.navigator.serviceWorker = {};
    win.PushManager = function PushManager() {};
  } else delete win.Notification;
  return win;
};

test("VAPID key: base64url turns into the 65 raw bytes of a P-256 public key", () => {
  const bytes = new Uint8Array(65).map((_, i) => (i === 0 ? 4 : i * 3));
  const encoded = Buffer.from(bytes).toString("base64url");
  assert.deepEqual([...urlBase64ToUint8Array(encoded)], [...bytes]);
});

test("iPhone and iPad (which reports itself as a Mac with touch) count as iOS", () => {
  assert.equal(isIos({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" }), true);
  assert.equal(isIos({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", maxTouchPoints: 5 }), true);
  assert.equal(isIos({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", maxTouchPoints: 0 }), false);
  assert.equal(isIos({ userAgent: "Mozilla/5.0 (Linux; Android 14)" }), false);
});

test("standalone: opened from the Home Screen icon", () => {
  assert.equal(isStandalone(browser({ standalone: true })), true);
  assert.equal(isStandalone(browser()), false);
});

test("what the notifications page offers on each device", () => {
  const vapidKey = "key";
  assert.equal(pushSupport({ vapidKey: "", win: browser() }), "unconfigured");
  assert.equal(pushSupport({ vapidKey, win: browser() }), "ready");
  assert.equal(pushSupport({ vapidKey, win: browser({ permission: "denied" }) }), "denied");
  assert.equal(pushSupport({ vapidKey, win: browser({ apis: false }) }), "unsupported");
  const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)";
  assert.equal(pushSupport({ vapidKey, win: browser({ ua: iphone, apis: false }) }), "install", "Safari tab: add to Home Screen first");
  assert.equal(pushSupport({ vapidKey, win: browser({ ua: iphone, standalone: true }) }), "ready", "Home Screen app can subscribe");
});

test("a subscription is stored as endpoint + keys, and only over https", () => {
  const sub = { toJSON: () => ({ endpoint: "https://web.push.apple.com/abc", keys: { p256dh: "p".repeat(87), auth: "a".repeat(22) } }) };
  assert.deepEqual(subscriptionRecord(sub), { endpoint: "https://web.push.apple.com/abc", p256dh: "p".repeat(87), auth: "a".repeat(22) });
  assert.throws(() => subscriptionRecord({ endpoint: "http://insecure", keys: { p256dh: "x", auth: "y" } }));
  assert.throws(() => subscriptionRecord({ endpoint: "https://x", keys: {} }));
});
