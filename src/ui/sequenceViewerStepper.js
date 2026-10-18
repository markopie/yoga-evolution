import { builderState } from '../store/builderState.js';
import { builderOpen } from './builder.js';

let viewedIndex = null;
let startIndex = null;
let stepper = null;

const courseKey = (course) => String(course?.supabaseId ?? course?.id ?? '');

function isAvailable() {
    const inCurriculum = !!window.currentCurriculumPractice?.curriculum_node_id;
    const view = document.body.dataset.appView || 'practice';
    return !inCurriculum && view === 'practice';
}

// Siblings follow the dropdown exactly (same collection group, same order, same active filters),
// so whatever is browsed here can always be selected on the main page afterwards.
function siblingIndices(idx) {
    const option = document.querySelector(`#sequenceSelect option[value="${idx}"]`);
    const group = option?.parentElement;
    if (!group || group.tagName !== 'OPTGROUP') return [];
    return Array.from(group.querySelectorAll('option')).map(opt => Number(opt.value));
}

function resolveCourse(idx) {
    const course = window.courses?.[idx];
    if (!course?.is_alias) return course;
    const master = (window.courses || []).find(c => courseKey(c) === String(course.redirect_id));
    if (!master) return course;
    return { ...course, poses: master.poses, sequence_json: master.sequence_json, playbackMode: master.playbackMode };
}

function ensureStepper() {
    if (stepper) return stepper;
    const header = document.getElementById('viewModeHeader');
    if (!header) return null;
    stepper = document.createElement('div');
    stepper.className = 'sequence-viewer-stepper';
    stepper.innerHTML = `
        <button type="button" class="sequence-viewer-stepper__btn" data-step="-1" aria-label="Previous sequence in this collection">‹ Prev</button>
        <span class="sequence-viewer-stepper__count" aria-live="polite"></span>
        <button type="button" class="sequence-viewer-stepper__btn" data-step="1" aria-label="Next sequence in this collection">Next ›</button>`;
    stepper.addEventListener('click', (event) => {
        const btn = event.target.closest('button[data-step]');
        if (btn && !btn.disabled) step(Number(btn.dataset.step), btn);
    });
    header.append(stepper);
    return stepper;
}

function render() {
    const el = ensureStepper();
    if (!el) return;
    const siblings = viewedIndex === null ? [] : siblingIndices(viewedIndex);
    const pos = siblings.indexOf(viewedIndex);
    if (!isAvailable() || pos < 0 || siblings.length < 2) {
        el.hidden = true;
        return;
    }
    el.hidden = false;
    el.querySelector('.sequence-viewer-stepper__count').textContent = `${pos + 1} of ${siblings.length}`;
    el.querySelector('[data-step="-1"]').disabled = pos === 0;
    el.querySelector('[data-step="1"]').disabled = pos === siblings.length - 1;
}

function step(offset, button) {
    const siblings = siblingIndices(viewedIndex);
    const target = siblings[siblings.indexOf(viewedIndex) + offset];
    const course = target === undefined ? null : resolveCourse(target);
    if (!course) return;
    const opener = builderState.opener;
    builderOpen('edit', course);
    builderState.opener = opener;
    viewedIndex = target;
    render();
    // builderOpen moves focus to the search box; keep it on the stepper for repeated browsing.
    setTimeout(() => { if (!button.disabled) button.focus(); }, 60);
}

function onBuilderOpened(event) {
    const { mode, seq, alreadyOpen } = event.detail || {};
    if (!alreadyOpen) {
        const sel = document.getElementById('sequenceSelect');
        startIndex = sel?.value ? Number(sel.value) : null;
    }
    if (mode !== 'edit' || !seq) {
        viewedIndex = null;
    } else if (!alreadyOpen) {
        const idx = (window.courses || []).findIndex(c => courseKey(c) === courseKey(seq));
        viewedIndex = idx >= 0 ? idx : null;
    }
    render();
}

function switchMainSequence(idx) {
    const sel = document.getElementById('sequenceSelect');
    if (!sel) return;
    if (typeof window.stopTimer === 'function') window.stopTimer();
    if (typeof window.saveCurrentProgress === 'function') window.saveCurrentProgress();
    sel.value = String(idx);
    sel.dispatchEvent(new Event('change'));
}

function isSessionActive() {
    return (window.playbackEngine && window.playbackEngine.activePracticeSeconds > 5)
        || (window.currentIndex || 0) > 0
        || (typeof window.getCompletionTracker === 'function'
            && Object.values(window.getCompletionTracker()).some(v => v > 0));
}

export function setupSequenceViewerStepper() {
    window.addEventListener('yoga:builder-opened', onBuilderOpened);
}

// Called when the viewer closes: if the user browsed to a different sequence, open it on the
// main page once (showing its "Before You Begin" briefing there, not on every step).
export function finishSequenceBrowsing() {
    const target = viewedIndex;
    const changed = target !== null && target !== startIndex && isAvailable();
    viewedIndex = null;
    startIndex = null;
    if (stepper) stepper.hidden = true;
    if (!changed) return;
    if (isSessionActive() && typeof window.showConflictModal === 'function') {
        window.showConflictModal(() => switchMainSequence(target), () => {});
    } else {
        switchMainSequence(target);
    }
}
