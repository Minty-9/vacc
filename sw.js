// Minimal service worker — exists only so the browser considers VACC Learn an
// installable PWA (required by Chrome/Edge/Samsung Internet for the "Add to Home
// Screen" prompt). Deliberately does NOT cache anything: this app changes often
// (courses, payments, admin content), and a caching service worker risks serving
// stale pages to students. Every request just passes straight through to the network.
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});

// ───────────────────────── Web Push ─────────────────────────
// Shows a real OS/lock-screen notification even when the app/tab isn't open,
// sent from the send-push Netlify function whenever an admin posts an
// announcement. Not Firebase Cloud Messaging — plain Web Push (VAPID), so it
// has no dependency on Firebase beyond where the subscription itself is stored.
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) {
    data = { title: 'VACC Learn', body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'VACC Learn';
  const options = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: data.url || '/' }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if ('focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
