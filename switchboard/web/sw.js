// Minimal service worker: lets the page install as an app on iPhone/Android.
// Network-first for everything; the UI is useless offline anyway.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
