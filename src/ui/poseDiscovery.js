import { parsePoseFilterIds } from '../services/coursePoseIndexService.js';
import { findAuthoredCourses, findEarlierLessons } from '../services/authoredDiscovery.js';
import { getDiscoverySourceOrder, getDiscoverySourceOrderStatus } from '../services/discoverySourceOrder.js';
import { previewDiscoverySequence } from './sequenceViewerStepper.js';

function element(tag, text) {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    return node;
}

function button(text, onClick) {
    const control = element('button', text);
    control.type = 'button';
    control.className = 'tiny';
    control.addEventListener('click', onClick);
    return control;
}

function lessonButton(sequence, label = sequence.title) {
    return button(label, () => previewDiscoverySequence(sequence));
}

function sourceLink(result) {
    const link = element('a', result.sourceRef);
    link.href = result.sourceUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    return link;
}

function targetLabels(targets) {
    const library = new Map();
    for (const pose of Object.values(window.asanaLibrary || {})) {
        const [id] = parsePoseFilterIds([pose.id || pose.asanaNo || '']);
        if (id) library.set(id, library.has(id) ? null : pose);
    }
    const labels = new Map();
    for (const target of targets) {
        const [id, stageId] = target.split('/');
        const pose = library.get(id);
        const stage = stageId && Object.values(pose?.variations || {}).find(item => String(item?.id) === stageId);
        const name = [pose?.english || pose?.iast || pose?.name, stage?.title].filter(Boolean).join(' · ');
        labels.set(target, name ? name + ' (#' + target + ')' : '#' + target);
    }
    return labels;
}

function describeOccurrence(entry) {
    const parts = [entry.kind === 'linked' ? 'Linked' : 'Direct'];
    if (entry.kind === 'linked') {
        const path = entry.path.map(step => (step.title || '#' + step.sequenceId) + ', entry ' + (step.entryIndex + 1));
        parts.push([...path, entry.sourceTitle || '#' + entry.sourceSequenceId].join(' → '));
    }
    parts.push('Entry ' + (entry.entryIndex + 1));
    if (entry.stageTitle || entry.variation || entry.stageId) parts.push(entry.stageTitle || entry.variation || 'Stage #' + entry.stageId);
    if (entry.duration != null) parts.push(entry.duration + ' s in sequence');
    if (entry.tier) parts.push('Tier ' + entry.tier);
    if (entry.duration == null && !entry.tier) parts.push('Asana or variation default');
    return parts.join(' · ');
}

// Limit the initial DOM even when a common pose occurs in hundreds of sequences.
function listResults(container, items, emptyMessage, renderItem) {
    container.replaceChildren();
    if (!items.length) {
        container.append(element('p', emptyMessage));
        return;
    }
    const list = element('ul');
    list.className = 'pose-discovery__list';
    container.append(list);
    let offset = 0;
    const more = button('', () => {
        const previous = list.lastElementChild;
        addPage();
        previous?.nextElementSibling?.querySelector('button, summary')?.focus();
    });
    function addPage() {
        const page = items.slice(offset, offset + 6);
        for (const result of page) list.append(renderItem(result));
        offset += page.length;
        more.textContent = 'Show more (' + (items.length - offset) + ' remaining)';
        more.hidden = offset >= items.length;
    }
    addPage();
    container.append(more);
}

function renderSequence(sequence, match, labels) {
    const row = element('li');
    row.append(lessonButton(sequence));
    if (sequence.category) row.append(element('span', sequence.category));
    const details = element('details');
    details.append(element('summary', match.matchedTargets.map(id => labels.get(id)).join(', ')));
    // The same authored entry can represent both a pose and its selected stage.
    const seen = new Set();
    const list = element('ul');
    for (const occurrence of match.occurrences) {
        const key = JSON.stringify([occurrence.sourceSequenceId, occurrence.entryIndex, occurrence.kind, occurrence.path]);
        if (seen.has(key)) continue;
        seen.add(key);
        list.append(element('li', '#' + occurrence.poseId + ' · ' + describeOccurrence(occurrence)));
    }
    details.append(list);
    row.append(details);
    return row;
}

function renderCourse(course, labels) {
    const row = element('li');
    const details = element('details');
    details.append(element('summary', course.title + ' · ' + course.lessons.length + ' matching lesson' + (course.lessons.length === 1 ? '' : 's')));
    const lessons = element('ul');
    for (const lesson of course.lessons) {
        const item = element('li');
        item.append(lessonButton(lesson.sequence, lesson.displayTitle), element('span', lesson.matchedTargets.map(id => labels.get(id)).join(', ')));
        lessons.append(item);
    }
    details.append(lessons);
    if (course.sourceUrl) details.append(sourceLink(course));
    row.append(details);
    return row;
}

function renderSuggestion(suggestion) {
    const row = element('li');
    row.append(lessonButton(suggestion.sequence), element('span', suggestion.courseTitle));
    row.append(element('strong', suggestion.evidenceLabel));
    row.append(element('p', suggestion.reason));
    row.append(sourceLink(suggestion));
    return row;
}

function renderLearning({ allMatches, visibleMatches, allCourses, collectionCourses }, focusTarget, previousLesson) {
    const results = document.getElementById('poseLearningResults');
    const select = document.getElementById('poseReferenceLesson');
    const field = document.getElementById('poseReferenceField');
    const status = document.getElementById('poseOrderStatus');
    const order = getDiscoverySourceOrder();
    const state = getDiscoverySourceOrderStatus();
    const messages = {
        loading: 'Checking the saved book order…',
        cached: 'Using the book order saved on this device.',
        unavailable: 'The saved book order is unavailable. Guidance uses the archived source mapping where possible.',
    };
    status.textContent = messages[state] || '';
    status.hidden = !status.textContent;
    if (state === 'loading' && !order.size) {
        field.hidden = true;
        select.onchange = null;
        results.replaceChildren();
        return;
    }
    const choices = new Map();
    const anchorScope = new Set(collectionCourses);
    const courses = findAuthoredCourses(visibleMatches, [focusTarget], 'any', order);
    select.replaceChildren(new Option('Across courses', ''));
    for (const course of courses) {
        const group = document.createElement('optgroup');
        group.label = course.title;
        const multipleSections = new Set(course.lessons.map(lesson => lesson.section)).size > 1;
        for (const lesson of course.lessons) {
            if (!lesson.eligibleForGuidance || !lesson.occurrences.some(hit => hit.kind === 'direct')) continue;
            const id = String(lesson.sequence.supabaseId ?? lesson.sequence.id);
            choices.set(id, lesson);
            group.append(new Option(multipleSections ? lesson.section + ' · ' + lesson.title : lesson.title, id));
        }
        if (group.childElementCount) select.append(group);
    }
    field.hidden = choices.size === 0;
    if (!field.hidden && choices.has(previousLesson)) select.value = previousLesson;
    const show = () => {
        const reference = choices.get(select.value);
        const suggestions = findEarlierLessons(allMatches, focusTarget, reference?.sequence, allCourses, order, anchorScope);
        const emptyMessage = 'No earlier lesson with a documented connection to this focus pose was found here.';
        listResults(results, suggestions, emptyMessage, renderSuggestion);
        if (!suggestions.length) {
            const lessons = reference ? [reference] : courses.flatMap(course => course.lessons);
            const notes = new Set(lessons.map(lesson => lesson.guidanceNote).filter(Boolean));
            if (notes.size === 1) results.append(element('p', [...notes][0]));
        }
    };
    select.onchange = show;
    show();
}

export function renderDiscoveryResults({ targets, mode, visibleMatches, collectionCourses, allMatches, allCourses, sequenceHits, outside, filter, renderCourseUI }) {
    const panel = document.getElementById('poseDiscovery');
    const status = document.getElementById('poseSequenceFilterStatus');
    if (!panel || !status) return;
    const focus = document.getElementById('poseLearningFocus');
    const sequenceResults = document.getElementById('poseSequenceResults');
    const courseResults = document.getElementById('poseCourseResults');
    const learningResults = document.getElementById('poseLearningResults');
    const reference = document.getElementById('poseReferenceLesson');
    panel.hidden = targets.length === 0;
    status.replaceChildren();
    if (panel.hidden) {
        for (const node of [sequenceResults, courseResults, learningResults, focus, reference]) node.replaceChildren();
        focus.onchange = null;
        reference.onchange = null;
        return;
    }
    const labels = targetLabels(targets);
    const collection = !filter?.value || filter.value === 'ALL' ? 'all collections' : filter.value;
    const match = targets.length === 1 ? 'pose ' : (mode === 'all' ? 'all of poses ' : 'any of poses ');
    const count = sequenceHits.length;
    status.textContent = count + ' sequence' + (count === 1 ? ' contains ' : 's contain ') + match + targets.join(', ') + ' in ' + collection + '.';
    if (navigator.onLine === false || window.isTrustedOfflineMode) status.append(' Searching downloaded sequences.');
    if (outside) {
        const showAll = button('Show all collections', () => {
            filter.value = 'ALL';
            renderCourseUI();
            document.getElementById('sequenceSelect')?.focus();
        });
        status.append(' ' + outside + ' more in other collections. ', showAll);
    }
    listResults(sequenceResults, sequenceHits, 'No sequence here contains ' + match + targets.join(', ') + '.',
        sequence => renderSequence(sequence, visibleMatches.get(sequence), labels));
    const courses = findAuthoredCourses(visibleMatches, targets, mode, getDiscoverySourceOrder());
    const matchAll = mode === 'all' && targets.length > 1;
    document.getElementById('poseCourseMatchInfo').hidden = !matchAll;
    const emptyCourses = matchAll ? 'No book course here includes all the selected poses across its lessons.'
        : 'No book course here matches the selected poses.';
    listResults(courseResults, courses, emptyCourses, course => renderCourse(course, labels));
    const previous = focus.value;
    focus.replaceChildren(...targets.map(id => new Option(labels.get(id), id)));
    if (targets.includes(previous)) focus.value = previous;
    const scope = { allMatches, visibleMatches, allCourses, collectionCourses };
    focus.onchange = () => renderLearning(scope, focus.value, '');
    renderLearning(scope, focus.value, previous === focus.value ? reference.value : '');
}
