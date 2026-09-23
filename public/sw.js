const SHELL_CACHE = 'yoga-shell-v6';
const MEDIA_CACHE = 'yoga-offline-media-v1';
const OFFLINE_MEDIA_PREFIX = '/__offline_media__/';
const EXCLUDED_OFFLINE_BUCKETS = ['yoga-cards'];
const APP_SHELL = [
    './',
    './manifest.webmanifest',
    './icons/yoga-evolution-192.png',
    './icons/yoga-evolution-512.png',
];
const NAVIGATION_TIMEOUT_MS = 1500;

async function fetchWithTimeout(request, timeoutMs) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(request, { signal: controller.signal });
    } finally {
        clearTimeout(timeout);
    }
}

function mediaKey(bucket, objectPath) {
    const encodedPath = objectPath
        .split('/')
        .filter(Boolean)
        .map(encodeURIComponent)
        .join('/');
    return new URL(
        `${OFFLINE_MEDIA_PREFIX}${encodeURIComponent(bucket)}/${encodedPath}`,
        self.location.origin,
    ).toString();
}

function storageObjectFromUrl(url) {
    const match = url.pathname.match(
        /\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+)$/i,
    );
    if (!match) return null;
    return {
        bucket: decodeURIComponent(match[1]),
        objectPath: match[2]
            .split('/')
            .filter(Boolean)
            .map(decodeURIComponent)
            .join('/'),
    };
}

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(SHELL_CACHE)
            .then((cache) => Promise.all(
                APP_SHELL.map((path) =>
                    cache.add(new Request(path, { cache: 'reload' }))),
            ))
            .then(() => self.skipWaiting()),
    );
});

self.addEventListener('activate', (event) => {
    // Keep the previous shell cache as rollback protection until a later,
    // verified release explicitly retires it.
    event.waitUntil((async () => {
        await caches.delete('yoga-shell-v2');
        await caches.delete('yoga-shell-v3');
        await caches.delete('yoga-shell-v4');
        await caches.delete('yoga-shell-v5');
        const media = await caches.open(MEDIA_CACHE);
        for (const request of await media.keys()) {
            const path = new URL(request.url).pathname;
            if (path.includes('/__offline_media__/light-on-yoga-plates/') || EXCLUDED_OFFLINE_BUCKETS.some((bucket) => path.includes(`/__offline_media__/${bucket}/`))) {
                await media.delete(request);
            }
        }
        await self.clients.claim();
    })());
});

self.addEventListener('message', (event) => {
    if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET') return;
    const url = new URL(request.url);
    const storageObject = storageObjectFromUrl(url);

    if (storageObject) {
        event.respondWith((async () => {
            const mediaCache = await caches.open(MEDIA_CACHE);
            const cached = await mediaCache.match(
                mediaKey(storageObject.bucket, storageObject.objectPath),
            );
            if (cached) return cached;
            return fetch(request);
        })());
        return;
    }

    if (url.origin !== self.location.origin) return;
    if (url.pathname.includes(OFFLINE_MEDIA_PREFIX)) {
        event.respondWith(
            caches.open(MEDIA_CACHE).then(async (cache) =>
                await cache.match(request) || new Response('Offline media not installed', { status: 404 })),
        );
        return;
    }

    if (request.mode === 'navigate') {
        event.respondWith((async () => {
            const shell = await caches.open(SHELL_CACHE);
            const cached = await shell.match(request, { ignoreVary: true })
                || await shell.match('./', { ignoreVary: true })
                || await caches.match(request, { ignoreVary: true })
                || await caches.match('./', { ignoreVary: true });
            try {
                const response = await fetchWithTimeout(request, NAVIGATION_TIMEOUT_MS);
                if (response.ok) {
                    await shell.put(request, response.clone());
                    await shell.put('./', response.clone());
                }
                return response;
            } catch {
                return cached || new Response('Yoga Evolution is not available offline yet.', {
                        status: 503,
                        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
                    });
            }
        })());
        return;
    }

    event.respondWith((async () => {
        const shell = await caches.open(SHELL_CACHE);
        const cached = await shell.match(request, { ignoreVary: true })
            || await caches.match(request, { ignoreVary: true });
        if (cached) return cached;
        try {
            const response = await fetch(request);
            if (response.ok && ['script', 'style', 'font', 'image'].includes(request.destination)) {
                await shell.put(request, response.clone());
            }
            return response;
        } catch {
            return new Response('', { status: 504 });
        }
    })());
});
