import { test, describe } from 'node:test';
import assert from 'node:assert';
import { buildResumeState, resolveResumeCourse, resumeCourseId } from './resumeState.js';

describe('resume state helpers', () => {
  test('stores a stable course identifier with the legacy dropdown index', () => {
    const state = buildResumeState({
      currentSequence: { id: 'course-42', title: 'Stable Course' },
      sequenceIdx: '0',
      poseIdx: 2,
      focusDuration: 1234,
      completionTracker: { 0: 30 },
      timestamp: 1000,
    });

    assert.strictEqual(state.sequenceIdx, '0');
    assert.strictEqual(state.sequenceId, 'course-42');
    assert.strictEqual(state.sequenceTitle, 'Stable Course');
    assert.strictEqual(state.mode, 'manual');
  });

  test('stores curriculum resume context separately from the source sequence', () => {
    const state = buildResumeState({
      currentSequence: { id: 'course-42', title: 'Course 42' },
      currentCurriculumPractice: {
        curriculum_node_id: 77,
        curriculum_slug: 'iyengar-curriculum',
        week_number: 1,
        day_number: 2,
      },
      poseIdx: 3,
    });

    assert.strictEqual(state.mode, 'curriculum');
    assert.strictEqual(state.curriculumNodeId, 77);
    assert.strictEqual(state.curriculumSlug, 'iyengar-curriculum');
    assert.strictEqual(state.curriculumWeek, 1);
    assert.strictEqual(state.curriculumDay, 2);
  });

  test('restores by stable id after course order changes', () => {
    const courses = [
      { id: 'course-a', title: 'Course A' },
      { id: 'course-b', title: 'Course B' },
    ];
    const savedState = { sequenceIdx: '0', sequenceId: 'course-b' };

    const resolved = resolveResumeCourse(courses, savedState);

    assert.strictEqual(resolved.index, 1);
    assert.strictEqual(resolved.course.title, 'Course B');
  });

  test('falls back to legacy dropdown index for old resume records', () => {
    const courses = [
      { id: 'course-a', title: 'Course A' },
      { id: 'course-b', title: 'Course B' },
    ];
    const savedState = { sequenceIdx: '0' };

    const resolved = resolveResumeCourse(courses, savedState);

    assert.strictEqual(resolved.index, 0);
    assert.strictEqual(resolved.course.title, 'Course A');
  });

  test('normalises supabaseId and id values for matching', () => {
    assert.strictEqual(resumeCourseId({ supabaseId: 99 }), '99');
    assert.strictEqual(resolveResumeCourse([{ id: 99, title: 'Numeric Id' }], { sequenceId: '99' }).index, 0);
  });
});
