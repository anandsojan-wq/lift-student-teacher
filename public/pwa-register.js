if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .getRegistrations()
      .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
      .then(async () => {
        if (!('caches' in window)) return;
        const keys = await caches.keys();
        const appKeys = keys.filter((key) => key.startsWith('lift-portal-cache'));
        await Promise.all(appKeys.map((key) => caches.delete(key)));
      })
      .catch(() => {
        // Ignore cleanup failures.
      });
  });
}
