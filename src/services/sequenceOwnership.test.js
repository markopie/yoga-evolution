import test from 'node:test';
import assert from 'node:assert/strict';
import { sequenceHash, sequenceSnapshot } from './sequenceOwnership.js';

test('sequence snapshot is stable and includes playback content', () => {
    const sequence = { title: 'Practice', category: 'Manual', supabaseId: 4, poses: [['12', 30, 'Pose', 'right', 'Note', 0, null, { props: ['belt'], explicitSide: 'right' }]] };
    const snapshot = sequenceSnapshot(sequence);
    assert.deepEqual(snapshot.pose_ids, ['12']);
    assert.deepEqual(snapshot.variations, ['right']);
    assert.deepEqual(snapshot.props, [['belt']]);
    assert.equal(sequenceHash(snapshot), sequenceHash(structuredClone(snapshot)));
});
