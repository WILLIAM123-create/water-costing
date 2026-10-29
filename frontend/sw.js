// Service worker: makes the site installable. Pages are always fetched fresh when online,
// so a new deploy shows up straight away. Calls to the Render API are never cached.
const CACHE = "wc-shell-v3";
const STATIC = ["/css/style.css", "/js/app.js", "/js/auth.js", "/js/config.js", "/icons/icon-192.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return; // API calls go straight to the network
  e.respondWith(
    fetch(req).then(res => {
      if (res.ok && !res.redirected) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(async () => {
      const hit = await caches.match(req);
      if (hit) return hit;
      if (req.mode === "navigate") return new Response("<!doctype html><meta name=viewport content='width=device-width,initial-scale=1'><body style='font-family:sans-serif;padding:2rem'><h2>You are offline</h2><p>Connect to the internet and reopen the app. Your records are stored on the server.</p>", { headers: { "Content-Type": "text/html" } });
      return Response.error();
    })
  );
});
