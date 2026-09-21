import assert from 'node:assert/strict';
import test from 'node:test';
import {
    optionalStageEligibility,
    optionalStageKey,
    optionalStageLabel,
    optionalStageSet,
} from './curriculumOptionalStages.js';

const bridgeGate = {
    requires_user_selection: true,
    curriculum_payload: {
        optional_stage: 'course_2_specialist_bridge',
    },
};
const bridgePractice = {
    requires_user_selection: false,
    curriculum_payload: {
        optional_stage: 'course_2_specialist_bridge',
    },
};
const courseThreeGate = {
    requires_user_selection: true,
    curriculum_payload: {
        optional_stage: 'course_3_advanced_extension',
        required_optional_stage: 'course_2_specialist_bridge',
    },
};

test('ordinary core nodes do not require optional-stage enrollment', () => {
    assert.deepEqual(
        optionalStageEligibility({ curriculum_payload: {} }),
        { eligible: true, requiresChoice: false, stageKey: null },
    );
});

test('only the first node of an unenrolled stage is offered as a choice', () => {
    assert.deepEqual(optionalStageEligibility(bridgeGate), {
        eligible: true,
        requiresChoice: true,
        stageKey: 'course_2_specialist_bridge',
        prerequisite: null,
        reason: 'choice_required',
    });
    assert.equal(optionalStageEligibility(bridgePractice).eligible, false);
});

test('enrollment unlocks every node in that optional stage', () => {
    const enrolled = optionalStageSet([{ stage_key: 'course_2_specialist_bridge' }]);
    assert.equal(optionalStageEligibility(bridgeGate, enrolled).requiresChoice, false);
    assert.equal(optionalStageEligibility(bridgePractice, enrolled).eligible, true);
});

test('Course 3 remains hidden until the Course 2 bridge is enrolled', () => {
    const blocked = optionalStageEligibility(courseThreeGate);
    assert.equal(blocked.eligible, false);
    assert.equal(blocked.reason, 'prerequisite_not_enrolled');

    const bridgeEnrolled = new Set(['course_2_specialist_bridge']);
    const offered = optionalStageEligibility(courseThreeGate, bridgeEnrolled);
    assert.equal(offered.eligible, true);
    assert.equal(offered.requiresChoice, true);
});

test('stage metadata has stable labels for the user prompt', () => {
    assert.equal(optionalStageKey(bridgeGate), 'course_2_specialist_bridge');
    assert.equal(
        optionalStageLabel('course_3_advanced_extension'),
        'Light on Yoga Course 3 advanced extension',
    );
});
