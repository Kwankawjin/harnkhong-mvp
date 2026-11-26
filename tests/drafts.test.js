import test from "node:test";
import assert from "node:assert/strict";

const store = new Map();
globalThis.localStorage = {
  get length() { return store.size; },
  key: (i) => [...store.keys()][i] ?? null,
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.CSS = { escape: (v) => v };

const { captureDraft, restoreDrafts, clearDraft, clearAllDrafts, setDraftExtra, getDraftExtra, fieldKey } = await import("../src/drafts.js");

function field(tag, props = {}, attrs = {}) {
  return {
    tagName: tag.toUpperCase(),
    type: props.type || (tag === "textarea" ? "textarea" : tag === "select" ? "select-one" : "text"),
    name: "", id: "", value: "", checked: false, ...props,
    attributes: Object.keys(attrs).map((name) => ({ name })),
    hasAttribute: (name) => name in attrs,
  };
}
function form(key, fields) {
  return {
    dataset: { draft: key },
    matches: () => true,
    querySelectorAll: (sel) => (sel === "[data-draft]" ? [] : sel.startsWith("input[type=\"checkbox\"]") ? fields.filter((f) => f.type === "checkbox" && sel.includes(`"${f.name}"`)) : fields),
  };
}
const make = () => [
  field("input", { name: "name" }),
  field("textarea", { name: "memberNote" }),
  field("input", { name: "billing", type: "radio", value: "one_time", checked: true }),
  field("input", { name: "billing", type: "radio", value: "monthly" }),
  field("input", {}, { "data-announcement-title": "" }),
  field("input", { name: "password", type: "password" }),
  field("input", { name: "listingId", type: "hidden" }),
];

test("saves typed text and restores it into a fresh form", () => {
  const a = make();
  a[0].value = "หาร Netflix";
  a[1].value = "โอนภายใน 2 วัน";
  a[2].checked = false; a[3].checked = true;
  a[4].value = "ปิดปรับปรุง";
  a[5].value = "secret";
  a[6].value = "x";
  captureDraft(form("t", a));
  const b = make();
  restoreDrafts(form("t", b));
  assert.equal(b[0].value, "หาร Netflix");
  assert.equal(b[1].value, "โอนภายใน 2 วัน");
  assert.equal(b[3].checked, true);
  assert.equal(b[2].checked, false);
  assert.equal(b[4].value, "ปิดปรับปรุง");
  assert.equal(b[5].value, "", "passwords are never saved");
  assert.equal(b[6].value, "", "hidden fields are not saved");
  assert.ok(!store.get("harn-draft:t").includes("secret"));
});

test("empty form leaves no draft; clear removes it", () => {
  captureDraft(form("e", make()));
  assert.equal(store.has("harn-draft:e"), false);
  const a = make(); a[0].value = "x";
  captureDraft(form("e", a));
  assert.equal(store.has("harn-draft:e"), true);
  clearDraft("e");
  assert.equal(store.has("harn-draft:e"), false);
});

test("extras survive field saves and clearAllDrafts wipes everything", () => {
  setDraftExtra("c", "categories", ["อาหาร"]);
  const a = make(); a[0].value = "y";
  captureDraft(form("c", a));
  assert.deepEqual(getDraftExtra("c", "categories"), ["อาหาร"]);
  store.set("other", "keep");
  clearAllDrafts();
  assert.equal(getDraftExtra("c", "categories"), undefined);
  assert.equal(store.get("other"), "keep");
});

test("field keys", () => {
  assert.equal(fieldKey(field("input", { name: "a" })), "a");
  assert.equal(fieldKey(field("input", { id: "b" })), "#b");
  assert.equal(fieldKey(field("input", {}, { "data-x": "" })), "[data-x]");
});
