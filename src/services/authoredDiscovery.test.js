import test from 'node:test';
import assert from 'node:assert/strict';
import { findSequencePoseMatches } from './coursePoseIndexService.js';
import { findAuthoredCourses, findEarlierLessons } from './authoredDiscovery.js';
import { authoredCourseSections } from '../config/authoredCourseSources.js';

const loy = 'Light on Yoga';
const ytiw = 'Yoga The Iyengar Way';
const pose = (id, stageId = null) => [id, null, null, null, null, null, null, { stageId }];
function lesson(id, title, poses, source = loy, section = 'Course 1') {
    return { id: String(id), supabaseId: String(id), title, isSystem: true, categoryName: source, subCategoryName: section, poses };
}

test('course coverage combines distinct goals across verified lessons and keeps source courses separate', () => {
    const one = lesson(114, 'Week 1 & 2', [pose('003'), pose('003')]);
    const two = lesson(115, 'Week 3 & 4', [pose('012')]);
    const other = lesson(213, 'Lesson 1', [pose('003')], ytiw);
    const targets = ['003', '012'];
    const hits = findSequencePoseMatches([other, two, one], targets);
    assert.equal([...hits.values()].some(match => match.matchedTargets.length === 2), false);
    const all = findAuthoredCourses(hits, targets, 'ALL');
    assert.equal(all.length, 1);
    assert.equal(all[0].id, 'loy_course_1');
    assert.deepEqual(all[0].lessons.map(l => [l.sequence.id, l.matchedTargets]), [['114', ['003']], ['115', ['012']]]);
    assert.deepEqual(all[0].matchedTargets, targets);
    assert.equal(findAuthoredCourses(hits, targets, 'any').length, 2);
});

test('mapping suppresses title/source drift, aliases and personal copies; shared owner-bearing rows remain eligible', () => {
    const real = lesson(114, 'Week 1 & 2', [pose('003')]);
    const candidates = [
        { ...real, title: 'Renamed' }, { ...real, categoryName: ytiw }, { ...real, subCategoryName: 'Course 2' },
        { ...real, is_alias: true }, { ...real, redirect_id: 115 }, { ...real, isSystem: false },
        { ...real, isUserSequence: true, userId: 'device-a' },
    ];
    const matches = findSequencePoseMatches(candidates, ['003'], { profileId: 'device-a' });
    assert.deepEqual(findAuthoredCourses(matches, ['003'])[0].lessons.map(l => l.sequence), [candidates.at(-1)]);
});

test('numbered members of the same Iyengar Way rotating group have order but do not precede one another', () => {
    const a = lesson(240, '4A (Standing)', [pose('074')], ytiw, 'Course 2');
    const b = lesson(241, '4B (Sitting)', [pose('074')], ytiw, 'Course 2');
    const hits = findSequencePoseMatches([a,b], ['074']);
    const courses = findAuthoredCourses(hits, ['074']);
    assert.deepEqual(courses[0].lessons.map(l => l.position), [41, 42]);
    assert.deepEqual(findEarlierLessons(hits, '074', b), []);
});

test('guidance names actual entry and supported stage, honors the chosen lesson, and ignores linked-only repetitions', () => {
    const one = lesson(114, 'Week 1 & 2', [pose('012'), pose('003', 186)]);
    const two = lesson(115, 'Week 3 & 4', [pose('003')]);
    const linked = lesson(116, 'Week 5 & 6', [pose('MACRO:115')]);
    const unrelated = lesson(117, 'Week 8', [pose('120')]);
    const hits = findSequencePoseMatches([linked, two, unrelated, one], ['003', '003/186', '120'], {
        asanaLibrary: { '003': { id: '003', variations: { Wall: { id: 186, title: 'Against the wall' } } } },
    });
    const [result] = findEarlierLessons(hits, '003', two);
    assert.equal(result.sequence, one);
    assert.equal(result.referenceSequence, two);
    assert.equal(result.evidenceType, 'earlier-occurrence');
    assert.match(result.reason, /Against the wall.*entry 2/);
    assert.match(result.reason, /Week 3 & 4.*entry 1/);
    assert.deepEqual(findEarlierLessons(hits, '003', one), []);
    assert.deepEqual(findEarlierLessons(hits, '003', linked), []);
    assert.deepEqual(findEarlierLessons(hits, '003/186', two), []);
    assert.deepEqual(findEarlierLessons(hits, '120', unrelated), []);
    assert.deepEqual(findEarlierLessons(hits, ['003','120']), []);
});

test('the cited teacher rule applies only to adjacent pairings in the named source', () => {
    const one = lesson(213, 'Lesson 1', [pose('047')], ytiw);
    const two = lesson(215, 'Lesson 2', [pose('047'), pose('040')], ytiw);
    const three = lesson(216, 'Lesson 3', [pose('047')], ytiw);
    const courses = [three, two, one];
    const hits = findSequencePoseMatches(courses, ['047','040']);
    const observed = findEarlierLessons(hits, '047', three, courses);
    assert.deepEqual(observed.map(item => item.evidenceType), ['teacher-recommended','earlier-occurrence']);
    assert.match(observed[0].reason, /recommend alternating Lesson 2 and Lesson 3/);
    assert.match(observed[0].sourceRef, /Suggested Scheme of Practice/);
    assert.deepEqual(findEarlierLessons(hits, '047').map(r => r.sequence), [one]);
    const [pair] = findEarlierLessons(hits, '040', two, courses);
    assert.equal(pair.sequence, one);
    assert.equal(pair.evidenceType, 'teacher-recommended');
    assert.doesNotMatch(pair.reason, /Lesson 1 includes/);
    assert.deepEqual(findEarlierLessons(hits, '040', two, [two,three]), []);
});

test('the archived mapping identifies a teaching role and position for each of the 244 authored sheets', () => {
    const lessons = authoredCourseSections.flatMap(section => section.lessons);
    assert.equal(lessons.length, 244);
    assert.equal(new Set(lessons.map(([id]) => id)).size, lessons.length);
    assert.equal(new Set(authoredCourseSections.map(s => s.sourceKey)).size, 5);
    assert.ok(lessons.every(([, title, position, role]) => title && Number.isSafeInteger(position) && role));
});

const breath = 'Light on Pranayama';
const gem = 'Yoga A Gem For Women';
const htuy = 'How to Use Yoga';

test('Pranayama Stage II sticks to the same variation and reports where its order came from', () => {
    const section = 'Course 1 (Preparatory)';
    const one = lesson(52, 'Week 1 and 2', [pose('203', 31)], breath, section);
    const three = lesson(53, 'Week 3 and 4', [pose('203', 32)], breath, section);
    const five = lesson(54, 'Week 5 and 6', [pose('203', 32)], breath, section);
    const hits = findSequencePoseMatches([five, three, one], ['203/32']);
    const source = { sourceKey: 'light_on_pranayama', sourceCourse: section, conflict: false };
    const stored = new Map([['53', { ...source, position: 3000 }], ['54', { ...source, position: 5000 }]]);
    const earlier = () => findEarlierLessons(hits, '203/32', five, [], stored);
    assert.deepEqual(earlier().map(row => [row.sequence, row.orderStatus]), [[three, 'stored']]);
    stored.delete('53');
    assert.equal(earlier()[0].orderStatus, 'mixed');
    assert.match(earlier()[0].orderNote, /Week 3 and 4 uses the archived/);
    for (const invalid of [
        { ...source, position: 1000 }, { ...source, position: 3000, conflict: true },
        { ...source, position: 3000, sourceKey: 'light_on_yoga' },
        { ...source, position: 3000, sourceCourse: 'Course 2 (Primary)' },
    ]) {
        stored.set('53', invalid);
        assert.deepEqual(earlier(), []);
        const [member] = findAuthoredCourses(hits, ['203/32'], 'any', stored).flatMap(c => c.lessons).filter(l => l.sequence === three);
        assert.equal(member.orderStatus, 'conflict');
        assert.equal(member.eligibleForGuidance, false);
    }
});

test('How to Use Yoga compares weeks, including a filtered later week, and keeps recovery on its own track', () => {
    const focus = '003';
    const sheet = (id, title, week) => lesson(id, title, [pose(focus)], htuy, 'Week ' + week);
    const a = sheet(173, 'Day 1', 1), b = sheet(174, 'Day 2 and 4', 1);
    const c = sheet(178, 'Day 1, 3, 5', 2), d = sheet(200, 'Day 1, 3, 5', 6);
    const recovery1 = sheet(177, 'Day 7', 1), recovery2 = sheet(181, 'Day 7', 2);
    const sheets = [recovery2, d, c, b, a, recovery1];
    const hits = findSequencePoseMatches(sheets, [focus]);
    assert.deepEqual(findEarlierLessons(hits, focus, b), []);
    assert.deepEqual(findEarlierLessons(hits, focus, c).map(r => r.sequence), [a, b]);
    const [inScope] = findEarlierLessons(hits, focus, null, sheets, new Map(), new Set([d]));
    assert.equal(inScope.sequence, c);
    assert.equal(inScope.referenceSequence, d);
    assert.match(inScope.reason, /Week 2 · Day 1, 3, 5.*Week 6 · Day 1, 3, 5/);
    assert.deepEqual(findEarlierLessons(hits, focus, recovery2).map(r => [r.sequence, r.orderStatus]), [[recovery1, 'archive']]);
});

test('Gem guidance follows the introductory and annual phases. Two weekly sheets from one year are peers', () => {
    const common = [pose('003')];
    const intro = lesson(361, 'Introductory 3 month Course', common, gem, 'First Year');
    const a = lesson(363, 'Day 1, 5', common, gem, 'First Year');
    const b = lesson(364, 'Day 2', common, gem, 'First Year');
    const c = lesson(369, 'Day 1, 5', common, gem, 'Second Year');
    const hits = findSequencePoseMatches([c, b, a, intro], ['003']);
    assert.deepEqual(findEarlierLessons(hits, '003', intro), []);
    assert.deepEqual(findEarlierLessons(hits, '003', b).map(r => r.sequence), [intro]);
    const results = findEarlierLessons(hits, '003', c);
    assert.deepEqual(results.map(r => r.sequence), [a, b, intro]);
    assert.match(results[0].reason, /First Year · Day 1, 5.*Second Year · Day 1, 5/);
    assert.equal(results[0].evidenceType, 'earlier-occurrence');
});

test('Iyengar Way Course 2 starts with 1 and 2 together. Later numbered sheets compare only in the same letter', () => {
    const sheet = (id, title) => lesson(id, title, [pose('003')], ytiw, 'Course 2');
    const a = sheet(227, '1B (Sitting)'), b = sheet(230, '2A (Standing)');
    const c = sheet(231, '2B (Sitting)'), d = sheet(240, '4A (Standing)');
    const hits = findSequencePoseMatches([a,b,c,d], ['003']);
    assert.deepEqual(findEarlierLessons(hits, '003', c), []);
    assert.deepEqual(findEarlierLessons(hits, '003', d).map(r => r.sequence), [b]);
    assert.equal(findEarlierLessons(hits, '003', d)[0].evidenceType, 'earlier-occurrence');
    const emphasisA = lesson(294, '1 (Standing and Balancing)', [pose('003')], ytiw, 'Course 4');
    const emphasisB = lesson(296, '2 (Sitting)', [pose('003')], ytiw, 'Course 4');
    const emphasis = findSequencePoseMatches([emphasisB, emphasisA], ['003']);
    assert.deepEqual(findEarlierLessons(emphasis, '003', emphasisB), []);
    assert.match(findAuthoredCourses(emphasis, ['003'])[0].lessons[0].guidanceNote, /daily emphasis/);
});

test('Light on Yoga anchors milestone days to their actual week and leaves maintenance references out', () => {
    const values = [pose('003')];
    const before = lesson(160, 'Week 176 to 180', values, loy, 'Course 3');
    const after = lesson(161, 'Week 181 to 190', values, loy, 'Course 3');
    const milestone = lesson(167, 'Weekly Practice Day 1', values, loy, 'Course 3');
    const reference = lesson(113, 'Important Asanas in Course 1', values);
    const hits = findSequencePoseMatches([after, milestone, reference, before], ['003']);
    assert.deepEqual(findEarlierLessons(hits, '003', milestone).map(r => r.sequence), [before]);
    assert.deepEqual(findEarlierLessons(hits, '003', after).map(r => r.sequence), [before]);
    assert.deepEqual(findEarlierLessons(hits, '003', reference), []);
});

test('Iyengar Way teacher advice for later rotations names the month or the review phase', () => {
    const sheet = (id, title, number) => lesson(id, title, [pose('003')], ytiw, 'Course ' + number);
    const one = sheet(227, '1B (Sitting)', 2), two = sheet(231, '2B (Sitting)', 2), three = sheet(235, '3B (Sitting)', 2);
    const first = sheet(273, '1B (Sitting)', 3), second = sheet(277, '2B (Sitting)', 3), third = sheet(281, '3B (Sitting)', 3);
    const hits = findSequencePoseMatches([one, two, three, first, second, third], ['003']);
    const month = findEarlierLessons(hits, '003', three);
    assert.deepEqual(month.map(result => result.sequence), [one, two]);
    assert.ok(month.every(result => result.evidenceLabel === 'Teacher recommendation for month three'));
    assert.match(month[0].reason, /alternate 2B and 3B and revisit 1B/);
    const review = findEarlierLessons(hits, '003', third);
    assert.deepEqual(review.map(result => result.evidenceType), ['teacher-recommended', 'earlier-occurrence']);
    assert.match(review[0].reason, /After completing group 4 and repeating the course/);
    assert.match(review[0].evidenceLabel, /later review/);
});

test('Light on Pranayama recurring mastery and final maintenance days can refer back to the week blocks', () => {
    const values = [pose('203')];
    const before = lesson(72, 'Weeks 76 to 80', values, breath, 'Course 3 (Intermediate)');
    const masterA = lesson(73, 'Weeks 91 to 120: First Week (Monday)', values, breath, 'Course 3 (Mastery Phase)');
    const masterB = lesson(80, 'Weeks 91 to 120: Second Week (Monday)', values, breath, 'Course 3 (Mastery Phase)');
    const end = lesson(106, 'Weeks 196 to 200', values, breath, 'Course 5 (Highly Intense)');
    const mon = lesson(108, 'Weekly Practice - Monday', values, breath, 'Course 5 (Weekly Practice)');
    const tue = lesson(111, 'Weekly Practice - Tuesday', values, breath, 'Course 5 (Weekly Practice)');
    const hits = findSequencePoseMatches([before, masterA, masterB, end, mon, tue], ['203']);
    assert.deepEqual(findEarlierLessons(hits, '203', masterB).map(r => r.sequence), [before]);
    assert.deepEqual(findEarlierLessons(hits, '203', tue).map(r => r.sequence), [end]);
});
