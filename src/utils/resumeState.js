export function resumeCourseId(course) {
    const id = course?.supabaseId ?? course?.id;
    return id === undefined || id === null || id === "" ? "" : String(id);
}

export function buildResumeState({
    currentSequence,
    currentCurriculumPractice = null,
    sequenceIdx,
    poseIdx,
    focusDuration,
    completionTracker,
    timestamp = Date.now(),
}) {
    const sequenceId = resumeCourseId(currentSequence);
    const curriculumNodeId = currentCurriculumPractice?.curriculum_node_id ?? null;
    return {
        mode: curriculumNodeId == null ? 'manual' : 'curriculum',
        sequenceIdx: sequenceIdx || "",
        sequenceId,
        poseIdx,
        sequenceTitle: currentSequence?.title || "",
        curriculumNodeId,
        curriculumSlug: currentCurriculumPractice?.curriculum_slug || '',
        curriculumWeek: currentCurriculumPractice?.week_number ?? null,
        curriculumDay: currentCurriculumPractice?.day_number ?? null,
        focusDuration,
        completionTracker,
        timestamp,
    };
}

export function resolveResumeCourse(courses, state) {
    const courseList = Array.isArray(courses) ? courses : [];
    const savedId = state?.sequenceId;

    if (savedId !== undefined && savedId !== null && savedId !== "") {
        const stableIndex = courseList.findIndex(course => resumeCourseId(course) === String(savedId));
        if (stableIndex >= 0) {
            return { course: courseList[stableIndex], index: stableIndex };
        }
    }

    const legacyIndex = Number.parseInt(state?.sequenceIdx, 10);
    if (Number.isInteger(legacyIndex) && legacyIndex >= 0 && legacyIndex < courseList.length) {
        return { course: courseList[legacyIndex], index: legacyIndex };
    }

    return { course: null, index: -1 };
}
