import {
    downloadAllMedia,
    offlineMediaStatus,
    removeOfflineMedia,
} from '../services/offlineMedia.js';
import { getSyncStatus, setSyncStatus, SYNC_STATES } from '../services/syncStatus.js';

function formatBytes(bytes) {
    const value = Number(bytes || 0);
    if (value < 1024) return `${value} B`;
    if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KiB`;
    return `${(value / 1024 ** 2).toFixed(1)} MiB`;
}

function percent(done, total) {
    return total > 0 ? Math.round((done / total) * 100) : 0;
}

function hasInstalledPrivateMedia() {
    try {
        const paths = JSON.parse(localStorage.getItem('yoga-offline-media-paths-v1') || '[]');
        return Array.isArray(paths)
            && paths.some((key) => String(key).startsWith('light-on-yoga-plates/'));
    } catch {
        return false;
    }
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
    const removePrivateButton = root.querySelector('[data-offline-remove-private]');
    let controller = null;

    async function render() {
        const state = await offlineMediaStatus();
        const sync = getSyncStatus();
        if (state.updateAvailable && sync.state === SYNC_STATES.HEALTHY) {
            setSyncStatus({ state: SYNC_STATES.UPDATE_READY, updateReady: true });
        } else if (!state.updateAvailable && sync.state === SYNC_STATES.UPDATE_READY) {
            setSyncStatus({ state: SYNC_STATES.HEALTHY, updateReady: false });
        }
        const installed = state.pack?.status === 'installed';
        status.textContent = state.updateAvailable
            ? 'Offline content update ready'
            : installed
            ? `Offline pack ready · ${state.installedCount} files`
            : state.pack?.status === 'partial'
                ? `Partial pack · ${state.installedCount} files`
                : 'Not downloaded';
        status.dataset.state = installed ? 'ready' : state.online ? 'online' : 'offline';
        const quota = state.storageQuota
            ? `${formatBytes(Math.max(0, state.storageQuota - state.storageUsage))} free of ` +
                `${formatBytes(state.storageQuota)} browser quota`
            : 'Browser storage quota unavailable';
        const required = state.requiredBytes || state.pack?.totalBytes || 0;
        const packSize = required ? `Pack requires ${formatBytes(required)}` : 'Sign in to calculate pack size';
        detail.textContent = `${navigator.onLine ? 'Connected' : 'Offline'} · ${packSize} · ${quota}`;
        progress.value = state.pack?.completedCount || 0;
        progress.max = state.pack?.totalCount || 1;
        downloadButton.textContent = installed ? 'Check for updates' : 'Download all media';
        removeButton.disabled = state.installedCount === 0;
        removePrivateButton.disabled = !hasInstalledPrivateMedia();
    }

    downloadButton.addEventListener('click', async () => {
        controller = new AbortController();
        downloadButton.disabled = true;
        cancelButton.hidden = false;
        detail.textContent = 'Preparing verified media manifest…';
        try {
            await downloadAllMedia({
                signal: controller.signal,
                onProgress(info) {
                    progress.max = info.totalCount;
                    progress.value = info.completedCount;
                    status.textContent = `Downloading · ${percent(info.completedCount, info.totalCount)}%`;
                    detail.textContent =
                        `${info.completedCount}/${info.totalCount} files · ` +
                        `${formatBytes(info.completedBytes)} of ${formatBytes(info.totalBytes)}`;
                },
            });
        } catch (error) {
            detail.textContent = error.name === 'AbortError'
                ? 'Download paused. Tap Download all media to resume.'
                : `Download stopped: ${error.message}`;
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
    removePrivateButton.addEventListener('click', async () => {
        if (!window.confirm('Remove private Light on Yoga plates from this device?')) return;
        await removeOfflineMedia({ privateOnly: true });
        await render();
    });
    window.addEventListener('online', render);
    window.addEventListener('offline', render);
    await render();
}
