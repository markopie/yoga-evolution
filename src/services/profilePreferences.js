import { profileStorageKey } from './deviceProfiles.js';

function read(userId = window.currentUserId) {
    try { return JSON.parse(localStorage.getItem(profileStorageKey('preferences-v1', userId)) || '{}'); }
    catch { return {}; }
}

export function readPreference(key, fallback) {
    return read().values?.[key] ?? fallback;
}

export function setPreference(key, value) {
    const record = read();
    localStorage.setItem(profileStorageKey('preferences-v1'), JSON.stringify({
        values: { ...record.values, [key]: value }, dirty: true,
    }));
    if (window.currentUserId && window.hasLiveProfileSession) {
        void syncProfilePreferences().catch(() => {});
    }
}

const pending = new Map();
export async function syncProfilePreferences(userId = window.currentUserId) {
    const { supabase } = await import('./supabaseClient.js');
    if (!supabase || !userId || !navigator.onLine) return;
    if (pending.has(userId)) return pending.get(userId);
    const operation = (async () => {
        const key = profileStorageKey('preferences-v1', userId);
        let record = read(userId);
        if (!record.dirty) {
            const { data, error } = await supabase.from('user_preferences').select('preferences').eq('user_id', userId).maybeSingle();
            if (error) throw error;
            if (!read(userId).dirty && data) localStorage.setItem(key, JSON.stringify({ values: data.preferences, dirty: false }));
        }
        // Changes made while a request was in flight must also reach the server.
        while ((record = read(userId)).dirty) {
            const { error } = await supabase.from('user_preferences').upsert({ user_id: userId, preferences: record.values });
            if (error) throw error;
            if (JSON.stringify(read(userId).values) === JSON.stringify(record.values)) {
                localStorage.setItem(key, JSON.stringify({ values: record.values, dirty: false }));
            }
        }
    })().finally(() => pending.delete(userId));
    pending.set(userId, operation);
    return operation;
}
