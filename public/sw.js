const CACHE_NAME = "betelgeze-pwa-v1";
const STATIC_ASSETS = [
  "/icons/betelgeze-icon-192.png",
  "/icons/betelgeze-icon-512.png",
  "/brand/betelgeze-logo-inverted-no-background.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("betelgeze-pwa-") && key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (!STATIC_ASSETS.includes(url.pathname)) return;

  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});

self.addEventListener("push", (event) => {
  let payload = {};
  if (event.data) {
    try {
      payload = event.data.json();
    } catch {
      payload = { body: event.data.text() };
    }
  }

  const title = typeof payload.title === "string" ? payload.title : "Betelgeze";
  const options = {
    body: typeof payload.body === "string" ? payload.body : "A Betelgeze update is ready.",
    icon: typeof payload.icon === "string" ? payload.icon : "/icons/betelgeze-icon-192.png",
    badge: "/icons/betelgeze-icon-192.png",
    tag: typeof payload.tag === "string" ? payload.tag : undefined,
    renotify: typeof payload.tag === "string",
    data: {
      url: typeof payload.url === "string" && payload.url.startsWith("/") ? payload.url : "/",
      category: typeof payload.category === "string" ? payload.category : "update",
      conversationId: typeof payload.conversationId === "string" ? payload.conversationId : null,
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetPath = event.notification.data?.url || "/";
  const targetUrl = new URL(targetPath, self.location.origin).href;

  event.waitUntil(
    (async () => {
      const clientList = await clients.matchAll({ type: "window", includeUncontrolled: true });
      const exactClient = clientList.find((client) => client.url === targetUrl);
      if (exactClient) return exactClient.focus();
      const existingClient = clientList.find((client) => client.url.startsWith(self.location.origin));
      if (existingClient) {
        const navigatedClient = await existingClient.navigate(targetUrl);
        return navigatedClient ? navigatedClient.focus() : existingClient.focus();
      }
      return clients.openWindow(targetUrl);
    })()
  );
});
