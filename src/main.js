import '../styles/main.css';

async function cacheLoadedAppShell() {
    if (!('caches' in window)) return;
    const controller = new AbortController();
    const cancel = () => controller.abort();
    window.addEventListener('pagehide', cancel, { once: true });
    const cache = await caches.open('yoga-shell-v20');
    const resources = new Set([
        new URL('./', window.location.href).toString(),
        new URL('manifest.webmanifest', window.location.href).toString(),
        new URL('icons/yoga-evolution-192.png', window.location.href).toString(),
        ...performance.getEntriesByType('resource')
            .map((entry) => entry.name)
            .filter((value) => {
                const url = new URL(value, window.location.href);
                return url.origin === window.location.origin
                    && /\.(?:css|js|png|svg|ttf|woff2?)(?:$|\?)/i.test(url.pathname);
            }),
    ]);
    await Promise.allSettled(
        [...resources].map(async (url) => {
            const response = await fetch(url, { cache: 'reload', signal: controller.signal });
            if (response.ok) await cache.put(url, response);
        }),
    );
    window.removeEventListener('pagehide', cancel);
}

if (!new URLSearchParams(window.location.search).get('prototype')) {
    if ('serviceWorker' in navigator) {
        const base = import.meta.env.BASE_URL || '/';
        // Version the script URL as well as the cache name. This prevents an
        // older worker from serving a cached sw.js and hiding client fixes
        // during local testing or after deployment.
        navigator.serviceWorker.register(`${base}sw.js?v=20`, { scope: base })
            .then((registration) => {
                registration.addEventListener('updatefound', () => {
                    const worker = registration.installing;
                    worker?.addEventListener('statechange', () => {
                        if (worker.state !== 'installed' || !navigator.serviceWorker.controller) return;
                        void import('./services/syncStatus.js').then(({ setSyncStatus, SYNC_STATES }) => {
                            setSyncStatus({ state: SYNC_STATES.UPDATE_READY, updateReady: true });
                        });
                    });
                });
            })
            .catch((error) => console.warn('[Offline] Service worker registration failed:', error));
    }
    await import('./services/supabaseClient.js');
    await import('./services/dataAdapter.js');
    await import('../app.js?client=20');
    const { setupOfflineMediaUI } = await import('./ui/offlineMediaUI.js');
    const { setupSyncStatusUI } = await import('./ui/syncStatusUI.js');
    const { setupProfileUI } = await import('./ui/profileUI.js');
    setupOfflineMediaUI().catch((error) =>
        console.warn('[Offline] Offline media controls unavailable:', error));
    setupSyncStatusUI();
    await setupProfileUI();
    cacheLoadedAppShell().catch((error) =>
        console.warn('[Offline] App shell caching failed:', error));
}
