import assert from 'node:assert/strict';
import test from 'node:test';
import { collectDiscoverySourceOrder, createDiscoveryOrderStore, fetchDiscoverySourceOrder } from './discoverySourceOrder.js';

const book = 'light_on_yoga';
const breath = 'light_on_pranayama';
const gem = 'yoga_a_gem_for_women';

function node(id, sourceKey, sequenceId, position, course = 'Course 1') {
    return {
        id, sequence_id: sequenceId, source_key: sourceKey, source_course: course,
        source_sequence_order: position,
        parts: [{ role: 'primary_asana', sequence_id: sequenceId, delivery_variant_course_id: sequenceId,
            authored_source_course_id: sequenceId, source_key: sourceKey, source_course: course }],
    };
}

function fixtureClient(rows, { cap = Infinity, counted = true, failAt = null, beforePage } = {}) {
    const offsets = [];
    return {
        offsets,
        from(table) {
            assert.equal(table, 'program_curriculum');
            const filters = {};
            return {
                select(columns, options) {
                    assert.match(columns, /source_sequence_order/);
                    assert.ok(!columns.includes('*'));
                    assert.deepEqual(options, { count: 'exact' });
                    return this;
                },
                eq(field, value) { filters[field] = value; return this; },
                order(field) { assert.equal(field, 'id'); return this; },
                async range(from, to) {
                    assert.deepEqual(filters, { curriculum_slug: 'iyengar_integrated_source_faithful_v4', is_active: true, is_visible: true });
                    offsets.push(from);
                    await beforePage?.();
                    if (failAt === from) return { data: null, error: new Error('Interrupted fixture download') };
                    return { data: rows.slice(from, Math.min(to + 1, from + cap)), count: counted ? rows.length : null };
                },
            };
        },
    };
}

test('source order deduplicates repeated lessons and maps Gem deliveries to one authored parent', () => {
    const first = node(1, gem, 384, 3633, 'First Year');
    first.parts[0].authored_source_course_id = 363;
    const full = node(2, gem, 363, 3633, 'First Year');
    const missingParent = node(3, gem, 385, 3633, 'First Year');
    delete missingParent.parts[0].authored_source_course_id;
    const order = collectDiscoverySourceOrder([first, full, missingParent]);
    assert.deepEqual([...order.keys()], ['363']);
    assert.deepEqual(order.get('363'), { position: 3633, sourceKey: gem, sourceCourse: 'First Year', conflict: false });
});

test('recovery rows carry only the designated breathing lesson order; an append on an ordinary row inherits nothing', () => {
    const primary = node(1, book, 114, 100);
    const breathing = { role: 'appended_pranayama', sequence_id: 52, source_key: breath, source_course: 'Course 1 (Preparatory)' };
    primary.parts.push(breathing);
    assert.deepEqual([...collectDiscoverySourceOrder([primary]).keys()], ['114']);
    const recovery = { id: 2, source_key: 'integrated_recovery', sequence_id: null, source_sequence_order: 1000, lop_id: '52',
        parts: [{ role: 'quiet_asana', sequence_id: 354 }, breathing] };
    const order = collectDiscoverySourceOrder([recovery, recovery, primary]);
    assert.deepEqual(order.get('52'), { position: 1000, sourceKey: breath, sourceCourse: 'Course 1 (Preparatory)', conflict: false });
    assert.equal(order.has('354'), false);
    assert.equal(collectDiscoverySourceOrder([{ ...recovery, lop_id: '53' }]).get('53').conflict, true);
});

test('conflicting positions or source courses stay withheld regardless of the last repetition', () => {
    const valid = node(1, book, 114, 100);
    for (const other of [node(2, book, 114, 200), node(2, book, 114, 100, 'Course 2'), node(2, book, 114, null)]) {
        const result = collectDiscoverySourceOrder([valid, other, valid]).get('114');
        assert.equal(result.conflict, true);
        assert.equal(result.position, null);
    }
});

test('reads every page up to the exact count when the server caps page size', async () => {
    const rows = [1, 2, 3, 4, 5].map(id => node(id, book, 100 + id, id * 100));
    const client = fixtureClient(rows, { cap: 2 });
    const result = await fetchDiscoverySourceOrder(client);
    assert.deepEqual(client.offsets, [0, 2, 4]);
    assert.deepEqual([...result.keys()], ['101', '102', '103', '104', '105']);
    const uncounted = fixtureClient(rows, { cap: 2, counted: false });
    assert.deepEqual(await fetchDiscoverySourceOrder(uncounted), result);
    assert.deepEqual(uncounted.offsets, [0, 2, 4, 5]);
    await assert.rejects(fetchDiscoverySourceOrder(fixtureClient([rows[0], rows[0]])), /Unstable/);
});

test('offline and interrupted refreshes use only the last complete cache for that project', async () => {
    const disk = new Map();
    const storage = { read: async key => disk.get(key), save: async (key, value) => disk.set(key, structuredClone(value)) };
    const client = fixtureClient([node(1, book, 114, 100)]);
    const online = createDiscoveryOrderStore(storage);
    let renders = 0;
    const render = () => { renders++; online.request(client, 'projectA', true, render); };
    const first = online.request(client, 'projectA', true, render);
    assert.equal(online.request(client, 'projectA', true, render), first);
    await first;
    assert.equal(renders, 1);
    assert.equal(online.getStatus(), 'live');
    const offline = createDiscoveryOrderStore(storage);
    await offline.request(client, 'projectA', false);
    assert.equal(offline.getStatus(), 'cached');
    assert.deepEqual([...offline.getOrder().keys()], ['114']);
    assert.deepEqual(client.offsets, [0]);
    const interrupted = fixtureClient([node(1, book, 115, 300), node(2, book, 116, 500)], { cap: 1, failAt: 1 });
    await offline.request(interrupted, 'projectA', true);
    assert.equal(offline.getStatus(), 'cached');
    assert.deepEqual([...offline.getOrder().keys()], ['114']);
    assert.equal(disk.size, 1);
    assert.equal([...disk.values()][0][0][0], '114');
    await offline.request(null, 'unrelatedProject', false);
    assert.equal(offline.getStatus(), 'unavailable');
    assert.equal(offline.getOrder().size, 0);
});

test('a late remote response cannot replace order for a different project', async () => {
    let resolveFetch;
    const gate = new Promise(resolve => { resolveFetch = resolve; });
    const old = fixtureClient([node(1, book, 114, 100)], { beforePage: () => gate });
    const cacheKeys = [];
    const store = createDiscoveryOrderStore({ read: async () => null, save: async key => cacheKeys.push(key) });
    const slow = store.request(old, 'old', true);
    await store.request(fixtureClient([node(42, book, 115, 300)]), 'new', true);
    resolveFetch();
    await slow;
    assert.deepEqual([...store.getOrder().keys()], ['115']);
    assert.equal(cacheKeys.length, 1);
    assert.match(cacheKeys[0], /:new:/);
});
