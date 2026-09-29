// Builds the web app into docs/ (served by GitHub Pages).
// Uses esbuild and React from the global npm folder (no package install needed).

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const globalModules = process.env.GLOBAL_NODE_MODULES || "/home/claude/.npm-global/lib/node_modules";
const require = createRequire(import.meta.url);
const esbuild = require(join(globalModules, "tsx/node_modules/esbuild"));
const out = join(root, "docs");
mkdirSync(out, { recursive: true });

const version = process.env.APP_VERSION || "0.1.0";

// Built-in food database (restaurant items + staples), shipped beside app.js and cached offline.
const foodDb = readFileSync(join(root, "src/data/fooddb.json"));
const foodDbUrl = `fooddb.json?v=${createHash("sha256").update(foodDb).digest("hex").slice(0, 10)}`;
writeFileSync(join(out, "fooddb.json"), foodDb);

// The four MAGI type roles. Noto Serif 900 is used only for English display words (the brand).
const FONTS =
  "https://fonts.googleapis.com/css2?family=Arimo:wght@700&family=Noto+Serif:wght@900&family=Roboto+Condensed:wght@400;700&family=Share+Tech+Mono&display=swap";

const result = await esbuild.build({
  entryPoints: [join(root, "src/main.tsx")],
  bundle: true,
  minify: true,
  format: "iife",
  target: ["safari16"],
  jsx: "automatic",
  nodePaths: [globalModules],
  define: { "process.env.NODE_ENV": '"production"', __APP_VERSION__: JSON.stringify(version), __FOODDB_URL__: JSON.stringify(foodDbUrl) },
  write: false,
  logLevel: "warning",
  legalComments: "none",
});
const js = result.outputFiles[0].contents;
// MAGI base (tokens + mg- components) first, then the app's own styles.
const css = Buffer.concat([readFileSync(join(root, "src/magi/base.css")), Buffer.from("\n"), readFileSync(join(root, "src/styles.css"))]);
const hash = createHash("sha256").update(js).update(css).digest("hex").slice(0, 10);

writeFileSync(join(out, "app.js"), js);
writeFileSync(join(out, "app.css"), css);

// Icons.
for (const f of ["icon-180.png", "icon-192.png", "icon-512.png"]) {
  const src = join(root, "public", f);
  if (existsSync(src)) copyFileSync(src, join(out, f));
}

writeFileSync(
  join(out, "manifest.webmanifest"),
  JSON.stringify(
    {
      name: "Janos Health",
      short_name: "Janos",
      start_url: "./",
      scope: "./",
      display: "standalone",
      background_color: "#000000",
      theme_color: "#000000",
      icons: [
        { src: "icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "icon-512.png", sizes: "512x512", type: "image/png" },
      ],
    },
    null,
    2,
  ),
);

writeFileSync(
  join(out, "index.html"),
  `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#000000">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black">
<meta name="apple-mobile-web-app-title" content="Janos">
<title>Janos Health</title>
<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="icon-180.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}">
<link rel="stylesheet" href="app.css?v=${hash}">
</head>
<body>
<div id="root"></div>
<noscript>JANOS HEALTH REQUIRES JAVASCRIPT.</noscript>
<script src="app.js?v=${hash}"></script>
</body>
</html>
`,
);

// Service worker: app shell cached for offline use; Garmin data always fetched fresh.
const shell = ["./", "index.html", `app.js?v=${hash}`, `app.css?v=${hash}`, foodDbUrl, "manifest.webmanifest", "icon-180.png", "icon-192.png", "icon-512.png"];
writeFileSync(
  join(out, "sw.js"),
  `const CACHE = "janos-${hash}";
const SHELL = ${JSON.stringify(shell)};
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
`,
);

writeFileSync(join(out, ".nojekyll"), "");
console.log(`Built docs/ (version ${version}, ${hash}, app.js ${(js.length / 1024).toFixed(0)} KB)`);
