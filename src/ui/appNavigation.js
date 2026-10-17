import { openHistoryModal, closeHistoryModal } from './historyModal.js';
import { setupClassesUI } from './classesUI.js';

export function setupAppNavigation() {
    const root = document.getElementById('mainAppContainer');
    const header = root.querySelector('header');
    const navigation = document.createElement('nav');
    navigation.className = 'app-navigation'; navigation.setAttribute('aria-label', 'Main navigation');
    for (const view of ['practice', 'classes', 'progress']) {
        const button = document.createElement('button');
        button.type = 'button'; button.dataset.view = view;
        button.id = `nav${view[0].toUpperCase()}${view.slice(1)}`;
        button.textContent = view[0].toUpperCase() + view.slice(1);
        button.addEventListener('click', () => { button.focus(); window.navigateApp(view); }); navigation.append(button);
    }
    header.firstElementChild.after(navigation);
    const classes = document.createElement('section'); classes.id = 'classesScreen'; classes.hidden = true;
    classes.className = 'classes-screen'; header.after(classes);
    const classUI = setupClassesUI(classes);
    const progress = document.getElementById('historyBackdrop'); root.append(progress);
    progress.classList.add('progress-screen');
    progress.querySelector('[role="dialog"]')?.setAttribute('role', 'region');
    progress.querySelector('[aria-modal]')?.removeAttribute('aria-modal');
    const sizeProgress = () => root.style.setProperty('--progress-top', `${header.getBoundingClientRect().bottom + window.scrollY}px`);
    new ResizeObserver(sizeProgress).observe(header);
    let current = 'practice';
    function setView(view) {
        current = view; document.body.dataset.appView = view;
        classes.hidden = view !== 'classes';
        navigation.querySelectorAll('button').forEach(button => {
            if (button.dataset.view === view) button.setAttribute('aria-current', 'page');
            else button.removeAttribute('aria-current');
        });
    }
    window.navigateApp = view => {
        if (current === 'classes' && view !== 'classes') {
            if (!classUI.canLeave()) return false;
            classUI.leave();
        }
        if (window.playbackEngine?.running) window.stopTimer();
        if (current === 'progress' && view !== 'progress') closeHistoryModal();
        setView(view);
        window.scrollTo(0, 0); root.scrollTop = 0;
        if (view === 'classes') classUI.show();
        if (view === 'progress') void openHistoryModal();
        return true;
    };
    window.addEventListener('yoga:progress-open', () => setView('progress'));
    window.addEventListener('yoga:progress-close', () => setView('practice'));
    const context = document.createElement('section'); context.id = 'practiceContext'; context.hidden = true;
    const title = document.createElement('h2'); title.id = 'activeSequenceTitle'; context.append(title);
    const resume = document.createElement('button'); resume.type = 'button'; resume.textContent = 'Return to practice'; resume.id = 'returnToPracticeBtn';
    resume.onclick = () => { document.body.classList.remove('library-view'); title.focus(); };
    title.tabIndex = -1; context.append(resume);
    document.getElementById('practicePlaybackControls').before(context);
    const end = document.createElement('button'); end.type = 'button'; end.textContent = 'End practice'; end.id = 'endManualPracticeBtn';
    end.onclick = () => {
        if (!window.confirm('End this practice without marking it complete?')) return;
        window.exitCurriculumPractice(); document.body.classList.remove('library-view'); window.refreshPracticeNavigation();
    };
    context.append(end);
    window.refreshPracticeNavigation = () => {
        context.hidden = !window.currentSequence;
        title.textContent = window.currentSequence?.title || '';
        end.hidden = !!window.currentCurriculumPractice;
        const review = document.getElementById('quickEditBtn');
        if (review) review.disabled = !window.currentSequence || !document.getElementById('sequenceSelect').value;
        if (typeof window.updateSequenceStepper === 'function') window.updateSequenceStepper();
    };
    document.getElementById('sequenceSelect').addEventListener('change', () => {
        document.body.classList.remove('library-view'); window.refreshPracticeNavigation();
    });
    window.addEventListener('yoga:practice-changed', () => {
        document.body.classList.remove('library-view'); window.refreshPracticeNavigation();
        const settings = document.getElementById('appSettingsPanel');
        if (settings) settings.open = false;
    });
    let activeProfile = window.currentUserId;
    window.addEventListener('yoga:verified-session', () => {
        if (activeProfile && activeProfile !== window.currentUserId) { classUI.leave(); setView('practice'); }
        activeProfile = window.currentUserId;
    });
    setView('practice'); window.refreshPracticeNavigation();
}
