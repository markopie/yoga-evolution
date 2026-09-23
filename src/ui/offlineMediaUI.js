import {
    downloadAllMedia,
    offlineMediaStatus,
    removeOfflineMedia,
} from '../services/offlineMedia.js';
import { getSyncStatus, setSyncStatus, SYNC_STATES } from '../services/syncStatus.js';

function formatBytes(bytes) {
    const value = Number(bytes || 0);
    if (value < 1024) return `${value} bytes`;
    if (value < 1024 ** 2) return `${Math.round(value / 1024)} KB`;
    if (value < 1024 ** 3) return `${Math.round(value / 1024 ** 2)} MB`;
    return `${(value / 1024 ** 3).toFixed(1)} GB`;
}

function downloadedDate(value) {
    if (!value) return '';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-AU', {
        day: 'numeric', month: 'short', year: 'numeric',
    });
}

function percent(done, total) {
    return total > 0 ? Math.round((done / total) * 100) : 0;
}

export async function setupOfflineMediaUI() {
    const root = document.getElementById('offlineMediaPanel');
    if (!root) return;
    const status = root.querySelector('[data-offline-status]');
    const detail = root.querySelector('[data-offline-detail]');
    const progress = root.querySelector('progress');
    const downloadButton = root.querySelector('[data-offline-download]');
    const cancelButton = root.querySelector('[data-offline-cancel]');
    const removeButton = root.querySelector('[data-offline-remove]');
    let controller = null;
    let lastDownloadError = '';

    async function render() {
        const state = await offlineMediaStatus();
        const sync = getSyncStatus();
        if (state.updateAvailable && sync.state === SYNC_STATES.HEALTHY) {
            setSyncStatus({ state: SYNC_STATES.UPDATE_READY, updateReady: true });
        } else if (!state.updateAvailable && sync.state === SYNC_STATES.UPDATE_READY) {
            setSyncStatus({ state: SYNC_STATES.HEALTHY, updateReady: false });
        }
        const installed = state.pack?.status === 'installed'
            || (state.requiredCount > 0 && state.installedCount >= state.requiredCount);
        status.textContent = state.manifestError || state.manifestEmpty
            ? 'Media list unavailable'
            : state.updateAvailable
            ? 'Update available'
            : installed
            ? `Available offline · downloaded ${downloadedDate(state.pack?.installedAt || state.pack?.updatedAt) || 'previously'}`
            : state.pack?.status === 'partial'
                ? 'Download incomplete'
                : state.pack?.status === 'failed'
                    ? 'Download failed'
                : 'Not downloaded yet';
        status.dataset.state = state.manifestError || state.manifestEmpty
            ? 'error'
            : state.updateAvailable
                ? 'update'
                : installed ? 'ready' : state.online ? 'online' : 'offline';
        const required = state.requiredBytes || state.pack?.totalBytes || 0;
        const packSize = required ? ` · about ${formatBytes(required)} of media` : '';
        detail.textContent = state.manifestError
            ? 'We could not check the available media. Check your internet connection and try again.'
            : state.manifestEmpty
                ? 'The media catalog is empty in this environment. Populate the media manifest before downloading.'
            : `${navigator.onLine ? 'You are online' : 'You are offline'}${packSize}.`;
        if (state.updateAvailable) detail.textContent += ' New media is ready to download.';
        if (lastDownloadError) detail.textContent = lastDownloadError;
        progress.value = state.pack?.completedCount || 0;
        progress.max = state.pack?.totalCount || 1;
        downloadButton.textContent = installed ? 'Download updates' : 'Download for offline use';
        downloadButton.disabled = installed && !state.updateAvailable;
        downloadButton.title = installed && !state.updateAvailable
            ? 'Your offline media is already up to date.'
            : '';
        removeButton.disabled = state.installedCount === 0;
    }

    downloadButton.addEventListener('click', async () => {
        controller = new AbortController();
        downloadButton.disabled = true;
        cancelButton.hidden = false;
        detail.textContent = 'Checking media…';
        try {
            lastDownloadError = '';
            await downloadAllMedia({
                signal: controller.signal,
                onProgress(info) {
                    progress.max = info.totalCount;
                    progress.value = info.completedCount;
                    status.textContent = `Downloading · ${percent(info.completedCount, info.totalCount)}%`;
                    detail.textContent = info.totalBytes > 0
                        ? `${info.completedCount}/${info.totalCount} files · ${formatBytes(info.completedBytes)} of ${formatBytes(info.totalBytes)}`
                        : `${info.completedCount}/${info.totalCount} files`;
                },
            });
        } catch (error) {
            console.error('[Offline] Media download failed:', error);
            const diagnostic = import.meta.env.VITE_APP_ENV === 'testing' && error?.message
                ? ` (${error.message})`
                : '';
            lastDownloadError = error.name === 'AbortError'
                ? 'Download paused. Tap Download for offline use to resume.'
                : error.code === 'NO_MEDIA_MANIFEST'
                    ? `No media manifest is available in this environment. Populate the media catalog, then try again.${diagnostic}`
                : `The download could not be completed. Check your internet connection and try again.${diagnostic}`;
        } finally {
            controller = null;
            downloadButton.disabled = false;
            cancelButton.hidden = true;
            await render();
        }
    });

    cancelButton.addEventListener('click', () => controller?.abort());
    removeButton.addEventListener('click', async () => {
        if (!window.confirm('Remove all downloaded offline media from this device?')) return;
        await removeOfflineMedia();
        await render();
    });
    window.addEventListener('online', render);
    window.addEventListener('offline', render);
    window.addEventListener('yoga:verified-session', render);
    await render();
}
