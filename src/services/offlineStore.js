const DATABASE_NAME = 'yoga-evolution-offline';
const DATABASE_VERSION = 2;
const SNAPSHOT_STORE = 'snapshots';
const PACK_STORE = 'packs';
const COMPLETION_STORE = 'completionQueue';

function openDatabase() {
    if (typeof indexedDB === 'undefined') {
        return Promise.reject(new Error('IndexedDB is unavailable'));
    }
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
        request.onupgradeneeded = () => {
            const database = request.result;
            if (!database.objectStoreNames.contains(SNAPSHOT_STORE)) {
                database.createObjectStore(SNAPSHOT_STORE, { keyPath: 'key' });
            }
            if (!database.objectStoreNames.contains(PACK_STORE)) {
                database.createObjectStore(PACK_STORE, { keyPath: 'key' });
            }
            if (!database.objectStoreNames.contains(COMPLETION_STORE)) {
                database.createObjectStore(COMPLETION_STORE, { keyPath: 'id' });
            } else if (request.oldVersion < 2) {
                const store = request.transaction.objectStore(COMPLETION_STORE);
                const cursorRequest = store.openCursor();
                cursorRequest.onsuccess = () => {
                    const cursor = cursorRequest.result;
                    if (!cursor) return;
                    cursor.update(normalizeCompletionOperation(cursor.value));
                    cursor.continue();
                };
            }
        };
    });
}

async function transaction(storeName, mode, callback) {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
        const tx = database.transaction(storeName, mode);
        const store = tx.objectStore(storeName);
        let value;
        try {
            value = callback(store);
        } catch (error) {
            database.close();
            reject(error);
            return;
        }
        tx.oncomplete = () => {
            database.close();
            resolve(value);
        };
        tx.onerror = () => {
            database.close();
            reject(tx.error);
        };
        tx.onabort = () => {
            database.close();
            reject(tx.error || new Error('IndexedDB transaction aborted'));
        };
    });
}

function requestValue(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

export async function saveSnapshot(key, value) {
    await transaction(SNAPSHOT_STORE, 'readwrite', (store) => {
        store.put({ key, value, updatedAt: new Date().toISOString() });
    });
}

export async function loadSnapshot(key) {
    const database = await openDatabase();
    try {
        const tx = database.transaction(SNAPSHOT_STORE, 'readonly');
        return (await requestValue(tx.objectStore(SNAPSHOT_STORE).get(key)))?.value ?? null;
    } finally {
        database.close();
    }
}

export async function savePackState(key, value) {
    await transaction(PACK_STORE, 'readwrite', (store) => {
        store.put({ key, ...value, updatedAt: new Date().toISOString() });
    });
}

export async function loadPackState(key) {
    const database = await openDatabase();
    try {
        const tx = database.transaction(PACK_STORE, 'readonly');
        return await requestValue(tx.objectStore(PACK_STORE).get(key)) || null;
    } finally {
        database.close();
    }
}

export async function removePackState(key) {
    await transaction(PACK_STORE, 'readwrite', (store) => store.delete(key));
}

export function normalizeCompletionOperation(item = {}) {
    const rows = Array.isArray(item.rows) ? item.rows : [];
    const createdAt = item.createdAt || new Date().toISOString();
    const operationId = item.operationId || item.id || rows[0]?.id || crypto.randomUUID();
    return {
        id: operationId,
        operationId,
        userId: item.userId || rows[0]?.user_id || null,
        rowIds: rows.map((row) => row.id).filter(Boolean),
        rows,
        rating: item.rating ?? rows.find((row) => row.rating != null)?.rating ?? null,
        ratingPending: item.ratingPending ?? !rows.some((row) => row.rating != null),
        remoteSaved: item.remoteSaved === true,
        status: item.status || 'pending',
        attempts: Number(item.attempts || 0),
        nextRetryAt: item.nextRetryAt || null,
        lastError: item.lastError || null,
        createdAt,
        updatedAt: item.updatedAt || createdAt,
    };
}

export async function queueCompletionRows(rows, options = {}) {
    if (!Array.isArray(rows) || !rows.length) throw new Error('Completion rows are required.');
    const operationId = options.operationId || crypto.randomUUID();
    const operation = normalizeCompletionOperation({
        id: operationId,
        operationId,
        rows,
        userId: options.userId || rows[0]?.user_id,
        rating: options.rating,
        ratingPending: options.ratingPending ?? options.awaitingRating ?? true,
        createdAt: options.createdAt,
    });
    await transaction(COMPLETION_STORE, 'readwrite', (store) => {
        store.put(operation);
    });
    return operation;
}

export async function listQueuedCompletions(userId = null) {
    const database = await openDatabase();
    try {
        const tx = database.transaction(COMPLETION_STORE, 'readonly');
        const items = (await requestValue(tx.objectStore(COMPLETION_STORE).getAll()))
            .map(normalizeCompletionOperation);
        return userId == null
            ? items
            : items.filter((item) => String(item.userId || '') === String(userId));
    } finally {
        database.close();
    }
}

export async function removeQueuedCompletion(id) {
    await transaction(COMPLETION_STORE, 'readwrite', (store) => store.delete(id));
}

export async function updateQueuedCompletionRating(id, rating) {
    const items = await listQueuedCompletions();
    const item = items.find((candidate) =>
        candidate.id === id || candidate.rowIds.includes(id));
    if (!item) return false;
    item.rows = item.rows.map((row) => ({ ...row, rating }));
    item.rating = rating;
    item.ratingPending = false;
    item.status = 'pending';
    item.nextRetryAt = null;
    item.lastError = null;
    item.updatedAt = new Date().toISOString();
    await transaction(COMPLETION_STORE, 'readwrite', (store) => store.put(item));
    return true;
}

export async function updateQueuedCompletion(id, changes = {}) {
    const items = await listQueuedCompletions();
    const item = items.find((candidate) => candidate.id === id);
    if (!item) return null;
    const updated = normalizeCompletionOperation({
        ...item,
        ...changes,
        updatedAt: new Date().toISOString(),
    });
    await transaction(COMPLETION_STORE, 'readwrite', (store) => store.put(updated));
    return updated;
}

export async function pendingCompletionCount(userId = null) {
    const items = await listQueuedCompletions(userId);
    return items.filter((item) => !item.remoteSaved || !item.ratingPending).length;
}

export async function pendingRatingOperation(userId) {
    const items = await listQueuedCompletions(userId);
    return items.find((item) => item.ratingPending) || null;
}
