// Ballet AI Coach service worker.
// App files: network first (so updates show up), falling back to the cache when offline.
// Pose model and libraries from the CDN: cache first (their URLs are versioned).
// Supabase traffic is never cached.
// When you change any app file, bump VERSION so phones pick up the new version.
const VERSION = "bac-v8";
const SHELL = ["./", "./index.html", "./config.js", "./manifest.webmanifest",
               "./icons/icon-192.png", "./icons/icon-512.png", "./icons/apple-touch-icon.png"];
const CDN_HOSTS = ["cdn.jsdelivr.net", "storage.googleapis.com"];
 
self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== "bac-cdn").map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (CDN_HOSTS.includes(url.hostname)){
    e.respondWith(caches.open("bac-cdn").then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    }));
    return;
  }
  if (url.origin === location.origin){
    e.respondWith(fetch(req).then(res => {
      if (res.ok){ const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then(r => r || caches.match("./index.html"))));
  }
});