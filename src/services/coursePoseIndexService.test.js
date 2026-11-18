import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { findSequencePoseMatches, parsePoseFilterIds } from './coursePoseIndexService.js';

function sequence(id, poses, extra = {}) {
    return { id, title: 'Sequence ' + id, poses, isSystem: true, ...extra };
}

function macro(id, rounds = 1) {
    return ['MACRO:' + id, rounds, '', '', '', null, '', { originalJson: { type: 'macro' } }];
}

describe('sequence pose discovery', () => {
    it('normalises and deduplicates selected targets without truncating long IDs or stripping suffixes', () => {
        assert.deepEqual(parsePoseFilterIds('#0007,7, 7A, #007/00142,7/142,9876543210'), [
            '007', '007a', '007/142', '9876543210',
        ]);
        assert.equal(parsePoseFilterIds(Array.from({ length: 25 }, (_, i) => i + 1)).length, 20);
    });

    it('finds exact authorship, source positions and stage context in native and legacy sequence entries', () => {
        const asanaLibrary = { '007': {
            variations: { II: { id: 12, title: 'With a chair' } }, preparatory_pose_id: '008', recovery_pose_id: '009',
        } };
        const staged = ['0007', 20, '', '', '', 4, null, { stageId: 12, tier: 'S' }];
        const legacy = [['7'], 0, '', 'ii', 'tier:L'];
        const lesson = sequence('10', [['LOOP_START', 5], staged, legacy, ['LOOP_END'], ['007a', 3]]);
        const other = sequence('11', [['007', 0], ['007', 20]]);
        const targets = parsePoseFilterIds('7, 7/12, 7a');
        const matches = findSequencePoseMatches([lesson, other], [...targets, '008', '009'], { asanaLibrary });
        assert.deepEqual(matches.get(lesson).matchedTargets, targets);
        assert.deepEqual(matches.get(other).matchedTargets, ['007']);
        const [nativeHit, legacyHit] = matches.get(lesson).occurrences.filter(hit => hit.target === '007/12');
        assert.deepEqual(nativeHit, {
            target: '007/12', poseId: '007', stageId: '12', variation: 'II', stageTitle: 'With a chair',
            entryIndex: 4, sourceSequenceId: '10', sourceTitle: 'Sequence 10', duration: 20, tier: 'S',
            kind: 'direct', path: [],
        });
        assert.equal(legacyHit.entryIndex, 2);
        assert.equal(legacyHit.duration, null);
        assert.equal(legacyHit.tier, 'L');
        assert.equal(matches.get(other).occurrences.length, 2);
    });

    it('retains an authored breadcrumb through macros, bounds cycles, and counts a child once across rounds', () => {
        const child = sequence('3', [macro('1'), ['001', 30]]);
        const middle = sequence('2', [macro('3', 1000000)]);
        const parent = sequence('1', [['002', 0], macro('2'), macro('2')]);
        const result = findSequencePoseMatches([parent, middle, child], ['001', '002']).get(parent);
        assert.deepEqual(result.matchedTargets, ['001', '002']);
        assert.equal(result.occurrences.length, 2);
        const linked = result.occurrences.find(hit => hit.target === '001');
        assert.equal(linked.kind, 'linked');
        assert.equal(linked.sourceSequenceId, '3');
        assert.equal(linked.entryIndex, 1);
        assert.deepEqual(linked.path.map(({ sequenceId, entryIndex }) => [sequenceId, entryIndex]), [['1', 1], ['2', 0]]);
        const chain = Array.from({ length: 14 }, (_, i) => sequence(String(i), i === 13 ? [['001', 0]] : [macro(i + 1)]));
        const matches = findSequencePoseMatches(chain, '001');
        assert.equal(matches.has(chain[0]), false);
        assert.equal(matches.get(chain[1]).occurrences[0].path.length, 12);
    });

    it('follows unique legacy titles and shared redirect identities without guessing missing links', () => {
        const child = sequence('7', [['007', 0]], { title: 'Cycle A' });
        const duplicate = sequence('9', [], { title: child.title.toLowerCase() });
        const legacyLink = sequence('10', [[['MACRO: Cycle A'], 2]]);
        const alias = sequence('11', [['987', 0]], { is_alias: true, redirect_id: '7' });
        const numericTitle = sequence('12', [['007', 20]], { title: '12345' });
        const missing = sequence('13', [macro('12345')]);
        const catalogue = [child, legacyLink, alias, numericTitle, missing];
        const matches = findSequencePoseMatches(catalogue, '007,987');
        assert.equal(matches.get(legacyLink).occurrences[0].kind, 'linked');
        assert.equal(matches.has(missing), false);
        assert.deepEqual(matches.get(alias).matchedTargets, ['007']);
        assert.equal(matches.get(alias).occurrences[0].sourceSequenceId, '7');
        assert.equal(findSequencePoseMatches([...catalogue, duplicate], '007').has(legacyLink), false);
        const conflictingId = sequence('12345', [['007', 10]]);
        assert.equal(findSequencePoseMatches([...catalogue, conflictingId], '007').has(missing), false);
    });

    it('excludes ambiguous pose IDs, long-ID collisions and mismatched parent-stage references', () => {
        const lesson = sequence('1', [['007', 20], ['9876543210', 0], ['009', 0, '', '', '', 4, null, { stageId: 2 }]]);
        const asanaLibrary = { '007': { id: '007' }, '0007': { id: '0007' }, '009': { variations: { I: { id: 3 } } } };
        const matches = findSequencePoseMatches([lesson], '007,987,009/2,009', { asanaLibrary });
        assert.deepEqual(matches.get(lesson).matchedTargets, ['009']);
    });

    it('rechecks ownership for roots, links and redirects whenever the device profile changes', () => {
        const mine = sequence('10', [['071', 15]], { userId: 'A', isSystem: false });
        const publicRow = sequence('11', [macro('10')], { userId: 'A' });
        const myLink = sequence('12', [macro('10')], { userId: 'A', isSystem: false });
        const sharedAlias = sequence('13', [], { is_alias: true, redirect_id: '10' });
        const legacyPrivate = sequence('14', [['071', 15]], { isUserSequence: true, isSystem: undefined });
        const courses = [mine, publicRow, myLink, sharedAlias, legacyPrivate];
        assert.deepEqual([...findSequencePoseMatches(courses, '071', { profileId: 'A' }).keys()], [mine, myLink]);
        assert.equal(findSequencePoseMatches(courses, '071', { profileId: 'B' }).size, 0);
        assert.equal(findSequencePoseMatches(courses, '071').size, 0);
    });
});
