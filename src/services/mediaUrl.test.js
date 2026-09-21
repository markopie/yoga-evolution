import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalizeStorageObjectPath } from './mediaUrl.js';

test('canonicalizes doubled storage slashes without touching a URL scheme', () => {
    assert.equal(
        canonicalizeStorageObjectPath('//audio-assets//nested///pose.mp3'),
        'audio-assets/nested/pose.mp3',
    );
});
