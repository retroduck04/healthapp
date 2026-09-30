const CACHE = "janos-c3f8425816";
const SHELL = ["./","index.html","app.js?v=c3f8425816","app.css?v=c3f8425816","fooddb.json?v=c1361e3c40","manifest.webmanifest","icon-180.png","icon-192.png","icon-512.png"];
const RUNTIME = "janos-runtime";
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
});
self.addEventListener("message", (e) => {
  if (e.data === "skip-waiting") self.skipWaiting();
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== RUNTIME).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  if (url.origin === location.origin && url.pathname.includes("/data/")) return; // Garmin data: network only
  if (url.origin === location.origin) {
    if (e.request.mode === "navigate") {
      e.respondWith(fetch(e.request).catch(() => caches.match("index.html")));
      return;
    }
    e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
    return;
  }
  if (url.hostname === "cdn.jsdelivr.net" || url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    // Barcode scanner library and Google Fonts: cache-first after first use, so both work offline.
    e.respondWith(
      caches.open(RUNTIME).then((c) =>
        c.match(e.request).then(
          (r) =>
            r ||
            fetch(e.request).then((res) => {
              if (res.ok || res.type === "opaque") c.put(e.request, res.clone());
              return res;
            })
        )
      )
    );
  }
});
