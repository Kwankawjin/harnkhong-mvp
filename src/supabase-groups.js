import { supabase } from "./supabase.js";
import { mapDatabaseGroup } from "./group-mapping.js";

function mapBundle({ group, members = [], approvals = [], events = [] }) {
  const names = {};
  const memberIds = members.map((member) => {
    names[member.user_id] = { id: member.user_id, name: member.display_name };
    return member.user_id;
  });
  const approved = Object.fromEntries(
    approvals.map((item) => [item.user_id, Number(item.revision)]),
  );
  return { group: mapDatabaseGroup(group, memberIds, approved, events), names };
}

export async function loadSupabaseGroups(client = supabase) {
  const [groupResult, productResult, shopResult] = await Promise.all([
      // Embed related rows so totals and membership come from one database snapshot.
      client
        .from("groups")
        .select(
          "id,listing_id,owner_id,name,category,categories,images,details,visibility,capacity,product_satang,delivery_per_member_satang,service_satang,total_satang,revision,status,admin_approved_revision,created_at,members:group_members(user_id,display_name,joined_at,approvals:group_approvals(revision)),events:group_events(revision,event_type,created_at)",
        )
        .order("created_at", { ascending: false })
        .order("joined_at", { referencedTable: "members" })
        .order("id", { referencedTable: "events" }),
      client
        .from("products")
        .select(
          "id,seller_id,title,category,kind,price_satang,art,mark,description,terms,details",
        )
        .eq("active", true),
      client.from("shops").select("id,name,intro,initials"),
    ]);
  for (const result of [groupResult, productResult, shopResult])
    if (result.error) throw result.error;
  const bundles = (groupResult.data || []).map((row) =>
    mapBundle({
      group: row,
      members: row.members || [],
      approvals: (row.members || []).flatMap((member) =>
        member.approvals
          ? [{ ...member.approvals, user_id: member.user_id }]
          : [],
      ),
      events: row.events || [],
    }),
  );
  const names = Object.assign({}, ...bundles.map((bundle) => bundle.names));
  const memberIds = [...new Set(Object.keys(names))];
  const paymentReportsByGroup = new Map();
  if (memberIds.length && client.auth?.getSession) {
    const { data: sessionData, error: sessionError } =
      await client.auth.getSession();
    if (sessionError) throw sessionError;
    if (sessionData?.session?.user?.id) {
      const userId = sessionData.session.user.id;
      const [profileResult, paymentResult] = await Promise.all([
        client.from("profiles").select("id,display_name,bio,avatar_url").in("id", memberIds),
        client.from("group_payment_reports").select("group_id,revision,amount_satang,status,reported_at,rejection_note").eq("user_id", userId),
      ]);
      if (profileResult.error) throw profileResult.error;
      if (paymentResult.error) throw paymentResult.error;
      for (const report of paymentResult.data || []) paymentReportsByGroup.set(report.group_id, report);
      for (const profile of profileResult.data || []) {
        names[profile.id] = {
          ...names[profile.id],
          id: profile.id,
          name: profile.display_name || names[profile.id]?.name,
          bio: profile.bio || "",
          avatar: profile.avatar_url || "",
        };
      }
    }
  }
  return {
    groups: bundles.map((bundle) => ({
      ...bundle.group,
      paymentReport: paymentReportsByGroup.get(bundle.group.id) || null,
    })),
    names,
    listings: [
      ...(productResult.data || []).map((row) => {
        const price = Number(row.price_satang);
        if (!Number.isSafeInteger(price) || price < 0)
          throw Object.assign(
            new Error("Product price exceeds supported amount"),
            { code: "groupTotalOutOfRange" },
          );
        return {
          id: row.id,
          sellerId: row.seller_id,
          title: row.title,
          category: row.category,
          kind: row.kind,
          price,
          art: row.art,
          mark: row.mark,
          description: row.description,
          terms: row.terms,
          productDetails: row.details || {},
        };
      }),
    ],
    sellers: (shopResult.data || []).map((row) => ({
      id: row.id,
      name: row.name,
      intro: row.intro,
      initials: row.initials,
    })),
  };
}

export async function resolveSupabaseInvite(groupId, token, userId) {
  if (!userId) return null;
  const { data, error } = await supabase.rpc("resolve_group_invite", {
    p_group: groupId,
    p_token: token,
  });
  if (error) throw error;
  if (!data) return null;
  const row = data;
  const members = row.members || [];
  const approvals = Object.entries(row.approvals || {}).map(
    ([user_id, revision]) => ({ user_id, revision }),
  );
  const history = (row.history || []).map((item) => ({
    revision: item.revision,
    event_type: item.event_type,
    created_at: item.created_at,
  }));
  const bundle = mapBundle({ group: row, members, approvals, events: history });
  return bundle;
}

async function runMutation(name, args, requestId = crypto.randomUUID()) {
  const { data, error } = await supabase.rpc(name, {
    ...args,
    p_request: requestId,
  });
  if (error) throw error;
  return data;
}

export async function createSupabaseGroup({
  product,
  details,
  name,
  categories,
  images = [],
  visibility,
  capacity,
  price,
  delivery,
  requestId,
}) {
  return runMutation(
    "create_group_from_form",
    {
      p_name: name,
      p_categories: categories,
      p_images: images,
      p_visibility: visibility,
      p_capacity: capacity,
      p_delivery: delivery,
      p_price: price,
      p_product: {
        title: product.title,
        category: product.category,
        type: product.productDetails?.type || "physical",
        description: product.description || "",
        terms: product.terms || "",
        productDetails: product.productDetails || {},
      },
      p_details: details,
    },
    requestId,
  );
}
export async function joinSupabaseGroup(groupId, token = null) {
  return runMutation("join_group", { p_group: groupId, p_token: token });
}
export async function leaveSupabaseGroup(groupId) {
  return runMutation("leave_group", { p_group: groupId });
}
export async function approveSupabaseGroup(groupId, revision) {
  return runMutation("approve_group", {
    p_group: groupId,
    p_revision: revision,
  });
}
export async function reportSupabaseGroupPayment(groupId, revision) {
  const { data, error } = await supabase.rpc("report_group_payment", {
    p_group: groupId,
    p_revision: revision,
  });
  if (error) throw error;
  return data;
}
export async function changeSupabaseDelivery(groupId, delivery) {
  return runMutation("change_group_delivery", {
    p_group: groupId,
    p_delivery: delivery,
  });
}
export async function updateSupabaseGroupDetails(
  groupId,
  { name, details, visibility, delivery },
) {
  return runMutation("update_group_details", {
    p_group: groupId,
    p_name: name,
    p_details: details,
    p_visibility: visibility,
    p_delivery: delivery,
  });
}
export async function transferSupabaseGroup(groupId, nextOwnerId) {
  return runMutation("transfer_group_owner", {
    p_group: groupId,
    p_next_owner: nextOwnerId,
  });
}
export async function removeSupabaseGroupMember(groupId, memberId) {
  return runMutation("remove_group_member", {
    p_group: groupId,
    p_member: memberId,
  });
}
export async function deleteSupabaseGroup(groupId) {
  return runMutation("delete_group", { p_group: groupId });
}
export async function getSupabaseInvite(groupId) {
  const { data, error } = await supabase.rpc("get_group_invite", {
    p_group: groupId,
  });
  if (error) throw error;
  return data;
}
