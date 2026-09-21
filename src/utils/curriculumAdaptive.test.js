import assert from 'node:assert/strict';
import test from 'node:test';

import { latestLowRatedCurriculumNode } from './curriculumAdaptive.js';

const nodes = [{ id: 10 }, { id: 20 }];

test('returns the node from the latest low-rated curriculum completion', () => {
    const node = latestLowRatedCurriculumNode(nodes, [
        { id: 1, curriculum_node_id: 10, rating: 4, completed_at: '2026-08-01T00:00:00Z' },
        { id: 2, curriculum_node_id: 20, rating: 2, completed_at: '2026-08-02T00:00:00Z' },
    ]);
    assert.equal(node?.id, 20);
});

test('does not retry once the latest completion is rated three or higher', () => {
    const node = latestLowRatedCurriculumNode(nodes, [
        { id: 1, curriculum_node_id: 20, rating: 2, completed_at: '2026-08-01T00:00:00Z' },
        { id: 2, curriculum_node_id: 20, rating: 3, completed_at: '2026-08-02T00:00:00Z' },
    ]);
    assert.equal(node, null);
});

test('ignores unrelated and incomplete completion rows', () => {
    const node = latestLowRatedCurriculumNode(nodes, [
        { id: 1, curriculum_node_id: 99, rating: 1, completed_at: '2026-08-03T00:00:00Z' },
        { id: 2, curriculum_node_id: 20, rating: 1, completed: false, completed_at: '2026-08-04T00:00:00Z' },
    ]);
    assert.equal(node, null);
});
