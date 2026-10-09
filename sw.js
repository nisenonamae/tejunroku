// 版は index.html の APP_VERSION から ?v= で渡される
const V = new URL(self.location).searchParams.get('v') || '0';
const CACHE = 'tejunroku-v' + V;
const FILES = ['./', './index.html', './core.js', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k.startsWith('tejunroku-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return; // GitHub API はそのまま通す
  if (req.mode === 'navigate' || req.url.endsWith('.html')) {
    // 画面は新しいものを先に取りに行き、つながらなければ保存しておいたもの
    e.respondWith(fetch(req).then(r => { const c = r.clone(); caches.open(CACHE).then(x => x.put(req, c)); return r; })
      .catch(() => caches.match(req).then(r => r || caches.match('./index.html'))));
    return;
  }
  e.respondWith(caches.match(req).then(r => r || fetch(req)));
});
