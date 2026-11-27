// Delivers queued phone notifications (private.push_outbox) with Web Push.
//
// Called by the database (pg_net right after something is queued, and pg_cron every minute
// as a retry) with the shared secret in the x-push-secret header. It is not for browsers.
//
// Secrets (supabase secrets set ...):
//   VAPID_PUBLIC_KEY   same value as VITE_VAPID_PUBLIC_KEY on the website
//   VAPID_PRIVATE_KEY
//   VAPID_SUBJECT      mailto:you@example.com (who push services contact about problems)
//   PUSH_CRON_SECRET   random string, also saved in Vault as push_cron_secret
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.118.0";

const env = (name: string) => (Deno.env.get(name) || "").trim();

function sameSecret(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

type OutboxRow = { id: number; user_id: string; title: string; body: string; url: string; tag: string | null };
type Device = { id: string; user_id: string; endpoint: string; p256dh: string; auth: string };

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (!sameSecret(req.headers.get("x-push-secret") || "", env("PUSH_CRON_SECRET"))) {
    return new Response("Forbidden", { status: 403 });
  }
  const publicKey = env("VAPID_PUBLIC_KEY");
  const privateKey = env("VAPID_PRIVATE_KEY");
  if (!publicKey || !privateKey) return Response.json({ error: "VAPID keys are not set" }, { status: 500 });
  webpush.setVapidDetails(env("VAPID_SUBJECT") || "mailto:harnkhong@gmail.com", publicKey, privateKey);

  const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let sent = 0;
  let removed = 0;
  // A few batches per call, so a big announcement still goes out in one wake-up.
  for (let batch = 0; batch < 5; batch += 1) {
    const { data: rows, error } = await db.rpc("push_claim_outbox", { p_limit: 200 });
    if (error) return Response.json({ error: error.message }, { status: 500 });
    const outbox = (rows || []) as OutboxRow[];
    if (!outbox.length) break;

    const users = [...new Set(outbox.map((row) => row.user_id))];
    const [{ data: deviceRows, error: deviceError }, { data: badgeRows }] = await Promise.all([
      db.from("push_subscriptions").select("id, user_id, endpoint, p256dh, auth").in("user_id", users),
      db.rpc("push_badge_counts", { p_users: users }),
    ]);
    if (deviceError) return Response.json({ error: deviceError.message }, { status: 500 });
    const devices = new Map<string, Device[]>();
    for (const device of (deviceRows || []) as Device[]) {
      devices.set(device.user_id, [...(devices.get(device.user_id) || []), device]);
    }
    const badges = new Map<string, number>(
      ((badgeRows || []) as { user_id: string; unread: number }[]).map((row) => [row.user_id, row.unread]),
    );

    const gone = new Set<string>();
    const done: number[] = [];
    await Promise.all(
      outbox.map(async (row) => {
        const payload = JSON.stringify({
          title: row.title,
          body: row.body,
          url: row.url,
          tag: row.tag,
          badge: badges.get(row.user_id) ?? undefined,
        });
        let delivered = false;
        let retry = false;
        for (const device of devices.get(row.user_id) || []) {
          if (gone.has(device.id)) continue;
          try {
            await webpush.sendNotification(
              { endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } },
              payload,
              { TTL: 60 * 60 * 24, urgency: row.url.startsWith("/chat") ? "normal" : "high" },
            );
            delivered = true;
            sent += 1;
          } catch (error) {
            const status = (error as { statusCode?: number }).statusCode;
            // 404/410: the person turned notifications off or removed the app.
            if (status === 404 || status === 410) gone.add(device.id);
            else {
              retry = true;
              console.error("push failed", status, (error as Error).message);
            }
          }
        }
        // Finished when it reached a device or nothing is left to retry.
        if (delivered || !retry) done.push(row.id);
      }),
    );

    if (gone.size) {
      await db.from("push_subscriptions").delete().in("id", [...gone]);
      removed += gone.size;
    }
    if (done.length) await db.rpc("push_finish_outbox", { p_ids: done });
    if (outbox.length < 200) break;
  }

  return Response.json({ sent, removed });
});
