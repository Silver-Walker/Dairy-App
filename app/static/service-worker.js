'use strict';

const CACHE_NAME = 'dairy-app-shell-v17';
const APP_SHELL = [
  '/',
  '/static/css/style.css',
  '/static/js/offline.js',
  '/static/js/api.js',
  '/static/js/charts.js',
  '/static/js/app.js',
  '/static/vendor/chart.umd.js'
];

self.addEventListener('install', function (event) {
  event.waitUntil(caches.open(CACHE_NAME).then(function (cache) { return cache.addAll(APP_SHELL); }));
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (key) { return key !== CACHE_NAME; })
      .map(function (key) { return caches.delete(key); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (event) {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin ||
      url.pathname.indexOf('/api/') === 0 || url.pathname.indexOf('/auth/') === 0) return;

  if (url.pathname === '/') {
    event.respondWith(fetch(request).then(function (response) {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(function (cache) { cache.put(request, copy); });
      }
      return response;
    }).catch(function () {
      return caches.match(request).then(function (cached) {
        return cached || caches.match('/', { ignoreSearch: true }).then(function (shell) {
          return shell || new Response('The app shell is not available offline yet.', {
          status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' }
          });
        });
      });
    }));
    return;
  }

  event.respondWith(caches.match(request).then(function (cached) {
    if (cached) return cached;
    return fetch(request);
  }));
});
