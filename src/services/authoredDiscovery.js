import { authoredCourseSections } from '../config/authoredCourseSources.js';

const sourceGuide = './course-sources.html#';

const lessonsById = new Map();
for (const section of authoredCourseSections) {
    for (const [id, title, position, role] of section.lessons) {
        lessonsById.set(String(id), { section, title, position, role });
    }
}

const fold = value => String(value ?? '').trim().normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const byTitle = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
// The archived builder encoded different things in the same integer. Keep a
// separate comparable period and track. For example, 4A–4D share a period
// and consecutive months can be compared within their standing or sitting track.
const gemPhases = ['gem_introductory', 'gem_first_year', 'gem_second_year', 'gem_third_year'];
const milestoneWeeks = [30, 78, 180, 300];
const teachingNotes = {
    maintenance_reference: 'This is a reference list of important asanas. The source assigns it no week of introduction.',
    one_time_milestone_day: 'This is a one-time milestone. Earlier practice comes from blocks before the milestone week.',
    monthly_rotation_member: 'Groups 1 and 2 start together. Later groups revisit earlier numbers within each letter. Only part of the monthly rotation is documented.',
    rotation_and_repeat_member: 'These lessons rotate and repeat. Earlier matches use a lower numbered group with the same letter.',
    daily_emphasis: 'These six lesson sheets rotate by daily emphasis. The source gives no within-course progression between sheets.',
    annual_daily_sheet: 'These days rotate throughout the year. Earlier practice comes from an earlier phase of this book.',
    introductory_template: 'This introductory course has one practice template and no earlier phase in the book.',
    source_recovery_day: 'This is a recovery day. Earlier matches are restricted to recovery practice.',
    title_addressed_days: 'Day sheets can recur during the same week. Earlier practice comes from an earlier source week.',
    three_week_mastery_weekday: 'These weekday practices repeat through a three-week consolidation cycle. Earlier matches come from before that cycle.',
    open_ended_weekly_template: 'These maintenance days repeat each week. Earlier matches come from the preceding course blocks.',
};

function bookPeriod(section, role, position) {
    const group = section.id;
    let series = group, period = position, track = '';
    if (gemPhases.includes(group)) {
        // Gem's numeric position incorporates its parent catalogue ID and stage.
        // GEM_OVERVIEW supplies the actual phase order for the annual day sheets.
        series = 'gem';
        period = gemPhases.indexOf(group);
    } else if (section.sourceKey === 'how_to_use_yoga') {
        series = 'htuy';
        period = Math.floor(position / 100);
    } else if (role === 'monthly_rotation_member' || role === 'rotation_and_repeat_member') {
        period = Math.floor(position / 10);
        // The first month of Course II pairs groups 1 and 2 from the outset.
        if (role === 'monthly_rotation_member' && period === 1) period = 2;
        track = String.fromCharCode(64 + position % 10);
    } else if (role === 'daily_emphasis') {
        period = 0;
    } else if (role === 'one_time_milestone_day') {
        // The sorting key puts all milestones at the end, including the
        // Course 3 block that occurs after week 180 rather than after week 300.
        const block = Math.floor((position - 90000) / 1000);
        period = milestoneWeeks[block] * 100 + 1;
    } else if (role === 'three_week_mastery_weekday') {
        period = Math.floor(position / 1000) * 1000;
    } else if (role === 'open_ended_weekly_template') {
        period = 1000000;
    }
    if (role === 'source_recovery_day') track = 'recovery';
    return { series, period, track };
}

function verifiedLesson(sequence, sourceOrder) {
    if (sequence.isSystem !== true || sequence.is_alias || sequence.redirect_id != null) return null;
    const id = String(sequence.supabaseId ?? sequence.id);
    const lesson = lessonsById.get(id);
    if (!lesson || sequence.title !== lesson.title) return null;
    const [category, subcategory] = String(sequence.category || '').split('>');
    const { section, role } = lesson;
    if (fold(sequence.categoryName || category) !== fold(section.source)
        || fold(sequence.subCategoryName || subcategory) !== fold(section.section)) return null;

    const saved = sourceOrder?.get(id);
    const conflict = saved && (saved.conflict || saved.position !== lesson.position
        || saved.sourceKey !== section.sourceKey || fold(saved.sourceCourse) !== fold(section.section));
    const orderStatus = conflict ? 'conflict' : saved ? 'stored' : 'archive';
    const position = conflict ? null : (saved?.position ?? lesson.position);
    const displayTitle = ['how_to_use_yoga', 'yoga_a_gem_for_women'].includes(section.sourceKey)
        ? section.section + ' · ' + lesson.title : lesson.title;
    return {
        sequence, title: lesson.title, displayTitle, section: section.section, courseId: section.id, role,
        sourceKey: section.sourceKey,
        position, orderStatus, eligibleForGuidance: position != null && role !== 'maintenance_reference',
        ...bookPeriod(section, role, position ?? lesson.position),
        guidanceNote: conflict ? 'The saved source order disagrees with the reviewed mapping for this lesson.'
            : teachingNotes[role] || '',
    };
}

/** Use partial sequence matches so different lessons of one book course can satisfy ALL. */
export function findAuthoredCourses(sequenceMatches, targets, mode = 'any', sourceOrder = null) {
    const selected = [...new Set(targets)];
    if (!selected.length) return [];
    const courses = new Map();
    for (const [sequence, match] of sequenceMatches) {
        const lesson = verifiedLesson(sequence, sourceOrder);
        if (!lesson) continue;
        const matchedTargets = selected.filter(target => match.matchedTargets.includes(target));
        if (!matchedTargets.length) continue;
        const { section } = lessonsById.get(String(sequence.supabaseId ?? sequence.id));
        if (!courses.has(section.id)) {
            courses.set(section.id, {
                id: section.id, title: section.source + ' · ' + section.course,
                sourceRef: 'View the course lesson list', sourceUrl: sourceGuide + 'map-' + section.id, lessons: [],
            });
        }
        courses.get(section.id).lessons.push({
            ...lesson, matchedTargets, occurrences: match.occurrences.filter(hit => matchedTargets.includes(hit.target)),
        });
    }

    const results = [];
    for (const course of courses.values()) {
        const coverage = new Set(course.lessons.flatMap(lesson => lesson.matchedTargets));
        if (String(mode).toLowerCase() === 'all' && coverage.size !== selected.length) continue;
        course.lessons.sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity)
            || byTitle.compare(a.section, b.section) || byTitle.compare(a.title, b.title));
        results.push({ ...course, matchedTargets: selected.filter(target => coverage.has(target)) });
    }
    return results.sort((a, b) => byTitle.compare(a.title, b.title));
}

function entryDescription(occurrence) {
    const label = occurrence.stageTitle || occurrence.variation;
    const stage = occurrence.stageId ? ' (variation #' + occurrence.stageId + (label ? ', ' + label : '') + ')' : '';
    return '#' + occurrence.poseId + stage + ' at entry ' + (occurrence.entryIndex + 1);
}

function explicitLessonAdvice(earlier, later) {
    if (later.sourceKey !== 'yoga_the_iyengar_way') return null;
    const adjacent = later.position - earlier.position === 10;
    if (later.courseId === 'ytiw_course_1' && adjacent) {
        return { course: 'I', reason: 'The authors recommend alternating ' + earlier.title + ' and ' + later.title + '.' };
    }
    if (earlier.track !== later.track) return null;
    const earlierGroup = Math.floor(earlier.position / 10);
    if (later.courseId === 'ytiw_course_2' && later.period === 3 && [1, 2].includes(earlierGroup)) {
        const lane = later.track;
        return { course: 'II', page: 177, label: 'Teacher recommendation for month three', reason: 'In month three, the authors alternate 2' + lane + ' and 3' + lane
            + ' and revisit 1' + lane + ' in the same ' + lane + ' rotation.' };
    }
    if (later.courseId === 'ytiw_course_3' && adjacent) {
        return { course: 'III', page: 181, label: 'Teacher recommendation for the later review', reason: 'After completing group 4 and repeating the course, the authors review groups '
            + earlierGroup + ' and ' + later.period + ' together across A–D. These two lessons share the ' + later.track + ' group.' };
    }
    return null;
}

function earlierSuggestion(course, earlier, later) {
    const advice = explicitLessonAdvice(earlier, later);
    const observed = (earlier.hit ? earlier.displayTitle + ' includes ' + entryDescription(earlier.hit) + '. ' : '')
        + later.displayTitle + ' includes ' + entryDescription(later.hit) + '.';
    const reasons = [];
    if (advice) reasons.push(advice.reason);
    else if (later.series === 'gem') reasons.push('The book places this practice in a preceding phase of its course.');
    else if (later.series === 'htuy') reasons.push('The earlier sheet belongs to a preceding week in this book.');
    else if (later.track && later.track !== 'recovery') reasons.push('This is a lower-numbered lesson in the same '
        + later.track + ' rotation. The book revisits these lessons.');
    else if (later.role === 'one_time_milestone_day') reasons.push('This week block precedes the selected milestone.');
    else if (later.role === 'three_week_mastery_weekday' || later.role === 'open_ended_weekly_template')
        reasons.push('This week block precedes the selected rotation.');
    reasons.push(observed);
    const orderStatus = earlier.orderStatus === later.orderStatus ? later.orderStatus : 'mixed';
    const orderNote = orderStatus === 'stored' ? 'Both source positions are recorded in Supabase.'
        : orderStatus === 'archive' ? 'Both source positions come from the archived course mapping.'
            : (earlier.orderStatus === 'archive' ? earlier.displayTitle : later.displayTitle)
              + ' uses the archived source position. The other lesson uses its saved Supabase position.';
    const source = advice ? {
        sourceRef: 'Silva, Mira and Shyam Mehta, Yoga: The Iyengar Way, Appendix, Course ' + advice.course
            + ', “Suggested Scheme of Practice”' + (advice.page ? ', p. ' + advice.page : ''),
        sourceUrl: sourceGuide + later.courseId,
    }
        : { sourceRef: 'Book practice scheme', sourceUrl: sourceGuide + later.sourceKey };
    return {
        courseTitle: course.title, sequence: earlier.sequence, referenceSequence: later.sequence,
        evidenceType: advice ? 'teacher-recommended' : 'earlier-occurrence',
        evidenceLabel: advice?.label || (advice ? 'Teacher recommendation' : 'Observed earlier practice'),
        orderStatus, orderNote, reason: [...reasons, orderNote].join(' '), ...source,
    };
}

function earlierMatches(later, lessons, pairedLessons) {
    const earlier = lessons.filter(candidate => candidate.series === later.series && candidate.period < later.period
        && candidate.track === later.track && candidate.role !== 'one_time_milestone_day')
        .sort((a, b) => b.period - a.period || a.position - b.position);
    if (later.courseId === 'ytiw_course_1') {
        const paired = pairedLessons.get(later.position - 10);
        if (paired && !earlier.some(lesson => lesson.position === paired.position)) earlier.unshift(paired);
    }
    return earlier;
}

/** Source-specific earlier practice for one focus. Course filters constrain the reference lesson. */
export function findEarlierLessons(sequenceMatches, focusTarget, referenceSequence = null, visibleCourses = [], sourceOrder = null, anchorScope = null) {
    if (typeof focusTarget !== 'string' || !focusTarget || focusTarget.includes(',')) return [];
    const courses = findAuthoredCourses(sequenceMatches, [focusTarget], 'any', sourceOrder);
    const directLessons = [];
    for (const course of courses) {
        for (const lesson of course.lessons) {
            const hit = lesson.occurrences.find(entry => entry.kind === 'direct');
            if (lesson.eligibleForGuidance && hit) directLessons.push({ ...lesson, hit });
        }
    }

    // A cited pair in the Mehtas' first course can support reviewing a lesson
    // even if only its partner contains the target. Presence still requires an entry.
    const pairedLessons = new Map();
    for (const course of visibleCourses) {
        const lesson = verifiedLesson(course, sourceOrder);
        if (lesson?.courseId === 'ytiw_course_1' && lesson.eligibleForGuidance) pairedLessons.set(lesson.position, lesson);
    }
    const suggestions = [];
    for (const course of courses) {
        for (const later of directLessons) {
            if (later.courseId !== course.id || (referenceSequence && referenceSequence !== later.sequence)
                || (!referenceSequence && anchorScope && !anchorScope.has(later.sequence))) continue;
            const earlier = earlierMatches(later, directLessons, pairedLessons);
            if (!earlier.length) continue;
            for (const candidate of referenceSequence ? earlier : earlier.slice(0, 1)) {
                suggestions.push(earlierSuggestion(course, candidate, later));
            }
            // Without a selected reference, present one explainable example per course.
            break;
        }
    }
    return suggestions;
}
