import { $ } from '../utils/dom.js';
import { openCurriculumRoadmap, restoreRoadmapState } from './curriculumRoadmapUI.js';

const getCurrentSequence = () => window.currentSequence;
const getServerHistoryCache = () => window.serverHistoryCache;
const updateTotalAndLastUI = () => window.updateTotalAndLastUI?.();
const fetchServerHistory = () => window.fetchServerHistory ? window.fetchServerHistory() : Promise.resolve([]);
const deleteAllCompletionsForTitle = (title) => window.deleteAllCompletionsForTitle ? window.deleteAllCompletionsForTitle(title) : Promise.resolve();
const deleteCompletionById = (id) => window.deleteCompletionById ? window.deleteCompletionById(id) : Promise.resolve();
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
    return getCurrentSequence()?.title ? 'current' : 'manual';
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
    const isCurrent = mode === 'current';
    tabCurrent?.classList.toggle('active', isCurrent);
    tabManual?.classList.toggle('active', mode === 'manual');
    tabCurriculum?.classList.toggle('active', isCurriculum);
    tabCurrent?.setAttribute('aria-selected', String(isCurrent));
    tabManual?.setAttribute('aria-selected', String(mode === 'manual'));
    tabCurriculum?.setAttribute('aria-selected', String(isCurriculum));
    viewLabel && (viewLabel.textContent = isCurrent ? 'Current sequence' : mode === 'manual' ? 'Manual practice' : 'Curriculum');
    if (viewCurrent) viewCurrent.style.display = isCurrent ? 'block' : 'none';
    if (viewManual) viewManual.style.display = mode === 'manual' ? 'block' : 'none';
    if (viewCurriculum) viewCurriculum.style.display = isCurriculum ? 'block' : 'none';
    if (mode === 'manual') renderGlobalHistory('manual');
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

const clearHistoryBtn = $('clearHistoryBtn');
clearHistoryBtn?.addEventListener('click', async () => {
    const sequence = getCurrentSequence();
    if (!sequence || !confirm(`Clear all completion history for “${sequence.title}”?`)) return;
    clearHistoryBtn.disabled = true;
    clearHistoryBtn.textContent = 'Clearing…';
    await deleteAllCompletionsForTitle(sequence.title);
    clearHistoryBtn.disabled = false;
    clearHistoryBtn.textContent = 'Clear This Sequence';
    await openHistoryModal('current');
    updateTotalAndLastUI();
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

async function openHistoryModal(defaultTab = null, { clearPracticeOnClose = false } = {}) {
    if (!histBackdrop) return;
    historyOpener = document.activeElement;
    const sequence = getCurrentSequence();
    const selectedTab = ['current', 'manual', 'curriculum'].includes(defaultTab)
        ? defaultTab
        : getDefaultHistoryTab();
    if (selectedTab === 'manual' && (getServerHistoryCache() === null || getServerHistoryCache() === undefined)) await fetchServerHistory();
    const titleEl = $('historyTitle');
    const listEl = $('historyList');
    if (titleEl) titleEl.textContent = sequence?.title || 'Current Sequence';
    if (clearHistoryBtn) clearHistoryBtn.hidden = !sequence;

    if (listEl) {
        if (!sequence) {
            listEl.innerHTML = '<div class="msg" role="status">Select a sequence to view its history.</div>';
        } else {
            listEl.innerHTML = '<div class="muted" style="padding:8px;">Loading…</div>';
            const cached = getServerHistoryCache();
            const history = cached === null || cached === undefined ? await fetchServerHistory() : cached;
            const entries = history.filter((entry) => entry.title === sequence.title).sort((a, b) => b.ts - a.ts);
            listEl.innerHTML = '';
            if (!entries.length) {
                listEl.innerHTML = '<div class="muted" style="padding:8px;">No completion history yet.</div>';
            } else {
                const streak = calculateStreak(entries.map((entry) => entry.iso).filter(Boolean));
                if (streak > 0) {
                    const streakEl = document.createElement('div');
                    streakEl.className = 'history-streak';
                    streakEl.textContent = streak === 1 ? 'Practiced today — keep the momentum!' : `${streak}-day practice streak — well done!`;
                    listEl.appendChild(streakEl);
                }
                entries.forEach((entry) => {
                    const row = document.createElement('div');
                    row.className = 'history-entry';
                    const info = document.createElement('div');
                    const badge = document.createElement('span');
                    badge.className = 'history-source-badge';
                    badge.textContent = entry.source_type === 'curriculum' ? 'Curriculum' : 'Manual';
                    const date = document.createElement('div');
                    date.textContent = formatDate(entry);
                    info.append(badge, date);
                    const details = formatDetails(entry);
                    if (details) {
                        const detailEl = document.createElement('div');
                        detailEl.className = 'history-entry-details';
                        detailEl.textContent = details;
                        info.appendChild(detailEl);
                    }
                    const deleteBtn = document.createElement('button');
                    deleteBtn.type = 'button';
                    deleteBtn.className = 'tiny';
                    deleteBtn.textContent = '✕';
                    deleteBtn.title = 'Remove this entry';
                    deleteBtn.setAttribute('aria-label', `Remove completion from ${formatDate(entry)}`);
                    deleteBtn.addEventListener('click', async () => {
                        if (!confirm('Remove this completion from history?')) return;
                        deleteBtn.disabled = true;
                        await deleteCompletionById(entry.id);
                        await openHistoryModal('current');
                        updateTotalAndLastUI();
                    });
                    row.append(info, deleteBtn);
                    listEl.appendChild(row);
                });
            }
        }
    }
    histBackdrop.style.display = 'flex';
    document.body.classList.add('modal-open');
    histBackdrop.dataset.clearPracticeOnClose = clearPracticeOnClose ? 'true' : 'false';
    switchHistoryTab(selectedTab);
    historyCloseBtn?.focus();
}

function renderGlobalHistory(scope = 'manual') {
    const container = $('globalHistoryList');
    if (!container) return;
    container.innerHTML = '';
    const allEntries = getServerHistoryCache() || [];
    const entries = scope === 'manual'
        ? allEntries.filter((entry) => entry.source_type !== 'curriculum')
        : allEntries;
    if (!entries.length) {
        container.innerHTML = '<div class="msg" role="status">No completion history yet. Complete a practice to see it here.</div>';
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
            row.className = 'history-entry';
            const label = item.sourceType === 'curriculum' ? 'Curriculum' : 'Manual';
            const detailText = formatDetails(item.latest);
            row.innerHTML = `<div><strong><span class="history-source-badge">${label}</span>${item.title}</strong><div class="history-entry-details">Last: ${formatDate(item.latest)}${detailText ? ` · ${detailText}` : ''}</div></div><strong>${item.count}×</strong>`;
            content.appendChild(row);
        });
        section.append(summary, content);
        container.appendChild(section);
    });
}

export { openHistoryModal, switchHistoryTab, renderGlobalHistory };
