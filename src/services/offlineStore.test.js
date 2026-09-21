import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeCompletionOperation } from './offlineStore.js';

test('migrates a v1 completion row into one durable operation', () => {
    const operation = normalizeCompletionOperation({
        id: 'row-1',
        rows: [{ id: 'row-1', user_id: 'user-1', rating: 4 }],
        createdAt: '2026-01-01T00:00:00.000Z',
    });
    assert.equal(operation.operationId, 'row-1');
    assert.equal(operation.userId, 'user-1');
    assert.deepEqual(operation.rowIds, ['row-1']);
    assert.equal(operation.rating, 4);
    assert.equal(operation.ratingPending, false);
});

test('keeps multi-row curriculum completion and rating together', () => {
    const operation = normalizeCompletionOperation({
        id: 'operation-1',
        rows: [
            { id: 'row-1', user_id: 'user-1' },
            { id: 'row-2', user_id: 'user-1' },
        ],
        ratingPending: true,
    });
    assert.deepEqual(operation.rowIds, ['row-1', 'row-2']);
    assert.equal(operation.userId, 'user-1');
    assert.equal(operation.ratingPending, true);
});
