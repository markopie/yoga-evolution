import test from 'node:test';
import assert from 'node:assert/strict';
import { sequenceProps, matchesSequence, resolveSequenceContent } from './sequenceTeaching.js';
const pose = (id, props = [], note = '') => [id, 30, '', '', note, 0, null, { props }];
test('sequence search matches titles without case and exact stable IDs', () => {
    const course = { id: '7', title: 'Seated Practice' };
    assert.ok(matchesSequence(course, 'SEATED'));
    assert.ok(matchesSequence(course, '7'));
    assert.ok(!matchesSequence(course, 'standing'));
});
test('props use explicit metadata and recognised tags, including links; never infer from names', () => {
    const child = { id: '2', title: 'Chair pose', poses: [pose('002', ['belt'], ':block')] };
    const main = { id: '1', title: 'Main', poses: [pose('001', ['belt', 'side:L'], 'use a blanket'), pose('MACRO:2')] };
    const result = sequenceProps(main, { courses: [main, child], registry: { block: { label: 'Block' } } });
    assert.deepEqual(result.props.sort(), ['belt', 'block']);

});
test('prop traversal reports cycles and missing links', () => {
    const main = { id: '1', title: 'Main', poses: [pose('MACRO:1'), pose('MACRO:missing')] };
    const result = sequenceProps(main, { courses: [main] });
    assert.ok(result.warnings.some(warning => warning.includes('Circular sequence link')));
    assert.ok(result.warnings.some(warning => warning.includes('Sequence unavailable')));
});
test('aliases resolve explicit props and sequence content', () => {
    const master = { id: '1', title: 'Master', poses: [['001', 0, '', '', '', 0, null, { props: ['block'] }]] };
    const alias = { id: '2', is_alias: true, redirect_id: '1' };
    const result = sequenceProps(alias, { courses: [master] });
    assert.deepEqual(result.props, ['block']);
    assert.equal(resolveSequenceContent(alias, [master]).poses, master.poses);
    assert.equal(resolveSequenceContent({ ...alias, redirect_id: '2' }, [alias]), null);
});

test('linked sequences match both existing IDs', () => {
    const child = { id: '12', supabaseId: '99', title: 'Child', poses: [pose('001', ['block'])] };
    const result = sequenceProps({ id: '1', title: 'Main', poses: [pose('MACRO:12')] }, { courses: [child] });
    assert.deepEqual(result.props, ['block']);
    assert.deepEqual(result.warnings, []);
});
