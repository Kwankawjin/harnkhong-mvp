import "./admin.css";

// Menu in the order the work happens: confirm totals → check slips → settle problems → pay owners.
const navItems = [
  ["dashboard", "งานวันนี้", "grid", ""],
  ["approvals", "1. ยืนยันยอดกลุ่ม", "check", "งานที่ต้องทำ"],
  ["payments", "2. ตรวจสลิป", "slip", "งานที่ต้องทำ"],
  ["disputes", "3. แจ้งปัญหา", "alert", "งานที่ต้องทำ"],
  ["payouts", "4. โอนให้เจ้าของ", "payout", "งานที่ต้องทำ"],
  ["reports", "รายงานปัญหา", "flag", "งานที่ต้องทำ"],
  ["groups", "กลุ่มทั้งหมด", "groups", "ข้อมูล"],
  ["users", "สมาชิก", "users", "ข้อมูล"],
  ["announcements", "ประกาศถึงทุกคน", "flag", "ข้อมูล"],
  ["settings", "ตั้งค่า", "settings", "ระบบ"],
];
// Old links (#/billing) now live on the slips page.
const sectionAliases = { billing: "payments" };
// Pending work per section, shown as badges in the menu and as cards on the dashboard.
let workCounts = {};

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
let cachedBilling = { subscriptions: [], cycles: [] };
let groupSearchQuery = "";
let groupCategoryFilter = "all";

const escapeHtml = (value = "") =>
  String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);

function activeSection() {
  const raw = location.hash.replace(/^#\/?/, "");
  const requested = sectionAliases[raw] || raw;
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

function approvalsContent(groupRows = cachedAdminGroups) {
  const pending = groupRows.filter(isApprovalPending);
  const waiting = groupRows.filter((row) => !isApprovalPending(row) && Number(row.approval_count || 0) > 0 && Number(row.admin_approved_revision) !== Number(row.revision) && row.status !== "cancelled");
  const alerts = typeof Notification !== "undefined" && Notification.permission === "granted" ? "เปิดแจ้งเตือนแล้ว" : "เปิดแจ้งเตือนบนเครื่องนี้";
  return `${howTo(["สมาชิกครบและทุกคนกดยืนยันยอดแล้ว กลุ่มจะขึ้นที่นี่", "ดูยอดรวมว่าสมเหตุสมผล แล้วกด <b>ยืนยันยอดกลุ่ม</b>", "หลังยืนยัน สมาชิกจะเห็น QR และโอนเงินได้"])}
  <section class="admin-panel"><div class="admin-panel-heading"><div><h2>รอคุณยืนยัน ${pending.length ? `<span class="admin-count">${pending.length}</span>` : ""}</h2><p>กลุ่มที่สมาชิกครบและยืนยันยอดกันครบแล้ว</p></div><div class="admin-panel-actions"><button type="button" class="admin-secondary" data-admin-action="enable-group-alerts">${alerts}</button><button type="button" class="admin-secondary" data-admin-action="reload">รีเฟรช</button></div></div>${groupApprovalRows(pending, "ไม่มีงานค้าง 🎉", false)}</section>
  ${waiting.length ? `<section class="admin-panel admin-panel-muted"><div class="admin-panel-heading"><div><h2>กำลังรอสมาชิก</h2><p>ยังไม่ต้องทำอะไร รอให้สมาชิกครบหรือยืนยันยอดครบก่อน</p></div></div>${groupApprovalRows(waiting, "", false)}</section>` : ""}`;
}

/** Slip rows for one-time groups, Plus and monthly cycles, pending first and history folded away. */
function slipSection({ title, note, headers, rows, isPending, render, empty }) {
  const pending = rows.filter(isPending), done = rows.filter((row) => !isPending(row));
  return `<section class="admin-panel"><div class="admin-panel-heading"><div><h2>${title} ${pending.length ? `<span class="admin-count">${pending.length}</span>` : ""}</h2><p>${note}</p></div></div>${table(headers, pending.map(render).join(""), empty)}${done.length ? `<details class="admin-history"><summary>ดูรายการที่ตรวจแล้ว (${done.length})</summary>${table(headers, done.map(render).join(""))}</details>` : ""}</section>`;
}
function paymentsContent(rows = cachedPaymentReports, billing = cachedBilling) {
  const oneTime = (row) => {
    const actions = row.status === "reported" && !row.stale_revision && row.slip_path
      ? `<div class="admin-row-actions"><button type="button" class="admin-primary admin-payment-verify" data-admin-action="verify-group-payment" data-payment-id="${escapeHtml(row.id)}">ยอดถูกต้อง · รับเงิน</button><button type="button" class="admin-danger" data-admin-action="reject-group-payment" data-payment-id="${escapeHtml(row.id)}">ไม่ถูกต้อง</button></div>`
      : row.status === "reported" && !row.stale_revision && !row.slip_path ? "<small>รอสมาชิกแนบสลิป</small>"
      : row.stale_revision && row.status === "reported" ? "<small>ให้สมาชิกแจ้งโอนใหม่</small>" : row.verified_at ? `<small>ตรวจแล้ว ${formatDate(row.verified_at)}</small>` : "—";
    return `<tr><td><strong>${escapeHtml(row.group_name)}</strong><small>${escapeHtml(row.member_name)} · ${escapeHtml(row.member_email)}</small></td><td><strong>${formatMoney(row.amount_satang)}</strong><small>โอน ${formatDate(row.transferred_at)}</small></td><td>${slipCell(row)}</td><td>${paymentStatus(row.status, row.stale_revision)}${row.rejection_note ? `<small>${escapeHtml(row.rejection_note)}</small>` : row.stale_revision && row.status === "reported" ? "<small>กลุ่มเปลี่ยนยอดหลังแจ้งโอน</small>" : ""}</td><td>${actions}</td></tr>`;
  };
  const cycle = (row) => {
    const ids = `data-group-id="${escapeHtml(row.group_id)}" data-user-id="${escapeHtml(row.user_id)}" data-cycle="${escapeHtml(row.cycle_number)}"`;
    const actions = row.status === "reported"
      ? `<div class="admin-row-actions"><button type="button" class="admin-primary" data-admin-action="verify-cycle-payment" ${ids}>ยอดถูกต้อง · รับเงิน</button><button type="button" class="admin-danger" data-admin-action="reject-cycle-payment" ${ids}>ไม่ถูกต้อง</button></div>`
      : row.verified_at ? `<small>ตรวจแล้ว ${formatDate(row.verified_at)}</small>` : `<small>${escapeHtml(row.rejection_note || "—")}</small>`;
    return `<tr><td><strong>${escapeHtml(row.group_name)}</strong><small>${escapeHtml(row.member_name)} · รอบที่ ${escapeHtml(row.cycle_number)}</small></td><td><strong>${formatMoney(row.amount_satang)}</strong><small>${formatDate(row.cycle_starts_at)}</small></td><td>${slipCell(row)}</td><td>${paymentStatus(row.status)}</td><td>${actions}</td></tr>`;
  };
  const plus = (row) => {
    const actions = row.status === "reported"
      ? `<div class="admin-row-actions"><button type="button" class="admin-primary" data-admin-action="verify-subscription-payment" data-payment-id="${escapeHtml(row.id)}">ยอดถูกต้อง · เปิด Plus</button><button type="button" class="admin-danger" data-admin-action="reject-subscription-payment" data-payment-id="${escapeHtml(row.id)}">ไม่ถูกต้อง</button></div>`
      : row.covers_from ? `<small>ใช้ได้ ${formatDate(row.covers_from)} – ${formatDate(row.covers_to)}</small>` : `<small>${escapeHtml(row.rejection_note || "—")}</small>`;
    return `<tr><td><strong>${escapeHtml(row.member_name)}</strong><small>แพ็กเกจ Plus 1 เดือน</small></td><td><strong>${formatMoney(row.amount_satang)}</strong><small>แจ้ง ${formatDate(row.reported_at)}</small></td><td>${slipCell(row)}</td><td>${paymentStatus(row.status)}</td><td>${actions}</td></tr>`;
  };
  const headers = ["ใคร / กลุ่ม", "ยอด", "สลิป", "สถานะ", "ตรวจ"];
  const alerts = typeof Notification !== "undefined" && Notification.permission === "granted" ? "เปิดแจ้งเตือนแล้ว" : "แจ้งเตือนเมื่อมีสลิปใหม่";
  return `${howTo(["เปิดดูสลิป เทียบ <b>ยอด</b> และ <b>ชื่อผู้โอน</b> กับเงินที่เข้าบัญชีจริง", "ตรงกัน กด <b>ยอดถูกต้อง</b> · ไม่ตรง กด <b>ไม่ถูกต้อง</b> แล้วพิมพ์เหตุผลให้สมาชิกเห็น", "เงินที่รับแล้วจะถูกพักไว้ จนกว่าสมาชิกได้รับของ แล้วไปขึ้นที่หน้าโอนเงินให้เจ้าของ"])}
  <div class="admin-page-actions"><button type="button" class="admin-secondary" data-admin-action="enable-payment-alerts">${alerts}</button><button type="button" class="admin-secondary" data-admin-action="reload">รีเฟรช</button></div>
  ${slipSection({ title: "กลุ่มจ่ายรอบเดียว", note: "สลิปที่สมาชิกแนบหลังยืนยันยอดกลุ่ม", headers, rows, isPending: (row) => row.status === "reported" && !row.stale_revision, render: oneTime, empty: "ไม่มีสลิปรอตรวจ" })}
  ${slipSection({ title: "กลุ่มรายเดือน", note: "ยอดของแต่ละรอบล็อกไว้แล้ว ตรวจให้ตรงกับยอดในตาราง", headers, rows: billing.cycles || [], isPending: (row) => row.status === "reported", render: cycle, empty: "ไม่มีสลิปรอตรวจ" })}
  ${slipSection({ title: "แพ็กเกจ Plus", note: "กดยอดถูกต้องแล้ว Plus เริ่ม 1 เดือนทันที (ถ้ายังใช้อยู่จะต่อจากวันหมดเดิม)", headers, rows: billing.subscriptions || [], isPending: (row) => row.status === "reported", render: plus, empty: "ไม่มีสลิปรอตรวจ" })}`;
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
  return `<section class="admin-panel"><div class="admin-panel-heading"><div><h2>กลุ่มทั้งหมด</h2><p>ค้นหาด้วยชื่อ หรือเลือกหมวดหมู่ · กลุ่มที่รอคุณยืนยันยอดอยู่บนสุด</p></div><div class="admin-panel-actions"><button type="button" class="admin-secondary" data-admin-action="enable-group-alerts">${alerts}</button><button type="button" class="admin-secondary" data-admin-action="reload">รีเฟรช</button></div></div><div class="admin-group-filters"><label class="admin-group-filter admin-group-search">ค้นหาชื่อกลุ่ม<input type="search" data-admin-group-search value="${escapeHtml(groupSearchQuery)}" placeholder="พิมพ์ชื่อกลุ่มหรือสินค้า"/></label><label class="admin-group-filter admin-group-category-filter">หมวดหมู่<select data-admin-group-category><option value="all" ${groupCategoryFilter === "all" ? "selected" : ""}>ทุกหมวดหมู่</option>${categories.map((category) => `<option value="${escapeHtml(category)}" ${groupCategoryFilter === category ? "selected" : ""}>${escapeHtml(category)}</option>`).join("")}</select></label></div><div class="admin-group-results">${groupResultsContent(rows)}</div></section>`;
}

/** Plus and monthly-cycle slips (admin-only RPC), with signed slip links. */
async function loadBilling() {
  const { data, error } = await currentClient.rpc("admin_billing_queue");
  if (error) throw new Error(billingErrorMessage(error));
  const sign = async (bucket, rows) => Promise.all((rows || []).map(async (row) => {
    if (!row.slip_path) return { ...row, slip_url: null };
    const { data: signed } = await currentClient.storage.from(bucket).createSignedUrl(row.slip_path, 600);
    return { ...row, slip_url: signed?.signedUrl || null };
  }));
  const [subscriptions, cycles] = await Promise.all([
    sign("subscription-payment-slips", data?.subscriptions),
    sign("cycle-payment-slips", data?.cycles),
  ]);
  return { subscriptions, cycles };
}
/** Group payment reports straight from the database, with signed slip links. */
async function loadGroupPayments() {
  const { data, error } = await currentClient.rpc("admin_group_payment_reports", { p_limit: 200 });
  if (error) throw new Error(billingErrorMessage(error));
  const rows = await Promise.all((data || []).map(async (row) => {
    if (!row.slip_path) return { ...row, slip_url: null };
    const { data: signed } = await currentClient.storage.from("group-payment-slips").createSignedUrl(row.slip_path, 600);
    return { ...row, slip_url: signed?.signedUrl || null };
  }));
  return { rows };
}
async function pollPaymentReports() {
  const { rows = [] } = await loadGroupPayments();
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
  if (activeSection() === "payments" && incoming.length) {
    const content = document.querySelector(".admin-content");
    if (content) content.innerHTML = paymentsContent(rows, cachedBilling);
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
          history.pushState({}, "", "/admin#/approvals");
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
  } else if (activeSection() === "approvals" && incoming.length) {
    const content = document.querySelector(".admin-content");
    if (content) content.innerHTML = approvalsContent(rows);
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
  return (navItems.find(([key]) => key === section)?.[1] || "งานวันนี้").replace(/^\d+\.\s*/, "");
}
/** One plain-language line at the top of a work page: what this page is for and what to do. */
function howTo(steps) {
  return `<ol class="admin-howto">${steps.map((step) => `<li>${step}</li>`).join("")}</ol>`;
}

function adminIcon(name) {
  const paths = {
    check: '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.6 2.5L16 9.5"/>',
    slip: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z"/><path d="M9 8h6M9 12h6"/>',
    alert: '<path d="M12 3 2 20h20L12 3Z"/><path d="M12 10v4M12 17h.01"/>',
    flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
    payout: '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 9h.01M18 15h.01"/>',
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
    ? `<main class="admin-login-wrap"><section class="admin-login"><a class="admin-brand" href="/"><img src="/images/harnkhong-logo.png" alt=""/><strong>HarnKhong</strong></a><h1>เข้าสู่ระบบผู้ดูแล</h1><p>สำหรับผู้ดูแลระบบเท่านั้น</p><button type="button" class="admin-google-button" data-admin-action="google-login" ${busy ? "disabled" : ""}><span class="admin-google-mark" aria-hidden="true">G</span>เข้าสู่ระบบด้วย Google</button><p class="admin-login-hint">ระบบให้สิทธิ์เฉพาะอีเมลผู้ดูแลที่กำหนดไว้เท่านั้น</p><div class="admin-login-divider"><span>หรือใช้อีเมลและรหัสผ่าน</span></div><form id="admin-login-form"><label>อีเมล<input type="email" name="email" autocomplete="username" required/></label><label>รหัสผ่าน<input type="password" name="password" autocomplete="current-password" required/></label><button class="admin-primary" type="submit" ${busy ? "disabled" : ""}>${busy ? "กำลังเข้าสู่ระบบ…" : "เข้าสู่ระบบ"}</button>${feedback ? `<p class="admin-feedback" role="alert">${escapeHtml(feedback)}</p>` : ""}</form><a class="admin-return" href="/">กลับไปหน้าเว็บไซต์</a></section></main>`
    : `<div class="admin-layout"><aside class="admin-sidebar"><a class="admin-brand" href="/"><img src="/images/harnkhong-logo.png" alt=""/><strong>HarnKhong</strong><small>ADMIN</small></a><nav aria-label="เมนูผู้ดูแล">${navItems.map(([key, label, icon, group], index) => `${group && group !== navItems[index - 1]?.[3] ? `<p class="admin-nav-group">${group}</p>` : ""}<a href="/admin#/${key}" class="admin-nav-link ${section === key ? "active" : ""}" ${section === key ? 'aria-current="page"' : ""}><span>${adminIcon(icon)}</span>${label}${workCounts[key] ? `<b class="admin-nav-badge" aria-label="ค้าง ${workCounts[key]} รายการ">${workCounts[key]}</b>` : ""}</a>`).join("")}</nav><div class="admin-sidebar-bottom"><span class="admin-online-dot"></span>เชื่อมต่อระบบแล้ว</div></aside><main class="admin-main"><header class="admin-topbar"><div><span class="admin-crumb">HarnKhong / Admin</span><h1>${sectionTitle(section)}</h1></div><div class="admin-account"><span class="admin-account-avatar">${escapeHtml((user?.email || "A").slice(0, 1).toUpperCase())}</span><span><strong>${escapeHtml(user?.email || "ผู้ดูแล")}</strong><small>ผู้ดูแลระบบ</small></span><button type="button" data-admin-action="logout" class="admin-logout">ออกจากระบบ</button></div></header><div class="admin-content">${content}</div></main></div><div class="admin-toast" role="status" aria-live="polite">${escapeHtml(feedback)}</div>`;
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

function dashboardContent(data, work = { counts: {}, money: null, owedTotal: 0 }) {
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
  const todo = [
    ["approvals", "ยืนยันยอดกลุ่ม", "กลุ่มที่สมาชิกครบและยืนยันยอดแล้ว"],
    ["payments", "ตรวจสลิป", "สลิปกลุ่มรอบเดียว รายเดือน และ Plus"],
    ["disputes", "แจ้งปัญหา", "เงินถูกพักจนกว่าจะตัดสิน"],
    ["payouts", "โอนเงินให้เจ้าของ", work.owedTotal ? `รวม ${formatMoney(work.owedTotal)}` : "สมาชิกได้รับของแล้ว"],
    ["reports", "รายงานปัญหา", "ผู้ใช้แจ้งปัญหาการใช้งาน"],
  ];
  const totalWork = todo.reduce((sum, [key]) => sum + (Number(work.counts[key]) || 0), 0);
  const totals = work.money;
  return `<section class="admin-today"><div class="admin-panel-heading"><div><h2>${totalWork ? `วันนี้มีงานค้าง ${totalWork} รายการ` : "ไม่มีงานค้าง 🎉"}</h2><p>ทำตามลำดับ 1 → 4 กดการ์ดเพื่อไปที่งานนั้น</p></div><button type="button" class="admin-secondary" data-admin-action="reload">รีเฟรช</button></div><div class="admin-todo-grid">${todo.map(([key, label, note], index) => `<a class="admin-todo ${work.counts[key] ? "has-work" : ""}" href="/admin#/${key}" data-admin-nav><span class="admin-todo-step">${index + 1}</span><span class="admin-todo-text"><b>${label}</b><small>${note}</small></span><strong>${work.counts[key] ?? "—"}</strong></a>`).join("")}</div></section>
    ${totals ? `<section class="admin-panel admin-money"><div class="admin-panel-heading"><div><h2>เงินในระบบ</h2><p>จากสลิปที่ตรวจแล้วทั้งหมด</p></div></div><dl class="admin-money-grid"><div><dt>สมาชิกโอนเข้ามา</dt><dd>${formatMoney(totals.gross)}</dd></div><div><dt>ค่าคอม 2% (รายได้แพลตฟอร์ม)</dt><dd>${formatMoney(totals.commission)}</dd></div><div><dt>พักไว้ รอสมาชิกรับของ</dt><dd>${formatMoney(totals.held)}</dd></div><div><dt>โอนให้เจ้าของแล้ว</dt><dd>${formatMoney(totals.paidOut)}</dd></div></dl></section>` : ""}
    <section class="admin-stat-grid">${statCard("สมาชิกทั้งหมด", data.stats.users ?? "—", "บัญชีที่สมัครแล้ว", "♙", "blue")}${statCard("กลุ่มทั้งหมด", data.stats.groups ?? "—", "กลุ่มหารของ", "♧", "violet")}${statCard("กลุ่มที่ยังรอสมาชิก", data.stats.awaitingGroups ?? "—", "ยังไม่ครบหรือยังยืนยันไม่ครบ", "◷", "amber")}${statCard("สินค้าในระบบ", data.stats.activeProducts ?? "—", "สินค้าที่เปิดอยู่", "◇", "green")}</section>
    <section class="admin-panel admin-analytics"><div class="admin-panel-heading"><div><h2>กลุ่มที่สร้างใหม่</h2><p>จำนวนกลุ่มที่สร้างในแต่ละวัน</p></div><label class="admin-range-label">ช่วงวันที่<select data-admin-range aria-label="ช่วงวันที่ของกราฟ"><option value="7" ${dashboardRangeDays === 7 ? "selected" : ""}>7 วัน</option><option value="30" ${dashboardRangeDays === 30 ? "selected" : ""}>30 วัน</option><option value="90" ${dashboardRangeDays === 90 ? "selected" : ""}>90 วัน</option></select></label></div><div class="admin-analytics-body admin-analytics-full"><div>${chart}</div></div></section>
    <section class="admin-panel"><div class="admin-panel-heading"><div><h2>กิจกรรมล่าสุด</h2><p>สมัครสมาชิก สร้างกลุ่ม เข้า/ออกกลุ่ม</p></div></div>${activity ? `<ul class="admin-activity-list">${activity}</ul>` : `<p class="admin-inline-empty">ยังไม่มีกิจกรรม</p>`}</section>
    <section class="admin-panel"><div class="admin-panel-heading"><div><h2>กลุ่มหารของล่าสุด</h2><p>ข้อมูลกลุ่มที่มีอยู่จริงในระบบปัจจุบัน</p></div><a href="/admin#/groups">ดูกลุ่มทั้งหมด <span aria-hidden="true">→</span></a></div>${table(["สินค้า / กลุ่ม", "ผู้สร้าง", "ยอดต่อกลุ่ม", "สถานะ", "วันที่", ""], rows, "ยังไม่มีกลุ่มหารของ")}</section>
    <section class="admin-panel admin-system"><div class="admin-panel-heading"><div><h2>สถานะระบบ</h2><p>ทุกช่องควรเป็นสีเขียว ถ้าไม่ใช่ แจ้งทีมพัฒนา</p></div></div><div class="admin-system-grid">${statusLine("ฐานข้อมูล", data.system.supabase)}${statusLine("ระบบล็อกอิน", data.system.authentication)}${statusLine("ระบบตรวจสลิป", data.system.paymentVerification)}<div class="admin-system-row"><span>อัปเดตล่าสุด</span><strong>${formatDate(data.system.updatedAt)}</strong></div></div></section>`;
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

const isApprovalPending = (row) => row.status !== "cancelled" && Number(row.member_count) === Number(row.capacity)
  && Number(row.approval_count) === Number(row.member_count) && Number(row.admin_approved_revision) !== Number(row.revision);
/** How much work is waiting in each section. A part that fails to load just shows no badge. */
async function loadWorkCounts() {
  const settle = async (promise) => { try { const { data, error } = await promise; return error ? null : data; } catch { return null; } };
  const [groups, payments, billing, payouts, disputes, appReports] = await Promise.all([
    settle(currentClient.rpc("admin_list_groups", { p_limit: 500 })),
    settle(currentClient.rpc("admin_group_payment_reports", { p_limit: 200 })),
    settle(currentClient.rpc("admin_billing_queue")),
    settle(currentClient.rpc("admin_payouts")),
    settle(currentClient.rpc("admin_disputes")),
    settle(currentClient.rpc("admin_app_problem_reports")),
  ]);
  const slips = (payments || []).filter((row) => row.status === "reported" && !row.stale_revision && row.slip_path).length
    + [...(billing?.subscriptions || []), ...(billing?.cycles || [])].filter((row) => row.status === "reported").length;
  const owed = (payouts || []).filter((row) => Number(row.owed_satang) > 0);
  workCounts = {
    approvals: (groups || []).filter(isApprovalPending).length,
    payments: slips,
    disputes: (disputes || []).filter((row) => row.status === "open").length,
    payouts: owed.length,
    reports: (appReports || []).filter((row) => row.status === "open").length,
  };
  return {
    counts: workCounts,
    owedTotal: owed.reduce((sum, row) => sum + Number(row.owed_satang), 0),
    money: (payouts || []).reduce((sum, row) => ({
      gross: sum.gross + Number(row.gross_satang || 0),
      commission: sum.commission + Number(row.commission_satang || 0),
      held: sum.held + Number(row.held_satang || 0),
      paidOut: sum.paidOut + Number(row.paid_out_satang || 0),
    }), { gross: 0, commission: 0, held: 0, paidOut: 0 }),
  };
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
  if (message.includes("payment_report_not_pending")) return "รายการนี้ถูกตรวจไปแล้ว";
  if (message.includes("stale_revision")) return "ยอดกลุ่มเปลี่ยนหลังสมาชิกแจ้งโอน ให้สมาชิกแจ้งโอนใหม่";
  if (message.includes("payment_slip_missing")) return "ยังไม่มีสลิปแนบ จึงยืนยันรับเงินไม่ได้";
  if (message.includes("invalid_rejection_note") || message.includes("rejection_note")) return "กรุณาระบุเหตุผล 3–500 ตัวอักษร";
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

/** Where to send the owner's money, or a warning when they have not added an account. */
function payoutAccountCell(row) {
  if (!row.payout_method) return '<span class="admin-payout-account missing">ยังไม่มีบัญชีรับเงิน</span>';
  const number = row.payout_method === "promptpay" ? row.promptpay_id : row.account_number;
  const where = row.payout_method === "promptpay" ? "PromptPay" : row.bank_name;
  const qr = row.payout_qr_url
    ? `<a class="admin-payout-qr" href="${escapeHtml(row.payout_qr_url)}" target="_blank" rel="noopener noreferrer"><img src="${escapeHtml(row.payout_qr_url)}" alt="QR รับเงินของ ${escapeHtml(row.account_name)}"/><span>เปิด QR</span></a>`
    : "";
  return `<span class="admin-payout-account"><b>${escapeHtml(where)}</b> <code>${escapeHtml(number)}</code><br/>${escapeHtml(row.account_name)}</span>${qr}`;
}
/** Money to pass on to group owners: verified member payments minus the 2% commission. */
function payoutsContent(rows) {
  const owedRows = rows.filter((row) => Number(row.owed_satang) > 0);
  const total = owedRows.reduce((sum, row) => sum + Number(row.owed_satang), 0);
  const render = (row) => {
    const owed = Number(row.owed_satang) > 0;
    const held = Number(row.held_satang) > 0;
    const actions = [
      owed ? `<button type="button" class="admin-primary" data-admin-action="record-payout" data-group-id="${escapeHtml(row.group_id)}" data-owner-id="${escapeHtml(row.owner_id)}" data-group-name="${escapeHtml(row.group_name)}" data-amount="${escapeHtml(formatMoney(row.owed_satang))}">โอนแล้ว · แนบสลิป</button>` : "",
      held && !Number(row.open_disputes) ? `<button type="button" class="admin-secondary" data-admin-action="release-payout" data-group-id="${escapeHtml(row.group_id)}" data-group-name="${escapeHtml(row.group_name)}" data-monthly="${row.billing_mode === "monthly" ? "1" : ""}">ปล่อยเงินก่อนกำหนด</button>` : "",
    ].filter(Boolean).join("") || (Number(row.open_disputes) ? '<small>ตัดสินเรื่องแจ้งปัญหาก่อน</small>' : held ? "" : '<span class="admin-status good">โอนครบแล้ว</span>');
    const stage = Number(row.open_disputes)
      ? `<span class="admin-status bad">มีเรื่องแจ้งปัญหา ${escapeHtml(row.open_disputes)} เรื่อง</span>`
      : owed ? '<span class="admin-status pending">พร้อมโอน</span>'
      : held ? `<span class="admin-status">${row.last_shipped_at ? `ส่งของแล้ว ${formatDate(row.last_shipped_at)} · รอสมาชิกรับของ` : "รอเจ้าของส่งของ"}</span>`
      : '<span class="admin-status good">โอนครบแล้ว</span>';
    return `<tr><td><strong>${escapeHtml(row.group_name)}</strong><small>${escapeHtml(row.owner_name)} · ${escapeHtml(row.owner_email)}${row.commission_waived_now ? " · โค้ดยกเว้นค่าคอม" : ""}</small>${stage}</td><td>${payoutAccountCell(row)}</td><td><strong>${formatMoney(row.owed_satang)}</strong><small>รับเงินรวม ${formatMoney(row.gross_satang)} · ค่าคอม −${formatMoney(row.commission_satang)}</small><small>พักไว้ ${formatMoney(row.held_satang)} · โอนแล้ว ${formatMoney(row.paid_out_satang)}</small></td><td><div class="admin-row-actions">${actions}</div></td></tr>`;
  };
  const headers = ["กลุ่ม / เจ้าของ", "โอนเข้าบัญชีไหน", "ต้องโอนตอนนี้", ""];
  const rest = rows.filter((row) => !(Number(row.owed_satang) > 0));
  return `${howTo(["เงินจะ <b>พร้อมโอน</b> เมื่อสมาชิกได้รับของ (กดเอง หรือครบ 7 วันหลังเจ้าของแจ้งส่งของ)", "โอนเงินเข้าบัญชีหรือสแกน QR ของเจ้าของ ตามยอดในช่อง <b>ต้องโอนตอนนี้</b>", "กด <b>โอนแล้ว · แนบสลิป</b> เจ้าของจะเห็นสลิปในหน้ากลุ่ม"])}
  <section class="admin-panel"><div class="admin-panel-heading"><div><h2>พร้อมโอน ${owedRows.length ? `<span class="admin-count">${owedRows.length}</span>` : ""}</h2><p>รวมที่ต้องโอนตอนนี้ <b>${formatMoney(total)}</b> (หักค่าคอม 2% แล้ว)</p></div></div>${table(headers, owedRows.map(render).join(""), "ไม่มียอดที่ต้องโอนตอนนี้")}</section>
  ${rest.length ? `<section class="admin-panel admin-panel-muted"><div class="admin-panel-heading"><div><h2>เงินที่ยังพักไว้ / โอนครบแล้ว</h2><p>ยังไม่ต้องโอน รอสมาชิกได้รับของ หรือโอนครบแล้ว</p></div></div>${table(headers, rest.map(render).join(""))}</section>` : ""}`;
}

const disputeStatus = { open: "รอตัดสิน · เงินถูกพัก", released: "ปล่อยเงินให้เจ้าของแล้ว", refunded: "คืนเงินสมาชิกแล้ว" };
/** Problem reports from members/buyers: release the payment to the owner or record a refund. */
function disputesContent(rows) {
  const body = rows.map((row) => {
    const open = row.status === "open";
    const actions = open
      ? `<div class="admin-row-actions"><button type="button" class="admin-primary" data-admin-action="resolve-dispute" data-outcome="released" data-dispute-id="${escapeHtml(row.id)}" data-label="${escapeHtml(row.member_name)} · ${escapeHtml(row.group_name)}">ปล่อยเงินให้เจ้าของ</button><button type="button" class="admin-danger" data-admin-action="resolve-dispute" data-outcome="refunded" data-dispute-id="${escapeHtml(row.id)}" data-label="${escapeHtml(row.member_name)} · ${escapeHtml(row.group_name)}">คืนเงินสมาชิก</button></div>`
      : `<small>${escapeHtml(row.resolution_note || "")}</small>`;
    return `<tr><td><strong>${escapeHtml(row.group_name)}</strong><small>${row.cycle_number ? `รอบที่ ${escapeHtml(row.cycle_number)} · ` : ""}เจ้าของ ${escapeHtml(row.owner_name)}</small><small>${row.shipped_at ? `แจ้งส่งของ ${formatDate(row.shipped_at)}` : "ยังไม่แจ้งส่งของ"}</small></td><td><strong>${escapeHtml(row.member_name)}</strong><small>${escapeHtml(row.member_email)}</small></td><td>${escapeHtml(row.reason)}<small>${formatDate(row.created_at)}</small></td><td><span class="admin-status ${open ? "bad" : "good"}">${escapeHtml(disputeStatus[row.status] || row.status)}</span></td><td>${actions}</td></tr>`;
  }).join("");
  const openCount = rows.filter((row) => row.status === "open").length;
  return `${howTo(["ระหว่างที่มีเรื่องเปิดอยู่ เงินของกลุ่มนั้นถูก <b>พักไว้</b> และไม่ยืนยันรับของอัตโนมัติ", "คุยกับทั้งสมาชิกและเจ้าของกลุ่ม ขอรูปหรือหลักฐาน", "ตัดสิน: <b>ปล่อยเงินให้เจ้าของ</b> หรือ <b>คืนเงินสมาชิก</b> (โอนคืนนอกแอปก่อน แล้วจดเลขอ้างอิง)"])}<section class="admin-panel"><div class="admin-panel-heading"><div><h2>รอตัดสิน ${openCount ? `<span class="admin-count">${openCount}</span>` : ""}</h2><p>เรื่องที่สมาชิกหรือผู้ซื้อแจ้งเข้ามา</p></div></div>${table(["กลุ่ม", "ผู้แจ้ง", "ปัญหา", "สถานะ", "ตัดสิน"], body, "ไม่มีเรื่องค้าง 🎉")}</section>`;
}

/** "รายงานปัญหา" sent from the account page. Open ones carry a red label until an admin closes them. */
function appReportsContent(rows) {
  const render = (row) => {
    const open = row.status === "open";
    const status = open ? '<span class="admin-status bad admin-report-new">ใหม่ · รอตรวจ</span>' : '<span class="admin-status good">ปิดเรื่องแล้ว</span>';
    const action = open
      ? `<button type="button" class="admin-primary" data-admin-action="resolve-app-report" data-report-id="${escapeHtml(row.id)}" data-label="${escapeHtml(row.member_name)} · ${escapeHtml(row.topic)}">ปิดเรื่อง</button>`
      : `<small>${escapeHtml(row.resolution_note || "")}${row.resolved_at ? ` · ${formatDate(row.resolved_at)}` : ""}</small>`;
    return `<tr class="${open ? "admin-row-alert" : ""}"><td><strong>${escapeHtml(row.member_name)}</strong><small>${escapeHtml(row.member_email)}</small></td><td><span class="admin-report-topic">${escapeHtml(row.topic)}</span><p class="admin-report-message">${escapeHtml(row.message)}</p><small>${formatDate(row.created_at)}${row.page ? ` · หน้า ${escapeHtml(row.page)}` : ""}</small>${row.user_agent ? `<small class="admin-report-ua">${escapeHtml(row.user_agent)}</small>` : ""}</td><td>${status}</td><td>${action}</td></tr>`;
  };
  const openRows = rows.filter((row) => row.status === "open");
  const closed = rows.filter((row) => row.status !== "open");
  const headers = ["ผู้แจ้ง", "เรื่องที่แจ้ง", "สถานะ", ""];
  return `${howTo(["ผู้ใช้กด <b>รายงานปัญหา</b> ในหน้าบัญชี เรื่องใหม่จะขึ้น <b>ป้ายแดง</b> ที่เมนูนี้", "อ่านรายละเอียด ติดต่อกลับทางอีเมลถ้าต้องการข้อมูลเพิ่ม", "แก้หรือส่งต่อทีมพัฒนาแล้ว กด <b>ปิดเรื่อง</b> พร้อมบันทึกสั้น ๆ"])}
  <section class="admin-panel"><div class="admin-panel-heading"><div><h2>เรื่องใหม่ ${openRows.length ? `<span class="admin-count admin-count-alert">${openRows.length}</span>` : ""}</h2><p>ยังไม่มีใครตรวจ</p></div></div>${table(headers, openRows.map(render).join(""), "ไม่มีเรื่องใหม่")}</section>
  ${closed.length ? `<section class="admin-panel admin-panel-muted"><div class="admin-panel-heading"><div><h2>ปิดเรื่องแล้ว</h2></div></div>${table(headers, closed.map(render).join(""))}</section>` : ""}`;
}

async function getSectionContent(section) {
  if (section === "announcements") {
    const { data, error } = await currentClient.rpc("admin_announcements");
    if (error) throw new Error(billingErrorMessage(error));
    const rows = (data || []).map((row) => `<tr><td><strong>${escapeHtml(row.title)}</strong><small>${escapeHtml(row.body || "")}</small></td><td>${formatDate(row.created_at)}</td><td>${row.expires_at ? formatDate(row.expires_at) : "ไม่หมดอายุ"}</td><td><button type="button" class="admin-danger" data-admin-action="delete-announcement" data-id="${escapeHtml(row.id)}">ลบ</button></td></tr>`).join("");
    return `<section class="admin-panel"><div class="admin-panel-heading"><div><h2>ประกาศถึงทุกคน</h2><p>ขึ้นในแท็บ "อัปเดตระบบ" ของทุกบัญชีที่เข้าสู่ระบบ</p></div></div><div class="admin-announcement-form"><label>หัวข้อ<input data-announcement-title maxlength="120" placeholder="เช่น ปิดปรับปรุงระบบคืนนี้ 23:00–24:00"/></label><label>รายละเอียด <small>ไม่บังคับ</small><textarea data-announcement-body maxlength="1000" rows="3" placeholder="รายละเอียดที่สมาชิกควรรู้"></textarea></label><label>แสดงนาน<select data-announcement-days><option value="">จนกว่าจะลบ</option><option value="1">1 วัน</option><option value="3">3 วัน</option><option value="7" selected>7 วัน</option><option value="30">30 วัน</option></select></label><button type="button" class="admin-primary" data-admin-action="post-announcement">ประกาศ</button></div>${table(["ประกาศ", "ประกาศเมื่อ", "หมดอายุ", ""], rows, "ยังไม่มีประกาศ")}</section>`;
  }
  if (section === "reports") {
    const { data, error } = await currentClient.rpc("admin_app_problem_reports");
    if (error) {
      const message = String(error.message || "");
      throw new Error(error.code === "PGRST202" || message.includes("Could not find the function")
        ? "ฐานข้อมูลยังไม่มีระบบรายงานปัญหา กรุณารัน migration 20261121090000_app_problem_reports.sql ใน Supabase SQL Editor"
        : billingErrorMessage(error));
    }
    return appReportsContent(data || []);
  }
  if (section === "payouts") {
    const { data, error } = await currentClient.rpc("admin_payouts");
    if (error) {
      const message = String(error.message || "");
      throw new Error(error.code === "PGRST202" || message.includes("Could not find the function")
        ? "ฐานข้อมูลยังไม่มีฟังก์ชันของหน้านี้ กรุณารัน migration 20261120120000_commission_from_owner_payout.sql และ 20261120130000_escrow_receipts_and_promo.sql"
        : billingErrorMessage(error));
    }
    const rows = await Promise.all((data || []).map(async (row) => {
      if (!row.payout_qr_path) return row;
      const { data: signed } = await currentClient.storage.from("payout-qr").createSignedUrl(row.payout_qr_path, 600);
      return { ...row, payout_qr_url: signed?.signedUrl || null };
    }));
    return payoutsContent(rows);
  }
  if (section === "dashboard") {
    const [data, work] = await Promise.all([
      currentClient.rpc("admin_overview", { p_days: dashboardRangeDays }).then(({ data: overview, error }) => {
        if (error) throw new Error(billingErrorMessage(error));
        return overview;
      }),
      loadWorkCounts(),
    ]);
    return dashboardContent(data, work);
  }
  if (section === "payments") {
    const [{ rows: paymentRows = [] }, billing] = await Promise.all([loadGroupPayments(), loadBilling()]);
    cachedPaymentReports = paymentRows;
    cachedBilling = billing;
    return paymentsContent(paymentRows, billing);
  }
  if (section === "approvals") {
    const { rows } = await loadAdminGroups();
    cachedAdminGroups = rows;
    return approvalsContent(rows);
  }
  if (section === "disputes") {
    const { data, error } = await currentClient.rpc("admin_disputes");
    if (error) throw new Error(billingErrorMessage(error));
    return disputesContent(data || []);
  }
  if (section === "users") {
    const { data: rows, error } = await currentClient.rpc("admin_users", { p_limit: 500 });
    if (error) throw new Error(billingErrorMessage(error));
    return `<section class="admin-panel"><div class="admin-panel-heading"><div><h2>สมาชิกทั้งหมด</h2><p>ทุกบัญชีที่สมัครเข้ามา</p></div></div>${table(["ชื่อที่แสดง", "อีเมล", "สถานะบัญชี", "สมัครเมื่อ"], (rows || []).map((user) => `<tr><td><strong>${escapeHtml(user.display_name || "ยังไม่ตั้งชื่อ")}</strong></td><td>${escapeHtml(user.email || "—")}</td><td>${user.email_confirmed_at ? '<span class="admin-status good">ยืนยันอีเมลแล้ว</span>' : '<span class="admin-status pending">ยังไม่ยืนยัน</span>'}</td><td>${formatDate(user.created_at)}</td></tr>`).join(""), "ยังไม่มีสมาชิก")}</section>`;
  }
  if (section === "groups") {
    const { rows } = await loadAdminGroups();
    cachedAdminGroups = rows;
    return groupsContent(rows);
  }
  return `<section class="admin-panel admin-settings"><h2>ผู้ดูแลระบบ</h2><p>เข้าหน้านี้ได้เฉพาะบัญชีที่ตั้งเป็นผู้ดูแลไว้ในระบบหลังบ้าน</p><dl><div><dt>ดูรายชื่อผู้ดูแล</dt><dd>แจ้งทีมพัฒนา (รายชื่อไม่แสดงในหน้าเว็บ เพื่อความปลอดภัย)</dd></div><div><dt>เพิ่มผู้ดูแลคนใหม่</dt><dd>แจ้งทีมพัฒนาให้เพิ่มอีเมล แล้วให้คนนั้นเข้าสู่ระบบด้วย Google ครั้งแรก</dd></div><div><dt>รหัสผ่าน</dt><dd>เว็บไม่เก็บรหัสผ่าน ใช้การเข้าสู่ระบบด้วย Google หรือรีเซ็ตรหัสผ่านทางอีเมล</dd></div></dl></section>`;
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
    ? "บัญชีนี้ไม่มีสิทธิ์ผู้ดูแล กรุณาเลือกบัญชี Google ของผู้ดูแล"
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
    const [content] = await Promise.all([getSectionContent(section), section === "dashboard" ? null : loadWorkCounts().catch(() => null)]);
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
      feedback = error.message?.includes("ADMIN_NOT_ALLOWED") ? "บัญชีนี้ไม่มีสิทธิ์ผู้ดูแล กรุณาใช้บัญชีของผู้ดูแล" : error.message?.includes("ADMIN_EMAIL_UNCONFIRMED") ? "กรุณายืนยันอีเมลก่อนเข้าใช้งานระบบผู้ดูแล" : error.message?.toLowerCase().includes("provider is not enabled") ? "Google OAuth ยังไม่ได้เปิดใน Supabase Auth กรุณาตั้งค่า Google provider ก่อน" : error.message?.includes("Failed to fetch") ? "ยังเชื่อมต่อระบบ Admin ไม่ได้ กรุณาตรวจว่าได้ติดตั้ง Edge Function แล้ว" : "เข้าสู่ระบบไม่สำเร็จ ตรวจสอบอีเมลและรหัสผ่านอีกครั้ง";
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
  const link = event.target.closest(".admin-nav-link, [data-admin-nav]");
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
  } else if (action === "post-announcement") {
    if (busy) return;
    const title = String(document.querySelector("[data-announcement-title]")?.value || "").trim();
    const body = String(document.querySelector("[data-announcement-body]")?.value || "").trim();
    const days = document.querySelector("[data-announcement-days]")?.value;
    if (title.length < 2) {
      feedback = "กรุณาใส่หัวข้ออย่างน้อย 2 ตัวอักษร";
      mountAdminPage({ supabase: currentClient, supabaseConfigured: true });
      return;
    }
    busy = true;
    button.disabled = true;
    try {
      const { error } = await currentClient.rpc("admin_post_announcement", { p_title: title, p_body: body, p_days: days ? Number(days) : null });
      if (error) throw new Error(billingErrorMessage(error));
      feedback = "ประกาศแล้ว สมาชิกจะเห็นในแท็บอัปเดตระบบ";
    } catch (error) {
      feedback = error.message || "ประกาศไม่สำเร็จ";
    } finally {
      busy = false;
      mountAdminPage({ supabase: currentClient, supabaseConfigured: true });
    }
  } else if (action === "delete-announcement") {
    if (busy || !confirm("ลบประกาศนี้?")) return;
    busy = true;
    try {
      const { error } = await currentClient.rpc("admin_delete_announcement", { p_id: button.dataset.id });
      if (error) throw new Error(billingErrorMessage(error));
      feedback = "ลบประกาศแล้ว";
    } catch (error) {
      feedback = error.message || "ลบไม่สำเร็จ";
    } finally {
      busy = false;
      mountAdminPage({ supabase: currentClient, supabaseConfigured: true });
    }
  } else if (action === "confirm-group-revision") {
    const groupId = button.dataset.groupId;
    const revision = Number(button.dataset.revision);
    if (!groupId || !Number.isSafeInteger(revision) || busy) return;
    if (!confirm("ตรวจสอบยอดรอบปัจจุบันแล้ว และยืนยันให้สมาชิกเห็นว่ายอดรอบนี้ผ่านแล้วใช่หรือไม่?")) return;
    busy = true;
    button.disabled = true;
    button.textContent = "กำลังบันทึก…";
    try {
      const { error } = await currentClient.rpc("confirm_group_revision", { p_group: groupId, p_revision: revision });
      if (error) throw new Error(error.code === "40001" || error.code === "23514" ? "สมาชิกยังยืนยันไม่ครบ หรือกลุ่มมีการเปลี่ยนยอดแล้ว" : billingErrorMessage(error));
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
      const { error } = await currentClient.rpc("admin_review_group_payment", { p_payment: paymentId, p_approve: true, p_note: null });
      if (error) throw new Error(billingErrorMessage(error));
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
      const { error } = await currentClient.rpc("admin_review_group_payment", { p_payment: paymentId, p_approve: false, p_note: rejectionNote });
      if (error) throw new Error(billingErrorMessage(error));
      feedback = "ปฏิเสธรายการแล้ว แจ้งเหตุผลให้สมาชิกทราบแล้ว";
    } catch (error) {
      feedback = error.message || "ปฏิเสธรายการไม่สำเร็จ";
    } finally {
      busy = false;
      mountAdminPage({ supabase: currentClient, supabaseConfigured: true });
    }
  } else if (action === "resolve-dispute") {
    if (busy) return;
    const outcome = button.dataset.outcome === "refunded" ? "refunded" : "released";
    const note = prompt(outcome === "refunded"
      ? `คืนเงินให้ ${button.dataset.label} — โอนคืนนอกแอปแล้วใช่ไหม? ระบุรายละเอียด (เช่น เลขอ้างอิงการโอนคืน)`
      : `ปล่อยเงินของ ${button.dataset.label} ให้เจ้าของกลุ่ม — ระบุเหตุผล`, "");
    if (note === null) return;
    if (note.trim().length < 3) {
      feedback = "กรุณาระบุรายละเอียดอย่างน้อย 3 ตัวอักษร";
      mountAdminPage({ supabase: currentClient, supabaseConfigured: true });
      return;
    }
    busy = true;
    button.disabled = true;
    try {
      const { error } = await currentClient.rpc("admin_resolve_dispute", { p_dispute: button.dataset.disputeId, p_outcome: outcome, p_note: note.trim() });
      if (error) throw new Error(error.message || "ตัดสินไม่สำเร็จ");
      feedback = outcome === "refunded" ? "บันทึกการคืนเงินแล้ว ยอดนี้ไม่นับเป็นเงินของเจ้าของ" : "ปล่อยเงินแล้ว";
    } catch (error) {
      feedback = error.message || "ตัดสินไม่สำเร็จ";
    } finally {
      busy = false;
      mountAdminPage({ supabase: currentClient, supabaseConfigured: true });
    }
  } else if (action === "resolve-app-report") {
    if (busy) return;
    const note = prompt(`ปิดเรื่อง ${button.dataset.label} — บันทึกสั้น ๆ ว่าทำอะไรไป`, "");
    if (note === null) return;
    if (!note.trim()) {
      feedback = "กรุณาเขียนบันทึกก่อนปิดเรื่อง";
      mountAdminPage({ supabase: currentClient, supabaseConfigured: true });
      return;
    }
    busy = true;
    button.disabled = true;
    try {
      const { error } = await currentClient.rpc("admin_resolve_app_problem_report", { p_report: button.dataset.reportId, p_note: note.trim() });
      if (error) throw new Error(String(error.message || "").includes("report_not_open") ? "เรื่องนี้ถูกปิดไปแล้ว" : error.message || "ปิดเรื่องไม่สำเร็จ");
      feedback = "ปิดเรื่องแล้ว";
    } catch (error) {
      feedback = error.message || "ปิดเรื่องไม่สำเร็จ";
    } finally {
      busy = false;
      mountAdminPage({ supabase: currentClient, supabaseConfigured: true });
    }
  } else if (action === "release-payout") {
    if (busy) return;
    let cycleNumber = null;
    if (button.dataset.monthly) {
      const answer = prompt("ปล่อยเงินของรอบที่เท่าไหร่? (ใส่ตัวเลขรอบ)", "1");
      if (answer === null) return;
      cycleNumber = Number(answer);
      if (!Number.isSafeInteger(cycleNumber) || cycleNumber < 1) {
        feedback = "เลขรอบไม่ถูกต้อง";
        mountAdminPage({ supabase: currentClient, supabaseConfigured: true });
        return;
      }
    }
    const reason = prompt(`เหตุผลที่ปล่อยเงินให้เจ้าของกลุ่ม “${button.dataset.groupName}” ก่อนสมาชิกยืนยันรับสินค้าครบ`, "");
    if (reason === null) return;
    if (reason.trim().length < 3) {
      feedback = "กรุณาระบุเหตุผลอย่างน้อย 3 ตัวอักษร";
      mountAdminPage({ supabase: currentClient, supabaseConfigured: true });
      return;
    }
    busy = true;
    button.disabled = true;
    try {
      const { error } = await currentClient.rpc("admin_release_payout", { p_group: button.dataset.groupId, p_cycle_number: cycleNumber, p_reason: reason.trim() });
      if (error) throw new Error(billingErrorMessage(error));
      feedback = "ปล่อยเงินแล้ว ยอดย้ายไปอยู่ในช่องพร้อมโอน";
    } catch (error) {
      feedback = error.message || "ปล่อยเงินไม่สำเร็จ";
    } finally {
      busy = false;
      mountAdminPage({ supabase: currentClient, supabaseConfigured: true });
    }
  } else if (action === "record-payout") {
    if (busy) return;
    const groupId = button.dataset.groupId;
    const ownerId = button.dataset.ownerId;
    if (!confirm(`โอน ${button.dataset.amount} ให้เจ้าของกลุ่ม “${button.dataset.groupName}” แล้วใช่ไหม? ขั้นต่อไปให้เลือกรูปสลิปการโอน`)) return;
    // The slip is required: pick it right away, still inside the click.
    const file = await new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/jpeg,image/png,image/webp";
      input.addEventListener("change", () => resolve(input.files?.[0] || null), { once: true });
      input.addEventListener("cancel", () => resolve(null), { once: true });
      input.click();
    });
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 8 * 1024 * 1024) {
      feedback = "สลิปต้องเป็นรูป JPG, PNG หรือ WebP ไม่เกิน 8 MB";
      mountAdminPage({ supabase: currentClient, supabaseConfigured: true });
      return;
    }
    const note = prompt("หมายเหตุการโอน (ไม่บังคับ) เช่น เลขอ้างอิงหรือช่องทางที่โอน", "") ?? "";
    busy = true;
    button.disabled = true;
    button.textContent = "กำลังอัปโหลดสลิป…";
    const extension = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[file.type];
    const slipPath = `${ownerId}/${groupId}/${crypto.randomUUID()}.${extension}`;
    try {
      const { error: uploadError } = await currentClient.storage.from("payout-slips").upload(slipPath, file, { contentType: file.type, upsert: false });
      if (uploadError) throw new Error(String(uploadError.message || "").toLowerCase().includes("bucket not found")
        ? "ยังไม่มีที่เก็บสลิปโอนให้เจ้าของ กรุณารัน migration 20261120150000_payout_slips.sql"
        : `อัปโหลดสลิปไม่สำเร็จ: ${uploadError.message}`);
      const { error } = await currentClient.rpc("admin_record_payout", { p_group: groupId, p_slip_path: slipPath, p_note: note.trim() || null });
      if (error) {
        await currentClient.storage.from("payout-slips").remove([slipPath]);
        throw new Error(String(error.message || "").includes("nothing_owed") ? "ไม่มียอดค้างโอนของกลุ่มนี้แล้ว" : billingErrorMessage(error));
      }
      feedback = `บันทึกการโอนให้เจ้าของกลุ่ม “${button.dataset.groupName}” พร้อมสลิปแล้ว`;
    } catch (error) {
      feedback = error.message || "บันทึกการโอนไม่สำเร็จ";
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
