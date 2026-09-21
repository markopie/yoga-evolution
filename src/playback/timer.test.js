import assert from 'node:assert/strict';
import test from 'node:test';

import { PlaybackEngine } from './timer.js';

test('first run starts immediately and derives countdown from wall clock', () => {
    const originalNow = Date.now;
    let now = 1_000;
    Date.now = () => now;
    const engine = new PlaybackEngine();
    try {
        engine.setPoseTime(5);
        engine.start();
        assert.equal(engine.running, true);
        now += 1_100;
        engine.syncNow();
        assert.equal(engine.remaining, 4);
    } finally {
        engine.stop();
        Date.now = originalNow;
    }
});

test('a throttled/backgrounded timer completes a pose exactly once', () => {
    const originalNow = Date.now;
    let now = 10_000;
    Date.now = () => now;
    const engine = new PlaybackEngine();
    let completions = 0;
    engine.onPoseComplete = () => { completions += 1; };
    try {
        engine.setPoseTime(3);
        engine.start();
        now += 10_000;
        engine.syncNow();
        engine.syncNow();
        assert.equal(engine.remaining, 0);
        assert.equal(completions, 1);
    } finally {
        engine.stop();
        Date.now = originalNow;
    }
});
