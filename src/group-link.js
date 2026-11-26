// Turns a pasted invite link (from LINE, Messenger, any HarnKhong domain) into an in-app path.
// Only the path and invite token are kept, so the user stays on the domain they are signed in to.

const GROUP_PATH = /^\/groups\/([A-Za-z0-9_-]+)(?:\/[^?#]*)?$/;

export function parseGroupLink(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;

  // A pasted message may wrap the link in other words: take the first URL in it.
  const urlMatch = raw.match(/https?:\/\/[^\s<>"']+/i);
  let candidate = urlMatch ? urlMatch[0] : raw.split(/\s+/)[0];

  // Bare host without scheme, e.g. "hamsterworkspace.site/groups/abc".
  if (!urlMatch && !candidate.startsWith("/") && candidate.includes("/groups/"))
    candidate = `https://${candidate}`;

  // A bare group id.
  if (/^[A-Za-z0-9_-]{2,}$/.test(candidate) && /\d/.test(candidate))
    candidate = `/groups/${candidate}`;

  let url;
  try {
    url = new URL(candidate, "https://harnkhong.invalid");
  } catch {
    return null;
  }

  const match = url.pathname.replace(/\/+$/, "").match(GROUP_PATH);
  if (!match || match[1] === "create") return null;

  const path = `/groups/${match[1]}`;
  const invite = url.searchParams.get("invite");
  return invite ? `${path}?invite=${encodeURIComponent(invite)}` : path;
}
