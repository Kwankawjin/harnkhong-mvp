import "./admin.css";

const navItems = [
  ["dashboard", "ภาพรวม", "grid"],
  ["payments", "การชำระเงิน", "payments"],
  ["billing", "Plus และรายเดือน", "payments"],
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
let paymentMonitorTimer = null;
let seenPaymentReportIds = null;
let groupApprovalMonitorTimer = null;
let seenGroupApprovalCounts = null;
let cachedAdminGroups = [];
let cachedPaymentReports = [];
let groupSearchQuery = "";
let groupCategoryFilter = "all";

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

function formatMoney(satang) {
  return satang == null ? "—" : `฿${(Number(satang) / 100).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function paymentStatus(status, staleRevision = false) {
  const label = staleRevision && status === "reported" ? "ยอดรอบเก่า · ต้องแจ้งใหม่" : status === "reported" ? "รอตรวจสอบ" : status === "verified" ? "ยืนยันรับเงินแล้ว" : status === "rejected" ? "ยอดไม่ตรง" : status || "—";
  const tone = status === "verified" ? "good" : status === "reported" && !staleRevision ? "pending" : "bad";
  return `<span class="admin-status ${tone}">${escapeHtml(label)}</span>`;
}

function groupApprovalRows(rows, emptyText = "ยังไม่มีสมาชิกยืนยันยอด", pendingOnly = true) {
  const displayRows = pendingOnly
    ? rows.filter((row) => Number(row.approval_count || 0) > 0
      && Number(row.admin_approved_revision) !== Number(row.revision))
    : rows;
  const rendered = displayRows.map((row) => {
    const count = Number(row.approval_count || 0);
    const members = Number(row.member_count || 0);
    const reviewed = Number(row.admin_approved_revision) === Number(row.revision);
    const canReview = row.status !== "cancelled" && members === Number(row.capacity) && count === members && !reviewed;
    const state = reviewed
      ? '<span class="admin-status good">ยืนยันยอดรอบนี้แล้ว</span>'
      : canReview
        ? '<span class="admin-status pending">รอคุณตรวจยอดรอบนี้</span>'
        : `<span class="admin-status ${count ? "pending" : ""}">สมาชิกยืนยัน ${escapeHtml(count)} / ${escapeHtml(members)} คน</span>`;
    const reviewAction = canReview
      ? `<button type="button" class="admin-primary" data-admin-action="confirm-group-revision" data-group-id="${escapeHtml(row.id)}" data-revision="${escapeHtml(row.revision)}">ตรวจยอดและยืนยันรอบ</button>`
      : reviewed ? `<small>ยืนยันรอบแล้ว ${formatDate(row.admin_approved_at)}</small>` : `<small>รอสมาชิกครบ ${escapeHtml(members)} / ${escapeHtml(row.capacity)} คน</small>`;
    const action = `<div class="admin-row-actions">${reviewAction}<button type="button" class="admin-danger" data-admin-action="delete-group" data-group-id="${escapeHtml(row.id)}" data-group-name="${escapeHtml(row.name)}">ลบกลุ่ม</button></div>`;
    return `<tr><td><strong>${escapeHtml(row.name)}</strong><small>รอบยอด ${escapeHtml(row.revision)} · ${(row.category_labels || []).map(escapeHtml).join(" · ")}</small></td><td>${state}<small>ยอดรวม ${formatMoney(row.total_satang)}</small></td><td>${formatDate(row.last_approval_at)}</td><td>${action}</td></tr>`;
  }).join("");
  return table(["กลุ่ม / รอบยอด", "สมาชิกยืนยัน", "ยืนยันล่าสุด", "ตรวจสอบ"], rendered, emptyText);
}

function paymentsContent(rows, groupRows = cachedAdminGroups) {
  const rendered = rows.map((row) => {
    const actions = row.status === "reported" && !row.stale_revision && row.slip_path
      ? `<div class="admin-row-actions"><button type="button" class="admin-primary admin-payment-verify" data-admin-action="verify-group-payment" data-payment-id="${escapeHtml(row.id)}">ยอมรับ · ยืนยันรับเงิน</button><button type="button" class="admin-danger" data-admin-action="reject-group-payment" data-payment-id="${escapeHtml(row.id)}">ปฏิเสธ</button></div>`
      : row.status === "reported" && !row.stale_revision && !row.slip_path ? "<small>รอสมาชิกแนบสลิป</small>"
      : row.stale_revision && row.status === "reported" ? "—" : row.verified_at ? formatDate(row.verified_at) : "—";
    const slip = row.slip_url
      ? `<a class="admin-payment-slip" href="${escapeHtml(row.slip_url)}" target="_blank" rel="noopener noreferrer"><img src="${escapeHtml(row.slip_url)}" alt="สลิปโอนเงินของ ${escapeHtml(row.member_name)}"/><span>เปิดดูสลิป</span></a>`
      : '<span class="admin-payment-slip-missing">ยังไม่มีสลิป</span>';
    return `<tr><td><strong>${escapeHtml(row.group_name)}</strong><small>รอบยอด ${escapeHtml(row.revision)}${row.stale_revision ? ` · รอบปัจจุบัน ${escapeHtml(row.current_revision)}` : ""}</small></td><td><strong>${escapeHtml(row.member_name)}</strong><small>${escapeHtml(row.member_email)}</small></td><td>${formatMoney(row.amount_satang)}</td><td>${slip}</td><td>${paymentStatus(row.status, row.stale_revision)}${row.rejection_note ? `<small>${escapeHtml(row.rejection_note)}</small>` : row.stale_revision && row.status === "reported" ? "<small>กลุ่มเปลี่ยนยอดหลังแจ้งโอน</small>" : ""}</td><td><strong>โอน ${formatDate(row.transferred_at)}</strong><small>แจ้ง ${formatDate(row.reported_at)}</small></td><td>${actions}</td></tr>`;
  }).join("");
  const alerts = typeof Notification !== "undefined" && Notification.permission === "granted"
    ? "เปิดแจ้งเตือนบนอุปกรณ์นี้แล้ว"
    : "เปิดแจ้งเตือนเมื่อมีคนแจ้งโอน";
  const pending = groupRows.filter((row) => Number(row.approval_count || 0) > 0
    && Number(row.admin_approved_revision) !== Number(row.revision));
  return `<section class="admin-panel admin-payment-approval-queue"><div class="admin-panel-heading"><div><h2>ยอดที่สมาชิกยืนยัน รอแอดมินตรวจ</h2><p>คิวนี้แสดงการยืนยันยอดกลุ่ม ส่วนรายการตรวจเงินโอนอยู่ด้านล่าง</p></div><button type="button" class="admin-secondary" data-admin-action="reload">รีเฟรช</button></div>${groupApprovalRows(groupRows, "ยังไม่มีสมาชิกยืนยันยอด")}${pending.length ? "" : '<p class="admin-truth-note">เมื่อสมาชิกกดยืนยันยอด กลุ่มจะแสดงในรายการนี้</p>'}</section><section class="admin-panel"><div class="admin-panel-heading"><div><h2>รายการชำระเงินจริง</h2><p>ตรวจชื่อผู้โอน สลิป วันเวลาที่โอน แล้วกดยอมรับหรือปฏิเสธ</p></div><div class="admin-panel-actions"><button type="button" class="admin-secondary" data-admin-action="enable-payment-alerts">${alerts}</button></div></div>${table(["กลุ่ม / รอบยอด", "สมาชิกผู้แจ้ง", "ยอดโอน", "สลิป", "สถานะ", "วันเวลา", "ตรวจสอบ"], rendered, "ยังไม่มีรายการชำระเงิน")}${rows.length ? "" : '<p class="admin-truth-note">รายการจะแสดงหลังสมาชิกแจ้งว่าโอนแล้วพร้อมแนบสลิป</p>'}</section>`;
}

function categoriesForGroup(row) {
  return Array.isArray(row.category_labels) && row.category_labels.length
    ? row.category_labels
    : Array.isArray(row.categories) && row.categories.length
      ? row.categories
      : row.category ? [row.category] : ["ไม่ระบุหมวดหมู่"];
}

function groupResultsContent(rows) {
  const query = groupSearchQuery.trim().toLocaleLowerCase("th-TH");
  const prioritizedRows = [...rows].sort((a, b) => {
    const waitingForAdmin = (row) => Number(row.member_count) === Number(row.capacity)
      && Number(row.approval_count) === Number(row.member_count)
      && Number(row.admin_approved_revision) !== Number(row.revision);
    const priority = Number(waitingForAdmin(b)) - Number(waitingForAdmin(a));
    if (priority) return priority;
    return String(b.last_approval_at || b.created_at).localeCompare(String(a.last_approval_at || a.created_at));
  });
  const filtered = prioritizedRows.filter((row) => {
    const categoryMatch = groupCategoryFilter === "all" || categoriesForGroup(row).includes(groupCategoryFilter);
    const nameMatch = !query || `${row.name || ""} ${row.product_title || ""}`.toLocaleLowerCase("th-TH").includes(query);
    return categoryMatch && nameMatch;
  });
  const byCategory = new Map();
  for (const row of filtered) {
    for (const category of categoriesForGroup(row)) {
      if (groupCategoryFilter !== "all" && category !== groupCategoryFilter) continue;
      if (!byCategory.has(category)) byCategory.set(category, []);
      byCategory.get(category).push(row);
    }
  }
  if (!byCategory.size) return '<p class="admin-group-no-results">ไม่พบกลุ่มที่ตรงกับคำค้นหาหรือหมวดหมู่</p>';
  return [...byCategory].sort(([a], [b]) => a.localeCompare(b, "th-TH")).map(([category, categoryRows]) =>
    `<section class="admin-group-category"><div class="admin-group-category-heading"><h3>${escapeHtml(category)}</h3><span>${categoryRows.length} กลุ่ม</span></div>${groupApprovalRows(categoryRows, "ไม่มีข้อมูลกลุ่ม", false)}</section>`,
  ).join("");
}

function groupsContent(rows) {
  cachedAdminGroups = rows;
  const categories = [...new Set(rows.flatMap(categoriesForGroup))].sort((a, b) => a.localeCompare(b, "th-TH"));
  const alerts = typeof Notification !== "undefined" && Notification.permission === "granted"
    ? "เปิดแจ้งเตือนบนอุปกรณ์นี้แล้ว"
    : "เปิดแจ้งเตือนยอดกลุ่ม";
  return `<section class="admin-panel"><div class="admin-panel-heading"><div><h2>กลุ่มหารของ</h2><p>ค้นหากลุ่มและดูรายการแยกตามหมวดหมู่</p></div><div class="admin-panel-actions"><button type="button" class="admin-secondary" data-admin-action="enable-group-alerts">${alerts}</button><button type="button" class="admin-secondary" data-admin-action="reload">รีเฟรช</button></div></div><div class="admin-group-filters"><label class="admin-group-filter admin-group-search">ค้นหาชื่อกลุ่ม<input type="search" data-admin-group-search value="${escapeHtml(groupSearchQuery)}" placeholder="พิมพ์ชื่อกลุ่มหรือสินค้า"/></label><label class="admin-group-filter admin-group-category-filter">หมวดหมู่<select data-admin-group-category><option value="all" ${groupCategoryFilter === "all" ? "selected" : ""}>ทุกหมวดหมู่</option>${categories.map((category) => `<option value="${escapeHtml(category)}" ${groupCategoryFilter === category ? "selected" : ""}>${escapeHtml(category)}</option>`).join("")}</select></label></div><div class="admin-group-results">${groupResultsContent(rows)}</div></section>`;
}

async function pollPaymentReports() {
  const { rows = [] } = await invoke("payments");
  const incoming = seenPaymentReportIds === null ? [] : rows.filter((row) => row.status === "reported" && !seenPaymentReportIds.has(row.id));
  seenPaymentReportIds = new Set(rows.map((row) => row.id));
  for (const row of incoming) {
    const message = `${row.group_name} · ${row.member_name} · ${formatMoney(row.amount_satang)}`;
    feedback = `มีรายการแจ้งโอนใหม่: ${message}`;
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      const notice = new Notification("HarnKhong · มีรายการแจ้งโอน", { body: message, tag: `payment-${row.id}` });
      notice.onclick = () => { window.focus(); history.pushState({}, "", "/admin#/payments"); mountAdminPage({ supabase: currentClient, supabaseConfigured: Boolean(currentClient) }); notice.close(); };
    }
  }
  cachedPaymentReports = rows;
  if (activeSection() === "payments") {
    const content = document.querySelector(".admin-content");
    if (content) content.innerHTML = paymentsContent(rows, cachedAdminGroups);
  }
  const toast = document.querySelector(".admin-toast");
  if (toast && incoming.length) toast.textContent = feedback;
}

function startPaymentMonitor() {
  if (paymentMonitorTimer) return;
  pollPaymentReports().catch(() => {});
  paymentMonitorTimer = window.setInterval(() => pollPaymentReports().catch(() => {}), 15000);
}

async function pollGroupApprovals() {
  const { rows = [] } = await loadAdminGroups();
  const current = new Map(rows.map((row) => [row.id, {
    revision: Number(row.revision),
    count: Number(row.approval_count || 0),
  }]));
  const incoming = seenGroupApprovalCounts === null
    ? []
    : rows.flatMap((row) => {
      const count = Number(row.approval_count || 0);
      const previous = seenGroupApprovalCounts.get(row.id);
      const revisionChanged = previous && previous.revision !== Number(row.revision);
      return count > 0 && (!previous || revisionChanged || count > previous.count)
        ? [{ row, count }]
        : [];
    });
  seenGroupApprovalCounts = current;
  cachedAdminGroups = rows;
  if (incoming.length) {
    const { row, count } = incoming[incoming.length - 1];
    const message = `${row.name} · สมาชิกยืนยัน ${count}/${row.member_count} คน`;
    feedback = `มีสมาชิกยืนยันยอดใหม่: ${message}`;
    for (const item of incoming) {
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        const notice = new Notification("HarnKhong · สมาชิกยืนยันยอด", {
          body: `${item.row.name} · ยืนยันแล้ว ${item.count}/${item.row.member_count} คน`,
          tag: `group-approval-${item.row.id}-${item.row.revision}-${item.count}`,
        });
        notice.onclick = () => {
          window.focus();
          history.pushState({}, "", "/admin#/payments");
          mountAdminPage({ supabase: currentClient, supabaseConfigured: Boolean(currentClient) });
          notice.close();
        };
      }
    }
  }
  if (activeSection() === "groups") {
    const content = document.querySelector(".admin-content");
    if (content) {
      const active = document.activeElement;
      const focusedFilter = active?.matches?.("[data-admin-group-search], [data-admin-group-category]")
        ? active.hasAttribute("data-admin-group-search") ? "search" : "category"
        : "";
      const selection = focusedFilter === "search" ? active.selectionStart : null;
      content.innerHTML = groupsContent(rows);
      const nextFilter = focusedFilter === "search"
        ? content.querySelector("[data-admin-group-search]")
        : focusedFilter === "category" ? content.querySelector("[data-admin-group-category]") : null;
      if (nextFilter) {
        nextFilter.focus();
        if (focusedFilter === "search" && selection !== null) nextFilter.setSelectionRange(selection, selection);
      }
    }
  } else if (activeSection() === "payments") {
    const content = document.querySelector(".admin-content");
    if (content) content.innerHTML = paymentsContent(cachedPaymentReports, rows);
  }
  const toast = document.querySelector(".admin-toast");
  if (toast && incoming.length) toast.textContent = feedback;
}

function startGroupApprovalMonitor() {
  if (groupApprovalMonitorTimer) return;
  pollGroupApprovals().catch(() => {});
  groupApprovalMonitorTimer = window.setInterval(() => pollGroupApprovals().catch(() => {}), 15000);
}

function sectionTitle(section) {
  return navItems.find(([key]) => key === section)?.[1] || "ภาพรวม";
}

function adminIcon(name) {
  const paths = {
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    payments: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h4"/>',
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

/** Every group, read with the admin-only RPC from the same database the website uses. */
async function loadAdminGroups() {
  const { data, error } = await currentClient.rpc("admin_list_groups", { p_limit: 500 });
  if (error) {
    const message = String(error.message || "");
    if (error.code === "PGRST202" || message.includes("Could not find the function"))
      throw new Error("ฐานข้อมูลยังไม่มีฟังก์ชันรายชื่อกลุ่ม กรุณารัน migration 20261120110000_admin_group_rpcs.sql ใน Supabase SQL Editor");
    throw new Error(billingErrorMessage(error));
  }
  return { rows: data || [] };
}

function billingErrorMessage(error) {
  const message = String(error?.message || "");
  if (error?.code === "PGRST202" || message.includes("Could not find the function"))
    return "ฐานข้อมูลยังไม่มีฟังก์ชันของหน้านี้ กรุณารัน migration 20261120100000_admin_billing_rpcs.sql ใน Supabase SQL Editor";
  if (message.includes("admin_only")) return "บัญชีนี้ไม่มีสิทธิ์ผู้ดูแลระบบ ออกจากระบบแล้วเข้าใหม่อีกครั้ง";
  if (message.includes("payment_not_pending")) return "รายการนี้ถูกตรวจไปแล้ว";
  if (message.includes("subscription_payments") || message.includes("group_cycle"))
    return "ยังไม่มีตาราง Plus หรือรอบรายเดือน กรุณารัน migration 20261119140000_monthly_billing_and_plus.sql";
  return [error?.code, message].filter(Boolean).join(": ") || "โหลดข้อมูลไม่สำเร็จ";
}

function slipCell(row) {
  return row.slip_url
    ? `<a class="admin-payment-slip" href="${escapeHtml(row.slip_url)}" target="_blank" rel="noopener noreferrer"><img src="${escapeHtml(row.slip_url)}" alt="สลิปโอนเงินของ ${escapeHtml(row.member_name)}"/><span>เปิดดูสลิป</span></a>`
    : '<span class="admin-payment-slip-missing">ยังไม่มีสลิป</span>';
}
const billingStatus = { reported: "รอตรวจ", verified: "ยืนยันแล้ว", rejected: "ปฏิเสธแล้ว" };

/** Plus subscription slips and monthly group cycle slips, each with verify and reject. */
function billingContent(subscriptionRows, cycleRows) {
  const plus = subscriptionRows.map((row) => {
    const actions = row.status === "reported"
      ? `<div class="admin-row-actions"><button type="button" class="admin-primary" data-admin-action="verify-subscription-payment" data-payment-id="${escapeHtml(row.id)}">ยืนยันรับเงิน · เปิด Plus</button><button type="button" class="admin-danger" data-admin-action="reject-subscription-payment" data-payment-id="${escapeHtml(row.id)}">ปฏิเสธ</button></div>`
      : row.covers_from ? `<small>ใช้งาน ${formatDate(row.covers_from)} – ${formatDate(row.covers_to)}</small>` : escapeHtml(row.rejection_note || "—");
    return `<tr><td><strong>${escapeHtml(row.member_name)}</strong><small>แจ้งเมื่อ ${formatDate(row.reported_at)}</small></td><td>${formatMoney(row.amount_satang)}</td><td>${slipCell(row)}</td><td>${escapeHtml(billingStatus[row.status] || row.status)}</td><td>${actions}</td></tr>`;
  }).join("");
  const cycles = cycleRows.map((row) => {
    const ids = `data-group-id="${escapeHtml(row.group_id)}" data-user-id="${escapeHtml(row.user_id)}" data-cycle="${escapeHtml(row.cycle_number)}"`;
    const actions = row.status === "reported"
      ? `<div class="admin-row-actions"><button type="button" class="admin-primary" data-admin-action="verify-cycle-payment" ${ids}>ยืนยันรับเงิน</button><button type="button" class="admin-danger" data-admin-action="reject-cycle-payment" ${ids}>ปฏิเสธ</button></div>`
      : row.verified_at ? formatDate(row.verified_at) : escapeHtml(row.rejection_note || "—");
    return `<tr><td><strong>${escapeHtml(row.group_name)}</strong><small>รอบที่ ${escapeHtml(row.cycle_number)} · ${formatDate(row.cycle_starts_at)} – ${formatDate(row.cycle_ends_at)}</small></td><td><strong>${escapeHtml(row.member_name)}</strong></td><td>${formatMoney(row.amount_satang)}</td><td>${slipCell(row)}</td><td>${escapeHtml(billingStatus[row.status] || row.status)}</td><td>${actions}</td></tr>`;
  }).join("");
  return `<section class="admin-panel"><div class="admin-panel-heading"><div><h2>สลิปค่าแพ็กเกจ Plus</h2><p>ยืนยันแล้ว Plus เริ่ม 1 เดือนทันที ถ้ายังใช้งานอยู่จะต่อจากวันสิ้นสุดเดิม</p></div></div>${table(["สมาชิก", "ยอด", "สลิป", "สถานะ", "ดำเนินการ"], plus, "ยังไม่มีสลิปค่าแพ็กเกจ")}</section>
  <section class="admin-panel"><div class="admin-panel-heading"><div><h2>สลิปกลุ่มรายเดือน</h2><p>ยอดของแต่ละรอบล็อกไว้แล้ว ตรวจให้ตรงกับยอดในตาราง</p></div></div>${table(["กลุ่มและรอบ", "สมาชิก", "ยอด", "สลิป", "สถานะ", "ดำเนินการ"], cycles, "ยังไม่มีสลิปรายเดือน")}</section>`;
}

async function getSectionContent(section) {
  if (section === "billing") {
    // Read straight from the database (admin-only RPC), so this page works without redeploying admin-api.
    const { data, error } = await currentClient.rpc("admin_billing_queue");
    if (error) throw new Error(billingErrorMessage(error));
    const sign = async (bucket, rows) => Promise.all((rows || []).map(async (row) => {
      if (!row.slip_path) return { ...row, slip_url: null };
      const { data: signed } = await currentClient.storage.from(bucket).createSignedUrl(row.slip_path, 600);
      return { ...row, slip_url: signed?.signedUrl || null };
    }));
    const [subscriptionRows, cycleRows] = await Promise.all([
      sign("subscription-payment-slips", data?.subscriptions),
      sign("cycle-payment-slips", data?.cycles),
    ]);
    return billingContent(subscriptionRows, cycleRows);
  }
  if (section === "dashboard") {
    const data = await invoke("overview", { rangeDays: dashboardRangeDays });
    return dashboardContent(data);
  }
  if (section === "payments") {
    const [{ rows: paymentRows = [] }, { rows: groupRows = [] }] = await Promise.all([
      invoke("payments"),
      loadAdminGroups(),
    ]);
    cachedPaymentReports = paymentRows;
    cachedAdminGroups = groupRows;
    return paymentsContent(paymentRows, groupRows);
  }
  if (section === "users") {
    const { rows } = await invoke("users");
    return `<section class="admin-panel"><div class="admin-panel-heading"><div><h2>สมาชิก</h2><p>ข้อมูลบัญชีจาก Supabase Auth และโปรไฟล์สมาชิก</p></div></div>${table(["ชื่อที่แสดง", "อีเมล", "สถานะบัญชี", "สมัครเมื่อ"], rows.map((user) => `<tr><td><strong>${escapeHtml(user.display_name || "ยังไม่ตั้งชื่อ")}</strong></td><td>${escapeHtml(user.email || "—")}</td><td>${user.email_confirmed_at ? '<span class="admin-status good">ยืนยันอีเมลแล้ว</span>' : '<span class="admin-status pending">ยังไม่ยืนยัน</span>'}</td><td>${formatDate(user.created_at)}</td></tr>`).join(""), "ยังไม่มีสมาชิก")}</section>`;
  }
  if (section === "groups") {
    const { rows } = await loadAdminGroups();
    cachedAdminGroups = rows;
    return groupsContent(rows);
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
    startPaymentMonitor();
    startGroupApprovalMonitor();
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
  window.clearInterval(paymentMonitorTimer);
  window.clearInterval(groupApprovalMonitorTimer);
  paymentMonitorTimer = null;
  groupApprovalMonitorTimer = null;
  seenPaymentReportIds = null;
  seenGroupApprovalCounts = null;
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
    window.clearInterval(paymentMonitorTimer);
    window.clearInterval(groupApprovalMonitorTimer);
    paymentMonitorTimer = null;
    groupApprovalMonitorTimer = null;
    seenPaymentReportIds = null;
    seenGroupApprovalCounts = null;
    await currentClient.auth.signOut();
    feedback = "ออกจากระบบแล้ว";
    renderLogin();
  } else if (action === "reload") {
    mountAdminPage({ supabase: currentClient, supabaseConfigured: true });
  } else if (action === "enable-payment-alerts") {
    if (typeof Notification === "undefined") {
      feedback = "เบราว์เซอร์นี้ไม่รองรับการแจ้งเตือนบนอุปกรณ์";
    } else {
      const permission = await Notification.requestPermission();
      feedback = permission === "granted" ? "เปิดแจ้งเตือนรายการโอนแล้ว" : "เบราว์เซอร์ไม่ได้รับอนุญาตให้แจ้งเตือน";
    }
    mountAdminPage({ supabase: currentClient, supabaseConfigured: true });
  } else if (action === "enable-group-alerts") {
    if (typeof Notification === "undefined") {
      feedback = "เบราว์เซอร์นี้ไม่รองรับการแจ้งเตือนบนอุปกรณ์";
    } else {
      const permission = await Notification.requestPermission();
      feedback = permission === "granted" ? "เปิดแจ้งเตือนสมาชิกยืนยันยอดแล้ว" : "เบราว์เซอร์ไม่ได้รับอนุญาตให้แจ้งเตือน";
    }
    mountAdminPage({ supabase: currentClient, supabaseConfigured: true });
  } else if (action === "confirm-group-revision") {
    const groupId = button.dataset.groupId;
    const revision = Number(button.dataset.revision);
    if (!groupId || !Number.isSafeInteger(revision) || busy) return;
    if (!confirm("ตรวจสอบยอดรอบปัจจุบันแล้ว และยืนยันให้สมาชิกเห็นว่ายอดรอบนี้ผ่านแล้วใช่หรือไม่?")) return;
    busy = true;
    button.disabled = true;
    button.textContent = "กำลังบันทึก…";
    try {
      await invoke("confirm-group-revision", { groupId, revision });
      feedback = "ยืนยันยอดรอบกลุ่มแล้ว";
    } catch (error) {
      feedback = error.message || "ยืนยันยอดรอบกลุ่มไม่สำเร็จ";
    } finally {
      busy = false;
      mountAdminPage({ supabase: currentClient, supabaseConfigured: true });
    }
  } else if (["verify-subscription-payment", "reject-subscription-payment", "verify-cycle-payment", "reject-cycle-payment"].includes(action)) {
    if (busy) return;
    const rejecting = action.startsWith("reject");
    let rejectionNote = "";
    if (rejecting) {
      const note = prompt("ระบุเหตุผลที่ปฏิเสธ เพื่อให้สมาชิกทราบว่าต้องแก้ไขอะไร", "ไม่พบยอดเงินเข้าบัญชี กรุณาตรวจสอบและแนบสลิปใหม่");
      if (note === null) return;
      rejectionNote = note.trim();
      if (rejectionNote.length < 3 || rejectionNote.length > 500) {
        feedback = "กรุณาระบุเหตุผลอย่างน้อย 3 ตัวอักษรและไม่เกิน 500 ตัวอักษร";
        mountAdminPage({ supabase: currentClient, supabaseConfigured: true });
        return;
      }
    } else if (!confirm("ตรวจรายการเงินเข้าในบัญชีธนาคารแล้ว และยืนยันว่าได้รับยอดนี้ครบถ้วนใช่หรือไม่?")) return;
    busy = true;
    button.disabled = true;
    button.textContent = "กำลังบันทึก…";
    try {
      const approve = !rejecting;
      const { error } = action.includes("subscription")
        ? await currentClient.rpc("admin_review_subscription_payment", { p_payment: button.dataset.paymentId, p_approve: approve, p_note: rejectionNote || null })
        : await currentClient.rpc("admin_review_cycle_payment", { p_group: button.dataset.groupId, p_cycle_number: Number(button.dataset.cycle), p_user: button.dataset.userId, p_approve: approve, p_note: rejectionNote || null });
      if (error) throw new Error(billingErrorMessage(error));
      feedback = rejecting ? "ปฏิเสธรายการแล้ว แจ้งเหตุผลให้สมาชิกทราบแล้ว" : "ยืนยันรับเงินแล้ว";
    } catch (error) {
      feedback = error.message || "บันทึกผลตรวจไม่สำเร็จ";
    } finally {
      busy = false;
      mountAdminPage({ supabase: currentClient, supabaseConfigured: true });
    }
  } else if (action === "verify-group-payment") {
    const paymentId = button.dataset.paymentId;
    if (!paymentId || busy) return;
    if (!confirm("ตรวจรายการเงินเข้าในบัญชีธนาคารแล้ว และยืนยันว่าได้รับยอดนี้ครบถ้วนใช่หรือไม่?")) return;
    busy = true;
    button.disabled = true;
    button.textContent = "กำลังบันทึก…";
    try {
      await invoke("verify-group-payment", { paymentId });
      feedback = "ยืนยันยอดรับเงินแล้ว";
      seenPaymentReportIds?.add(paymentId);
    } catch (error) {
      feedback = error.message || "ยืนยันยอดไม่สำเร็จ";
    } finally {
      busy = false;
      mountAdminPage({ supabase: currentClient, supabaseConfigured: true });
    }
  } else if (action === "reject-group-payment") {
    const paymentId = button.dataset.paymentId;
    if (!paymentId || busy) return;
    const note = prompt("ระบุเหตุผลที่ปฏิเสธ เพื่อให้สมาชิกทราบว่าต้องแก้ไขอะไร", "ไม่พบยอดเงินเข้าบัญชี กรุณาตรวจสอบและแจ้งโอนใหม่");
    if (note === null) return;
    const rejectionNote = note.trim();
    if (rejectionNote.length < 3 || rejectionNote.length > 500) {
      feedback = "กรุณาระบุเหตุผลอย่างน้อย 3 ตัวอักษรและไม่เกิน 500 ตัวอักษร";
      mountAdminPage({ supabase: currentClient, supabaseConfigured: true });
      return;
    }
    if (!confirm("ยืนยันปฏิเสธรายการนี้? สมาชิกจะเห็นเหตุผลและสามารถแจ้งโอนใหม่ได้")) return;
    busy = true;
    button.disabled = true;
    button.textContent = "กำลังบันทึก…";
    try {
      await invoke("reject-group-payment", { paymentId, rejectionNote });
      feedback = "ปฏิเสธรายการแล้ว แจ้งเหตุผลให้สมาชิกทราบแล้ว";
    } catch (error) {
      feedback = error.message || "ปฏิเสธรายการไม่สำเร็จ";
    } finally {
      busy = false;
      mountAdminPage({ supabase: currentClient, supabaseConfigured: true });
    }
  } else if (action === "delete-group") {
    const groupId = button.dataset.groupId;
    const groupName = button.dataset.groupName || "กลุ่มนี้";
    if (!groupId || busy) return;
    if (!confirm(`ลบ “${groupName}” อย่างถาวรหรือไม่? ข้อมูลสมาชิก แชท และรายการชำระเงินของกลุ่มนี้จะถูกลบด้วย`)) return;
    busy = true;
    button.disabled = true;
    button.textContent = "กำลังลบ…";
    try {
      const { error } = await currentClient.rpc("admin_delete_group", { p_group: groupId });
      if (error) {
        const message = String(error.message || "");
        throw new Error(
          error.code === "PGRST202" || message.includes("Could not find the function")
            ? "ฐานข้อมูลยังไม่มีฟังก์ชันลบกลุ่ม กรุณารัน migration 20261120110000_admin_group_rpcs.sql"
            : message.includes("group_not_found") ? "ไม่พบกลุ่มนี้ อาจถูกลบไปแล้ว" : billingErrorMessage(error),
        );
      }
      feedback = `ลบกลุ่ม “${groupName}” แล้ว`;
    } catch (error) {
      feedback = error.message || "ลบกลุ่มไม่สำเร็จ";
    } finally {
      busy = false;
      mountAdminPage({ supabase: currentClient, supabaseConfigured: true });
    }
  }
});

document.addEventListener("input", (event) => {
  const search = event.target.closest("[data-admin-group-search]");
  if (!search) return;
  groupSearchQuery = search.value;
  const results = document.querySelector(".admin-group-results");
  if (results) results.innerHTML = groupResultsContent(cachedAdminGroups);
});

document.addEventListener("change", (event) => {
  const category = event.target.closest("[data-admin-group-category]");
  if (category) {
    groupCategoryFilter = category.value || "all";
    const results = document.querySelector(".admin-group-results");
    if (results) results.innerHTML = groupResultsContent(cachedAdminGroups);
    return;
  }
  const select = event.target.closest("[data-admin-range]");
  if (!select || !currentClient) return;
  dashboardRangeDays = Number(select.value) || 7;
  mountAdminPage({ supabase: currentClient, supabaseConfigured: true });
});

window.addEventListener("popstate", () => {
  if (location.pathname === "/admin" || location.pathname.startsWith("/admin/"))
    mountAdminPage({ supabase: currentClient, supabaseConfigured: Boolean(currentClient) });
});
