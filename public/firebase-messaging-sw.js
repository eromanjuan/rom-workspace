/* ROMIO push service worker.
 *
 * This is what lets a reminder reach you with ROMIO fully closed: the browser
 * keeps this worker available even when no tab is open, and FCM wakes it.
 *
 * It must be a classic service worker at the site root, so it loads Firebase
 * from the CDN (compat build) rather than the app bundle. The config here is the
 * public web config — safe to ship, access is enforced by Firestore rules.
 */
importScripts('https://www.gstatic.com/firebasejs/11.1.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/11.1.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyDgJai9t4UxicjzaIyHdc-hk5pTyAVF0bI',
  authDomain: 'rom-database-0909.firebaseapp.com',
  projectId: 'rom-database-0909',
  storageBucket: 'rom-database-0909.firebasestorage.app',
  messagingSenderId: '192979949981',
  appId: '1:192979949981:web:162d2e67ffe5cb4a8e3774',
});

const messaging = firebase.messaging();

// The server sends data-only messages so we control exactly how they render.
messaging.onBackgroundMessage(async (payload) => {
  const d = (payload && payload.data) || {};

  // If a ROMIO tab is already focused, the in-app engine is handling the alert —
  // showing a system notification too would double up.
  try {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (clients.some((c) => c.focused)) return;
  } catch { /* fall through and notify */ }

  await self.registration.showNotification(d.title || 'ROMIO', {
    body: d.body || '',
    icon: '/romio-mark.png',
    badge: '/romio-mark.png',
    tag: d.tag || 'romio',
    requireInteraction: true,
    data: { url: d.url || '/' },
  });
});

// Focus an existing ROMIO tab if there is one, else open a new one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of clients) {
      if ('focus' in c) { try { await c.navigate(url); } catch { /* cross-origin */ } return c.focus(); }
    }
    if (self.clients.openWindow) return self.clients.openWindow(url);
  })());
});
