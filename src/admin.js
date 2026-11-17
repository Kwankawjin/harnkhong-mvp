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
  const rows = (data.recentGroups || []).map((group) => `<tr><td><strong>${escapeHtml(group.name)}</strong><small>${escapeHtml(String(group.id).slice(0, 8))}</small></td><td>${escapeHtml(group.owner_email || "สมาชิก")}</td><td>${escapeHtml(group.member_count)}</td><td>${statusPill(group.status)}</td><td>${formatDate(group.created_at)}</td></tr>`).join("");
  return `<section class="admin-welcome"><div><h2>ยินดีต้อนรับกลับ</h2><p>ภาพรวมสมาชิกและกลุ่มหารของ HarnKhong</p></div><span class="admin-welcome-mark" aria-hidden="true">HK</span></section><section class="admin-stat-grid">${statCard("สมาชิกทั้งหมด", data.stats.users, "บัญชีสมาชิก", "♙", "blue")}${statCard("กลุ่มหารของ", data.stats.groups, "กลุ่มทั้งหมด", "♧", "violet")}${statCard("รอสมาชิกยืนยัน", data.stats.awaitingGroups, "กลุ่มที่กำลังเปิดรับการยืนยัน", "✓", "amber")}${statCard("พร้อมดำเนินการ", data.stats.readyGroups, "กลุ่มที่สมาชิกยืนยันครบแล้ว", "◇", "green")}</section><section class="admin-panel"><div class="admin-panel-heading"><div><h2>กลุ่มหารของล่าสุด</h2><p>สถานะและจำนวนสมาชิกในแต่ละกลุ่ม</p></div><a href="/admin#/groups">ดูกลุ่มทั้งหมด <span aria-hidden="true">→</span></a></div>${table(["กลุ่ม", "หัวหน้ากลุ่ม", "สมาชิก", "สถานะ", "วันที่สร้าง"], rows, "ยังไม่มีกลุ่มหารของ")}</section>`;
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
    const data = await invoke("overview");
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

window.addEventListener("popstate", () => {
  if (location.pathname === "/admin" || location.pathname.startsWith("/admin/"))
    mountAdminPage({ supabase: currentClient, supabaseConfigured: Boolean(currentClient) });
});
