import { withSupabase } from "npm:@supabase/server";
import { corsHeaders } from "npm:@supabase/supabase-js@2.118.0/cors";

const INITIAL_ADMIN = "harnkhong@gmail.com";
const ALLOWED_ORIGINS = (Deno.env.get("ADMIN_ALLOWED_ORIGINS") || "")
  .split(",").map((origin) => origin.trim()).filter(Boolean);

function response(req: Request, body: unknown, status = 200) {
  const origin = req.headers.get("origin") || "";
  const corsOrigin = ALLOWED_ORIGINS.length
    ? (ALLOWED_ORIGINS.includes(origin) ? origin : "null")
    : "*";
  return Response.json(body, {
    status,
    headers: {
      ...corsHeaders,
      "Access-Control-Allow-Origin": corsOrigin,
      "Vary": "Origin",
    },
  });
}

function allowedEmails() {
  const configured = (Deno.env.get("ADMIN_EMAILS") || INITIAL_ADMIN)
    .split(",").map((email) => email.trim().toLowerCase()).filter(Boolean);
  return new Set([INITIAL_ADMIN, ...configured]);
}

async function authorize(ctx: any, allowBootstrap = false) {
  const email = String(ctx.userClaims?.email || "").trim().toLowerCase();
  const userId = String(ctx.userClaims?.sub || ctx.userClaims?.id || "");
  if (!email || !userId || !allowedEmails().has(email)) {
    throw Object.assign(new Error("ADMIN_NOT_ALLOWED"), { status: 403 });
  }
  const { data: { user }, error } = await ctx.supabaseAdmin.auth.admin.getUserById(userId);
  if (error || !user || user.email?.toLowerCase() !== email) {
    throw Object.assign(new Error("ADMIN_NOT_ALLOWED"), { status: 403 });
  }
  if (!user.email_confirmed_at) {
    throw Object.assign(new Error("ADMIN_EMAIL_UNCONFIRMED"), { status: 403 });
  }
  if (user.app_metadata?.role === "admin") return user;
  if (!allowBootstrap) throw Object.assign(new Error("ADMIN_NOT_ALLOWED"), { status: 403 });
  const { data, error: updateError } = await ctx.supabaseAdmin.auth.admin.updateUserById(userId, {
    app_metadata: { ...user.app_metadata, role: "admin" },
  });
  if (updateError || !data.user) throw Object.assign(new Error("ไม่สามารถกำหนดสิทธิ์ผู้ดูแลได้"), { status: 500 });
  return data.user;
}

async function countRows(client: any, table: string) {
  const { count, error } = await client.from(table).select("*", { count: "exact", head: true });
  if (error) throw error;
  return count || 0;
}

async function userIndex(client: any) {
  const users = new Map<string, any>();
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw error;
    for (const user of data.users) users.set(user.id, user);
    if (data.users.length < 100) break;
  }
  return users;
}

async function listOrders(client: any, limit = 100) {
  const { data, error } = await client.from("secondhand_orders")
    .select("id, listing_title, buyer_id, seller_id, unit_price_satang, quantity, total_satang, delivery_method, status, created_at")
    .order("created_at", { ascending: false }).limit(limit);
  if (error) throw error;
  const users = await userIndex(client);
  return (data || []).map((order: any) => ({
    ...order,
    buyer_email: users.get(order.buyer_id)?.email || "",
    seller_email: users.get(order.seller_id)?.email || "",
  }));
}

async function handleAction(req: Request, ctx: any) {
  if (req.method === "OPTIONS") return response(req, { ok: true });
  if (req.method !== "POST") return response(req, { error: "Method not allowed" }, 405);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return response(req, { error: "Invalid request" }, 400); }
  const action = String(body.action || "");
  if (action === "bootstrap") {
    const user = await authorize(ctx, true);
    return response(req, { ok: true, role: user.app_metadata?.role || "admin" });
  }
  await authorize(ctx);
  const db = ctx.supabaseAdmin;

  if (action === "overview") {
    const [users, orders, pendingPayments, products, groups, recentOrders] = await Promise.all([
      (async () => (await userIndex(db)).size)(),
      countRows(db, "secondhand_orders"),
      (async () => {
        const { count, error } = await db.from("secondhand_orders").select("id", { count: "exact", head: true }).eq("status", "pending_payment");
        if (error) throw error;
        return count || 0;
      })(),
      countRows(db, "secondhand_listings"),
      countRows(db, "groups"),
      listOrders(db, 8),
    ]);
    return response(req, { stats: { users, orders, pendingPayments, products, groups }, recentOrders });
  }
  if (action === "orders") return response(req, { rows: await listOrders(db) });
  if (action === "payments") {
    const rows = await listOrders(db);
    return response(req, { rows: rows.filter((row: any) => ["pending_payment", "payment_secured"].includes(row.status)) });
  }
  if (action === "users") {
    const users = await userIndex(db);
    const { data: profiles, error } = await db.from("profiles").select("id, display_name").limit(1000);
    if (error) throw error;
    const names = new Map((profiles || []).map((profile: any) => [profile.id, profile.display_name]));
    const rows = [...users.values()].map((user: any) => ({ ...user, display_name: names.get(user.id) || user.user_metadata?.display_name || "" }))
      .sort((a: any, b: any) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 500)
      .map(({ id, email, email_confirmed_at, created_at, display_name }: any) => ({ id, email, email_confirmed_at, created_at, display_name }));
    return response(req, { rows });
  }
  if (action === "products") {
    const { data, error } = await db.from("secondhand_listings").select("id, owner_id, seller_name, title, category, price_satang, active, created_at").order("created_at", { ascending: false }).limit(200);
    if (error) throw error;
    return response(req, { rows: data || [] });
  }
  if (action === "groups") {
    const { data, error } = await db.from("groups").select("id, name, owner_id, status, created_at").order("created_at", { ascending: false }).limit(200);
    if (error) throw error;
    const users = await userIndex(db);
    const ids = (data || []).map((row: any) => row.id);
    let counts = new Map<string, number>();
    if (ids.length) {
      const { data: members, error: memberError } = await db.from("group_members").select("group_id").in("group_id", ids);
      if (memberError) throw memberError;
      counts = (members || []).reduce((map: Map<string, number>, row: any) => map.set(row.group_id, (map.get(row.group_id) || 0) + 1), new Map());
    }
    return response(req, { rows: (data || []).map((row: any) => ({ ...row, owner_email: users.get(row.owner_id)?.email || "", member_count: counts.get(row.id) || 0 })) });
  }
  if (action === "confirm-payment") {
    const orderId = String(body.orderId || "");
    const amount = Number(body.amountSatang);
    if (!/^[0-9a-f-]{36}$/i.test(orderId) || !Number.isSafeInteger(amount) || amount < 0) {
      return response(req, { error: "ข้อมูลยืนยันการชำระเงินไม่ถูกต้อง" }, 400);
    }
    const { data, error } = await db.rpc("confirm_admin_secondhand_payment", {
      p_order_id: orderId,
      p_amount_satang: amount,
      p_verified_by: ctx.userClaims.sub,
    });
    if (error) throw error;
    return response(req, { ok: true, verification: data });
  }
  return response(req, { error: "ไม่รู้จักคำสั่งนี้" }, 400);
}

const authenticatedFetch = withSupabase({ auth: "user" }, async (req: Request, ctx: any) => {
    try {
      return await handleAction(req, ctx);
    } catch (error: any) {
      const status = Number(error?.status) || 500;
      const message = status === 500 && !String(error?.message || "").startsWith("ADMIN_")
        ? "เกิดข้อผิดพลาดในการประมวลผลคำขอ" : String(error?.message || "เกิดข้อผิดพลาด");
      return response(req, { error: message }, status);
    }
  });

export default {
  fetch: (req: Request) => req.method === "OPTIONS"
    ? new Response("ok", { headers: { ...corsHeaders, "Access-Control-Allow-Origin": ALLOWED_ORIGINS.length ? (ALLOWED_ORIGINS.includes(req.headers.get("origin") || "") ? req.headers.get("origin")! : "null") : "*" } })
    : authenticatedFetch(req),
};
