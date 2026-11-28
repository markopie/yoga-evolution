// src/ui/coachUI.js — Daily AI coach check-in card on the Practice screen.
import {
    coachUnavailableReason,
    requestCoachRecommendation,
    submitCoachFeedback,
    saveLocalRecommendation,
    loadLocalRecommendation,
} from '../services/coachService.js';

const CHECK_IN_KEY = 'yogaCoachCheckInToday';
const DISMISS_KEY = 'yogaCoachDismissedUntil';

const CHECK_IN_OPTIONS = {
    energy: ['High', 'Moderate', 'Low'],
    soreness: ['None', 'Mild', 'Significant'],
    focus: ['Energize', 'Relax', 'Focus'],
};

function todayKey() {
    return new Date().toISOString().slice(0, 10);
}

function byId(id) { return document.getElementById(id); }

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
}

function loadCheckIn() {
    try {
        const saved = JSON.parse(localStorage.getItem(CHECK_IN_KEY) || 'null');
        return saved && saved.date === todayKey() ? saved.answers : null;
    } catch { return null; }
}

function saveCheckIn(answers) {
    try {
        localStorage.setItem(CHECK_IN_KEY, JSON.stringify({ date: todayKey(), answers }));
    } catch { /* best effort */ }
}

function dismissedToday() {
    try {
        return Number(localStorage.getItem(DISMISS_KEY) || 0) > Date.now();
    } catch { return false; }
}

function renderCheckInForm(container, existing) {
    container.replaceChildren();
    const answers = { ...existing };

    const heading = el('h3', 'coach-card__title', 'How are you feeling today?');
    heading.id = 'coachCheckInHeading';
    container.append(heading);

    for (const [question, options] of Object.entries(CHECK_IN_OPTIONS)) {
        const fieldset = el('div', 'coach-card__question');
        fieldset.append(el('span', 'coach-card__question-label', question[0].toUpperCase() + question.slice(1)));
        const group = el('div', 'coach-card__options');
        for (const option of options) {
            const button = el('button', 'coach-chip', option);
            button.type = 'button';
            button.setAttribute('aria-pressed', answers[question] === option ? 'true' : 'false');
            if (answers[question] === option) button.classList.add('coach-chip--active');
            button.addEventListener('click', () => {
                answers[question] = answers[question] === option ? undefined : option;
                group.querySelectorAll('.coach-chip').forEach((chip) => {
                    const isActive = chip.textContent === answers[question];
                    chip.classList.toggle('coach-chip--active', isActive);
                    chip.setAttribute('aria-pressed', isActive ? 'true' : 'false');
                });
            });
            group.append(button);
        }
        fieldset.append(group);
        container.append(fieldset);
    }

    const status = el('p', 'coach-card__status');
    status.id = 'coachStatus';
    status.setAttribute('role', 'status');
    status.hidden = true;

    const actions = el('div', 'coach-card__actions');
    const submit = el('button', 'coach-card__primary', 'Get my practice suggestion');
    submit.type = 'button';
    const skip = el('button', 'coach-card__secondary', 'Not now');
    skip.type = 'button';

    submit.addEventListener('click', () => void onSubmit({ container, answers, status, submit }));
    skip.addEventListener('click', () => {
        try { localStorage.setItem(DISMISS_KEY, String(Date.now() + 12 * 60 * 60 * 1000)); } catch { /* ignore */ }
        container.hidden = true;
    });

    actions.append(submit, skip);
    container.append(status, actions);
}

async function onSubmit({ container, answers, status, submit }) {
    const reason = coachUnavailableReason();
    if (reason) {
        status.textContent = reason;
        status.hidden = false;
        return;
    }
    submit.disabled = true;
    status.textContent = 'Your coach is picking today\u2019s practice\u2026';
    status.hidden = false;
    try {
        saveCheckIn(answers);
        const payload = await requestCoachRecommendation({
            energy: answers.energy || 'not reported',
            soreness: answers.soreness || 'none reported',
            focus: answers.focus || 'not reported',
        });
        if (!payload || !Array.isArray(payload.recommended_sessions) || !payload.recommended_sessions.length) {
            throw new Error('The coach could not find a suitable class today.');
        }
        saveLocalRecommendation(payload);
        renderRecommendation(container, payload);
    } catch (error) {
        status.textContent = error?.message || 'The coach is unavailable right now. Please try again later.';
    } finally {
        submit.disabled = false;
    }
}

function renderRecommendation(container, payload) {
    container.replaceChildren();

    const header = el('div', 'coach-card__header');
    const badge = el('span', 'coach-card__badge', payload.model_used === 'fallback' ? 'Coach picks' : 'AI coach');
    const dismiss = el('button', 'coach-card__dismiss', 'Dismiss');
    dismiss.type = 'button';
    dismiss.addEventListener('click', () => {
        try { localStorage.setItem(DISMISS_KEY, String(Date.now() + 12 * 60 * 60 * 1000)); } catch { /* ignore */ }
        container.hidden = true;
    });
    header.append(badge, dismiss);
    container.append(header);

    container.append(el('p', 'coach-card__message', payload.coach_message));

    const list = el('div', 'coach-card__sessions');
    for (const session of payload.recommended_sessions.slice(0, 3)) {
        const card = el('div', 'coach-session');
        const title = el('div', 'coach-session__title', session.title || `Class ${session.course_id}`);
        const reason = el('p', 'coach-session__reason', session.reason || '');
        card.append(title, reason);
        if (session.modification_tip) {
            card.append(el('p', 'coach-session__tip', `Tip: ${session.modification_tip}`));
        }
        const open = el('button', 'coach-session__open', 'Open class');
        open.type = 'button';
        open.addEventListener('click', () => openCourse(String(session.course_id)));
        card.append(open);
        list.append(card);
    }
    container.append(list);

    const feedbackRow = el('div', 'coach-card__feedback');
    const prompt = el('span', 'coach-card__feedback-label', 'Was this helpful?');
    const up = el('button', 'coach-thumb', 'Helpful');
    up.type = 'button';
    const down = el('button', 'coach-thumb', 'Not for me');
    down.type = 'button';
    const done = () => {
        up.disabled = true; down.disabled = true;
        up.classList.add('coach-thumb--chosen');
    };
    up.addEventListener('click', () => { void submitCoachFeedback(payload.id, payload.traceId, 1); done(); });
    down.addEventListener('click', () => { void submitCoachFeedback(payload.id, payload.traceId, -1); done(); });
    feedbackRow.append(prompt, up, down);
    container.append(feedbackRow);
}

function openCourse(courseId) {
    const courses = window.courses || [];
    const index = courses.findIndex((c) => String(c.supabaseId ?? c.id) === String(courseId));
    if (index === -1) {
        window.navigateApp?.('practice');
        return;
    }
    const sel = document.getElementById('sequenceSelect');
    if (!sel) return;
    sel.value = String(index);
    sel.dispatchEvent(new Event('change'));
    window.navigateApp?.('practice');
    const workspace = document.getElementById('practiceWorkspace');
    if (workspace) workspace.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export function setupCoachUI() {
    const host = byId('coachCheckInCard');
    if (!host) return;

    const card = el('section', 'coach-card');
    card.setAttribute('aria-labelledby', 'coachCheckInHeading');
    host.append(card);
    card.hidden = false;

    const existing = loadCheckIn();
    const cached = loadLocalRecommendation();

    if (existing && cached) {
        renderRecommendation(card, cached);
    } else if (existing) {
        renderCheckInForm(card, existing);
    } else {
        renderCheckInForm(card, null);
    }

    if (dismissedToday()) card.hidden = true;

    // Re-show the card for a new day of check-ins.
    window.addEventListener('focus', () => {
        if (!dismissedToday() && card.hidden && !loadCheckIn()) card.hidden = false;
    });
    window.addEventListener('yoga:verified-session', () => {
        if (window.currentUserId && !dismissedToday()) card.hidden = false;
    });
}
