import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureOptionalStageEnrollment } from './curriculumOptionalStageEnrollment.js';

function fakeClient(existing = false) {
    const writes = [];
    const query = {
        select() { return this; },
        eq() { return this; },
        async maybeSingle() {
            return {
                data: existing ? { stage_key: 'course_2_specialist_bridge' } : null,
                error: null,
            };
        },
        async upsert(payload) {
            writes.push(payload);
            return { data: payload, error: null };
        },
    };
    return {
        writes,
        from() { return query; },
    };
}

const gate = {
    requires_user_selection: true,
    curriculum_payload: {
        optional_stage: 'course_2_specialist_bridge',
    },
};

test('a stored optional-stage enrollment bypasses the prompt', async () => {
    const client = fakeClient(true);
    let prompted = false;
    const result = await ensureOptionalStageEnrollment({
        practice: gate,
        client,
        userId: 'user-1',
        curriculumSlug: 'curriculum-1',
        confirmChoice: async () => {
            prompted = true;
            return false;
        },
    });
    assert.equal(result.reason, 'stored_enrollment');
    assert.equal(prompted, false);
});

test('not now leaves the stage unenrolled and available later', async () => {
    const client = fakeClient(false);
    const result = await ensureOptionalStageEnrollment({
        practice: gate,
        client,
        userId: 'user-1',
        curriculumSlug: 'curriculum-1',
        confirmChoice: async () => false,
    });
    assert.equal(result.accepted, false);
    assert.equal(result.reason, 'not_now');
    assert.equal(client.writes.length, 0);
});

test('accepting the prompt persists the enrollment', async () => {
    const client = fakeClient(false);
    const result = await ensureOptionalStageEnrollment({
        practice: gate,
        client,
        userId: 'user-1',
        curriculumSlug: 'curriculum-1',
        confirmChoice: async () => true,
    });
    assert.equal(result.reason, 'new_enrollment');
    assert.equal(client.writes.length, 1);
    assert.equal(client.writes[0].stage_key, 'course_2_specialist_bridge');
});

test('an unenrolled optional stage cannot be selected while offline', async () => {
    await assert.rejects(
        ensureOptionalStageEnrollment({
            practice: gate,
            client: fakeClient(false),
            userId: 'user-1',
            curriculumSlug: 'curriculum-1',
            offline: true,
            confirmChoice: async () => true,
        }),
        /Reconnect/,
    );
});
