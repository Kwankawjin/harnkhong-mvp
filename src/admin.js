import "./admin.css";

const navItems = [
  ["dashboard", "ภาพรวม", "grid"],
  ["users", "สมาชิก", "users"],
  ["groups", "กลุ่มหารของ", "groups"],
  ["settings", "ตั้งค่า", "settings"],
];

const ADMIN_EMAILS = ["harnkhong@gmail.com", "asdwadwaa8@gmail.com"];
const ADMIN_EMAIL_LABEL = ADMIN_EMAILS.join(" หรือ ");
let currentClient = null;
let pageGeneration = 0;
let feedback = "";
let busy = false;
let dashboardRangeDays = 7;

const escapeHtml = (value = "") =>
  String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);

function activeSection() {
  const requested = location.hash.replace(/^#\/?/, "");
  return navItems.some(([key]) => key === requested) ? requested : "dashboard";
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "—" : new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function sectionTitle(section) {
  return navItems.find(([key]) => key === section)?.[1] || "ภาพรวม";
}

function adminIcon(name) {
  const paths = {
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM20 8v6M23 11h-6"/>',
    groups: '<circle cx="9" cy="8" r="3"/><path d="M3 20v-1a6 6 0 0 1 12 0v1M16 5a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 5v1"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1 1.2.9-1.2 2.1-1.4-.6a8 8 0 0 1-1.7 1l-.2 1.5h-2.4l-.2-1.5a8 8 0 0 1-1.9 0l-.2 1.5H9.1l-.2-1.5a8 8 0 0 1-1.7-1l-1.4.6-1.2-2.1 1.2-.9a7 7 0 0 1 0-2l-1.2-.9 1.2-2.1 1.4.6a8 8 0 0 1 1.7-1l.2-1.5h2.4l.2 1.5a8 8 0 0 1 1.9 0l.2-1.5h2.4l.2 1.5a8 8 0 0 1 1.7 1l1.4-.6 1.2 2.1-1.2.9a7 7 0 0 1 0 1.9Z"/>',
  };
  return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.grid}</svg>`;
}

function shell(content, { user, section, login = false } = {}) {
  const root = document.querySelector("#app");
  if (!root) return;
  document.body.classList.toggle("admin-mode", !login);
  document.title = login ? "เข้าสู่ระบบผู้ดูแล | HarnKhong" : `${sectionTitle(section)} | HarnKhong Admin`;
  root.innerHTML = login
    ? `<main class="admin-login-wrap"><section class="admin-login"><a class="admin-brand" href="/"><img src="/images/harnkhong-logo.png" alt=""/><strong>HarnKhong</strong></a><h1>เข้าสู่ระบบผู้ดูแล</h1><p>ใช้บัญชี Google ${ADMIN_EMAIL_LABEL} เพื่อเข้าใช้งาน</p><button type="button" class="admin-google-button" data-admin-action="google-login" ${busy ? "disabled" : ""}><span class="admin-google-mark" aria-hidden="true">G</span>เข้าสู่ระบบด้วย Google</button><p class="admin-login-hint">ระบบให้สิทธิ์เฉพาะอีเมลผู้ดูแลที่กำหนดไว้เท่านั้น</p><div class="admin-login-divider"><span>หรือใช้อีเมลและรหัสผ่าน</span></div><form id="admin-login-form"><label>อีเมล<input type="email" name="email" autocomplete="username" required/></label><label>รหัสผ่าน<input type="password" name="password" autocomplete="current-password" required/></label><button class="admin-primary" type="submit" ${busy ? "disabled" : ""}>${busy ? "กำลังเข้าสู่ระบบ…" : "เข้าสู่ระบบ"}</button>${feedback ? `<p class="admin-feedback" role="alert">${escapeHtml(feedback)}</p>` : ""}</form><a class="admin-return" href="/">กลับไปหน้าเว็บไซต์</a></section></main>`
    : `<div class="admin-layout"><aside class="admin-sidebar"><a class="admin-brand" href="/"><img src="/images/harnkhong-logo.png" alt=""/><strong>HarnKhong</strong><small>ADMIN</small></a><nav aria-label="เมนูผู้ดูแล">${navItems.map(([key, label, icon]) => `<a href="/admin#/${key}" class="admin-nav-link ${section === key ? "active" : ""}" ${section === key ? 'aria-current="page"' : ""}><span>${adminIcon(icon)}</span>${label}</a>`).join("")}</nav><div class="admin-sidebar-bottom"><span class="admin-online-dot"></span>เชื่อมต่อระบบแล้ว</div></aside><main class="admin-main"><header class="admin-topbar"><div><span class="admin-crumb">HarnKhong / Admin</span><h1>${sectionTitle(section)}</h1></div><div class="admin-account"><span class="admin-account-avatar">${escapeHtml((user?.email || "A").slice(0, 1).toUpperCase())}</span><span><strong>${escapeHtml(user?.email || "ผู้ดูแล")}</strong><small>ผู้ดูแลระบบ</small></span><button type="button" data-admin-action="logout" class="admin-logout">ออกจากระบบ</button></div></header><div class="admin-content">${content}</div></main></div><div class="admin-toast" role="status" aria-live="polite">${escapeHtml(feedback)}</div>`;
}

function loading(title = "กำลังโหลดข้อมูล…") {
  return `<div class="admin-loading"><span class="admin-spinner" aria-hidden="true"></span>${title}</div>`;
}

function errorState(message) {
  return `<section class="admin-empty"><h2>โหลดข้อมูลไม่สำเร็จ</h2><p>${escapeHtml(message)}</p><button type="button" class="admin-secondary" data-admin-action="reload">ลองอีกครั้ง</button></section>`;
}

function statCard(label, value, note, icon, color) {
  return `<article class="admin-stat"><span class="admin-stat-icon ${color}" aria-hidden="true">${icon}</span><div><span>${label}</span><strong>${escapeHtml(value)}</strong><small>${note}</small></div></article>`;
}

function table(headers, rows, emptyText = "ยังไม่มีข้อมูล") {
  return `<div class="admin-table-scroll"><table><thead><tr>${headers.map((header) => `<th>${header}</th>`).join("")}</tr></thead><tbody>${rows || `<tr><td class="admin-table-empty" colspan="${headers.length}">${emptyText}</td></tr>`}</tbody></table></div>`;
}

function statusPill(status) {
  const labels = {
    cancelled: "ยกเลิก", awaiting_approval: "รอสมาชิกยืนยัน", ready: "พร้อมดำเนินการ",
  };
  const tone = status === "ready" ? "good" : status === "cancelled" ? "bad" : "pending";
  return `<span class="admin-status ${tone}">${escapeHtml(labels[status] || status || "—")}</span>`;
}

function dashboardContent(data) {
  const money = (satang) => satang == null ? "—" : `฿${(Number(satang) / 100).toLocaleString("th-TH", { minimumFractionDigits: 2 })}`;
  const rows = (data.recentGroups || []).map((group) => `<tr><td><strong>${escapeHtml(group.product_title || group.name)}</strong><small>${escapeHtml(group.name)}</small></td><td>${escapeHtml(group.owner_email || "สมาชิก")}</td><td>${money(group.total_satang)}</td><td>${statusPill(group.status)}</td><td>${formatDate(group.created_at)}</td><td><a class="admin-row-link" href="/admin#/groups">ดูกลุ่ม</a></td></tr>`).join("");
  const trend = data.analytics?.groupsByDay || [];
  const maxCount = Math.max(1, ...trend.map((day) => day.count));
  const hasTrend = trend.some((day) => day.count > 0);
  const tickEvery = trend.length > 60 ? 15 : trend.length > 14 ? 5 : 1;
  const chart = hasTrend ? `<div class="admin-chart" role="img" aria-label="จำนวนกลุ่มที่สร้างในแต่ละวันย้อนหลัง ${data.analytics.rangeDays} วัน">${trend.map((day, index) => `<div class="admin-chart-column"><span class="admin-chart-value">${day.count || ""}</span><span class="admin-chart-bar" style="--bar-height:${Math.max(day.count ? 10 : 2, Math.round((day.count / maxCount) * 100))}%"></span>${index % tickEvery === 0 || index === trend.length - 1 ? `<time datetime="${escapeHtml(day.date)}">${new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${day.date}T12:00:00Z`))}</time>` : "<span></span>"}</div>`).join("")}</div>` : `<p class="admin-inline-empty">ยังไม่มีข้อมูลในช่วงวันที่นี้</p>`;
  const activityNames = { member_registered: "สมัครสมาชิกใหม่", group_created: "สร้างกลุ่มใหม่", member_joined: "เข้าร่วมกลุ่ม", member_left: "ออกจากกลุ่ม", costs_changed: "เปลี่ยนข้อมูลค่าใช้จ่าย", leadership_transferred: "เปลี่ยนหัวหน้ากลุ่ม", share_approved: "ยืนยันข้อมูลกลุ่ม", group_details_changed: "แก้ไขข้อมูลกลุ่ม" };
  const activity = (data.recentActivity || []).map((item) => `<li><span class="admin-activity-dot" aria-hidden="true"></span><div><strong>${escapeHtml(activityNames[item.kind] || "กิจกรรมกลุ่ม")}</strong><p>${escapeHtml(item.actor || "สมาชิก")} · ${escapeHtml(item.target || "")}</p></div><time datetime="${escapeHtml(item.created_at)}">${formatDate(item.created_at)}</time></li>`).join("");
  const statusLine = (label, state) => `<div class="admin-system-row"><span>${label}</span><strong class="${state === "unavailable" ? "is-unavailable" : "is-ok"}"><i></i>${state === "connected" ? "เชื่อมต่อแล้ว" : state === "authorized" ? "ยืนยันสิทธิ์แล้ว" : "ยังไม่มีข้อมูล"}</strong></div>`;
  return `<section class="admin-welcome"><div><h2>ยินดีต้อนรับกลับ</h2><p>ภาพรวมข้อมูลจริงของระบบหารของ</p></div><span class="admin-welcome-mark" aria-hidden="true">HK</span></section>
    <section class="admin-stat-grid">${statCard("สมาชิกทั้งหมด", data.stats.users ?? "—", "บัญชี Supabase Auth", "♙", "blue")}${statCard("กลุ่มทั้งหมด", data.stats.groups ?? "—", "กลุ่มหารของ", "♧", "violet")}${statCard("กลุ่มรอยืนยัน", data.stats.awaitingGroups ?? "—", "สถานะรอสมาชิกยืนยัน", "✓", "amber")}${statCard("สินค้าเปิดขาย", data.stats.activeProducts ?? "—", "สินค้าที่ Active", "◇", "green")}</section>
    <section class="admin-panel admin-analytics"><div class="admin-panel-heading"><div><h2>แนวโน้มกลุ่มหารของ</h2><p>จำนวนกลุ่มที่สร้าง · ยอดขายที่ยืนยันแล้วไม่มีแหล่งข้อมูลในระบบหารของ</p></div><label class="admin-range-label">ช่วงวันที่<select data-admin-range aria-label="ช่วงวันที่ของกราฟ"><option value="7" ${dashboardRangeDays === 7 ? "selected" : ""}>7 วัน</option><option value="30" ${dashboardRangeDays === 30 ? "selected" : ""}>30 วัน</option><option value="90" ${dashboardRangeDays === 90 ? "selected" : ""}>90 วัน</option></select></label></div><div class="admin-analytics-body"><div>${chart}</div><aside class="admin-sales-unavailable"><span>ยอดขายที่ยืนยันแล้ว</span><strong>ยังไม่มีข้อมูล</strong><small>ระบบหารของยังไม่มีรายการชำระเงินที่บันทึกในฐานข้อมูล</small></aside></div></section>
    <section class="admin-dashboard-grid"><div class="admin-panel"><div class="admin-panel-heading"><div><h2>การชำระเงิน</h2><p>ตัวเลขจะแสดงเมื่อมีข้อมูลการชำระเงินจริง</p></div></div><div class="admin-unavailable"><strong>ยังไม่มีข้อมูลการชำระเงิน</strong><span>ระบบกลุ่มหารของปัจจุบันยังไม่มีตารางรายการชำระ จึงไม่แสดงยอดหรือจำนวนรอตรวจสอบ</span></div></div><div class="admin-panel"><div class="admin-panel-heading"><div><h2>กิจกรรมล่าสุด</h2><p>รายการจากประวัติกลุ่มและสมาชิกที่สมัคร</p></div></div>${activity ? `<ul class="admin-activity-list">${activity}</ul>` : `<p class="admin-inline-empty">ยังไม่มีกิจกรรม</p>`}</div></section>
    <section class="admin-panel"><div class="admin-panel-heading"><div><h2>กลุ่มหารของล่าสุด</h2><p>ข้อมูลกลุ่มที่มีอยู่จริงในระบบปัจจุบัน</p></div><a href="/admin#/groups">ดูกลุ่มทั้งหมด <span aria-hidden="true">→</span></a></div>${table(["สินค้า / กลุ่ม", "ผู้สร้าง", "ยอดต่อกลุ่ม", "สถานะ", "วันที่", ""], rows, "ยังไม่มีกลุ่มหารของ")}</section>
    <section class="admin-panel admin-system"><div class="admin-panel-heading"><div><h2>สถานะระบบ</h2><p>ตรวจสอบจากการโหลดข้อมูลครั้งนี้</p></div></div><div class="admin-system-grid">${statusLine("Supabase", data.system.supabase)}${statusLine("Authentication", data.system.authentication)}${statusLine("การตรวจสอบการชำระ", data.system.paymentVerification)}<div class="admin-system-row"><span>อัปเดตล่าสุด</span><strong>${formatDate(data.system.updatedAt)}</strong></div></div></section>`;
}

async function invoke(action, payload = {}) {
  const { data, error } = await currentClient.functions.invoke("admin-api", { body: { action, ...payload } });
  if (error) {
    let detail = "";
    try { detail = (await error.context?.json())?.error || ""; } catch { /* use the client message */ }
    throw new Error(detail || error.message || "ไม่สามารถเชื่อมต่อระบบ Admin ได้");
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

async function getSectionContent(section) {
  if (section === "dashboard") {
    const data = await invoke("overview", { rangeDays: dashboardRangeDays });
    return dashboardContent(data);
  }
  if (section === "users") {
    const { rows } = await invoke("users");
    return `<section class="admin-panel"><div class="admin-panel-heading"><div><h2>สมาชิก</h2><p>ข้อมูลบัญชีจาก Supabase Auth และโปรไฟล์สมาชิก</p></div></div>${table(["ชื่อที่แสดง", "อีเมล", "สถานะบัญชี", "สมัครเมื่อ"], rows.map((user) => `<tr><td><strong>${escapeHtml(user.display_name || "ยังไม่ตั้งชื่อ")}</strong></td><td>${escapeHtml(user.email || "—")}</td><td>${user.email_confirmed_at ? '<span class="admin-status good">ยืนยันอีเมลแล้ว</span>' : '<span class="admin-status pending">ยังไม่ยืนยัน</span>'}</td><td>${formatDate(user.created_at)}</td></tr>`).join(""), "ยังไม่มีสมาชิก")}</section>`;
  }
  if (section === "groups") {
    const { rows } = await invoke("groups");
    return `<section class="admin-panel"><div class="admin-panel-heading"><div><h2>กลุ่มหารของ</h2><p>ภาพรวมกลุ่มที่สร้างบนแพลตฟอร์ม</p></div></div>${table(["ชื่อกลุ่ม", "เจ้าของ", "สมาชิก", "สถานะ", "สร้างเมื่อ"], rows.map((row) => `<tr><td><strong>${escapeHtml(row.name)}</strong></td><td>${escapeHtml(row.owner_email || "สมาชิก")}</td><td>${escapeHtml(row.member_count)}</td><td>${statusPill(row.status)}</td><td>${formatDate(row.created_at)}</td></tr>`).join(""), "ยังไม่มีกลุ่ม")}</section>`;
  }
  return `<section class="admin-panel admin-settings"><h2>สิทธิ์ผู้ดูแลระบบ</h2><p>สิทธิ์ตรวจจาก <code>app_metadata.role = admin</code> และรายชื่อที่กำหนดใน Edge Function ทุกครั้งก่อนเข้าถึงข้อมูล</p><dl><div><dt>บัญชีผู้ดูแล</dt><dd>${ADMIN_EMAILS.map(escapeHtml).join("<br>")}</dd></div><div><dt>เพิ่มผู้ดูแลในอนาคต</dt><dd>เพิ่มอีเมลใน secret <code>ADMIN_EMAILS</code> ของ Edge Function แล้วให้ผู้ใช้เข้าสู่ระบบครั้งแรกเพื่อกำหนดสิทธิ์</dd></div><div><dt>รหัสผ่าน</dt><dd>จัดการผ่าน Supabase Auth เท่านั้น ไม่มีการเก็บรหัสผ่านไว้ในเว็บ</dd></div></dl><p class="admin-truth-note">รายการที่มีสิทธิ์สูงอ่านและแก้ไขผ่าน Edge Function ฝั่งเซิร์ฟเวอร์ ไม่ส่ง Service Role Key มาที่เบราว์เซอร์</p></section>`;
}

async function renderAuthenticated(generation) {
  const { data: { user: firstUser }, error: userError } = await currentClient.auth.getUser();
  if (generation !== pageGeneration) return;
  if (userError || !firstUser) return renderLogin("กรุณาเข้าสู่ระบบบัญชีผู้ดูแล");
  let user = firstUser;
  try {
    const access = await invoke("bootstrap");
    if (access.refresh_required) {
      const { error } = await currentClient.auth.refreshSession();
      if (error) throw error;
      if (generation !== pageGeneration) return;
      const { data, error: refreshedUserError } = await currentClient.auth.getUser();
      if (refreshedUserError || !data.user) throw refreshedUserError || new Error("ไม่พบข้อมูลบัญชีหลังยืนยันสิทธิ์");
      user = data.user;
    }
  } catch (err) {
    if (generation !== pageGeneration) return;
    const message = err.message?.includes("ADMIN_NOT_ALLOWED")
    ? `บัญชีนี้ไม่มีสิทธิ์ Admin กรุณาเลือก Google บัญชี ${ADMIN_EMAIL_LABEL}`
      : err.message?.includes("ADMIN_EMAIL_UNCONFIRMED")
        ? "บัญชีนี้ยังยืนยันอีเมลไม่ครบ กรุณายืนยันอีเมล Google แล้วลองใหม่"
        : err.message || "ตรวจสอบสิทธิ์ Admin ไม่สำเร็จ";
    return renderLogin(message);
  }
  const root = document.querySelector("#app");
  if (!root) return;
  const section = activeSection();
  shell(loading(), { user, section });
  try {
    const content = await getSectionContent(section);
    if (generation !== pageGeneration) return;
    shell(content, { user, section });
  } catch (err) {
    if (generation !== pageGeneration) return;
    shell(errorState(err.message || "ไม่สามารถโหลดข้อมูลจากระบบได้"), { user, section });
  }
}

async function renderLogin(message = "") {
  feedback = message;
  const root = document.querySelector("#app");
  if (!root) return;
  shell("", { login: true });
  const form = root.querySelector("#admin-login-form");
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!currentClient || busy) return;
    busy = true;
    feedback = "";
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    button.textContent = "กำลังเข้าสู่ระบบ…";
    const values = new FormData(form);
    try {
      const { error } = await currentClient.auth.signInWithPassword({ email: String(values.get("email")).trim(), password: String(values.get("password")) });
      if (error) throw error;
      feedback = "";
      busy = false;
      await renderAuthenticated(pageGeneration);
    } catch (error) {
      feedback = error.message?.includes("ADMIN_NOT_ALLOWED") ? `บัญชีนี้ไม่มีสิทธิ์ Admin กรุณาใช้ ${ADMIN_EMAIL_LABEL}` : error.message?.includes("ADMIN_EMAIL_UNCONFIRMED") ? "กรุณายืนยันอีเมลก่อนเข้าใช้งานระบบผู้ดูแล" : error.message?.toLowerCase().includes("provider is not enabled") ? "Google OAuth ยังไม่ได้เปิดใน Supabase Auth กรุณาตั้งค่า Google provider ก่อน" : error.message?.includes("Failed to fetch") ? "ยังเชื่อมต่อระบบ Admin ไม่ได้ กรุณาตรวจว่าได้ติดตั้ง Edge Function แล้ว" : "เข้าสู่ระบบไม่สำเร็จ ตรวจสอบอีเมลและรหัสผ่านอีกครั้ง";
      busy = false;
      renderLogin(feedback);
      return;
    }
    busy = false;
  });
}

export function mountAdminPage({ supabase, supabaseConfigured }) {
  currentClient = supabase;
  const generation = ++pageGeneration;
  if (!supabaseConfigured || !supabase) return renderLogin("ต้องตั้งค่า Supabase ก่อนใช้งานระบบผู้ดูแล");
  currentClient.auth.getSession().then(({ data, error }) => {
    if (generation !== pageGeneration) return;
    if (error || !data.session) renderLogin();
    else renderAuthenticated(generation);
  }).catch(() => generation === pageGeneration && renderLogin("ไม่สามารถตรวจสอบเซสชันได้"));
}

export function unmountAdminPage() {
  pageGeneration += 1;
  currentClient = null;
  document.body.classList.remove("admin-mode");
}

document.addEventListener("click", async (event) => {
  const link = event.target.closest(".admin-nav-link");
  if (link) {
    event.preventDefault();
    history.pushState({}, "", link.href);
    mountAdminPage({ supabase: currentClient, supabaseConfigured: Boolean(currentClient) });
    return;
  }
  const button = event.target.closest("[data-admin-action]");
  if (!button || !currentClient) return;
  const action = button.dataset.adminAction;
  if (action === "google-login") {
    if (busy) return;
    // A stale customer sign-in return path must not override the Admin OAuth callback.
    sessionStorage.removeItem("harn-return");
    busy = true;
    button.disabled = true;
    button.textContent = "กำลังเชื่อมต่อ Google…";
    try {
      const { error } = await currentClient.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${location.origin}/admin`,
          queryParams: { prompt: "select_account" },
        },
      });
      if (error) throw error;
    } catch (error) {
      feedback = error.message?.toLowerCase().includes("provider is not enabled")
        ? "Google OAuth ยังไม่ได้เปิดใน Supabase Auth กรุณาตั้งค่า Google provider ก่อน"
        : error.message || "เริ่มเข้าสู่ระบบด้วย Google ไม่สำเร็จ";
      busy = false;
      renderLogin(feedback);
    }
  } else if (action === "logout") {
    await currentClient.auth.signOut();
    feedback = "ออกจากระบบแล้ว";
    renderLogin();
  } else if (action === "reload") {
    mountAdminPage({ supabase: currentClient, supabaseConfigured: true });
  }
});

document.addEventListener("change", (event) => {
  const select = event.target.closest("[data-admin-range]");
  if (!select || !currentClient) return;
  dashboardRangeDays = Number(select.value) || 7;
  mountAdminPage({ supabase: currentClient, supabaseConfigured: true });
});

window.addEventListener("popstate", () => {
  if (location.pathname === "/admin" || location.pathname.startsWith("/admin/"))
    mountAdminPage({ supabase: currentClient, supabaseConfigured: Boolean(currentClient) });
});
