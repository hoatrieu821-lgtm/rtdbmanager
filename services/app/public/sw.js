const CACHE_NAME = 'rtdb-manager-v3';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/assets/favicon.svg',
  '/assets/icon-192.png',
  '/assets/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then((clients) => Promise.all(clients.map((client) => client.navigate(client.url))))
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (url.origin !== self.location.origin) {
    return;
  }

  if (isApiRequest(url)) {
    event.respondWith(networkFirst(request));
    return;
  }

  if (isAppShellRequest(request, url)) {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(cacheFirst(request));
});

/**
 * Checks whether a URL is an app data request.
 * @param {URL} url URL.
 * @returns {boolean} True for API/data routes.
 */
function isApiRequest(url) {
  return ['/api/', '/auth/', '/projects', '/data'].some((prefix) => url.pathname.startsWith(prefix));
}

/**
 * Checks whether a request should always prefer the network.
 * @param {Request} request Fetch request.
 * @param {URL} url URL.
 * @returns {boolean} True for HTML and JavaScript modules.
 */
function isAppShellRequest(request, url) {
  return request.mode === 'navigate'
    || url.pathname === '/'
    || url.pathname === '/index.html'
    || url.pathname.endsWith('.js');
}

/**
 * Network-first strategy with cache fallback for GET requests.
 * @param {Request} request Fetch request.
 * @returns {Promise<Response>} Response.
 */
async function networkFirst(request) {
  if (request.method !== 'GET') {
    return fetch(request);
  }

  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    return cached || offlineResponse();
  }
}

/**
 * Cache-first strategy for static assets.
 * @param {Request} request Fetch request.
 * @returns {Promise<Response>} Response.
 */
async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (request.method === 'GET') {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return offlineResponse();
  }
}

/**
 * Returns a minimal offline page.
 * @returns {Response} Offline response.
 */
function offlineResponse() {
  return new Response('<!doctype html><title>Offline</title><body style="background:#030712;color:#f9fafb;font-family:sans-serif;padding:2rem">RTDB Manager is offline.</body>', {
    headers: { 'Content-Type': 'text/html' },
    status: 503
  });
}
