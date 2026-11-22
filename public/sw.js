/*
 * Self-destroying service worker (replaces the old Workbox worker).
 *
 * WHY: the previous `sw.js` registered a `NetworkFirst` route for every
 * navigation (`request.mode === "navigate"`). Whenever the origin was slow or
 * briefly unreachable, Workbox rejected the request with
 *
 *     workbox no-response :: [{"url":"https://yasco.tech/"}]
 *
 * and the browser showed a blank page for the landing, /login, /app and the
 * travel dashboard ("kuch b open nahi ho raha").
 *
 * This worker intentionally has NO `fetch` handler, so it never intercepts a
 * request. As soon as the browser picks it up it:
 *   1. skips waiting and activates immediately,
 *   2. unregisters itself,
 *   3. deletes every Cache Storage entry the old worker created,
 *   4. reloads every open tab so the real page loads from the network.
 *
 * After one reload no service worker controls the site at all.
 */
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // 1) Remove this registration completely.
      try {
        await self.registration.unregister();
      } catch (e) {
        /* ignore */
      }

      // 2) Wipe every cache (pages-cache, asset-cache, api-cache, workbox-*).
      try {
        const keys = await caches.keys();
        await Promise.all(
          keys.map((key) => {
            try {
              return caches.delete(key);
            } catch (e) {
              return undefined;
            }
          }),
        );
      } catch (e) {
        /* ignore */
      }

      // 3) Reload all clients so nobody is stuck on a cached/blank shell.
      try {
        const clients = await self.clients.matchAll({
          type: "window",
          includeUncontrolled: true,
        });
        for (const client of clients) {
          try {
            client.navigate(client.url);
          } catch (e) {
            /* ignore */
          }
        }
      } catch (e) {
        /* ignore */
      }
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
