// Web Push without dependencies: VAPID (RFC 8292) + aes128gcm payload encryption (RFC 8291).
// Uses only WebCrypto, so the same file runs in Supabase Edge Functions (Deno) and in Node tests.
// Only erasable TypeScript syntax is used (Node strips the types when running the tests).

export type PushSubscriptionKeys = { endpoint: string; p256dh: string; auth: string };
export type VapidKeys = { publicKey: string; privateKey: string; subject: string };
export type PushOptions = { ttl?: number; urgency?: "very-low" | "low" | "normal" | "high"; topic?: string };
export type PushResult = { ok: boolean; status: number; gone: boolean; retryable: boolean; body?: string };

const enc = new TextEncoder();

export function b64urlEncode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlDecode(value: string): Uint8Array {
  const s = value.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s + "=".repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bytes * 8);
  return new Uint8Array(bits);
}

/** Encrypt one push message for a subscription (single aes128gcm record). */
export async function encryptPayload(
  payload: Uint8Array,
  p256dh: string,
  authSecret: string,
  // Only for tests: fixed sender key pair and salt.
  fixed?: { senderKeys?: CryptoKeyPair; salt?: Uint8Array },
): Promise<Uint8Array> {
  const uaPublic = b64urlDecode(p256dh);
  const auth = b64urlDecode(authSecret);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error("invalid_p256dh");
  if (auth.length !== 16) throw new Error("invalid_auth_secret");
  if (payload.length > 3993) throw new Error("payload_too_large");

  const sender = fixed?.senderKeys ??
    await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", sender.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, sender.privateKey, 256),
  );

  const keyInfo = concat(enc.encode("WebPush: info\0"), uaPublic, asPublic);
  const ikm = await hkdf(auth, ecdhSecret, keyInfo, 32);
  const salt = fixed?.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);

  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const plaintext = concat(payload, new Uint8Array([2])); // 0x02 = last record, no padding
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, plaintext));

  const header = new Uint8Array(16 + 4 + 1 + 65);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = 65;
  header.set(asPublic, 21);
  return concat(header, ciphertext);
}

/** The VAPID Authorization header value for one push service origin. */
export async function vapidAuthorization(endpoint: string, vapid: VapidKeys, now = Date.now()): Promise<string> {
  const pub = b64urlDecode(vapid.publicKey);
  if (pub.length !== 65 || pub[0] !== 4) throw new Error("invalid_vapid_public_key");
  if (!/^(mailto:|https:\/\/)/.test(vapid.subject)) throw new Error("invalid_vapid_subject");
  const key = await crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC", crv: "P-256", ext: false,
      x: b64urlEncode(pub.slice(1, 33)), y: b64urlEncode(pub.slice(33, 65)), d: vapid.privateKey,
    },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const header = b64urlEncode(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64urlEncode(enc.encode(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(now / 1000) + 12 * 3600,
    sub: vapid.subject,
  })));
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${header}.${claims}`)),
  );
  return `vapid t=${header}.${claims}.${b64urlEncode(signature)}, k=${vapid.publicKey}`;
}

/** Send one message. Never throws for HTTP errors; `gone` means the subscription should be deleted. */
export async function sendWebPush(
  sub: PushSubscriptionKeys,
  message: unknown,
  vapid: VapidKeys,
  options: PushOptions = {},
  fetchImpl: typeof fetch = fetch,
): Promise<PushResult> {
  const url = new URL(sub.endpoint);
  if (url.protocol !== "https:") throw new Error("invalid_endpoint");
  const body = await encryptPayload(enc.encode(JSON.stringify(message)), sub.p256dh, sub.auth);
  const headers: Record<string, string> = {
    Authorization: await vapidAuthorization(sub.endpoint, vapid),
    "Content-Encoding": "aes128gcm",
    "Content-Type": "application/octet-stream",
    TTL: String(Math.max(0, Math.floor(options.ttl ?? 86_400))),
    Urgency: options.urgency ?? "normal",
  };
  if (options.topic) headers.Topic = options.topic.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
  const res = await fetchImpl(sub.endpoint, { method: "POST", headers, body });
  const text = res.ok ? undefined : (await res.text().catch(() => "")).slice(0, 300);
  return {
    ok: res.status >= 200 && res.status < 300,
    status: res.status,
    gone: res.status === 404 || res.status === 410,
    retryable: res.status === 429 || res.status >= 500,
    body: text,
  };
}
