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

export const SESSION_ACTIVE_MIN_SECONDS = 5;

/**
 * Mirrors the app-wide "is a session genuinely under way?" check used by
 * handleStart and the reset flow: real practice time, movement past the first
 * pose, or at least one completed pose.
 */
export function isResumeStateActive(state) {
    if (!state) return false;
    const focusMs = Number(state.focusDuration) || 0;
    if (focusMs / 1000 >= SESSION_ACTIVE_MIN_SECONDS) return true;
    if (Number(state.poseIdx) > 0) return true;
    const tracker = state.completionTracker || {};
    return Object.values(tracker).some(v => Number(v) > 0);
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
