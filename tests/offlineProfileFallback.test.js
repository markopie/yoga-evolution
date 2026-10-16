import assert from 'node:assert/strict';
import test from 'node:test';

import { openProfileOffline } from '../src/services/deviceProfiles.js';

const cachedSnapshot = async () => ({ nodes: [{ id: 'node-1' }] });
const emptySnapshot = async () => ({ nodes: [] });

function makeError(message, { name, status } = {}) {
    const error = new Error(message);
    if (name) error.name = name;
    if (status != null) error.status = status;
    return error;
}

function trackingLoader(result) {
    const calls = [];
    const load = async (args) => { calls.push(args); return result; };
    return { calls, load };
}

test('network failure with a cached snapshot opens the profile offline', async () => {
    const loader = trackingLoader({ nodes: [{ id: 'node-1' }] });
    await openProfileOffline(new TypeError('Failed to fetch'), 'user-1', loader.load);
    assert.deepEqual(loader.calls, [{ userId: 'user-1' }]);
});

test('network failure without a cached snapshot is refused', async () => {
    await assert.rejects(
        openProfileOffline(makeError('Network request failed'), 'user-1', emptySnapshot),
        /check your internet connection/i,
    );
});

for (const [label, error] of [
    ['expired session', makeError('JWT expired', { status: 401 })],
    ['revoked refresh token', makeError('Invalid Refresh Token: Refresh Token Not Found', { name: 'AuthApiError', status: 400 })],
    ['invalid session wording not on the auth list', makeError('Expired session')],
    ['session for a different user', makeError('This device has lost access to the profile.')],
    ['unknown failure', makeError('Something unexpected happened')],
    ['missing error', undefined],
]) {
    test(`${label} never falls back to cached offline access`, async () => {
        const loader = trackingLoader({ nodes: [{ id: 'node-1' }] });
        await assert.rejects(openProfileOffline(error, 'user-1', loader.load), /lost access/i);
        assert.equal(loader.calls.length, 0, 'offline snapshot must not be consulted');
    });
}

test('refused access keeps the original error as the cause', async () => {
    const original = makeError('JWT expired', { status: 401 });
    await assert.rejects(openProfileOffline(original, 'user-1', cachedSnapshot), (error) => error.cause === original);
});
