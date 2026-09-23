import { supabase } from './supabaseClient.js';

export const PROFILE_SEQUENCE_MIGRATION_VERSION = 1;

function migrationKey(userId) {
    return `yoga-profile-sequence-migration-v${PROFILE_SEQUENCE_MIGRATION_VERSION}:${userId}`;
}

export function sequenceMigrationMarker(userId) {
    if (!userId || typeof localStorage === 'undefined') return null;
    try { return JSON.parse(localStorage.getItem(migrationKey(userId)) || 'null'); } catch { return null; }
}

function writeMarker(userId, mappings) {
    localStorage.setItem(migrationKey(userId), JSON.stringify({
        version: PROFILE_SEQUENCE_MIGRATION_VERSION,
        mappings,
        migratedAt: new Date().toISOString(),
    }));
}

export function profileSequencePayload(source, userId) {
    const { id: _id, user_id: _userId, ...copy } = source || {};
    return {
        ...copy,
        user_id: userId,
        is_system: false,
        source_sequence_id: source?.source_sequence_id ?? source?.id ?? null,
        sequence_json: Array.isArray(source?.sequence_json) ? structuredClone(source.sequence_json) : source?.sequence_json,
    };
}

function isOwned(row, userId) {
    return String(row?.user_id || '') === String(userId);
}

/**
 * Clone shared courses into the selected profile. Existing owned rows are
 * never replaced; the marker is only a fast path, not the source of truth.
 */
export async function migrateProfileSequences(userId = window.currentUserId, client = supabase) {
    if (!userId || !client || navigator.onLine === false) return { skipped: true, reason: 'offline' };
    const marker = sequenceMigrationMarker(userId);
    if (marker?.version === PROFILE_SEQUENCE_MIGRATION_VERSION) return { skipped: true, reason: 'already-migrated', mappings: marker.mappings || {} };

    let columns = '*';
    let supportsSourceColumn = true;
    let result = await client.from('courses').select(columns).order('id');
    if (result.error) throw result.error;
    let rows = result.data || [];
    // Older deployments do not have the additive source column yet.
    if (rows.some((row) => Object.prototype.hasOwnProperty.call(row, 'source_sequence_id')) === false) supportsSourceColumn = false;
    const shared = rows.filter((row) => !row.user_id && !row.is_system);
    const owned = rows.filter((row) => isOwned(row, userId));
    const mappings = { ...(marker?.mappings || {}) };
    const ownedBySource = new Map(owned.filter((row) => row.source_sequence_id != null)
        .map((row) => [String(row.source_sequence_id), row]));
    for (const source of shared) {
        const sourceId = String(source.id);
        if (ownedBySource.has(sourceId) || mappings[sourceId]) continue;
        // Older profile copies predate source_sequence_id. Match them without
        // overwriting or replacing the user's content, then record the mapping.
        const legacyOwned = owned.find((row) =>
            row.title === source.title
            && String(row.category || '') === String(source.category || ''));
        if (legacyOwned) {
            mappings[sourceId] = legacyOwned.id;
            continue;
        }
        const payload = profileSequencePayload(source, userId);
        if (!supportsSourceColumn) delete payload.source_sequence_id;
        const inserted = await client.from('courses').insert(payload).select('id').single();
        if (inserted.error) throw inserted.error;
        mappings[sourceId] = inserted.data.id;
    }
    writeMarker(userId, mappings);
    return { migrated: true, mappings, cloned: Object.keys(mappings).length };
}

export function completionSourceType(options = {}) {
    return options.source_type || (options.curriculum_node_id != null ? 'curriculum' : 'manual');
}
