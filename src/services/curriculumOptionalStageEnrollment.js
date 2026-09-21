import {
    optionalStageKey,
    optionalStageLabel,
} from '../utils/curriculumOptionalStages.js';

export async function ensureOptionalStageEnrollment({
    practice,
    client,
    userId,
    curriculumSlug,
    offline = false,
    confirmChoice,
}) {
    if (!practice?.requires_user_selection) {
        return { accepted: true, stageKey: optionalStageKey(practice), reason: 'not_a_gate' };
    }
    const stageKey = optionalStageKey(practice);
    if (!stageKey) {
        return { accepted: true, stageKey: null, reason: 'legacy_choice_node' };
    }
    if (practice.optional_stage_enrolled === true) {
        return { accepted: true, stageKey, reason: 'snapshot_enrollment' };
    }
    if (!userId) {
        throw new Error('Sign in before choosing an optional curriculum stage.');
    }
    if (offline) {
        throw new Error(
            `Reconnect to choose whether to begin the optional ${optionalStageLabel(stageKey)}.`,
        );
    }
    if (!client) throw new Error('The curriculum service is unavailable.');

    const { data: existing, error: readError } = await client
        .from('curriculum_optional_stage_enrollments')
        .select('stage_key')
        .eq('user_id', userId)
        .eq('curriculum_slug', curriculumSlug)
        .eq('stage_key', stageKey)
        .maybeSingle();
    if (readError) throw readError;
    if (existing) {
        return { accepted: true, stageKey, reason: 'stored_enrollment' };
    }

    const accepted = await confirmChoice(stageKey);
    if (!accepted) return { accepted: false, stageKey, reason: 'not_now' };

    const { error: enrollmentError } = await client
        .from('curriculum_optional_stage_enrollments')
        .upsert({
            user_id: userId,
            curriculum_slug: curriculumSlug,
            stage_key: stageKey,
            accepted_at: new Date().toISOString(),
        }, { onConflict: 'user_id,curriculum_slug,stage_key' });
    if (enrollmentError) throw enrollmentError;
    return { accepted: true, stageKey, reason: 'new_enrollment' };
}
