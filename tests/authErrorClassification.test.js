import assert from 'node:assert/strict';
import test from 'node:test';

import { isAuthError, isNetworkError } from '../src/services/authErrorClassification.js';

function makeError(message, { name, status } = {}) {
    const error = new Error(message);
    if (name) error.name = name;
    if (status != null) error.status = status;
    return error;
}

test('isAuthError detects 401 status', () => {
    assert.equal(isAuthError(makeError('Request failed', { status: 401 })), true);
});

test('isAuthError detects 403 status', () => {
    assert.equal(isAuthError(makeError('Request failed', { status: 403 })), true);
});

test('isAuthError detects AuthError by name', () => {
    assert.equal(isAuthError(makeError('Something', { name: 'AuthError' })), true);
    assert.equal(isAuthError(makeError('Something', { name: 'AuthApiError' })), true);
});

test('isAuthError detects JWT expired message', () => {
    assert.equal(isAuthError(makeError('jwt expired')), true);
});

test('isAuthError detects session revoked message', () => {
    assert.equal(isAuthError(makeError('Your session has been revoked')), true);
});

test('isAuthError returns false for network errors', () => {
    assert.equal(isAuthError(makeError('Failed to fetch', { name: 'TypeError' })), false);
    assert.equal(isAuthError(makeError('The internet connection did not respond in time.')), false);
});

test('isAuthError returns false for null or undefined', () => {
    assert.equal(isAuthError(null), false);
    assert.equal(isAuthError(undefined), false);
});

test('isNetworkError detects TypeError with fetch', () => {
    assert.equal(isNetworkError(makeError('Failed to fetch', { name: 'TypeError' })), true);
});

test('isNetworkError detects timeout message', () => {
    assert.equal(isNetworkError(makeError('The request timed out')), true);
});

test('isNetworkError returns false for auth errors', () => {
    assert.equal(isNetworkError(makeError('jwt expired', { status: 401 })), false);
});

test('isNetworkError returns false for generic errors', () => {
    assert.equal(isNetworkError(makeError('Something went wrong')), false);
});

test('isNetworkError returns false for null or undefined', () => {
    assert.equal(isNetworkError(null), false);
    assert.equal(isNetworkError(undefined), false);
});
