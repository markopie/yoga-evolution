import { supabase } from './supabaseClient.js';
import { readProfiles, profileStorageKey } from './deviceProfiles.js';
import { listQueuedCompletions } from './offlineStore.js';
import { validateProfileBackup } from './profileFile.js';
import { ACTIVE_CURRICULUM_SLUG } from '../config/curriculumConfig.js';

async function privateRows(table, userId) {
    const rows = [];
    for (let offset = 0; ; offset += 1000) {
        const { data, error } = await supabase.from(table).select('*').eq('user_id', userId).order('id').range(offset, offset + 999);
        if (error) throw error;
        rows.push(...data);
        if (data.length < 1000) return rows;
    }
}

export async function exportProfileBackup(userId = window.currentUserId) {
    if (!navigator.onLine || !supabase) throw new Error('Connect to the Yoga server to export your latest progress.');
    const profile = readProfiles().find((item) => item.id === userId);
    if (!profile) throw new Error('Open a profile before exporting.');
    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (authError || auth?.user?.id !== userId) throw new Error('Open your profile again before exporting.');
    const [completions, mastery, enrollments, queued] = await Promise.all([
        privateRows('sequence_completions', userId),
        privateRows('curriculum_mastery_decisions', userId),
        privateRows('curriculum_optional_stage_enrollments', userId),
        listQueuedCompletions(userId),
    ]);
    if (queued.some((item) => item.ratingPending)) throw new Error('Finish rating your last practice before exporting.');
    const allCompletions = new Map(completions.map((row) => [row.id, row]));
    for (const operation of queued) for (const row of operation.rows) allCompletions.set(row.id, row);
    let preferences = {};
    try { preferences = JSON.parse(localStorage.getItem(profileStorageKey('preferences-v1', userId)) || '{}').values || {}; }
    catch { /* Use defaults if no preferences have been saved yet. */ }
    return validateProfileBackup({
        format: 'yoga-profile', version: 1, curriculumSlug: ACTIVE_CURRICULUM_SLUG,
        name: profile.name, exportedAt: new Date().toISOString(),
        completions: [...allCompletions.values()], mastery, enrollments, preferences,
    });
}
