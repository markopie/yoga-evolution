import { $ } from '../utils/dom.js';
import { openCurriculumRoadmap, restoreRoadmapState } from './curriculumRoadmapUI.js';

const getCurrentSequence = () => window.currentSequence;
const getServerHistoryCache = () => window.serverHistoryCache;
const fetchServerHistory = () => window.fetchServerHistory ? window.fetchServerHistory() : Promise.resolve([]);
const calculateStreak = (arr) => window.calculateStreak ? window.calculateStreak(arr) : 0;

const histBackdrop = $('historyBackdrop');
const historyDialog = histBackdrop?.querySelector('[role="dialog"]');
const historyCloseBtn = $('historyCloseBtn');
const tabCurrent = $('histTabCurrent');
const tabManual = $('histTabManual');
const tabCurriculum = $('histTabCurriculum');
const viewCurrent = $('histViewCurrent');
const viewManual = $('histViewManual');
const viewCurriculum = $('histViewCurriculum');
const viewLabel = $('historyViewLabel');
let historyOpener = null;

function getDefaultHistoryTab() {
    return window.currentCurriculumPractice?.curriculum_node_id != null ? 'curriculum' : 'current';
}

function closeHistoryModal() {
    if (!histBackdrop) return;
    console.info('[completion-flow] progress-close', {
        clearPracticeOnClose: histBackdrop.dataset.clearPracticeOnClose === 'true',
        sequence: window.currentSequence?.title || null,
    });
    histBackdrop.style.display = 'none';
    document.body.classList.remove('modal-open');
    if (histBackdrop.dataset.clearPracticeOnClose === 'true') {
        if (typeof window.clearActivePracticeAfterCompletion === 'function') {
            window.clearActivePracticeAfterCompletion();
        } else {
            window.exitCurriculumPractice?.();
        }
        delete histBackdrop.dataset.clearPracticeOnClose;
    }
    restoreRoadmapState();
    if (historyOpener instanceof HTMLElement) historyOpener.focus();
}

function switchHistoryTab(mode) {
    const isCurriculum = mode === 'curriculum';
    const isCurrent = mode === 'current' || mode === 'manual';
    tabCurrent?.classList.toggle('active', isCurrent);
    tabManual?.classList.toggle('active', mode === 'manual');
    tabCurriculum?.classList.toggle('active', isCurriculum);
    tabCurrent?.setAttribute('aria-selected', String(isCurrent));
    tabManual?.setAttribute('aria-selected', String(mode === 'manual'));
    tabCurriculum?.setAttribute('aria-selected', String(isCurriculum));
    viewLabel && (viewLabel.textContent = isCurrent ? 'Practice history' : 'Curriculum');
    if (viewCurrent) viewCurrent.style.display = isCurrent ? 'block' : 'none';
    if (viewManual) viewManual.style.display = 'none';
    if (viewCurriculum) viewCurriculum.style.display = isCurriculum ? 'block' : 'none';
    if (isCurrent) renderGlobalHistory('manual');
    if (isCurriculum) void openCurriculumRoadmap({ embedded: true });
}

historyCloseBtn?.addEventListener('click', closeHistoryModal);
histBackdrop?.addEventListener('click', (event) => {
    if (event.target === histBackdrop) closeHistoryModal();
});
tabCurrent?.addEventListener('click', () => switchHistoryTab('current'));
tabManual?.addEventListener('click', () => switchHistoryTab('manual'));
tabCurriculum?.addEventListener('click', () => switchHistoryTab('curriculum'));

document.addEventListener('keydown', (event) => {
    if (!histBackdrop || histBackdrop.style.display === 'none') return;
    if (event.key === 'Escape') {
        event.preventDefault();
        closeHistoryModal();
        return;
    }
    if (event.key !== 'Tab' || !historyDialog) return;
    const focusable = [...historyDialog.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
    }
});

function formatDate(entry) {
    const date = new Date(entry.ts);
    return Number.isNaN(date.getTime()) ? entry.local || 'Unknown date' : `${date.toLocaleDateString('en-AU')} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

function formatDetails(entry) {
    const details = [];
    const duration = Number(entry.duration_seconds);
    const manuallyConfirmed = /manually confirmed completion outside the app/i.test(entry.notes || '');
    if (manuallyConfirmed) {
        details.push('Completed outside the app');
    } else if (Number.isFinite(duration) && duration >= 60) {
        details.push(`${Math.round(duration / 60)} min`);
    } else if (Number.isFinite(duration) && duration > 0) {
        details.push('Under 1 min');
    }
    if (entry.status) details.push(entry.status);
    if (entry.rating !== null && entry.rating !== undefined && entry.rating !== '') details.push(`Rating: ${entry.rating}`);
    return details.join(' · ');
}

function activePracticePercent() {
    const poses = typeof window.getActivePlaybackList === 'function'
        ? window.getActivePlaybackList()
        : (window.activePlaybackList || window.currentSequence?.poses || []);
    const tracker = typeof window.getCompletionTracker === 'function' ? window.getCompletionTracker() : {};
    const total = poses.reduce((sum, pose) => sum + Number(pose?.[1] || 0), 0);
    const completed = poses.reduce((sum, pose, index) => sum + Math.min(total ? Number(tracker?.[index] || 0) : 0, Number(pose?.[1] || 0)), 0);
    return total > 0 ? Math.round((completed / total) * 100) : null;
}

async function openHistoryModal(defaultTab = null, { clearPracticeOnClose = false, completedPractice = null } = {}) {
    if (!histBackdrop) return;
    historyOpener = document.activeElement;
    const selectedTab = ['current', 'manual', 'curriculum'].includes(defaultTab)
        ? defaultTab
        : getDefaultHistoryTab();
    if (selectedTab === 'current' && (getServerHistoryCache() === null || getServerHistoryCache() === undefined)) await fetchServerHistory();
    const completionNotice = $('historyCompletionNotice');
    if (completionNotice) {
        const completedTitle = completedPractice?.title || '';
        const sourceLabel = completedPractice?.sourceType === 'curriculum' ? 'Curriculum sequence' : 'Manual practice';
        completionNotice.hidden = !completedTitle;
        const ratingText = completedPractice?.rating ? ` · Rating: ${completedPractice.rating}/5` : '';
        completionNotice.textContent = completedTitle
            ? `Completed ${sourceLabel}: ${completedTitle}${ratingText}`
            : '';
    }

    histBackdrop.style.display = 'flex';
    document.body.classList.add('modal-open');
    histBackdrop.dataset.clearPracticeOnClose = clearPracticeOnClose ? 'true' : 'false';
    switchHistoryTab(selectedTab);
    historyCloseBtn?.focus();
}

function renderGlobalHistory(scope = 'manual', highlightTitle = getCurrentSequence()?.title || '') {
    const container = $('globalHistoryList');
    if (!container) return;
    container.innerHTML = '';
    const allEntries = getServerHistoryCache() || [];
    const entries = scope === 'manual'
        ? allEntries.filter((entry) => entry.source_type !== 'curriculum')
        : allEntries;
    const activePercent = highlightTitle ? activePracticePercent() : null;
    const hasActiveHistory = entries.some((entry) => entry.title === highlightTitle);
    if (highlightTitle && !hasActiveHistory) {
        const active = document.createElement('div');
        active.className = 'history-active-practice';
        active.innerHTML = `<strong>${highlightTitle}</strong><span>${activePercent == null ? 'Ready to practise' : `${activePercent}% complete`}</span>`;
        container.appendChild(active);
    }
    if (!entries.length) {
        const empty = document.createElement('div');
        empty.className = 'msg';
        empty.setAttribute('role', 'status');
        empty.textContent = 'No completion history yet. Complete a practice to see it here.';
        container.appendChild(empty);
        return;
    }
    const byTitle = {};
    entries.forEach((entry) => {
        if (!entry.title) return;
        byTitle[entry.title] ||= { category: entry.category || '', source_type: entry.source_type || 'manual', entries: [] };
        byTitle[entry.title].entries.push(entry);
    });
    const overallStreak = calculateStreak(entries.map((entry) => entry.iso).filter(Boolean));
    const statsHeader = document.createElement('div');
    statsHeader.className = 'history-stats';
    statsHeader.textContent = `Total sessions: ${entries.length}${overallStreak ? ` · ${overallStreak}-day streak` : ''}`;
    container.appendChild(statsHeader);
    const grouped = {};
    const titleToCat = Object.fromEntries((window.sequences || []).map((sequence) => [sequence.title, sequence.category || 'Uncategorized']));
    Object.entries(byTitle).forEach(([title, group]) => {
        const latest = [...group.entries].sort((a, b) => b.ts - a.ts)[0];
        const category = group.category || titleToCat[title] || 'Archived / Removed';
        grouped[category] ||= [];
        grouped[category].push({ title, count: group.entries.length, latest, sourceType: group.source_type });
    });
    Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).forEach(([category, items]) => {
        const section = document.createElement('details');
        section.open = true;
        const summary = document.createElement('summary');
        summary.textContent = `${category} (${items.length} sequences)`;
        const content = document.createElement('div');
        items.sort((a, b) => b.latest.ts - a.latest.ts).forEach((item) => {
            const row = document.createElement('div');
            const isCurrent = Boolean(highlightTitle && item.title === highlightTitle);
            row.className = `history-entry${isCurrent ? ' history-entry--current' : ''}`;
            const label = item.sourceType === 'curriculum' ? 'Curriculum' : 'Manual';
            const detailText = formatDetails(item.latest);
            const progressText = isCurrent && activePercent != null ? ` · ${activePercent}% complete` : '';
            row.innerHTML = `<div><strong>${isCurrent ? '<span class="history-current-badge">Current in player</span>' : ''}<span class="history-source-badge">${label}</span>${item.title}</strong><div class="history-entry-details">Last: ${formatDate(item.latest)}${detailText ? ` · ${detailText}` : ''}${progressText}</div></div><strong>${item.count}×</strong>`;
            content.appendChild(row);
        });
        section.append(summary, content);
        container.appendChild(section);
    });
}

export { openHistoryModal, switchHistoryTab, renderGlobalHistory };
