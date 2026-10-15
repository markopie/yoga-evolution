export const sequenceId = course => String(course?.supabaseId ?? course?.id ?? '');
export function matchesSequence(course, query = '') {
    const q = query.trim().toLocaleLowerCase();
    return !q || String(course.title || '').toLocaleLowerCase().includes(q) || sequenceId(course).toLocaleLowerCase() === q;
}
export function sequenceLabel(course) {
    return [course.title || 'Untitled sequence', course.category, sequenceId(course) && `#${sequenceId(course)}`].filter(Boolean).join(' · ');
}
export function findSequence(id, courses = []) {
    return courses.find(course => sequenceId(course) === String(id)) || null;
}

function linkedSequence(id, courses) {
    return findSequence(id, courses) || courses.find(course => String(course.id) === String(id) || course.title?.toLocaleLowerCase() === String(id).toLocaleLowerCase());
}

export function resolveSequenceContent(course, courses = [], visited = new Set()) {
    if (!course || visited.has(sequenceId(course))) return null;
    if (!course.is_alias) return course;
    const master = resolveSequenceContent(findSequence(course.redirect_id, courses), courses, new Set(visited).add(sequenceId(course)));
    return master ? { ...course, poses: master.poses, sequence_json: master.sequence_json, playbackMode: master.playbackMode, condition_notes: course.condition_notes || master.condition_notes } : null;
}

export function explicitProps(pose, registry = {}) {
    const props = new Set((pose?.[7]?.props || []).filter(p => typeof p === 'string' && !p.startsWith('side:')));
    const tags = String(pose?.[4] || '').matchAll(/:([\w-]+)/g);
    for (const [, tag] of tags) if (registry[tag]) props.add(tag);
    return [...props];
}

// Collect only recorded props; links are guarded without expanding repeat counts.
export function sequenceProps(course, { courses = [], registry = {} } = {}, ancestors = new Set()) {
    const warnings = [], props = new Set();
    const key = sequenceId(course) || course?.title;
    if (!course) return { warnings: ['Sequence unavailable.'], props: [] };
    if (ancestors.has(key)) return { warnings: [`Circular sequence link: ${course.title}`], props: [] };
    const visited = new Set(ancestors).add(key);
    if (course.is_alias) return sequenceProps(findSequence(course.redirect_id, courses), { courses, registry }, visited);
    for (const pose of course.poses || []) {
        const id = String(Array.isArray(pose[0]) ? pose[0][0] : pose[0]);
        for (const prop of explicitProps(pose, registry)) props.add(prop);
        if (id.startsWith('MACRO:')) {
            const result = sequenceProps(linkedSequence(id.slice(6), courses), { courses, registry }, visited);
            warnings.push(...result.warnings);
            result.props.forEach(prop => props.add(prop));
        }
    }
    return { warnings: [...new Set(warnings)], props: [...props] };
}
