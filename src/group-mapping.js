import { costBreakdown, totalCost, SEAT_MODE, ownerFee } from "./domain.js";

const eventReason = {
  group_created: "สร้างกลุ่มแล้ว",
  member_joined: "มีสมาชิกเข้าร่วม",
  member_left: "มีสมาชิกออกจากกลุ่ม",
  costs_changed: "มีการเปลี่ยนค่าใช้จ่าย",
  group_details_changed: "มีการแก้ไขข้อมูลกลุ่ม",
  leadership_transferred: "มีการโอนหัวหน้ากลุ่ม",
  share_approved: "ยืนยันยอดแล้ว",
};
const asSafeSatang = (value) => {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount < 0)
    throw Object.assign(new Error("Group total exceeds supported amount"), {
      code: "groupTotalOutOfRange",
    });
  return amount;
};

export function mapDatabaseGroup(
  row,
  members = [],
  approvals = {},
  history = [],
) {
  const product = asSafeSatang(row.product_satang),
    delivery = asSafeSatang(row.delivery_per_member_satang);
  const seatPriced = row.pricing_mode === SEAT_MODE;
  const costs = { product, delivery, mode: seatPriced ? SEAT_MODE : "per_member_v2" };
  // Seat-priced totals cover every seat; legacy totals cover the people present.
  const units = seatPriced ? Number(row.capacity) : members.length;
  // Until 20261120120000 runs, seat-priced rows still carry the old owner fee in their totals;
  // accept both so the site keeps loading during the switch.
  const subtotal = product + delivery * units;
  const legacySeatTotals =
    seatPriced &&
    asSafeSatang(row.total_satang) === subtotal + ownerFee(subtotal) &&
    asSafeSatang(row.service_satang) === ownerFee(subtotal);
  if (
    !legacySeatTotals &&
    (asSafeSatang(row.total_satang) !== totalCost(costs, units) ||
      asSafeSatang(row.service_satang) !== costBreakdown(costs, units).service)
  ) {
    throw Object.assign(new Error("Database and app group totals differ"), {
      code: "groupTotalMismatch",
    });
  }
  return {
    id: row.id,
    listingId: row.listing_id,
    name: row.name,
    category: row.category,
    categories:
      Array.isArray(row.categories) && row.categories.length
        ? row.categories
        : row.category
          ? [row.category]
          : [],
    images: Array.isArray(row.images) ? row.images : [],
    details: row.details && typeof row.details === "object" ? row.details : {},
    ownerId: row.owner_id,
    visibility: row.visibility,
    capacity: Number(row.capacity),
    costs,
    billing: row.billing_mode === "monthly" ? "monthly" : "one_time",
    ...(row.billing_mode === "monthly"
      ? { cycleAnchor: row.cycle_anchor || null, cycles: mapCycles(row.cycles, row.owner_id) }
      : {}),
    members,
    revision: Number(row.revision),
    adminApprovedRevision: row.admin_approved_revision == null
      ? null
      : Number(row.admin_approved_revision),
    approvals,
    status: row.status,
    orderId: null,
    history: history.map((event) => ({
      revision: Number(event.revision),
      reason: eventReason[event.event_type] || "มีการอัปเดตกลุ่ม",
      at: event.created_at,
    })),
  };
}

/** Database cycles (group_cycles + group_cycle_members) in the shape src/billing.js uses. */
export function mapCycles(rows = [], ownerId) {
  return [...(rows || [])]
    .sort((a, b) => Number(a.cycle_number) - Number(b.cycle_number))
    .map((cycle) => {
      const shares = [...(cycle.shares || [])].sort((a, b) => Number(a.seat_index) - Number(b.seat_index));
      const amounts = Object.fromEntries(shares.map((share) => [share.user_id, asSafeSatang(share.amount_satang)]));
      return {
        number: Number(cycle.cycle_number),
        start: cycle.starts_at,
        end: cycle.ends_at,
        status: cycle.status,
        closedFrom: cycle.closed_from || undefined,
        members: shares.map((share) => share.user_id),
        ownerId,
        amounts,
        total: asSafeSatang(cycle.total_satang),
        confirmations: Object.fromEntries(
          shares.filter((share) => share.confirmed_at).map((share) => [share.user_id, share.confirmed_at]),
        ),
        payments: Object.fromEntries(
          shares.filter((share) => share.payment_status).map((share) => [share.user_id, share.payment_status]),
        ),
        rejections: Object.fromEntries(
          shares.filter((share) => share.rejection_note).map((share) => [share.user_id, share.rejection_note]),
        ),
      };
    });
}
