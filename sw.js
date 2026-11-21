/* =========================================================================
 * SERVICE WORKER (App Shell + ArcGIS Runtime + Map Tile Offline Cache)
 * ========================================================================= */

const SHELL_CACHE = "field-app-shell-v2";
const ARCGIS_CACHE = "field-app-arcgis-v2";
const TILES_CACHE = "field-app-tiles-v2";
const MAX_CACHED_TILES = 350;

const APP_SHELL_URLS = [
  "/app/",
  "/app/index.html",
  "/exec/",
  "/exec/index.html",
  "/css/style.css",
  "/js/config.js",
  "/js/offline-db.js",
  "/js/app.js",
  "/assets/logos.jpg"
];

const ARCGIS_PRECACHE_URLS = [
  "https://js.arcgis.com/4.30/",
  "https://js.arcgis.com/4.30/esri/themes/light/main.css"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const shellCache = await caches.open(SHELL_CACHE);
      await Promise.all(
        APP_SHELL_URLS.map((url) =>
          shellCache.add(new Request(url, { credentials: "same-origin" })).catch(() => {})
        )
      );

      const arcgisCache = await caches.open(ARCGIS_CACHE);
      await Promise.all(
        ARCGIS_PRECACHE_URLS.map((url) =>
          arcgisCache.add(new Request(url, { mode: "cors" })).catch(() => {})
        )
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  const validCaches = new Set([SHELL_CACHE, ARCGIS_CACHE, TILES_CACHE]);
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.map((key) => {
          if (!validCaches.has(key)) {
            return caches.delete(key);
          }
          return null;
        })
      );
      await self.clients.claim();
    })()
  );
});

function isTileRequest(url) {
  const host = url.hostname.toLowerCase();
  const path = url.pathname.toLowerCase();
  if (
    (host.includes("arcgisonline.com") || host.includes("arcgis.com")) &&
    (path.includes("/tile/") || path.includes("/tilemap/") || host.startsWith("basemaps"))
  ) {
    return true;
  }
  return false;
}

function isArcgisSdkAsset(url) {
  return url.hostname.toLowerCase() === "js.arcgis.com";
}

function isLocalShellAsset(url) {
  if (url.origin !== self.location.origin) return false;
  if (url.pathname.startsWith("/api/")) return false;
  if (url.pathname === "/sw.js") return false;
  return (
    url.pathname === "/app" ||
    url.pathname === "/app/" ||
    url.pathname === "/app/index.html" ||
    url.pathname === "/exec" ||
    url.pathname === "/exec/" ||
    url.pathname === "/exec/index.html" ||
    url.pathname.startsWith("/css/") ||
    url.pathname.startsWith("/js/") ||
    url.pathname.startsWith("/assets/")
  );
}

async function networkFirst(request, cacheName, fallbackUrls = []) {
  try {
    const networkRes = await fetch(request);
    // Avoid caching auth redirects (3xx/opaque) or error responses as app shell
    if (networkRes && networkRes.status === 200 && networkRes.type === "basic") {
      const cache = await caches.open(cacheName);
      cache.put(request, networkRes.clone()).catch(() => {});
    }
    return networkRes;
  } catch (err) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);
    if (cached) return cached;

    for (const url of fallbackUrls) {
      const alt = await cache.match(url);
      if (alt) return alt;
    }
    throw err;
  }
}

async function cacheFirstBounded(request, cacheName, maxEntries = 0) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  const networkRes = await fetch(request);
  if (networkRes && (networkRes.status === 200 || networkRes.type === "opaque")) {
    cache
      .put(request, networkRes.clone())
      .then(async () => {
        if (maxEntries > 0) {
          const keys = await cache.keys();
          if (keys.length > maxEntries) {
            await cache.delete(keys[0]);
          }
        }
      })
      .catch(() => {});
  }
  return networkRes;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin === self.location.origin && url.pathname.startsWith("/api/")) {
    return;
  }

  // Never cache ArcGIS FeatureServer data queries/edits in SW (handled by IndexedDB)
  if (url.pathname.includes("/FeatureServer")) {
    return;
  }

  if (isLocalShellAsset(url)) {
    let fallbacks = [];
    if (request.mode === "navigate") {
      fallbacks = url.pathname.startsWith("/exec")
        ? ["/exec/", "/exec/index.html"]
        : ["/app/", "/app/index.html"];
    }
    event.respondWith(networkFirst(request, SHELL_CACHE, fallbacks));
    return;
  }

  if (isArcgisSdkAsset(url)) {
    event.respondWith(cacheFirstBounded(request, ARCGIS_CACHE));
    return;
  }

  if (isTileRequest(url)) {
    event.respondWith(cacheFirstBounded(request, TILES_CACHE, MAX_CACHED_TILES));
  }
});
