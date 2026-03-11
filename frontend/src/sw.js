// sw.js — Service Worker pour le configurateur Comelit PWA
const CACHE_NAME = 'comelit-config-v1';

// Fichiers à cacher pour le fonctionnement offline
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/assets/logo.png',
  '/assets/logosmall.png',
];

// Install — pré-cacher les assets essentiels
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Pre-caching assets');
      return cache.addAll(PRECACHE_URLS);
    })
  );
  self.skipWaiting();
});

// Activate — nettoyer les anciens caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// Fetch — stratégie Network First, fallback cache
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // Ne pas cacher les appels API, KPI, proxy-pdf
  if (url.pathname.startsWith('/api/') || 
      url.pathname.startsWith('/proxy-pdf') ||
      url.pathname.startsWith('/export/')) {
    return;
  }

  // Pour les CSV de données — Network First (données fraîches)
  if (url.pathname.startsWith('/data/')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Pour les images Comelit — Cache First (ne changent pas)
  if (url.hostname.includes('comelitgroup.com') && 
      (url.pathname.includes('/storage/') || url.pathname.includes('.png') || url.pathname.includes('.jpg'))) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        });
      })
    );
    return;
  }

  // Pour tout le reste — Network First
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok && event.request.method === 'GET') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
