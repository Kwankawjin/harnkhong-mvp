import { withSupabase } from "npm:@supabase/server";
import { corsHeaders } from "npm:@supabase/supabase-js@2.118.0/cors";

const INITIAL_ADMINS = ["harnkhong@gmail.com", "asdwadwaa8@gmail.com"];
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
  const configured = (Deno.env.get("ADMIN_EMAILS") || "")
    .split(",").map((email) => email.trim().toLowerCase()).filter(Boolean);
  return new Set([...INITIAL_ADMINS, ...configured]);
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
  if (user.app_metadata?.role === "admin") return { user, bootstrapped: false };
  if (!allowBootstrap) throw Object.assign(new Error("ADMIN_NOT_ALLOWED"), { status: 403 });
  const { data, error: updateError } = await ctx.supabaseAdmin.auth.admin.updateUserById(userId, {
    app_metadata: { ...user.app_metadata, role: "admin" },
  });
  if (updateError || !data.user) throw Object.assign(new Error("ไม่สามารถกำหนดสิทธิ์ผู้ดูแลได้"), { status: 500 });
  return { user: data.user, bootstrapped: true };
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

async function listGroups(client: any, limit = 200) {
  const { data, error } = await client.from("groups")
    .select("id, name, owner_id, listing_id, product_satang, delivery_per_member_satang, service_satang, total_satang, status, created_at, products(title)")
    .order("created_at", { ascending: false }).limit(limit);
  if (error) throw error;
  const users = await userIndex(client);
  const ids = (data || []).map((row: any) => row.id);
  let counts = new Map<string, number>();
  if (ids.length) {
    const { data: members, error: memberError } = await client.from("group_members").select("group_id").in("group_id", ids);
    if (memberError) throw memberError;
    counts = (members || []).reduce((map: Map<string, number>, row: any) => map.set(row.group_id, (map.get(row.group_id) || 0) + 1), new Map());
  }
  return (data || []).map((row: any) => ({ ...row, product_title: row.products?.title || "", products: undefined, owner_email: users.get(row.owner_id)?.email || "", member_count: counts.get(row.id) || 0 }));
}

async function listPayments(client: any, limit = 200) {
  const { data, error } = await client.from("group_payment_reports")
    .select("id, group_id, user_id, revision, amount_satang, status, reported_at, verified_at, verified_by, rejection_note")
    .order("reported_at", { ascending: false }).limit(limit);
  if (error) throw error;
  const groupIds = [...new Set((data || []).map((row: any) => row.group_id))];
  const [users, groupsResult] = await Promise.all([
    userIndex(client),
    groupIds.length
      ? client.from("groups").select("id,name").in("id", groupIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (groupsResult.error) throw groupsResult.error;
  const groups = new Map((groupsResult.data || []).map((group: any) => [group.id, group.name]));
  return (data || []).map((row: any) => ({
    ...row,
    group_name: groups.get(row.group_id) || "กลุ่มที่ถูกลบ",
    member_email: users.get(row.user_id)?.email || "",
    member_name: users.get(row.user_id)?.user_metadata?.display_name || users.get(row.user_id)?.email || "สมาชิก",
  }));
}

async function dashboardOverview(client: any, body: Record<string, unknown>, actor: any) {
  const allowedRanges = new Set([7, 30, 90]);
  const rangeDays = Number(body.rangeDays);
  const days = allowedRanges.has(rangeDays) ? rangeDays : 7;
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  start.setUTCHours(0, 0, 0, 0);
  const startIso = start.toISOString();
  const usersById = await userIndex(client);
  const [users, groups, waiting, ready, products, trendRows, activityRows, recentGroups] = await Promise.all([
    (async () => { const { count, error } = await client.from("profiles").select("id", { count: "exact", head: true }); if (error) throw error; return count; })(),
    (async () => { const { count, error } = await client.from("groups").select("id", { count: "exact", head: true }); if (error) throw error; return count; })(),
    (async () => { const { count, error } = await client.from("groups").select("id", { count: "exact", head: true }).eq("status", "awaiting_approval"); if (error) throw error; return count; })(),
    (async () => { const { count, error } = await client.from("groups").select("id", { count: "exact", head: true }).eq("status", "ready"); if (error) throw error; return count; })(),
    (async () => { const { count, error } = await client.from("products").select("id", { count: "exact", head: true }).eq("active", true); if (error) throw error; return count; })(),
    (async () => { const { data, error } = await client.from("groups").select("created_at").gte("created_at", startIso).lte("created_at", end.toISOString()); if (error) throw error; return data || []; })(),
    (async () => { const { data, error } = await client.from("group_events").select("id, event_type, actor_id, group_id, created_at, groups(name)").order("created_at", { ascending: false }).limit(10); if (error) throw error; return data || []; })(),
    listGroups(client, 8),
  ]);
  const byDay = new Map<string, number>();
  for (let offset = 0; offset < days; offset += 1) {
    const day = new Date(start); day.setUTCDate(start.getUTCDate() + offset);
    byDay.set(day.toISOString().slice(0, 10), 0);
  }
  for (const row of trendRows) {
    const key = new Date(row.created_at).toISOString().slice(0, 10);
    if (byDay.has(key)) byDay.set(key, (byDay.get(key) || 0) + 1);
  }
  const activity = [
    ...activityRows.map((row: any) => ({ kind: row.event_type, actor: usersById.get(row.actor_id)?.email || "สมาชิก", target: row.groups?.name || "กลุ่ม", created_at: row.created_at })),
    ...[...usersById.values()].filter((user: any) => user.created_at >= startIso).map((user: any) => ({ kind: "member_registered", actor: user.email || "สมาชิก", target: "สมัครสมาชิก", created_at: user.created_at })),
  ].sort((a: any, b: any) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 10);
  return {
    stats: { users, groups, awaitingGroups: waiting, readyGroups: ready, activeProducts: products },
    analytics: { rangeDays: days, start: startIso, end: end.toISOString(), groupsByDay: [...byDay].map(([date, count]) => ({ date, count })), paidSales: null },
    paymentOverview: { available: false, reason: "ยังไม่มีข้อมูลการชำระเงินในระบบหารของ" },
    recentActivity: activity,
    recentGroups,
    system: { supabase: "connected", authentication: "authorized", paymentVerification: "unavailable", updatedAt: new Date().toISOString(), checkedBy: actor.email },
  };
}

async function handleAction(req: Request, ctx: any) {
  if (req.method === "OPTIONS") return response(req, { ok: true });
  if (req.method !== "POST") return response(req, { error: "Method not allowed" }, 405);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return response(req, { error: "Invalid request" }, 400); }
  const action = String(body.action || "");
  if (action === "bootstrap") {
    const access = await authorize(ctx, true);
    return response(req, {
      ok: true,
      role: access.user.app_metadata?.role || "admin",
      refresh_required: access.bootstrapped,
    });
  }
  const admin = await authorize(ctx);
  const db = ctx.supabaseAdmin;

  if (action === "overview") {
    return response(req, await dashboardOverview(db, body, ctx.userClaims));
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
  if (action === "groups") {
    return response(req, { rows: await listGroups(db) });
  }
  if (action === "payments") {
    return response(req, { rows: await listPayments(db) });
  }
  if (action === "verify-group-payment") {
    const paymentId = String(body.paymentId || "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(paymentId)) {
      return response(req, { error: "รหัสรายการชำระเงินไม่ถูกต้อง" }, 400);
    }
    const { data, error } = await db.from("group_payment_reports")
      .update({ status: "verified", verified_at: new Date().toISOString(), verified_by: admin.user.id, rejection_note: null })
      .eq("id", paymentId).eq("status", "reported")
      .select("id, status, amount_satang, verified_at").maybeSingle();
    if (error) throw error;
    if (!data) return response(req, { error: "รายการนี้ถูกตรวจแล้วหรือไม่พบรายการ" }, 409);
    return response(req, { ok: true, payment: data });
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
