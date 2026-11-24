import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deviceInfo, pushEnvironment, pushStatus, subscriptionKeys, urlBase64ToUint8Array } from "../src/push.js";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";

function env({ ua, standalone = false, push = true, secure = true, platform = "", touch = 0 }) {
  const e = {
    navigator: { userAgent: ua, platform, maxTouchPoints: touch, ...(push ? { serviceWorker: {} } : {}) },
    matchMedia: (q) => ({ matches: standalone && q === "(display-mode: standalone)" }),
    isSecureContext: secure,
  };
  if (push) Object.assign(e, { PushManager: function () {}, Notification: function () {} });
  return e;
}

test("iPhone in Safari must install to the Home Screen first", () => {
  const e = pushEnvironment(env({ ua: IPHONE, push: false }));
  assert.equal(e.ios, true);
  assert.equal(pushStatus(e, "default", false), "needs-install");
});

test("iPhone opened from the Home Screen can turn push on", () => {
  const e = pushEnvironment(env({ ua: IPHONE, standalone: true }));
  assert.equal(pushStatus(e, "default", false), "off");
  assert.equal(pushStatus(e, "granted", true), "on");
});

test("iPad that reports itself as a Mac is treated as iOS", () => {
  const e = pushEnvironment(env({ ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", platform: "MacIntel", touch: 5, push: false }));
  assert.equal(e.ios, true);
});

test("Android Chrome works in the browser tab, and respects a block", () => {
  const e = pushEnvironment(env({ ua: ANDROID }));
  assert.equal(pushStatus(e, "default", false), "off");
  assert.equal(pushStatus(e, "denied", false), "denied");
  assert.equal(pushStatus(e, "granted", false), "off", "permission without a subscription is still off");
  assert.deepEqual(deviceInfo(e, ANDROID), { platform: "android", browser: "Chrome", standalone: false });
});

test("no push without HTTPS or browser support", () => {
  assert.equal(pushStatus(pushEnvironment(env({ ua: ANDROID, secure: false })), "default", false), "unsupported");
  assert.equal(pushStatus(pushEnvironment(env({ ua: ANDROID, push: false })), "default", false), "unsupported");
});

test("base64url key decoding and subscription keys", () => {
  assert.deepEqual([...urlBase64ToUint8Array("AQID_-8")], [1, 2, 3, 255, 239]);
  const fake = { toJSON: () => ({ endpoint: "https://push.example/x", keys: { p256dh: "P", auth: "A" } }) };
  assert.deepEqual(subscriptionKeys(fake), { endpoint: "https://push.example/x", p256dh: "P", auth: "A" });
});

test("PWA files: manifest is installable, the service worker only opens same-site pages", () => {
  const manifest = JSON.parse(readFileSync(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"));
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "/");
  assert.ok(manifest.icons.some((i) => i.sizes === "192x192"));
  assert.ok(manifest.icons.some((i) => i.sizes === "512x512" && i.purpose === "any"));
  assert.ok(manifest.icons.some((i) => i.purpose === "maskable"));
  const sw = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
  const safePath = new Function(`${sw.match(/function safePath[\s\S]*?\n}/)[0]}; return safePath;`)();
  assert.equal(safePath("/groups/g1"), "/groups/g1");
  for (const bad of ["https://evil.example", "//evil.example", "javascript:alert(1)", undefined])
    assert.equal(safePath(bad), "/notifications");
  assert.doesNotMatch(sw, /addEventListener\("fetch"/, "no fetch caching: money figures are never served stale");
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /rel="manifest" href="\/manifest.webmanifest"/);
});

test("no VAPID private key or service key in the frontend", () => {
  for (const file of ["../src/push.js", "../src/app.js", "../public/sw.js", "../.env.production"]) {
    const text = readFileSync(new URL(file, import.meta.url), "utf8");
    // Comments may mention the names; no line may set or read a secret.
    const code = text.split("\n").filter((line) => !/^\s*(#|\/\/|\*)/.test(line)).join("\n");
    assert.doesNotMatch(code, /VAPID_PRIVATE_KEY|service_role|SUPABASE_SERVICE/i, file);
  }
});
