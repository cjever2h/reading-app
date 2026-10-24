// 서비스 워커: 앱 파일 오프라인 캐시 (데이터는 Supabase에서 직접)
const CACHE = 'reading-v3';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'db.js', 'ui.js', 'calc.js', 'forms.js', 'ocr.js', 'export.js', 'cert.js', 'guide-data.js',
  'v-home.js', 'v-library.js', 'v-book.js', 'v-timer.js', 'v-db.js', 'v-guide.js', 'v-review.js', 'v-stats.js', 'v-settings.js',
  'config.js', 'manifest.json', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname.endsWith('supabase.co')) return;
  if (url.origin === location.origin) {
    e.respondWith(fetch(req).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return res; })
      .catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
  } else if (url.hostname === 'cdn.jsdelivr.net') {
    e.respondWith(caches.match(req).then(r => r || fetch(req).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return res; })));
  }
});
