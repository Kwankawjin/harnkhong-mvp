import test from "node:test";
import assert from "node:assert/strict";
import {
  b64urlDecode,
  b64urlEncode,
  encryptPayload,
  sendWebPush,
  vapidAuthorization,
} from "../supabase/functions/_shared/webpush.ts";

const enc = new TextEncoder();
const dec = new TextDecoder();

async function hkdf(salt, ikm, info, bytes) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bytes * 8));
}

/** A browser-side subscription: its key pair and auth secret. */
async function browser() {
  const keys = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", keys.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return { keys, p256dh: b64urlEncode(pub), auth: b64urlEncode(auth), pub, authBytes: auth };
}

/** What the browser does on receipt (RFC 8291 §3.4 / RFC 8188), written independently of the sender. */
async function decrypt(body, ua) {
  const salt = body.slice(0, 16);
  const rs = new DataView(body.buffer, body.byteOffset).getUint32(16);
  const idlen = body[20];
  const asPublic = body.slice(21, 21 + idlen);
  const ciphertext = body.slice(21 + idlen);
  assert.equal(rs, 4096);
  assert.equal(idlen, 65);
  const asKey = await crypto.subtle.importKey("raw", asPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: asKey }, ua.keys.privateKey, 256));
  const info = new Uint8Array([...enc.encode("WebPush: info\0"), ...ua.pub, ...asPublic]);
  const ikm = await hkdf(ua.authBytes, secret, info, 32);
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, ciphertext));
  assert.equal(plain.at(-1), 2, "last-record delimiter");
  return dec.decode(plain.slice(0, -1));
}

async function vapidKeys() {
  const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", keys.privateKey);
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", keys.publicKey));
  return { publicKey: b64urlEncode(pub), privateKey: jwk.d, subject: "mailto:test@example.invalid", verifyKey: keys.publicKey };
}

test("base64url round trip", () => {
  const bytes = crypto.getRandomValues(new Uint8Array(65));
  assert.deepEqual(b64urlDecode(b64urlEncode(bytes)), bytes);
  assert.doesNotMatch(b64urlEncode(bytes), /[+/=]/);
});

test("the browser can decrypt what the server encrypts (Thai text intact)", async () => {
  const ua = await browser();
  const message = JSON.stringify({ title: "HarnKhong", body: "พรุ่งนี้ครบกำหนดชำระ Netflix Group 89 บาท", url: "/groups/abc" });
  const body = await encryptPayload(enc.encode(message), ua.p256dh, ua.auth);
  assert.equal(await decrypt(body, ua), message);
});

test("every message uses a fresh salt and sender key", async () => {
  const ua = await browser();
  const a = await encryptPayload(enc.encode("x"), ua.p256dh, ua.auth);
  const b = await encryptPayload(enc.encode("x"), ua.p256dh, ua.auth);
  assert.notDeepEqual(a.slice(0, 86), b.slice(0, 86));
});

test("rejects bad keys and oversize payloads", async () => {
  const ua = await browser();
  await assert.rejects(encryptPayload(enc.encode("x"), "AAAA", ua.auth), /invalid_p256dh/);
  await assert.rejects(encryptPayload(enc.encode("x"), ua.p256dh, "AAAA"), /invalid_auth_secret/);
  await assert.rejects(encryptPayload(new Uint8Array(4000), ua.p256dh, ua.auth), /payload_too_large/);
});

test("VAPID header is a valid ES256 JWT for the push service origin", async () => {
  const vapid = await vapidKeys();
  const now = Date.parse("2026-11-24T02:00:00Z");
  const header = await vapidAuthorization("https://fcm.googleapis.com/fcm/send/abc", vapid, now);
  const [, token, k] = header.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.equal(k, vapid.publicKey);
  const [h, c, s] = token.split(".");
  const claims = JSON.parse(dec.decode(b64urlDecode(c)));
  assert.equal(claims.aud, "https://fcm.googleapis.com");
  assert.equal(claims.exp, now / 1000 + 12 * 3600);
  assert.equal(claims.sub, vapid.subject);
  const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, vapid.verifyKey, b64urlDecode(s), enc.encode(`${h}.${c}`));
  assert.ok(ok, "signature verifies with the public key");
});

test("sendWebPush posts the right headers and reports gone/retryable", async () => {
  const ua = await browser();
  const vapid = await vapidKeys();
  const sub = { endpoint: "https://web.push.apple.com/QQ", p256dh: ua.p256dh, auth: ua.auth };
  let seen;
  const fake = (status) => async (url, init) => {
    seen = { url, init };
    return new Response(status === 201 ? null : "nope", { status });
  };
  const ok = await sendWebPush(sub, { title: "t" }, vapid, { ttl: 3600, urgency: "high", topic: "pay:g1/c2" }, fake(201));
  assert.deepEqual([ok.ok, ok.gone, ok.retryable], [true, false, false]);
  assert.equal(seen.init.headers["Content-Encoding"], "aes128gcm");
  assert.equal(seen.init.headers.TTL, "3600");
  assert.equal(seen.init.headers.Urgency, "high");
  assert.equal(seen.init.headers.Topic, "payg1c2");
  assert.equal(JSON.parse(await decrypt(seen.init.body, ua)).title, "t");
  assert.equal((await sendWebPush(sub, {}, vapid, {}, fake(410))).gone, true);
  assert.equal((await sendWebPush(sub, {}, vapid, {}, fake(404))).gone, true);
  assert.equal((await sendWebPush(sub, {}, vapid, {}, fake(429))).retryable, true);
  await assert.rejects(sendWebPush({ ...sub, endpoint: "http://x.example/" }, {}, vapid, {}, fake(201)), /invalid_endpoint/);
});

test("delivery: only same-site paths, gone devices removed, failures counted", async () => {
  const { deliverToUser, safePath, vapidFromEnv } = await import("../supabase/functions/_shared/push-delivery.ts");
  assert.equal(safePath("/groups/abc?tab=pay"), "/groups/abc?tab=pay");
  for (const bad of ["https://evil.example", "//evil.example", "javascript:alert(1)", "/\\evil", "", null])
    assert.equal(safePath(bad), "/notifications");
  assert.equal(vapidFromEnv({ get: () => undefined }), null);

  const ua = await browser();
  const vapid = await vapidKeys();
  const rows = [
    { id: "ok", endpoint: "https://push.example/ok", p256dh: ua.p256dh, auth: ua.auth, failure_count: 3 },
    { id: "gone", endpoint: "https://push.example/gone", p256dh: ua.p256dh, auth: ua.auth, failure_count: 0 },
    { id: "flaky", endpoint: "https://push.example/flaky", p256dh: ua.p256dh, auth: ua.auth, failure_count: 1 },
  ];
  const ops = [];
  const db = {
    from: () => ({
      select: () => ({ eq: async (col, value) => (ops.push(["select", col, value]), { data: rows, error: null }) }),
      update: (values) => ({ eq: async (_c, id) => (ops.push(["update", id, values]), {}) }),
      delete: () => ({ eq: async (_c, id) => (ops.push(["delete", id]), {}) }),
    }),
  };
  const realFetch = globalThis.fetch;
  const bodies = [];
  globalThis.fetch = async (url, init) => {
    bodies.push(init.body);
    return new Response(null, { status: url.endsWith("/ok") ? 201 : url.endsWith("/gone") ? 410 : 503 });
  };
  try {
    const report = await deliverToUser(db, "user-1", { title: "T", body: "B", url: "https://evil.example" }, vapid);
    assert.deepEqual(report, { devices: 3, sent: 1, failed: 2, removed: 1 });
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.deepEqual(ops[0], ["select", "user_id", "user-1"]);
  assert.deepEqual(ops.find((o) => o[1] === "ok")[2].failure_count, 0);
  assert.ok(ops.some((o) => o[0] === "delete" && o[1] === "gone"));
  assert.deepEqual(ops.find((o) => o[1] === "flaky")[2], { failure_count: 2 });
  assert.equal(JSON.parse(await decrypt(bodies[0], ua)).url, "/notifications", "unsafe link replaced");
});
