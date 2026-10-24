const CACHE_NAME = "skin-lesion-analyzer-v34";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/skinassess.css",
  "./css/w3.css",
  "./css/skin.css",
  "./css/pwa.css",
  "./css/woza.css",
  "./jscript/app_startup_code.js",
  "./jscript/app_batch_prediction_code.js",
  "./jscript/ui.js",
  "./jscript/pwa.js",
  "./assets/app-icon.svg",
  "./assets/robotfavicon.png",
  "./trained_model_7class/class_names.json",
  "./trained_model_7class/model.json",
  "./trained_model_7class/group1-shard1of4.bin",
  "./trained_model_7class/group1-shard2of4.bin",
  "./trained_model_7class/group1-shard3of4.bin",
  "./trained_model_7class/group1-shard4of4.bin"
];
const REQUIRED_EXTERNAL_SCRIPTS = [
  "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js"
];
const EXTERNAL_ASSET_HOSTS = new Set([
  "ajax.googleapis.com",
  "cdn.jsdelivr.net",
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  "use.fontawesome.com"
]);

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL);
    await Promise.all(REQUIRED_EXTERNAL_SCRIPTS.map(async (url) => {
      try {
        const response = await fetch(url, { mode: "no-cors" });
        if (!response.ok && response.type !== "opaque") {
          throw new Error(`Request failed with status ${response.status}`);
        }
        await cache.put(url, response);
      } catch (error) {
        console.warn(`Could not cache offline dependency ${url}:`, error);
      }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key.startsWith("skin-lesion-analyzer-") && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    if (!EXTERNAL_ASSET_HOSTS.has(url.hostname)) return;
    event.respondWith(cacheExternalAsset(request));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("./index.html"))
    );
    return;
  }

  event.respondWith(cacheSameOriginRequest(request));
});

async function cacheSameOriginRequest(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
  }
  return response;
}

async function cacheExternalAsset(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok || response.type === "opaque") {
    await cache.put(request, response.clone());
  }
  return response;
}
