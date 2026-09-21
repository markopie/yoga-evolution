export function optionalStageKey(node) {
    return String(node?.curriculum_payload?.optional_stage || '').trim() || null;
}

export function requiredOptionalStageKey(node) {
    return String(node?.curriculum_payload?.required_optional_stage || '').trim() || null;
}

export function optionalStageSet(enrollments = []) {
    return new Set(
        enrollments
            .map((entry) => typeof entry === 'string' ? entry : entry?.stage_key)
            .map((value) => String(value || '').trim())
            .filter(Boolean),
    );
}

export function optionalStageEligibility(node, enrollments = []) {
    const stageKey = optionalStageKey(node);
    if (!stageKey) return { eligible: true, requiresChoice: false, stageKey: null };

    const enrolled = enrollments instanceof Set
        ? enrollments
        : optionalStageSet(enrollments);
    const prerequisite = requiredOptionalStageKey(node);
    if (prerequisite && !enrolled.has(prerequisite)) {
        return {
            eligible: false,
            requiresChoice: false,
            stageKey,
            prerequisite,
            reason: 'prerequisite_not_enrolled',
        };
    }
    if (enrolled.has(stageKey)) {
        return {
            eligible: true,
            requiresChoice: false,
            stageKey,
            prerequisite,
            reason: 'already_enrolled',
        };
    }
    if (node?.requires_user_selection === true) {
        return {
            eligible: true,
            requiresChoice: true,
            stageKey,
            prerequisite,
            reason: 'choice_required',
        };
    }
    return {
        eligible: false,
        requiresChoice: false,
        stageKey,
        prerequisite,
        reason: 'stage_not_enrolled',
    };
}

export function optionalStageLabel(stageKey) {
    return {
        course_2_specialist_bridge: 'Light on Yoga Course 2 specialist bridge',
        course_3_advanced_extension: 'Light on Yoga Course 3 advanced extension',
    }[stageKey] || String(stageKey || 'optional curriculum stage').replaceAll('_', ' ');
}
