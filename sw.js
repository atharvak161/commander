/* commander service worker — makes the site work with no network.
 *
 * Why: this is a reference you reach for inside a client's building, on a
 * locked-down segment with no route to the internet. Everything here is static
 * and self-contained, so there is no reason it should need the network once
 * you have opened it once.
 *
 * Strategy: cache-first for same-origin GET, with a network fallback that also
 * populates the cache. Assets are content-hashed (app.js?v=HASH), so a cached
 * copy is never stale — a new deploy has new URLs and misses the cache cleanly.
 * data/*.json and index.html are not hashed, so they are revalidated in the
 * background (stale-while-revalidate): you get the cached copy instantly and
 * the next load has the fresh one.
 */
var CACHE = 'commander-v1';
var CORE = [
  './',
  './index.html',
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(CORE); }).then(function () {
    return self.skipWaiting();
  }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;       // never touch third-party requests

  var hashed = /\?v=[a-f0-9]+/.test(url.search);          // content-hashed asset

  if (hashed) {
    // cache-first: a hashed URL's content never changes
    e.respondWith(caches.match(req).then(function (hit) {
      return hit || fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
        return res;
      });
    }));
  } else {
    // stale-while-revalidate for index.html and data/*.json
    e.respondWith(caches.match(req).then(function (hit) {
      var net = fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
        return res;
      }).catch(function () { return hit; });
      return hit || net;
    }));
  }
});
