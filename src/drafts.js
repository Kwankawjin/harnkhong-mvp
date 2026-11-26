// Keeps what someone typed in a form when they leave the page, re-render it, or close the tab.
// Mark a form (or any wrapper) with data-draft="<key>", call restoreDrafts() after rendering,
// and clearDraft(key) once it has been submitted successfully.

const PREFIX = "harn-draft:";
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const SKIP_TYPES = new Set(["hidden", "file", "password", "submit", "button", "reset", "image"]);

function storage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

/** The name a field is saved under: name, then id, then its first data-* attribute. */
export function fieldKey(el) {
  if (el.name) return el.name;
  if (el.id) return `#${el.id}`;
  const data = [...(el.attributes || [])].find((attr) => attr.name.startsWith("data-") && attr.name !== "data-draft-skip");
  return data ? `[${data.name}]` : "";
}

function draftFields(container) {
  return [...container.querySelectorAll("input, textarea, select")].filter(
    (el) => !SKIP_TYPES.has(el.type) && !el.hasAttribute("data-draft-skip") && fieldKey(el),
  );
}

export function readDraft(key) {
  const store = storage();
  if (!store || !key) return null;
  try {
    const draft = JSON.parse(store.getItem(PREFIX + key) || "null");
    if (!draft || typeof draft !== "object") return null;
    if (Date.now() - Number(draft.at || 0) > MAX_AGE_MS) {
      store.removeItem(PREFIX + key);
      return null;
    }
    return draft;
  } catch {
    return null;
  }
}

function writeDraft(key, draft) {
  const store = storage();
  if (!store || !key) return;
  try {
    store.setItem(PREFIX + key, JSON.stringify({ ...draft, at: Date.now() }));
  } catch {
    // Storage full (big images) — keep the text at least.
    if (draft.extra) {
      try {
        const { images, ...rest } = draft.extra;
        store.setItem(PREFIX + key, JSON.stringify({ ...draft, extra: rest, at: Date.now() }));
      } catch {
        /* Nothing more we can do. */
      }
    }
  }
}

/** Saves every field in a data-draft container. Empty forms remove the draft. */
export function captureDraft(container) {
  const key = container?.dataset?.draft;
  if (!key) return;
  const fields = {};
  for (const el of draftFields(container)) {
    const name = fieldKey(el);
    if (el.type === "radio") {
      if (el.checked) fields[name] = el.value;
    } else if (el.type === "checkbox") {
      const group = container.querySelectorAll(`input[type="checkbox"][name="${CSS.escape(el.name || "")}"]`);
      if (el.name && group.length > 1) {
        fields[name] ||= [];
        if (el.checked) fields[name].push(el.value);
      } else fields[name] = el.checked;
    } else fields[name] = el.value;
  }
  const previous = readDraft(key);
  const typed = draftFields(container).some(
    (el) => (el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && !["radio", "checkbox", "range"].includes(el.type))) && el.value.trim(),
  );
  if (!typed && !previous?.extra) {
    clearDraft(key);
    return;
  }
  writeDraft(key, { fields, extra: previous?.extra });
}

/** Fills data-draft containers under root from their saved drafts. Returns the keys restored. */
export function restoreDrafts(root = document) {
  const restored = [];
  const containers = [...(root.matches?.("[data-draft]") ? [root] : []), ...root.querySelectorAll("[data-draft]")];
  for (const container of containers) {
    const draft = readDraft(container.dataset.draft);
    if (!draft?.fields) continue;
    for (const el of draftFields(container)) {
      const name = fieldKey(el);
      if (!(name in draft.fields)) continue;
      const value = draft.fields[name];
      if (el.type === "radio") el.checked = el.value === value;
      else if (el.type === "checkbox") el.checked = Array.isArray(value) ? value.includes(el.value) : Boolean(value);
      else if (typeof value === "string") el.value = value;
    }
    restored.push(container.dataset.draft);
  }
  return restored;
}

/** Extra state that is not a form field (selected chips, uploaded image previews). */
export function setDraftExtra(key, name, value) {
  const draft = readDraft(key) || { fields: {} };
  writeDraft(key, { ...draft, extra: { ...(draft.extra || {}), [name]: value } });
}

export function getDraftExtra(key, name) {
  return readDraft(key)?.extra?.[name];
}

export function clearDraft(key) {
  try {
    storage()?.removeItem(PREFIX + key);
  } catch {
    /* ignore */
  }
}

/** Removes every saved draft, e.g. on sign out so the next person on this device can't see them. */
export function clearAllDrafts() {
  const store = storage();
  if (!store) return;
  try {
    for (let i = store.length - 1; i >= 0; i -= 1) {
      const key = store.key(i);
      if (key?.startsWith(PREFIX)) store.removeItem(key);
    }
  } catch {
    /* ignore */
  }
}

let installed = false;
/** Saves drafts as the user types, from anywhere in the document. */
export function installDraftAutosave(doc = document) {
  if (installed) return;
  installed = true;
  const save = (event) => {
    const container = event.target?.closest?.("[data-draft]");
    if (container) captureDraft(container);
  };
  doc.addEventListener("input", save);
  doc.addEventListener("change", save);
}
