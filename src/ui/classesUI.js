import { readClasses, writeClasses, localDate } from '../services/classRecords.js';
import { findSequence, sequenceId, matchesSequence, sequenceLabel, sequenceProps, resolveSequenceContent } from '../services/sequenceTeaching.js';
import { builderOpen } from './builder.js';
import { downloadClassPdf } from './builderUI.js';
import { classCover } from '../services/classPresentation.js';

const element = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
};
const button = (label, action, primary = false) => {
    const node = element('button', label, primary ? 'primary-action' : 'secondary');
    node.type = 'button'; node.addEventListener('click', event => { node.focus(); action(event); }); return node;
};
const field = (label, input) => {
    const wrapper = element('label', label, 'class-field'); wrapper.append(input); return wrapper;
};
const input = (value = '', type = 'text') => {
    const node = element('input'); node.type = type; node.value = value; return node;
};

export function setupClassesUI(root) {
    let draft = null, saved = '', owner = null;
    let refreshDetail = null;
    let editing = false;
    const dirty = () => draft && JSON.stringify(draft) !== saved;
    const canLeave = () => !dirty() || window.confirm('Discard unsaved class changes?');
    const message = text => { root.querySelector('[role="status"]').textContent = text; };
    function reset() { draft = null; saved = ''; refreshDetail = null; editing = false; }
    function show() {
        if (owner !== window.currentUserId) { reset(); owner = window.currentUserId; }
        root.replaceChildren();
        const heading = element('h1', draft ? (saved ? draft.name : 'New class') : 'Classes');
        heading.tabIndex = -1;
        root.append(heading);
        const status = element('p'); status.setAttribute('role', 'status'); root.append(status);
        if (draft) renderDetail(); else renderList();
        window.scrollTo(0, 0);
        document.getElementById('mainAppContainer').scrollTop = 0;
        heading.focus({ preventScroll: true });
    }
    function open(record) {
        draft = structuredClone(record);
        saved = record.id ? JSON.stringify(draft) : '';
        editing = !record.id;
        if (!draft.id) draft.id = crypto.randomUUID();
        show();
    }
    function renderList() {
        let records;
        try { records = readClasses(); } catch (error) { message(error.message); return; }
        root.append(button('New class', () => open({ id: '', name: '', sequenceId: '', students: [], additionalProps: [], excludedProps: [] }), true));
        if (!records.length) root.append(element('p', 'No classes yet. Create a class to choose a sequence and add students.'));
        const list = element('div', '', 'class-list');
        for (const record of records) {
            const row = button(record.name, () => open(record));
            row.append(element('span', findSequence(record.sequenceId, window.courses)?.title || 'Sequence unavailable', 'muted'));
            list.append(row);
        }
        root.append(list);
    }
    function renderDetail() {
        root.append(button('Back to classes', () => { if (canLeave()) { reset(); show(); } }));
        const form = element('form', '', 'class-form');
        form.hidden = !!saved && !editing;
        const basics = saved ? element('details', '', 'class-basics') : element('div', '', 'class-basics');
        if (saved) {
            root.append(element('p', findSequence(draft.sequenceId, window.courses)?.title || 'Sequence unavailable', 'class-sequence-title'));
            basics.append(element('summary', 'Edit class name or sequence'));
            basics.open = editing;
        }
        const name = input(draft.name); name.required = true; name.maxLength = 200;
        name.addEventListener('input', () => { draft.name = name.value; });
        basics.append(field('Class name', name));
        const search = input('', 'search');
        basics.append(field('Search sequences', search));
        const category = element('select');
        const fillCollections = () => {
            const selected = category.value;
            category.replaceChildren(new Option('All collections', ''));
            [...new Set((window.courses || []).map(c => c.category).filter(Boolean))].sort().forEach(cat => category.append(new Option(cat, cat)));
            category.value = [...category.options].some(option => option.value === selected) ? selected : '';
        };
        fillCollections();
        basics.append(field('Collection', category));
        const select = element('select'); select.required = true;
        const missing = element('p', '', 'class-notice');
        basics.append(field('Choose a sequence', select));
        form.append(missing);
        const actions = element('div', '', 'class-actions');
        const overview = button('View sequence', () => {
            const course = findSequence(draft.sequenceId, window.courses);
            const resolved = resolveSequenceContent(course, window.courses);
            if (resolved) builderOpen('edit', resolved);
            else message('The linked sequence is unavailable. Choose a replacement sequence.');
        });
        const practise = button('Practise sequence', () => {
            const course = findSequence(draft.sequenceId, window.courses);
            if (!course) return;
            if (window.currentCurriculumPractice?.curriculum_node_id) {
                message('End the current curriculum practice before choosing another sequence.'); return;
            }
            // Ordinary manual selection owns all switching/briefing behaviour.
            if (!window.navigateApp('practice')) return;
            document.getElementById('sequenceSearch').value = '';
            document.getElementById('poseSequenceFilter').value = '';
            document.getElementById('categoryFilter').value = 'ALL';
            window.renderCourseUI();
            const selector = document.getElementById('sequenceSelect');
            selector.value = String(window.courses.indexOf(course));
            selector.dispatchEvent(new Event('change'));
        }, true);
        actions.append(practise, overview);
        if (!saved) form.append(basics);
        form.append(actions);
        if (saved) form.append(basics);
        const refreshActions = () => {
            const course = findSequence(draft.sequenceId, window.courses);
            const title = root.querySelector('.class-sequence-title');
            if (title) title.textContent = course?.title || 'Sequence unavailable';
            [overview, practise].forEach(btn => { btn.disabled = !course; });
            missing.textContent = draft.sequenceId && !course ? 'Sequence unavailable. Choose a replacement sequence.' : '';
            if (draft.sequenceId && !course && saved) basics.open = true;
        };
        const fillSequences = () => {
            select.replaceChildren(new Option('Choose a sequence', ''));
            const courses = window.courses || [];
            const matches = courses.filter(c => matchesSequence(c, search.value) && (!category.value || c.category === category.value));
            for (const course of matches) select.append(new Option(sequenceLabel(course), sequenceId(course)));
            if (draft.sequenceId && !matches.some(c => sequenceId(c) === draft.sequenceId)) {
                const current = findSequence(draft.sequenceId, courses);
                select.append(new Option(current ? `${sequenceLabel(current)} (selected)` : 'Sequence unavailable — choose a replacement', draft.sequenceId));
            }
            select.value = draft.sequenceId;
            refreshActions();
        };
        search.addEventListener('input', fillSequences); category.addEventListener('change', fillSequences);
        select.addEventListener('change', () => { draft.sequenceId = select.value; refreshActions(); renderRecordedProps(); });
        fillSequences();

        form.append(element('h2', 'Students'), element('p', 'Obtain and review the signed health disclosure required by your insurer. Keep the actual document outside this app.', 'class-notice'));
        const students = element('div', '', 'class-students');
        function renderStudents(focusLast = false) {
            students.replaceChildren();
            for (const student of draft.students) {
                const row = element('fieldset', '', 'class-student');
                row.append(element('legend', 'Student'));
                const name = input(student.name); name.required = true; name.maxLength = 200;
                name.oninput = () => { student.name = name.value; };
                const check = input('', 'checkbox'); check.checked = student.formReviewed;
                const date = input(student.reviewedOn || '', 'date'); date.disabled = !check.checked; date.required = check.checked;
                check.onchange = () => {
                    student.formReviewed = check.checked;
                    student.reviewedOn = check.checked ? localDate() : null;
                    date.value = student.reviewedOn || ''; date.disabled = !check.checked; date.required = check.checked;
                };
                date.oninput = () => { student.reviewedOn = date.value; };
                row.append(field('Student name', name), field('Form received and reviewed', check), field('Reviewed on', date), button('Remove student', () => {
                    draft.students = draft.students.filter(item => item.id !== student.id); renderStudents();
                }));
                students.append(row);
            }
            if (focusLast) students.lastElementChild?.querySelector('input')?.focus();
        }
        renderStudents(); form.append(students, button('Add student', () => {
            draft.students.push({ id: crypto.randomUUID(), name: '', formReviewed: false, reviewedOn: null }); renderStudents(true);
        }));
        form.append(element('h2', 'Props'), element('p', 'Tick props to include in this class. Your choices are saved with the class.'), element('h3', 'Props recorded in sequence'));
        const includeProp = key => {
            const getKey = typeof key === 'function' ? key : () => key;
            const check = input('', 'checkbox');
            check.checked = !draft.excludedProps.includes(getKey());
            check.onchange = () => {
                draft.excludedProps = draft.excludedProps.filter(prop => prop !== getKey());
                if (!check.checked) draft.excludedProps.push(getKey());
            };
            return check;
        };
        const recorded = element('div', '', 'class-props');
        function renderRecordedProps() {
            recorded.replaceChildren();
            const course = findSequence(draft.sequenceId, window.courses);
            const result = sequenceProps(course, { courses: window.courses, registry: window.PROP_REGISTRY });
            for (const prop of result.props) recorded.append(field(window.PROP_REGISTRY?.[prop]?.label || prop, includeProp(`sequence:${prop}`)));
            if (!result.props.length) recorded.append(element('p', 'No props recorded; review and add any missing props.'));
            if (draft.sequenceId) for (const warning of result.warnings) recorded.append(element('p', warning));
        }
        form.append(recorded); renderRecordedProps();
        form.append(element('h3', 'Additional props'));
        const extra = element('div');
        function renderExtra(focusLast = false) {
            extra.replaceChildren();
            draft.additionalProps.forEach((prop, index) => {
                const row = element('div', '', 'class-prop-row');
                const name = input(prop); name.required = true; name.maxLength = 200;
                const check = includeProp(() => `additional:${draft.additionalProps[index].trim()}`);
                check.setAttribute('aria-label', `Include ${prop || 'additional prop'}`);
                name.oninput = () => {
                    const previous = `additional:${draft.additionalProps[index].trim()}`;
                    draft.excludedProps = draft.excludedProps.filter(key => key !== previous);
                    draft.additionalProps[index] = name.value;
                    if (!check.checked) draft.excludedProps.push(`additional:${name.value.trim()}`);
                    check.setAttribute('aria-label', `Include ${name.value || 'additional prop'}`);
                };
                row.append(check, field('Prop', name), button('Remove prop', () => {
                    draft.excludedProps = draft.excludedProps.filter(key => key !== `additional:${draft.additionalProps[index].trim()}`);
                    draft.additionalProps.splice(index, 1); renderExtra();
                }));
                extra.append(row);
            });
            if (focusLast) extra.lastElementChild?.querySelector('input[type="text"]')?.focus();
        }
        renderExtra(); form.append(extra, button('Add prop', () => { draft.additionalProps.push(''); renderExtra(true); }));
        const footer = element('div', '', 'class-actions');
        const save = button(saved ? 'Save changes' : 'Save class', () => {}, true); save.type = 'submit';
        footer.append(save);
        if (saved) footer.append(button('Cancel changes', () => {
            if (!canLeave()) return;
            draft = JSON.parse(saved); editing = false; show();
        }));
        if (saved) footer.append(button('Delete class', () => {
            if (!window.confirm(`Delete class “${draft.name}” and its student list?`)) return;
            try { writeClasses(readClasses().filter(record => record.id !== draft.id)); reset(); show(); message('Class deleted.'); }
            catch (error) { message(error.message); }
        }));
        form.append(footer);
        if (!saved) { actions.hidden = true; }
        form.onsubmit = event => {
            event.preventDefault();
            try {
                const records = readClasses();
                const index = records.findIndex(record => record.id === draft.id);
                if (index < 0) records.push(draft); else records[index] = draft;
                const validated = writeClasses(records);
                draft = validated.find(record => record.id === draft.id);
                saved = JSON.stringify(draft); editing = false; show(); message('Class saved.');
            } catch (error) { message(error.message); }
        };
        root.append(form);
        let refreshSheet = () => {};
        if (saved && !editing) {
            const sheet = element('div', '', 'class-sheet');
            const toolbar = element('div', '', 'class-actions');
            toolbar.append(practise, overview, button('Edit class', () => { editing = true; show(); }));
            sheet.append(toolbar, missing);
            const panels = element('div', '', 'class-sheet-panels');
            const propsPanel = element('section', '', 'class-sheet-panel');
            const studentsPanel = element('section', '', 'class-sheet-panel');
            refreshSheet = () => {
                const course = findSequence(draft.sequenceId, window.courses);
                const cover = classCover(draft, course, { courses: window.courses, registry: window.PROP_REGISTRY });
                propsPanel.replaceChildren(element('h2', 'Props for this class'));
                const props = element('ul', '', 'class-sheet-props');
                cover.props.forEach(prop => props.append(element('li', prop)));
                propsPanel.append(cover.props.length ? props : element('p', 'No props selected. Edit the class to review and add props.'));
                propsPanel.append(element('p', 'Only recorded props and your additions are shown.', 'muted'));
                for (const warning of sequenceProps(course, { courses: window.courses, registry: window.PROP_REGISTRY }).warnings) propsPanel.append(element('p', warning));
                studentsPanel.replaceChildren(element('h2', `Students · ${draft.students.length}`));
                const students = element('ul', '', 'class-sheet-students');
                for (const student of draft.students) {
                    const row = element('li'); row.append(element('strong', student.name));
                    row.append(element('span', student.formReviewed ? `Form reviewed · ${student.reviewedOn}` : 'Form not yet reviewed', 'class-student-status'));
                    students.append(row);
                }
                studentsPanel.append(draft.students.length ? students : element('p', 'No students added yet.'));
            };
            panels.append(propsPanel, studentsPanel); sheet.append(panels);
            const downloads = element('section', '', 'class-sheet-download');
            const includeCover = input('', 'checkbox'); includeCover.checked = true;
            const download = button('Download PDF', () => {
                const course = resolveSequenceContent(findSequence(draft.sequenceId, window.courses), window.courses);
                if (!course) return;
                void downloadClassPdf(course, includeCover.checked ? classCover(draft, course, { courses: window.courses, registry: window.PROP_REGISTRY }) : null, download);
            });
            download.id = 'classDownloadPdf';
            downloads.append(element('h2', 'Take your class with you'), field('Include class cover with student names and props', includeCover), download);
            const updateSheet = refreshSheet;
            refreshSheet = () => { updateSheet(); download.disabled = !resolveSequenceContent(findSequence(draft.sequenceId, window.courses), window.courses); };
            sheet.append(downloads);
            const deleteButton = footer.querySelector('button:last-child');
            if (deleteButton?.textContent === 'Delete class') { deleteButton.classList.add('class-delete'); sheet.append(deleteButton); }
            root.append(sheet); refreshSheet();
        } else if (saved) actions.hidden = true;
        refreshDetail = () => { fillCollections(); fillSequences(); renderRecordedProps(); refreshSheet(); };
    }
    window.addEventListener('yoga:sequences-updated', () => {
        if (root.hidden) return;
        if (draft) refreshDetail?.(); else show();
    });
    window.addEventListener('beforeunload', event => { if (dirty()) { event.preventDefault(); event.returnValue = ''; } });
    return { show, canLeave, leave: reset };
}
