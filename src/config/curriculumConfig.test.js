import assert from 'node:assert/strict';
import test from 'node:test';

import { curriculumConfigFor } from './curriculumConfig.js';

test('uses the published v4 curriculum by default', () => {
    assert.deepEqual(curriculumConfigFor(null), {
        slug: 'iyengar_integrated_source_faithful_v4',
        name: 'Iyengar Curriculum',
    });
    assert.deepEqual(curriculumConfigFor('full'), curriculumConfigFor(null));
});

test('keeps limited and previous curricula behind explicit preview switches', () => {
    assert.equal(
        curriculumConfigFor('testing').slug,
        'iyengar_integrated_master_path_testing_v2',
    );
    assert.equal(
        curriculumConfigFor('week1').slug,
        'iyengar_integrated_week_1_review_v1',
    );
    assert.deepEqual(curriculumConfigFor('v3'), {
        slug: 'iyengar_integrated_source_faithful_v3_repair_review',
        name: 'Iyengar Curriculum — Previous v3 repair',
    });
    assert.deepEqual(
        curriculumConfigFor('previous'),
        curriculumConfigFor('v3'),
    );
});
