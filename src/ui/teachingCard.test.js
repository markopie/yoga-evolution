import test from 'node:test';
import assert from 'node:assert/strict';
import { googleImageReferenceUrl, openImageReferences } from './teachingCard.js';

test('builds an encoded Google Images query from the canonical pose name', () => {
    const url = googleImageReferenceUrl({ english: 'Extended Side Angle Pose', iast: 'Utthita Pārśvakoṇāsana' });
    const query = new URL(url).searchParams;
    assert.equal(query.get('tbm'), 'isch');
    assert.equal(query.get('q'), 'Utthita Pārśvakoṇāsana Iyengar yoga');
});

test('falls back to the English name when IAST is unavailable', () => {
    const url = googleImageReferenceUrl({ english: 'Equal Standing Pose' });
    assert.match(new URL(url).searchParams.get('q'), /^Equal Standing Pose /);
});

test('includes a recognised selected variation but never caller notes', () => {
    const url = googleImageReferenceUrl({ english: 'Adho Mukha Śvānāsana', note: 'private health note' }, 'Chair variation');
    assert.match(new URL(url).searchParams.get('q'), /Chair variation/);
    assert.doesNotMatch(new URL(url).searchParams.get('q'), /private health note/);
});

test('does not create a link without a pose name', () => {
    assert.equal(googleImageReferenceUrl({}), null);
});

test('opens only the reference URL in a separate tab and does not mutate playback state', () => {
    const state = { currentIndex: 3, currentSide: 'left', running: true };
    let opened;
    const url = openImageReferences({ english: 'Tāḍāsana' }, '', (...args) => { opened = args; return null; });
    assert.equal(opened[0], url);
    assert.deepEqual(opened.slice(1), ['_blank', 'noopener,noreferrer']);
    assert.deepEqual(state, { currentIndex: 3, currentSide: 'left', running: true });
});
