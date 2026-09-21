export const SYNC_STATES = Object.freeze({
    HEALTHY: 'healthy',
    OFFLINE: 'offline',
    PENDING: 'pending',
    SYNCING: 'syncing',
    UPDATE_READY: 'update_ready',
    NEEDS_ATTENTION: 'needs_attention',
});

let current = Object.freeze({
    state: SYNC_STATES.HEALTHY,
    pending: 0,
    lastSyncAt: null,
    updateReady: false,
});

export function getSyncStatus() {
    return current;
}

export function setSyncStatus(next) {
    const merged = { ...current, ...next };
    if (next.state === SYNC_STATES.UPDATE_READY) merged.updateReady = true;
    if (merged.state === SYNC_STATES.HEALTHY && merged.updateReady) {
        merged.state = SYNC_STATES.UPDATE_READY;
    }
    current = Object.freeze(merged);
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('yoga:sync-status', { detail: current }));
    }
    return current;
}

export function syncStatusLabel(status = current) {
    if (status.state === SYNC_STATES.SYNCING) return 'Syncing…';
    if (status.state === SYNC_STATES.UPDATE_READY) return 'Update ready';
    if (status.state === SYNC_STATES.NEEDS_ATTENTION) return 'Needs attention';
    if (status.state === SYNC_STATES.OFFLINE) return status.pending ? 'Offline · saved here' : 'Offline';
    if (status.state === SYNC_STATES.PENDING) {
        return `${status.pending} waiting to sync`;
    }
    return '';
}
