import test from 'node:test';
import assert from 'node:assert/strict';
import { readClasses, writeClasses, validateClasses, serverProfileBackup, localDate } from './classRecords.js';
import { validateProfileBackup } from './profileFile.js';
import { ACTIVE_CURRICULUM_SLUG } from '../config/curriculumConfig.js';

const record = () => ({ id: 'class-1', name: 'Morning class', sequenceId: '101', students: [{ id: 'student-1', name: 'Alex', formReviewed: true, reviewedOn: '2026-10-07' }], additionalProps: ['Belt'], excludedProps: [] });

test('prop exclusions survive storage and older classes include every prop by default', () => {
    const values = new Map(); const storage = { getItem: k => values.get(k), setItem: (k, v) => values.set(k, v) };
    const data = record(); data.excludedProps = ['sequence:block', 'additional:Belt'];
    writeClasses([data], 'a', storage);
    assert.deepEqual(readClasses('a', storage)[0].excludedProps, data.excludedProps);
    delete data.excludedProps;
    assert.deepEqual(validateClasses([data])[0].excludedProps, []);
});
test('class records round trip, stay profile-specific and never persist health details', () => {
    const values = new Map(); const storage = { getItem: k => values.get(k), setItem: (k, v) => values.set(k, v) };
    const data = record(); data.students[0].healthNotes = 'must not persist';
    writeClasses([data], 'a', storage);
    assert.deepEqual(readClasses('a', storage), [record()]);
    assert.deepEqual(readClasses('b', storage), []);
    writeClasses([], 'a', storage); assert.deepEqual(readClasses('a', storage), []);
});
test('malformed storage and failed writes are reported instead of clearing data', () => {
    assert.throws(() => readClasses('a', { getItem: () => '{' }), /could not be read/);
    assert.throws(() => writeClasses([record()], 'a', { setItem: () => { throw Error('quota'); } }), /could not be saved/);
});
test('review dates must be real calendar dates; unchecked forms discard dates', () => {
    const data = record(); data.students[0].reviewedOn = '2026-02-30';
    assert.throws(() => validateClasses([data]), /review date/);
    data.students[0].formReviewed = false;
    assert.equal(validateClasses([data])[0].students[0].reviewedOn, null);
    assert.equal(localDate(new Date(2026, 9, 7, 23)), '2026-10-07');
});
test('backups carry classes locally but RPC payload excludes the entire collection', () => {
    const base = { format: 'yoga-profile', version: 1, curriculumSlug: ACTIVE_CURRICULUM_SLUG, name: 'Teacher', completions: [], mastery: [], enrollments: [], preferences: {} };
    assert.deepEqual(validateProfileBackup(base).classes, []);
    const validated = validateProfileBackup({ ...base, classes: [record()] });
    assert.deepEqual(validated.classes, [record()]);
    assert.equal('classes' in serverProfileBackup(validated), false);
    assert.doesNotMatch(JSON.stringify(serverProfileBackup(validated)), /Alex|reviewedOn|Morning class/);
});
