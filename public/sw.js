/* HarnKhong service worker: Web Push only. It does not cache pages or API calls, so the app
   always loads the latest deploy and never serves stale money figures. */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

/** Only open pages on this site; anything else falls back to the notification list. */
function safePath(url) {
  return typeof url === "string" && /^\/(?!\/)[^\s\\]*$/.test(url) ? url : "/notifications";
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = String(data.title || "HarnKhong").slice(0, 120);
  const options = {
    body: String(data.body || "มีการแจ้งเตือนใหม่").slice(0, 300),
    icon: "/icons/icon-192.png",
    tag: data.tag ? String(data.tag).slice(0, 64) : undefined,
    renotify: Boolean(data.tag),
    lang: "th",
    data: { url: safePath(data.url) },
  };
  // Every push must show a notification (userVisibleOnly).
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = safePath(event.notification.data && event.notification.data.url);
  const target = new URL(path, self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const open = windows.find((client) => new URL(client.url).origin === self.location.origin);
    if (open) {
      await open.focus();
      // The app (src/push.js listenForNotificationClicks) opens the page without a reload.
      open.postMessage({ type: "harnkhong:open", url: path });
      return;
    }
    await self.clients.openWindow(target);
  })());
});
