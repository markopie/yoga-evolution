import test from 'node:test';
import assert from 'node:assert/strict';
import { makePersonalAsanaId, mergeAsanaOverrides } from './asanaOverrides.js';

test('profile override replaces only that profile library entry', () => {
    const source = {
        '001': { id: '001', english: 'Source name', variations: { I: { title: 'Source variation' } } },
        '002': { id: '002', english: 'Unchanged', variations: {} },
    };
    const merged = mergeAsanaOverrides(source, [{
        asana_id: '001',
        payload: { id: '001', english: 'Personal name', variations: { II: { title: 'Personal variation' } } },
    }]);

    assert.equal(merged['001'].english, 'Personal name');
    assert.deepEqual(Object.keys(merged['001'].variations), ['II']);
    assert.equal(merged['002'], source['002']);
    assert.equal(source['001'].english, 'Source name');
});

test('profile tombstone hides only its own source item', () => {
    const source = { '001': { id: '001' }, '002': { id: '002' } };
    const merged = mergeAsanaOverrides(source, [{ asana_id: '001', is_deleted: true }]);
    assert.deepEqual(Object.keys(merged), ['002']);
});

test('new profile-owned asana IDs are numeric and avoid current library collisions', () => {
    const values = [0, 0.000000001];
    const id = makePersonalAsanaId({ '9000000000': {} }, () => values.shift());
    assert.equal(id, '9000000001');
    assert.match(id, /^\d{10}$/);
});
