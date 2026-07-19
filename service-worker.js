/**
 * ============================================================================
 * SERVICE WORKER (service-worker.js)
 * ============================================================================
 * 
 * Provides offline shell caching and smart network interception.
 * - Static assets (CSS, JS, Icons): Cache-First strategy.
 * - HTML navigation: Network-First with Cache fallback.
 * - API requests (Google Apps Script): Network-Only without caching so live
 *   attendance records remain exact and fresh.
 * ============================================================================
 */

const CACHE_NAME = 'attendance-pwa-v17';
const STATIC_ASSETS = [
  'index.html',
  'manifest.json',
  'css/style.css',
  'js/config.js',
  'js/api.js',
  'js/db.js',
  'js/app.js',
  'icons/icon-192.png',
  'icons/icon-512.png'
];

/**
 * 1. Install Event: Cache App Shell resiliently
 */
self.addEventListener('install', (event) => {
  console.log('[Service Worker] Installing Cache Shell v4...');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Caching static assets');
      return Promise.allSettled(
        STATIC_ASSETS.map(url => cache.add(url).catch(err => console.warn('[SW Install] Could not cache asset:', url, err)))
      );
    }).then(() => self.skipWaiting())
  );
});

/**
 * 2. Activate Event: Clean up old caches
 */
self.addEventListener('activate', (event) => {
  console.log('[Service Worker] Activating and cleaning old caches...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('[Service Worker] Removing old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

/**
 * 3. Fetch Event: Intercept network requests with smart strategy
 */
self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);

  // RULE A: API requests (Google Apps Script Web App or queries with action parameter)
  // Bypass Service Worker completely so native browser fetch handles 302 cross-domain redirects without errors.
  if (requestUrl.hostname.includes('script.google.com') || requestUrl.hostname.includes('script.googleusercontent.com') || requestUrl.searchParams.has('action')) {
    return;
  }

  // RULE B: HTML Navigation requests (`index.html`) -> Network-First with Cache fallback
  if (event.request.mode === 'navigate' || requestUrl.pathname.endsWith('.html') || requestUrl.pathname === '/') {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          // Update cache with fresh copy
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
          return networkResponse;
        })
        .catch(() => {
          console.log('[Service Worker] Navigation offline. Falling back to cached index.html');
          return caches.match('index.html');
        })
    );
    return;
  }

  // RULE C: Static Assets (`css`, `js`, `icons`) -> Network-First with Cache fallback
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse.status === 200 && event.request.method === 'GET') {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
        }
        return networkResponse;
      })
      .catch(() => {
        return caches.match(event.request);
      })
  );
});
