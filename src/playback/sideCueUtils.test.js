import assert from 'node:assert/strict';
import test from 'node:test';

import {
    normalizePlaybackSide,
    requiresBilateralSides,
    sideCueSpeech,
} from './sideCueUtils.js';

test('recognizes normalized and legacy bilateral fields', () => {
    assert.equal(requiresBilateralSides({ requires_sides: true }), true);
    assert.equal(requiresBilateralSides({ requires_sides: 'true' }), true);
    assert.equal(requiresBilateralSides({ requiresSides: true }), true);
    assert.equal(requiresBilateralSides({ requiresSides: '1' }), true);
    assert.equal(requiresBilateralSides({ requires_sides: false }), false);
});

test('normalizes playback sides and second-side fallback', () => {
    assert.equal(normalizePlaybackSide('R'), 'right');
    assert.equal(normalizePlaybackSide('left'), 'left');
    assert.equal(normalizePlaybackSide(null, true), 'left');
    assert.equal(normalizePlaybackSide(null, false), null);
});

test('builds an audible speech fallback', () => {
    assert.equal(sideCueSpeech('right'), 'Right side');
    assert.equal(sideCueSpeech('L'), 'Left side');
    assert.equal(sideCueSpeech(null), '');
});
