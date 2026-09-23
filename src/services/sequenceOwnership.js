/** The persisted shape is deliberately a snapshot, so later edits cannot
 * change what an already-started practice represented. */
export function sequenceSnapshot(sequence = null) {
    if (!sequence) return null;
    return {
        title: sequence.title || null,
        category: sequence.category || null,
        pose_ids: (sequence.poses || []).map((pose) => pose?.[0] ?? null),
        variations: (sequence.poses || []).map((pose) => pose?.[3] ?? null),
        props: (sequence.poses || []).map((pose) => pose?.[7]?.props || []),
        sides: (sequence.poses || []).map((pose) => pose?.[7]?.explicitSide || null),
        notes: (sequence.poses || []).map((pose) => pose?.[4] || ''),
        planned_durations: (sequence.poses || []).map((pose) => Number(pose?.[1] || 0)),
        source_sequence_id: sequence.sourceSequenceId || sequence.source_sequence_id || sequence.supabaseId || null,
        profile_sequence_id: sequence.profileSequenceId || (sequence.isUserSequence ? sequence.id : null),
    };
}

export function sequenceHash(snapshot) {
    const input = JSON.stringify(snapshot || null);
    let hash = 2166136261;
    for (let index = 0; index < input.length; index += 1) {
        hash ^= input.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

export function isCurriculumLaunch(practice = null) {
    return practice?.curriculum_node_id != null && practice?.launch_context !== 'manual';
}

