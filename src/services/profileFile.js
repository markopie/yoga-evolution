import { ACTIVE_CURRICULUM_SLUG } from '../config/curriculumConfig.js';

export const PROFILE_FILE_LIMIT = 10 * 1024 * 1024;
const completionFields = ['title', 'category', 'completed_at', 'duration_seconds', 'notes',
    'completed', 'sequence_id', 'curriculum_node_id', 'status', 'rating', 'difficulty_feedback',
    'duration_scale_used', 'planned_duration_minutes', 'actual_adjusted_duration_minutes',
    'source_type', 'source_sequence_id', 'profile_sequence_id', 'sequence_hash', 'sequence_snapshot'];
const pick = (row, fields) => Object.fromEntries(fields.filter((key) => row[key] !== undefined).map((key) => [key, row[key]]));

export function validateProfileBackup(input) {
    if (!input || input.format !== 'yoga-profile' || input.version !== 1) throw new Error('This is not a supported Yoga profile file.');
    if (input.curriculumSlug !== ACTIVE_CURRICULUM_SLUG) throw new Error('This file uses a different curriculum. Keep the file and import it with the matching app version.');
    if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 60) throw new Error('The profile name is invalid.');
    for (const key of ['completions', 'mastery', 'enrollments']) {
        if (!Array.isArray(input[key]) || input[key].length > 25000
            || input[key].some((row) => !row || typeof row !== 'object' || Array.isArray(row))) {
            throw new Error(`The profile's ${key} data is invalid.`);
        }
    }
    const completions = input.completions.map((row) => {
        if (typeof row.title !== 'string' || row.title.length > 2000 || !Number.isFinite(Date.parse(row.completed_at))
            || (row.rating != null && (!Number.isInteger(row.rating) || row.rating < 1 || row.rating > 5))) {
            throw new Error('The profile contains invalid practice history.');
        }
        return pick(row, completionFields);
    });
    const preferences = {};
    if (['dark', 'light'].includes(input.preferences?.theme)) preferences.theme = input.preferences.theme;
    if (typeof input.preferences?.preferIast === 'boolean') preferences.preferIast = input.preferences.preferIast;
    return {
        format: 'yoga-profile', version: 1, curriculumSlug: input.curriculumSlug,
        name: input.name.trim(), exportedAt: input.exportedAt,
        completions,
        mastery: input.mastery.map((row) => pick(row, ['curriculum_slug', 'repeat_group', 'easy_rating_count', 'mastered_at'])),
        enrollments: input.enrollments.map((row) => pick(row, ['curriculum_slug', 'stage_key', 'accepted_at'])),
        preferences,
    };
}
