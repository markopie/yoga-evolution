import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProfileBackup } from './profileFile.js';
import { ACTIVE_CURRICULUM_SLUG } from '../config/curriculumConfig.js';
import { rememberProfile, readProfiles, profileStorageKey } from './deviceProfiles.js';

const file = () => ({ format: 'yoga-profile', version: 1, curriculumSlug: ACTIVE_CURRICULUM_SLUG,
    name: 'Alice', completions: [{ title: 'Practice', completed_at: '2026-09-21T00:00:00Z', rating: 4 }],
    mastery: [], enrollments: [], preferences: { theme: 'dark' } });

test('portable data excludes session credentials, ownership and admin claims', () => {
    const input = file();
    input.session = { access_token: 'secret', refresh_token: 'secret' };
    input.completions[0].user_id = 'other-user';
    input.completions[0].id = 'old-row-id';
    input.preferences.role = 'admin';
    const result = validateProfileBackup(input);
    assert.equal(result.session, undefined);
    assert.equal(result.completions[0].user_id, undefined);
    assert.equal(result.completions[0].id, undefined);
    assert.deepEqual(result.preferences, { theme: 'dark' });
});

test('invalid files and incompatible curriculum versions fail before import', () => {
    assert.throws(() => validateProfileBackup({}), /supported/);
    assert.throws(() => validateProfileBackup({ ...file(), curriculumSlug: 'other' }), /different curriculum/);
    const input = file();
    input.completions[0].rating = 6;
    assert.throws(() => validateProfileBackup(input), /invalid practice history/);
});

test('saved profiles keep distinct sessions, and profile preferences use distinct keys', () => {
    const map = new Map();
    const storage = { getItem: key => map.get(key), setItem: (key, value) => map.set(key, value) };
    for (const id of ['alice', 'bob']) rememberProfile({ user: { id }, access_token: id, refresh_token: `${id}-refresh` }, storage);
    rememberProfile({ user: { id: 'alice' }, access_token: 'alice-new', refresh_token: 'alice-new-refresh' }, storage);
    assert.equal(readProfiles(storage).length, 2);
    assert.equal(readProfiles(storage).find(p => p.id === 'bob').session.refresh_token, 'bob-refresh');
    assert.notEqual(profileStorageKey('preferences', 'alice'), profileStorageKey('preferences', 'bob'));
});
