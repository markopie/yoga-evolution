import { profileStorageKey } from './deviceProfiles.js';

export const CLASS_STORAGE_KEY = 'classes-v1';
const text = (value, max, label) => {
    if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`Enter a valid ${label}.`);
    return value.trim();
};

export function localDate(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function validateClasses(input = []) {
    if (!Array.isArray(input) || input.length > 1000) throw new Error('Invalid classes in profile.');
    const ids = new Set();
    return input.map(row => {
        if (!row || typeof row !== 'object') throw new Error('Invalid class record.');
        const id = text(row.id, 100, 'class ID');
        if (ids.has(id)) throw new Error('Duplicate class ID.');
        ids.add(id);
        if (!Array.isArray(row.students) || row.students.length > 1000 || !Array.isArray(row.additionalProps) || row.additionalProps.length > 1000) throw new Error('Invalid students or props.');
        const studentIds = new Set();
        const excludedProps = row.excludedProps ?? [];
        if (!Array.isArray(excludedProps) || excludedProps.length > 1000) throw new Error('Invalid prop selections.');
        return {
            id, name: text(row.name, 200, 'class name'), sequenceId: text(row.sequenceId, 200, 'sequence'),
            students: row.students.map(student => {
                const studentId = text(student?.id, 100, 'student ID');
                if (studentIds.has(studentId)) throw new Error('Duplicate student ID.');
                studentIds.add(studentId);
                if (typeof student.formReviewed !== 'boolean') throw new Error('Invalid form status.');
                const date = student.reviewedOn;
                if (student.formReviewed && (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)) throw new Error('Enter a valid review date.');
                return { id: studentId, name: text(student.name, 200, 'student name'), formReviewed: student.formReviewed, reviewedOn: student.formReviewed ? date : null };
            }),
            additionalProps: row.additionalProps.map(prop => text(prop, 200, 'prop')),
            excludedProps: [...new Set(excludedProps.map(prop => text(prop, 300, 'prop selection')))],
        };
    });
}

function key(userId) {
    if (!userId) throw new Error('Open a profile to use Classes.');
    return profileStorageKey(CLASS_STORAGE_KEY, userId);
}

export function readClasses(userId = globalThis.window?.currentUserId, storage = localStorage) {
    const raw = storage.getItem(key(userId));
    if (!raw) return [];
    try {
        const record = JSON.parse(raw);
        if (record.version !== 1) throw new Error('Unsupported version');
        return validateClasses(record.classes);
    } catch { throw new Error('Saved classes could not be read. Keep your browser data and restore a valid profile backup.'); }
}

export function writeClasses(classes, userId = globalThis.window?.currentUserId, storage = localStorage) {
    const record = { version: 1, classes: validateClasses(classes) };
    try { storage.setItem(key(userId), JSON.stringify(record)); }
    catch { throw new Error('Classes could not be saved in this browser. Your entered changes are still here.'); }
    return record.classes;
}

// Use an explicit allowlist: local student records must never enter an RPC payload.
export function serverProfileBackup(backup) {
    return Object.fromEntries(['format', 'version', 'curriculumSlug', 'name', 'exportedAt', 'completions', 'mastery', 'enrollments', 'preferences'].map(key => [key, backup[key]]));
}
