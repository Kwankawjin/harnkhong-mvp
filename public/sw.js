// HarnKhong service worker: shows push notifications on the phone's lock screen and
// notification centre, and opens the right page when one is tapped. It does not cache pages,
// so a new deploy is always picked up straight away.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "HarnKhong";
  const options = {
    body: data.body || "",
    icon: "/icon-192.png",
    badge: "/badge-72.png",
    tag: data.tag || undefined,
    renotify: Boolean(data.tag),
    data: { url: data.url || "/notifications" },
  };
  event.waitUntil(
    (async () => {
      await self.registration.showNotification(title, options);
      // Red count on the home-screen icon, where the device supports it.
      if (typeof data.badge === "number" && self.navigator.setAppBadge) {
        try { await self.navigator.setAppBadge(data.badge); } catch { /* not supported */ }
      }
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/notifications", self.location.origin);
  // Only ever open pages of this site.
  if (target.origin !== self.location.origin) return;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        await client.focus();
        if ("navigate" in client) return client.navigate(target.href);
        return undefined;
      }
      return self.clients.openWindow(target.href);
    })(),
  );
});

// The browser rotated the subscription: tell open pages so they save the new one.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((windows) =>
      windows.forEach((client) => client.postMessage({ type: "push-subscription-changed" })),
    ),
  );
});
