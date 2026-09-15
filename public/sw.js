/* MyTwitter app-shell service worker — enables cold start offline after one online visit. */
const CACHE = "mytwitter-shell-v14";
const APP_JS = "/app.js?v=0.1.14";

const PRECACHE = [
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  APP_JS,
  "/firebase-config.js",
  "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js",
  "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js",
  "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js",
  "https://www.gstatic.com/firebasejs/11.6.0/firebase-functions.js",
];

const FIREBASE_CDN = "https://www.gstatic.com/firebasejs/";

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      // Drop every prior shell cache so offline never boots an old app.js.
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      const cache = await caches.open(CACHE);
      await Promise.all(
        PRECACHE.map(async (url) => {
          try {
            await cache.add(url);
          } catch (err) {
            console.warn("[sw] precache skip", url, err);
          }
        })
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

function isOAuthPath(pathname) {
  return pathname.startsWith("/oauth/");
}

function isAppScript(pathname) {
  return pathname === "/app.js" || pathname === "/sw.js";
}

function isShellAsset(url) {
  if (url.origin === self.location.origin) {
    const p = url.pathname;
    return (
      p === "/" ||
      p === "/index.html" ||
      p === "/styles.css" ||
      p === "/app.js" ||
      p === "/firebase-config.js" ||
      p === "/sw.js"
    );
  }
  return url.href.startsWith(FIREBASE_CDN);
}

async function staleWhileRevalidate(event, request) {
  const cache = await caches.open(CACHE);
  const cached =
    (await cache.match(request, { ignoreSearch: true })) ||
    (await cache.match(request));
  const networkPromise = fetch(request)
    .then((fresh) => {
      if (fresh && fresh.ok) {
        cache.put(request, fresh.clone()).catch(() => {});
        const url = new URL(request.url);
        if (url.pathname === "/app.js") {
          cache.put("/app.js", fresh.clone()).catch(() => {});
        }
      }
      return fresh;
    })
    .catch(() => null);

  if (cached) {
    event.waitUntil(networkPromise);
    return cached;
  }

  const fresh = await networkPromise;
  if (fresh) return fresh;
  if (request.mode === "navigate") {
    const fallback =
      (await cache.match("/index.html")) || (await cache.match("/"));
    if (fallback) return fallback;
  }
  throw new Error("offline and no cached response");
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) return cached;
  const fresh = await fetch(request);
  if (fresh.ok) {
    cache.put(request, fresh.clone()).catch(() => {});
  }
  return fresh;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  if (url.origin === self.location.origin && isOAuthPath(url.pathname)) {
    return;
  }

  if (url.origin === self.location.origin && isAppScript(url.pathname)) {
    event.respondWith(staleWhileRevalidate(event, request));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(staleWhileRevalidate(event, request));
    return;
  }

  if (isShellAsset(url)) {
    event.respondWith(cacheFirst(request));
  }
});
