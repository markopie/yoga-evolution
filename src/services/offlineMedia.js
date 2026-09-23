import { supabase } from './supabaseClient.js';
import { storagePublicBase } from './mediaUrl.js';
import {
    loadPackState,
    removePackState,
    savePackState,
} from './offlineStore.js';
import { refreshCurriculumSnapshot } from './curriculumOffline.js';

export const OFFLINE_MEDIA_CACHE = 'yoga-offline-media-v1';
export const ALL_MEDIA_PACK = 'all-current-media';
const INSTALLED_PATHS_KEY = 'yoga-offline-media-paths-v1';
const EXCLUDED_OFFLINE_BUCKETS = new Set(['yoga-cards']);

function mediaManifestVersion(manifest) {
    return manifest.reduce(
        (latest, item) => item.updatedAt > latest ? item.updatedAt : latest,
        '',
    );
}

function canonicalPath(value) {
    return String(value || '')
        .replace(/\\/g, '/')
        .split('/')
        .filter(Boolean)
        .join('/');
}

function storageReference(value) {
    const raw = String(value || '').trim();
    if (!raw || /^(?:data|blob):/i.test(raw)) return null;
    try {
        const url = new URL(raw, window.location.origin);
        const match = url.pathname.match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+)$/i);
        if (match) return { bucket: decodeURIComponent(match[1]), objectPath: canonicalPath(match[2].split('/').map(decodeURIComponent).join('/')) };
    } catch { /* relative filenames are handled below */ }
    return { bucket: 'audio-assets', objectPath: canonicalPath(raw.replace(/^\//, '')) };
}

function addAudioReference(references, value) {
    const reference = storageReference(value);
    if (reference?.objectPath) references.set(assetKey(reference.bucket, reference.objectPath), reference);
}

/** Return every audio URL the playback engine can request from loaded data. */
export function referencedAudioAssets({ courses = [], asanaLibrary = {}, serverAudioFiles = [] } = {}) {
    const references = new Map();
    const addPose = (poseId) => {
        const asana = asanaLibrary?.[poseId] || asanaLibrary?.[String(poseId)] || null;
        addAudioReference(references, asana?.audio);
        Object.values(asana?.variations || {}).forEach((variation) => {
            addAudioReference(references, variation?.audio || variation?.audio_url);
        });
        // Do not invent filename variants here. Storage paths are case-sensitive
        // and the media manifest/server file list is the source of truth.
    };
    (courses || []).forEach((course) => (course?.poses || []).forEach((pose) => addPose(pose?.[0])));
    Object.entries(asanaLibrary || {}).forEach(([id, asana]) => addPose(asana?.id || id));
    (serverAudioFiles || []).forEach((file) => addAudioReference(references, file));
    // These are file-backed side cues. Prop cues remain speech synthesis only.
    addAudioReference(references, 'left_side.mp3');
    addAudioReference(references, 'right_side.mp3');
    return [...references.values()];
}

export function missingManifestAudioReferences(manifest, references) {
    const available = new Set((manifest || []).map((item) => assetKey(item.bucket, item.objectPath)));
    const availableInsensitive = new Set((manifest || [])
        .filter((item) => item.mediaType === 'audio' || item.bucket === 'audio-assets')
        .map((item) => assetKey(item.bucket, item.objectPath).toLowerCase()));
    return (references || []).filter((reference) => {
        const exactKey = assetKey(reference.bucket, reference.objectPath);
        return !available.has(exactKey)
            && !availableInsensitive.has(exactKey.toLowerCase());
    });
}

function isPosePhotoAsset(asset) {
    return asset.original_bucket === 'light-on-yoga-plates'
        || /image_url|private_plate_urls/i.test(String(asset.source_column || ''));
}

export function assetKey(bucket, objectPath) {
    return `${bucket}/${canonicalPath(objectPath)}`;
}

export function offlineMediaUrl(bucket, objectPath) {
    const encodedPath = canonicalPath(objectPath)
        .split('/')
        .map(encodeURIComponent)
        .join('/');
    return new URL(
        `__offline_media__/${encodeURIComponent(bucket)}/${encodedPath}`,
        `${window.location.origin}/`,
    ).toString();
}

export function installedOfflineAssetKeys() {
    try {
        const value = JSON.parse(localStorage.getItem(INSTALLED_PATHS_KEY) || '[]');
        return new Set(Array.isArray(value) ? value : []);
    } catch {
        return new Set();
    }
}

export function hasOfflineAsset(bucket, objectPath) {
    return installedOfflineAssetKeys().has(assetKey(bucket, objectPath));
}

function rememberInstalledAssets(keys) {
   localStorage.setItem(INSTALLED_PATHS_KEY, JSON.stringify([...keys].sort()));
}

async function removeExcludedOfflineAssets() {
    const cache = await caches.open(OFFLINE_MEDIA_CACHE);
    for (const request of await cache.keys()) {
        const path = new URL(request.url).pathname;
        if ([...EXCLUDED_OFFLINE_BUCKETS].some((bucket) => path.includes(`/__offline_media__/${bucket}/`))) {
            await cache.delete(request);
        }
    }
    const installed = installedOfflineAssetKeys();
    for (const key of [...installed]) {
        if ([...EXCLUDED_OFFLINE_BUCKETS].some((bucket) => key.startsWith(`${bucket}/`))) installed.delete(key);
    }
    rememberInstalledAssets(installed);
}

export async function loadMediaManifest() {
    if (!supabase || !window.currentUserId) {
        throw new Error('Sign in before downloading private offline media.');
    }
    const { data, error } = await supabase
        .from('media_assets')
        .select('id,source_table,source_pk,source_column,media_type,original_bucket,original_path,content_hash,byte_size,updated_at')
        .is('deleted_at', null)
        .order('original_bucket')
        .order('original_path');
    if (error) throw error;
    const manifest = (data || []).filter((asset) => !isPosePhotoAsset(asset) && !EXCLUDED_OFFLINE_BUCKETS.has(asset.original_bucket)).map((asset) => ({
        id: asset.id,
        mediaType: asset.media_type,
        bucket: asset.original_bucket,
        objectPath: canonicalPath(asset.original_path),
        contentHash: asset.content_hash || '',
        byteSize: Number(asset.byte_size || 0),
        updatedAt: asset.updated_at,
        access: asset.original_bucket === 'light-on-yoga-plates' ? 'private' : 'public',
        available: true,
        sourceRows: asset.source_table
            ? [{
                table: asset.source_table,
                primaryKey: asset.source_pk,
                column: asset.source_column,
            }]
            : [],
        packKeys: [ALL_MEDIA_PACK],
    }));
    const references = referencedAudioAssets({
        courses: window.courses,
        asanaLibrary: window.asanaLibrary,
        serverAudioFiles: window.serverAudioFiles,
    });
    const missing = missingManifestAudioReferences(manifest, references)
        .filter((reference) => !EXCLUDED_OFFLINE_BUCKETS.has(reference.bucket));
    // A storage manifest row is preferred, but a referenced public audio file
    // can still be downloaded safely when the backfill has not caught up.
    for (const reference of missing) {
        manifest.push({
            id: `referenced-audio:${assetKey(reference.bucket, reference.objectPath)}`,
            mediaType: 'audio',
            bucket: reference.bucket,
            objectPath: reference.objectPath,
            contentHash: '',
            byteSize: 0,
            updatedAt: '',
            access: 'public',
            available: true,
            sourceRows: [],
            packKeys: [ALL_MEDIA_PACK],
            manifestOnlyReference: true,
        });
    }
    return manifest;
}

async function signedPrivateUrls(assets) {
    const byPath = new Map();
    const paths = assets.filter((asset) => asset.access === 'private').map((asset) => asset.objectPath);
    for (let index = 0; index < paths.length; index += 100) {
        const chunk = paths.slice(index, index + 100);
        const { data, error } = await supabase.storage
            .from('light-on-yoga-plates')
            .createSignedUrls(chunk, 60 * 60);
        if (error) throw error;
        data?.forEach((item) => {
            if (item.path && item.signedUrl) byPath.set(canonicalPath(item.path), item.signedUrl);
        });
    }
    return byPath;
}

async function sha256Hex(buffer) {
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    return [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
}

async function verifiedResponse(response, asset) {
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const bytes = await response.arrayBuffer();
    if (asset.byteSize && bytes.byteLength !== asset.byteSize) {
        throw new Error(`Expected ${asset.byteSize} bytes, received ${bytes.byteLength}`);
    }
    const expected = String(asset.contentHash || '').replace(/^sha256:/i, '').toLowerCase();
    if (expected) {
        const actual = await sha256Hex(bytes);
        if (actual !== expected) throw new Error(`SHA-256 mismatch for ${assetKey(asset.bucket, asset.objectPath)}`);
    }
    const headers = new Headers(response.headers);
    headers.set('X-Yoga-Content-Hash', asset.contentHash || '');
    return new Response(bytes, {
        status: 200,
        statusText: 'OK',
        headers,
    });
}

function downloadUrl(asset, privateUrls) {
    if (asset.access === 'private') {
        const url = privateUrls.get(asset.objectPath);
        if (!url) throw new Error(`No signed URL for ${asset.objectPath}`);
        return url;
    }
    return `${storagePublicBase(asset.bucket)}${asset.objectPath}`;
}

export async function downloadAllMedia({ signal, onProgress } = {}) {
    if (!('caches' in window) || !crypto?.subtle) {
        throw new Error('This browser does not support verified offline media.');
    }
    if (navigator.storage?.persist) await navigator.storage.persist().catch(() => false);
    await removeExcludedOfflineAssets();

    try {
        await refreshCurriculumSnapshot({ userId: window.currentUserId });
    } catch (error) {
        throw new Error(`Could not refresh offline practice data: ${error?.message || error}`, { cause: error });
    }
    let manifest;
    try {
        manifest = await loadMediaManifest();
    } catch (error) {
        throw new Error(`Could not load the offline media catalogue: ${error?.message || error}`, { cause: error });
    }
    if (!manifest.length) {
        const error = new Error('The local media manifest is empty. Populate the media catalog before downloading offline media.');
        error.code = 'NO_MEDIA_MANIFEST';
        throw error;
    }
    let privateUrls;
    try {
        privateUrls = await signedPrivateUrls(manifest);
    } catch (error) {
        throw new Error(`Could not authorize private offline media: ${error?.message || error}`, { cause: error });
    }
    const cache = await caches.open(OFFLINE_MEDIA_CACHE);
    const previousPack = await loadPackState(ALL_MEDIA_PACK);
    const completed = installedOfflineAssetKeys();
    const totalBytes = manifest.reduce((sum, item) => sum + item.byteSize, 0);
    let completedBytes = 0;
    let completedCount = 0;
    let downloadedAny = false;

    try {
      for (const asset of manifest) {
        if (signal?.aborted) throw new DOMException('Download cancelled', 'AbortError');
        const key = assetKey(asset.bucket, asset.objectPath);
        const cacheUrl = offlineMediaUrl(asset.bucket, asset.objectPath);
        const existing = await cache.match(cacheUrl);
        const existingHash = existing?.headers.get('X-Yoga-Content-Hash') || '';
        if (existing && (!asset.contentHash || existingHash === asset.contentHash)) {
            completed.add(key);
        } else {
            downloadedAny = true;
            try {
                const response = await fetch(downloadUrl(asset, privateUrls), {
                    signal,
                    credentials: 'omit',
                });
                await cache.put(cacheUrl, await verifiedResponse(response, asset));
            } catch (error) {
                if (error?.name === 'AbortError') throw error;
                throw new Error(`Could not download ${asset.bucket}/${asset.objectPath}: ${error?.message || error}`, { cause: error });
            }
            completed.add(key);
        }
        completedCount += 1;
        completedBytes += asset.byteSize;
        rememberInstalledAssets(completed);
        if (completedCount % 20 === 0 || completedCount === manifest.length) {
            await savePackState(ALL_MEDIA_PACK, {
                status: completedCount === manifest.length ? 'installed' : 'partial',
                completedCount,
                totalCount: manifest.length,
                completedBytes,
                totalBytes,
                manifestVersion: mediaManifestVersion(manifest),
                ...(completedCount === manifest.length ? {
                    installedAt: downloadedAny
                        ? new Date().toISOString()
                        : (previousPack?.installedAt || new Date().toISOString()),
                } : {}),
            });
        }
        onProgress?.({
            completedCount,
            totalCount: manifest.length,
            completedBytes,
            totalBytes,
            asset,
        });
      }
    } catch (error) {
        await savePackState(ALL_MEDIA_PACK, {
            status: completedCount ? 'partial' : 'failed',
            completedCount,
            totalCount: manifest.length,
            completedBytes,
            totalBytes,
            manifestVersion: mediaManifestVersion(manifest),
            ...(previousPack?.installedAt ? { installedAt: previousPack.installedAt } : {}),
        }).catch(() => {});
        throw error;
    }
    return await loadPackState(ALL_MEDIA_PACK);
}

export async function removeOfflineMedia({ privateOnly = false } = {}) {
    const cache = await caches.open(OFFLINE_MEDIA_CACHE);
    const keys = await cache.keys();
    const installed = installedOfflineAssetKeys();
    for (const request of keys) {
        const url = new URL(request.url);
        const isPrivate = url.pathname.includes('/__offline_media__/light-on-yoga-plates/');
        if (!privateOnly || isPrivate) await cache.delete(request);
    }
    if (privateOnly) {
        for (const key of [...installed]) {
            if (key.startsWith('light-on-yoga-plates/')) installed.delete(key);
        }
        rememberInstalledAssets(installed);
        const state = await loadPackState(ALL_MEDIA_PACK);
        if (state) await savePackState(ALL_MEDIA_PACK, { ...state, status: 'partial' });
    } else {
        localStorage.removeItem(INSTALLED_PATHS_KEY);
        await removePackState(ALL_MEDIA_PACK);
    }
}

export async function offlineMediaStatus() {
    const [pack, estimate, manifestResult] = await Promise.all([
        loadPackState(ALL_MEDIA_PACK).catch(() => null),
        navigator.storage?.estimate?.().catch(() => null),
        navigator.onLine && window.currentUserId
            ? loadMediaManifest().then((manifest) => ({ manifest, error: null })).catch((error) => ({ manifest: [], error }))
            : Promise.resolve({ manifest: [], error: null }),
    ]);
    const manifest = manifestResult.manifest;
    const currentManifestVersion = mediaManifestVersion(manifest);
    const updateAvailable = Boolean(
        pack?.status === 'installed'
        && manifest.length
        && (pack.totalCount !== manifest.length
            || pack.manifestVersion !== currentManifestVersion),
    );
    return {
        pack,
        currentManifestVersion,
        updateAvailable,
        requiredBytes: manifest.reduce((sum, item) => sum + item.byteSize, 0),
        requiredCount: manifest.length,
        manifestEmpty: Boolean(navigator.onLine && window.currentUserId && !manifest.length),
        installedCount: installedOfflineAssetKeys().size,
        storageUsage: Number(estimate?.usage || 0),
        storageQuota: Number(estimate?.quota || 0),
        online: navigator.onLine,
        manifestError: manifestResult.error ? String(manifestResult.error?.message || manifestResult.error) : null,
    };
}
