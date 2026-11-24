// Prints a new VAPID key pair for Web Push. Run once: `node scripts/generate-vapid-keys.mjs`
// Put both values in Supabase → Edge Functions → Secrets (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY).
// Never commit the private key or put it in Vercel/VITE_ variables. Rotating it signs every
// device out of push, so keep the same pair once it is in use.
const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
const jwk = await crypto.subtle.exportKey("jwk", keys.privateKey);
const raw = new Uint8Array(await crypto.subtle.exportKey("raw", keys.publicKey));
const b64url = (bytes) => Buffer.from(bytes).toString("base64url");
console.log(`VAPID_PUBLIC_KEY=${b64url(raw)}`);
console.log(`VAPID_PRIVATE_KEY=${jwk.d}`);
console.log("VAPID_SUBJECT=mailto:harnkhong@gmail.com");
