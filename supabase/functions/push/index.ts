// Push notifications for signed-in users.
//   { action: "public-key" } -> the VAPID public key the browser subscribes with
//   { action: "test" }       -> sends a test notification to the caller's own devices
// Secrets (Supabase → Edge Functions → Secrets, never in the frontend):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:… or https://…)
//   PUSH_ALLOWED_ORIGINS (optional, comma-separated; falls back to ADMIN_ALLOWED_ORIGINS)
import { withSupabase } from "npm:@supabase/server";
import { corsHeaders } from "npm:@supabase/supabase-js@2.118.0/cors";
import { deliverToUser, vapidFromEnv } from "../_shared/push-delivery.ts";

const ALLOWED_ORIGINS = (Deno.env.get("PUSH_ALLOWED_ORIGINS") || Deno.env.get("ADMIN_ALLOWED_ORIGINS") || "")
  .split(",").map((origin) => origin.trim()).filter(Boolean);

function corsOrigin(req: Request) {
  const origin = req.headers.get("origin") || "";
  return ALLOWED_ORIGINS.length ? (ALLOWED_ORIGINS.includes(origin) ? origin : "null") : "*";
}

function response(req: Request, body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { ...corsHeaders, "Access-Control-Allow-Origin": corsOrigin(req), "Vary": "Origin" },
  });
}

const handler = withSupabase({ auth: "user" }, async (req: Request, ctx: any) => {
  try {
    if (req.method !== "POST") return response(req, { error: "Method not allowed" }, 405);
    const userId = String(ctx.userClaims?.sub || "");
    if (!userId) return response(req, { error: "authentication_required" }, 401);
    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return response(req, { error: "invalid_request" }, 400); }

    const vapid = vapidFromEnv(Deno.env);
    if (!vapid) return response(req, { error: "push_not_configured" }, 503);

    if (body.action === "public-key") return response(req, { publicKey: vapid.publicKey });

    if (body.action === "test") {
      const report = await deliverToUser(ctx.supabaseAdmin, userId, {
        title: "HarnKhong",
        body: "เปิดแจ้งเตือนสำเร็จ คุณจะได้รับแจ้งเตือนการชำระเงินบนอุปกรณ์นี้",
        url: "/notifications",
        tag: "harnkhong-test",
      }, vapid, { ttl: 600, urgency: "normal", topic: "test" });
      console.info("push_test", { user: userId, ...report });
      return response(req, report);
    }
    return response(req, { error: "unknown_action" }, 400);
  } catch (error) {
    console.error("push_function_error", String((error as Error)?.message || error));
    return response(req, { error: "push_failed" }, 500);
  }
});

export default {
  fetch: (req: Request) => req.method === "OPTIONS"
    ? new Response("ok", { headers: { ...corsHeaders, "Access-Control-Allow-Origin": corsOrigin(req) } })
    : handler(req),
};
