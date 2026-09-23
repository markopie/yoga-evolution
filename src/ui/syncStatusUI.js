import { getSyncStatus, syncStatusLabel, SYNC_STATES } from '../services/syncStatus.js';

function showToast(message) {
    document.getElementById('syncStatusToast')?.remove();
    const toast = document.createElement('div');
    toast.id = 'syncStatusToast';
    toast.className = 'sync-status-toast';
    toast.setAttribute('role', 'status');
    toast.textContent = message;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('sync-status-toast--visible'));
    setTimeout(() => {
        toast.classList.remove('sync-status-toast--visible');
        setTimeout(() => toast.remove(), 250);
    }, 2400);
}

export function setupSyncStatusUI() {
    const button = document.getElementById('syncStatusButton');
    const settingsToggle = document.getElementById('settingsToggleButton');
    const settings = document.getElementById('appSettingsPanel');
    const detail = document.getElementById('offlineSyncDetail');
    const retry = document.getElementById('retryProgressSyncBtn');
    const settingsClose = document.getElementById('settingsCloseButton');
    if (!button) return;
    let pendingRenderTimer = null;
    const render = (status = getSyncStatus()) => {
        const label = syncStatusLabel(status);
        button.hidden = status.state === SYNC_STATES.HEALTHY || !label;
        button.textContent = label;
        button.dataset.state = status.state;
        button.title = label ? `${label}. Open Settings for details.` : '';
        if (detail) {
            const lastSync = status.lastSyncAt
                ? ` Last sync: ${new Date(status.lastSyncAt).toLocaleString()}.`
                : '';
            detail.textContent = label ? `${label}.${lastSync}` : `Progress is synchronized.${lastSync}`;
        }
        if (retry) {
            retry.hidden = ![
                SYNC_STATES.PENDING,
                SYNC_STATES.NEEDS_ATTENTION,
                SYNC_STATES.OFFLINE,
            ].includes(status.state);
        }
    };
    const openSettings = () => {
        if (!settings) return;
        settings.open = true;
        settingsToggle?.setAttribute('aria-expanded', 'true');
    };
    const renderStatus = (status = getSyncStatus()) => {
        clearTimeout(pendingRenderTimer);
        if (status.state === SYNC_STATES.PENDING) {
            // A completion is written in two quick stages (completion, then
            // rating). Do not expose a transient pending state between them.
            pendingRenderTimer = setTimeout(() => render(status), 300);
            return;
        }
        render(status);
    };
    button.addEventListener('click', openSettings);
    settingsToggle?.addEventListener('click', () => {
        if (!settings) return;
        settings.open = !settings.open;
        settingsToggle.setAttribute('aria-expanded', String(settings.open));
    });
    settingsClose?.addEventListener('click', () => {
        if (!settings) return;
        settings.open = false;
        settingsToggle?.setAttribute('aria-expanded', 'false');
        settingsToggle?.focus();
    });
    settings.addEventListener('toggle', () => {
        settingsToggle?.setAttribute('aria-expanded', String(settings.open));
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && settings.open) {
            settings.open = false;
            settingsToggle?.focus();
        }
    });
    document.addEventListener('click', (event) => {
        if (!settings.open || settings.contains(event.target) || settingsToggle?.contains(event.target)) return;
        settings.open = false;
        settingsToggle?.setAttribute('aria-expanded', 'false');
    });
    retry?.addEventListener('click', async () => {
        retry.disabled = true;
        try {
            const { flushCompletionQueue } = await import('../services/historyService.js');
            await flushCompletionQueue();
        } finally {
            retry.disabled = false;
        }
    });
    window.addEventListener('yoga:sync-status', (event) => renderStatus(event.detail));
    window.addEventListener('yoga:progress-saved-locally', () => showToast('Saved on this device'));
    window.addEventListener('yoga:progress-synced', () => showToast('Progress synced'));
    renderStatus();
}
