const CACHE_NAME = 'xiaoyang-v12.0';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/icon-192.svg',
  './icons/icon-512.svg'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME && !k.endsWith('-ocr') && !k.endsWith('-share')).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Handle Web Share Target POST requests
  if (e.request.method === 'POST' && url.pathname.endsWith('/index.html')) {
    e.respondWith(
      e.request.formData().then(formData => {
        const title = formData.get('title') || '';
        const text = formData.get('text') || '';
        const file = formData.get('screenshot');

        const params = new URLSearchParams();
        if (title) params.set('title', title);
        if (text) params.set('text', text);

        if (file && file instanceof File) {
          return file.arrayBuffer().then(buffer => {
            const blob = new Blob([buffer], { type: file.type });
            return caches.open(CACHE_NAME + '-share').then(cache => {
              const response = new Response(blob, {
                headers: { 'Content-Type': file.type }
              });
              cache.put('shared-image', response);
              params.set('hasImage', '1');
              return Response.redirect('./index.html?' + params.toString(), 303);
            });
          });
        }

        return Response.redirect('./index.html?' + params.toString(), 303);
      }).catch(() => {
        return caches.match('./index.html');
      })
    );
    return;
  }

  // Cache Tesseract.js CDN resources for offline OCR
  if (url.hostname === 'cdn.jsdelivr.net' && url.pathname.includes('tesseract')) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME + '-ocr').then(cache => cache.put(e.request, clone));
          }
          return response;
        }).catch(() => caches.match(e.request));
      })
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
