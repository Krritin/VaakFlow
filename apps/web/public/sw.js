// Minimal app-shell service worker for installability + offline shell (§10).
const CACHE = "vaakflow-v1";
const SHELL = ["/", "/dashboard", "/manifest.webmanifest", "/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // never cache POST /voice, /sync
  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(() => caches.match("/")));
    return;
  }
  event.respondWith(caches.match(req).then((cached) => cached || fetch(req)));
});

// Background Sync hook (progressive enhancement). The page also flushes the
// IndexedDB queue on the 'online' event, so this is best-effort.
self.addEventListener("sync", (event) => {
  if (event.tag === "vaakflow-sync") {
    // The queue lives in IndexedDB; clients drain it. Notify open clients.
    event.waitUntil(
      self.clients.matchAll().then((clients) =>
        clients.forEach((c) => c.postMessage({ type: "flush-queue" }))
      )
    );
  }
});
