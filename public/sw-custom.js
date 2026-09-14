// Pulled into the auto-generated service worker via workbox.importScripts (see vite.config.ts)
// — vite-plugin-pwa's generateSW mode doesn't let you edit sw.js's own source, but importScripts
// runs this in the same worker context, so it can add event listeners generateSW itself has no
// hook for.
//
// Without this, tapping the "ยาใกล้หมดอายุ" notification (see src/utils/notify.ts) would do
// nothing but dismiss it in most browsers — no default "open the app" behavior exists unless a
// notificationclick listener explicitly asks for it. That's exactly the class of "I tapped it
// and nothing happened" bug this whole app has spent a long time hunting down elsewhere.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(self.registration.scope);
      return undefined;
    })
  );
});
