const CACHE_NAME = 'xiaoyang-v6.0';
const ASSETS = [
  './',
  './index.html',
  './app.js',
  './manifest.json',
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
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
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

        // Build redirect URL with share data as query params
        const params = new URLSearchParams();
        if (title) params.set('title', title);
        if (text) params.set('text', text);

        // If there's a file, we can't pass it via URL params
        // Store it in a temporary location that the page can read
        if (file && file instanceof File) {
          // Store the shared file for the page to pick up
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

  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
