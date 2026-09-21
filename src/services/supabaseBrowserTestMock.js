import { ACTIVE_CURRICULUM_SLUG } from '../config/curriculumConfig.js';

const ratingOptions = [
    { rating: 1, feedback_key: 'too_much', label: 'Too much', subtitle: 'Repeat this practice', emoji: null, progression_score: -2, sort_order: 1, is_active: true },
    { rating: 2, feedback_key: 'hard', label: 'Hard', subtitle: 'Repeat this practice', emoji: null, progression_score: -1, sort_order: 2, is_active: true },
    { rating: 3, feedback_key: 'steady', label: 'Steady', subtitle: 'Continue carefully', emoji: null, progression_score: 0, sort_order: 3, is_active: true },
    { rating: 4, feedback_key: 'good', label: 'Good', subtitle: 'Ready for the next one', emoji: null, progression_score: 1, sort_order: 4, is_active: true },
];

const courses = [
    {
        id: 101,
        title: 'Mock Standing Foundation',
        category: 'How to Use Yoga',
        sequence_json: [
            { type: 'pose', pose_id: '001', duration: 30, note: 'Stand evenly.' },
            { type: 'pose', pose_id: '002', duration: 30, note: 'Keep the breath quiet.' },
        ],
        course_sub_categories: { id: 1, name: 'Week 1', category_id: 10, course_categories: { id: 10, name: 'How to Use Yoga' } },
    },
    {
        id: 102,
        title: 'Mock Seated Foundation',
        category: 'How to Use Yoga',
        sequence_json: [
            { type: 'pose', pose_id: '003', duration: 30, note: 'Sit tall.' },
            { type: 'pose', pose_id: '004', duration: 30, note: 'Release the shoulders.' },
        ],
        course_sub_categories: { id: 1, name: 'Week 1', category_id: 10, course_categories: { id: 10, name: 'How to Use Yoga' } },
    },
    {
        id: 103,
        title: 'Mock Quiet Pranayama',
        category: 'Light on Pranayama',
        sequence_json: [
            { type: 'pose', pose_id: '005', duration: 30, note: 'Observe the breath.' },
        ],
        course_sub_categories: { id: 2, name: 'Course 1 (Preparatory)', category_id: 11, course_categories: { id: 11, name: 'Light on Pranayama' } },
    },
    {
        id: 104,
        title: 'Mock Combined Asana',
        category: 'Light on Yoga',
        sequence_json: [
            { type: 'pose', pose_id: '006', duration: 30, note: 'Steady legs.' },
        ],
        course_sub_categories: { id: 3, name: 'Course 1', category_id: 12, course_categories: { id: 12, name: 'Light on Yoga' } },
    },
    {
        id: 105,
        title: 'Mock Linked Macro Practice',
        category: 'Testing',
        sequence_json: [
            { type: 'macro', sequence_id: 101, rounds: 1, note: 'Part 1' },
            { type: 'macro', sequence_id: 101, rounds: 2, note: 'Part 2 duplicate' },
            { type: 'macro', sequence_id: 102, rounds: 1, note: 'Part 3' },
        ],
        course_sub_categories: { id: 4, name: 'PDF Export', category_id: 13, course_categories: { id: 13, name: 'Testing' } },
    },
];

const asanas = [
    { id: '001', name: 'Tadasana', english_name: 'Mountain Pose', sanskrit_name: 'Tadasana', requires_sides: true, asana_categories: { name: 'Standing' } },
    { id: '002', name: 'Utthita Hasta Padasana', english_name: 'Extended Hands and Feet Pose', sanskrit_name: 'Utthita Hasta Padasana', asana_categories: { name: 'Standing' } },
    { id: '003', name: 'Dandasana', english_name: 'Staff Pose', sanskrit_name: 'Dandasana', asana_categories: { name: 'Seated' } },
    { id: '004', name: 'Savasana', english_name: 'Corpse Pose', sanskrit_name: 'Savasana', asana_categories: { name: 'Restorative' } },
    { id: '005', name: 'Savasana Breath Observation', english_name: 'Breath Observation', sanskrit_name: 'Savasana', asana_categories: { name: 'Pranayama' } },
    { id: '006', name: 'Virabhadrasana II', english_name: 'Warrior II', sanskrit_name: 'Virabhadrasana II', asana_categories: { name: 'Standing' } },
];

const programCurriculum = [
    curriculumNode(9001, 1, 1, 1, 101, 'How to Use Yoga', 'How to Use Yoga', 'Week 1', 'Mock Standing Foundation', 'asana', { repeat_group: 'mock-foundations', mastery_skippable: true }),
    curriculumNode(9002, 1, 2, 2, 102, 'How to Use Yoga', 'How to Use Yoga', 'Week 1', 'Mock Seated Foundation', 'asana', { repeat_group: 'mock-foundations', mastery_skippable: true }),
    curriculumNode(9003, 1, 3, 3, 103, 'Light on Pranayama', 'Light on Pranayama', 'Course 1', 'Mock Quiet Pranayama', 'pranayama', { repeat_group: 'mock-foundations', mastery_skippable: true }),
    curriculumNode(9004, 1, 4, 4, 104, 'Light on Yoga', 'Light on Yoga', 'Course 1', 'Mock Combined Asana', 'asana', {
        practice_composition: [
            { role: 'primary_asana', sequence_id: 104, counts_for_source_completion: true, source_name: 'Light on Yoga', source_reference: 'Mock Combined Asana' },
            { role: 'appended_pranayama', sequence_id: 103, counts_for_source_completion: true, source_name: 'Light on Pranayama', source_reference: 'Mock Quiet Pranayama' },
        ],
        composed_total_duration_minutes: 3,
        repeat_group: 'mock-foundations',
        mastery_skippable: true,
    }),
    curriculumNode(9005, 1, 5, 5, 101, 'How to Use Yoga', 'How to Use Yoga', 'Week 1', 'Mock Standing Review', 'asana', { counts_for_source_completion: false }),
    curriculumNode(9006, 1, 6, 6, 102, 'How to Use Yoga', 'How to Use Yoga', 'Week 1', 'Mock Seated Review', 'asana', { counts_for_source_completion: false }),
    recoveryNode(9007, 1, 7, 7, 'How to Use Yoga'),
    curriculumNode(9008, 2, 1, 8, 104, 'Light on Yoga', 'Light on Yoga', 'Course 1', 'Mock Full Practice', 'asana', {
        counts_for_source_completion: false,
        milestone_key: 'loy_course_1_weekly_practice',
        milestone_after_source_week: 30,
        mastery_skippable: false,
    }),
    recoveryNode(9009, 2, 7, 9, 'Light on Yoga'),
    curriculumNode(9010, 3, 1, 10, 104, 'Light on Yoga', 'Light on Yoga', 'Course 2', 'Mock Optional Specialist Bridge', 'advanced_bridge', {
        requires_user_selection: true,
        optional_stage: 'course_2_specialist_bridge',
        optional_extension: true,
        is_visible: false,
    }),
];

let session = null;
let completionId = 1;
let completions = [];
let optionalStageEnrollments = [];
let masteryDecisions = [];
let preferences = [];
let mockSessions = [];
const authSubscribers = new Set();
const MOCK_STATE_KEY = 'yoga-browser-test-state';
const MOCK_AUTH_KEY = 'yoga-evolution-browser-test-auth';
function saveMockState() {
    localStorage.setItem(MOCK_STATE_KEY, JSON.stringify({ completionId, completions, optionalStageEnrollments, masteryDecisions, preferences, mockSessions }));
    if (session) localStorage.setItem(MOCK_AUTH_KEY, JSON.stringify(session));
    else localStorage.removeItem(MOCK_AUTH_KEY);
}
function restoreMockState() {
    const data = JSON.parse(localStorage.getItem(MOCK_STATE_KEY) || '{}');
    session = JSON.parse(localStorage.getItem(MOCK_AUTH_KEY) || 'null');
    completionId = data.completionId || 1;
    completions = data.completions || [];
    optionalStageEnrollments = data.optionalStageEnrollments || [];
    masteryDecisions = data.masteryDecisions || [];
    preferences = data.preferences || [];
    mockSessions = data.mockSessions || [];
}
export function mockEmitAuthEvent(event = 'TOKEN_REFRESHED') {
    if (session) notifyAuth(event);
}
export function mockResetAuthState() {
    session = null;
    mockSessions = [];
    saveMockState();
}

function curriculumNode(id, week, day, order, sequenceId, sourceName, sourceKey, sourceCourse, reference, track, extraPayload = {}) {
    const composition = extraPayload.practice_composition || [{
        role: track === 'pranayama' ? 'primary_pranayama' : 'primary_asana',
        sequence_id: sequenceId,
        counts_for_source_completion: extraPayload.counts_for_source_completion !== false,
        source_name: sourceName,
        source_reference: reference,
    }];
    const nodeType = composition.length > 1 ? 'composed_sequence' : 'sequence';

    return {
        id,
        curriculum_node_id: id,
        curriculum_slug: extraPayload.curriculum_slug || ACTIVE_CURRICULUM_SLUG,
        program_name: extraPayload.program_name || 'Integrated Iyengar Practice Path',
        week_number: week,
        day_number: day,
        order_index: order,
        node_type: nodeType,
        resolved_node_type: nodeType,
        day_role: 'practice',
        recovery_type: null,
        is_visible: extraPayload.is_visible !== false,
        is_active: true,
        is_rest_day: false,
        is_optional: extraPayload.optional_extension === true,
        requires_user_selection: extraPayload.requires_user_selection === true,
        sequence_id: sequenceId,
        resolved_sequence_id: sequenceId,
        resolved_course_title: reference,
        source_name: sourceName,
        source_key: sourceKey.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''),
        source_course: sourceCourse,
        source_reference: reference,
        practice_track: track,
        intensity: track === 'pranayama' ? 'quiet' : 'moderate',
        primary_focus: track === 'pranayama' ? 'Pranayama' : 'Asana',
        estimated_minutes: extraPayload.composed_total_duration_minutes || 3,
        completion_requirement: 'attempt',
        level_number: Math.max(1, week),
        special_instructions: 'Browser harness practice node.',
        curriculum_payload: {
            total_duration_minutes: 3,
            progression_group_label: extraPayload.progression_group_label || sourceName,
            source_category: sourceName,
            practice_role: extraPayload.practice_role || 'practice',
            term_number: extraPayload.term_number || null,
            practice_composition: composition,
            ...extraPayload,
        },
    };
}

function recoveryNode(id, week, day, order, sourceName, extraPayload = {}) {
    return {
        id,
        curriculum_node_id: id,
        curriculum_slug: extraPayload.curriculum_slug || ACTIVE_CURRICULUM_SLUG,
        program_name: extraPayload.program_name || 'Integrated Iyengar Practice Path',
        week_number: week,
        day_number: day,
        order_index: order,
        node_type: 'recovery',
        resolved_node_type: 'recovery',
        day_role: 'recovery',
        recovery_type: 'rest_day',
        is_visible: true,
        is_active: true,
        is_rest_day: true,
        sequence_id: null,
        resolved_sequence_id: null,
        source_name: sourceName,
        source_key: null,
        source_course: sourceName,
        source_reference: 'Weekly Recovery',
        practice_track: 'recovery',
        intensity: 'rest',
        primary_focus: 'Recovery',
        estimated_minutes: null,
        completion_requirement: 'acknowledge',
        level_number: Math.max(1, week),
        special_instructions: 'Rest or quiet Savasana only.',
        curriculum_payload: {
            progression_group_label: extraPayload.progression_group_label || sourceName,
            source_category: sourceName,
            practice_role: extraPayload.practice_role || 'rest',
            term_number: extraPayload.term_number || null,
            ...extraPayload,
        },
    };
}

function notifyAuth(event) {
    saveMockState();
    for (const callback of authSubscribers) callback(event, session);
}

function nextPractice(repeatNodeId, curriculumSlug = ACTIVE_CURRICULUM_SLUG) {
    const curriculumRows = programCurriculum.filter((node) => node.curriculum_slug === curriculumSlug);
    if (repeatNodeId != null) {
        return curriculumRows.find((node) => String(node.id) === String(repeatNodeId)) || curriculumRows[0];
    }
    const latest = completions.filter(row => row.user_id === session?.user?.id)
        .filter((row) => curriculumRows.some((node) =>
            Number(node.id) === Number(row.curriculum_node_id)))
        .sort((left, right) =>
            new Date(right.completed_at || 0) - new Date(left.completed_at || 0))[0];
    if (latest && Number(latest.rating) >= 1 && Number(latest.rating) <= 2) {
        return curriculumRows.find((node) =>
            Number(node.id) === Number(latest.curriculum_node_id));
    }
    const completedIds = new Set(completions.filter(row => row.user_id === session?.user?.id).map((row) =>
        Number(row.curriculum_node_id)).filter(Boolean));
    const masteredGroups = new Set(masteryDecisions
        .filter((row) => row.curriculum_slug === curriculumSlug && row.user_id === session?.user?.id)
        .map((row) => row.repeat_group));
    return curriculumRows.find((node) =>
        !completedIds.has(Number(node.id))
        && !(node.curriculum_payload?.mastery_skippable
            && masteredGroups.has(node.curriculum_payload?.repeat_group))) || curriculumRows[0];
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

class Query {
    constructor(table, operation = 'select', payload = null) {
        this.table = table;
        this.operation = operation;
        this.payload = payload;
        this.filters = [];
        this.notFilters = [];
        this.orders = [];
        this.limitValue = null;
        this.rangeValue = null;
        this.singleMode = false;
        this.maybeSingleMode = false;
        this.selected = null;
    }

    select(columns) { this.selected = columns || '*'; return this; }
    eq(column, value) { this.filters.push({ column, op: 'eq', value }); return this; }
    lt(column, value) { this.filters.push({ column, op: 'lt', value }); return this; }
    in(column, values) { this.filters.push({ column, op: 'in', value: values }); return this; }
    contains(column, value) { this.filters.push({ column, op: 'contains', value }); return this; }
    not(column, op, value) { this.notFilters.push({ column, op, value }); return this; }
    order(column, options = {}) { this.orders.push({ column, ascending: options.ascending !== false }); return this; }
    limit(value) { this.limitValue = value; return this; }
    range(from, to) { this.rangeValue = [Number(from), Number(to)]; return this; }
    single() { this.singleMode = true; return this; }
    maybeSingle() { this.maybeSingleMode = true; return this; }
    then(resolve, reject) { return this.execute().then(resolve, reject); }

    async execute() {
        try {
            if (this.operation !== 'select' && ['sequence_completions', 'curriculum_mastery_decisions', 'curriculum_optional_stage_enrollments', 'user_preferences'].includes(this.table)) {
                const rows = Array.isArray(this.payload) ? this.payload : [this.payload];
                if (rows.some(row => row?.user_id && row.user_id !== session?.user?.id)) throw new Error('Row ownership mismatch');
            }
            if (this.operation === 'insert') return { data: this.insertRows(), error: null };
            if (this.operation === 'upsert') return { data: this.upsertRows(), error: null };
            if (this.operation === 'update') return { data: this.updateRows(), error: null };
            if (this.operation === 'delete') return { data: this.deleteRows(), error: null };
            const rows = this.applyQuery(getTableRows(this.table));
            const data = this.singleMode || this.maybeSingleMode ? (rows[0] || null) : rows;
            return { data: clone(data), error: null };
        } catch (error) {
            return { data: null, error };
        } finally { saveMockState(); }
    }

    applyQuery(rows) {
        let result = rows.filter(row => !row.user_id || row.user_id === session?.user?.id);
        for (const filter of this.filters) {
            result = result.filter((row) => {
                if (filter.op === 'eq') return row[filter.column] === filter.value || String(row[filter.column]) === String(filter.value);
                if (filter.op === 'lt') return Number(row[filter.column]) < Number(filter.value);
                if (filter.op === 'in') return (filter.value || []).map(String).includes(String(row[filter.column]));
                if (filter.op === 'contains') return Object.entries(filter.value || {})
                    .every(([key, value]) =>
                        String(row[filter.column]?.[key]) === String(value));
                return true;
            });
        }
        for (const filter of this.notFilters) {
            if (filter.op === 'is' && filter.value === null) {
                result = result.filter((row) => row[filter.column] !== null && row[filter.column] !== undefined);
            }
        }
        for (const order of this.orders) {
            result.sort((a, b) => {
                const cmp = String(a[order.column] ?? '').localeCompare(String(b[order.column] ?? ''), undefined, { numeric: true });
                return order.ascending ? cmp : -cmp;
            });
        }
        if (this.limitValue != null) result = result.slice(0, Number(this.limitValue));
        if (this.rangeValue) result = result.slice(this.rangeValue[0], this.rangeValue[1] + 1);
        return result;
    }

    insertRows() {
        const rows = Array.isArray(this.payload) ? this.payload : [this.payload];
        if (this.table === 'sequence_completions') {
            const inserted = rows.map((row) => ({ id: completionId++, ...row }));
            completions.push(...inserted);
            return clone(inserted);
        }
        return clone(rows);
    }

    upsertRows() {
        const rows = Array.isArray(this.payload) ? this.payload : [this.payload];
        if (this.table === 'user_preferences') {
            for (const row of rows) {
                const existing = preferences.find(item => item.user_id === row.user_id);
                if (existing) Object.assign(existing, row);
                else preferences.push(row);
            }
            return clone(rows);
        }
        if (this.table === 'curriculum_mastery_decisions') {
            for (const row of rows) {
                const existing = masteryDecisions.find((entry) =>
                    entry.user_id === row.user_id
                    && entry.curriculum_slug === row.curriculum_slug
                    && entry.repeat_group === row.repeat_group);
                if (existing) Object.assign(existing, row);
                else masteryDecisions.push({ id: masteryDecisions.length + 1, ...row });
            }
            return clone(rows);
        }
        if (this.table !== 'curriculum_optional_stage_enrollments') {
            return this.insertRows();
        }
        for (const row of rows) {
            const existing = optionalStageEnrollments.find((entry) =>
                String(entry.user_id) === String(row.user_id)
                && String(entry.curriculum_slug) === String(row.curriculum_slug)
                && String(entry.stage_key) === String(row.stage_key));
            if (existing) Object.assign(existing, row);
            else optionalStageEnrollments.push({
                id: optionalStageEnrollments.length + 1,
                ...row,
            });
        }
        return clone(rows);
    }

    updateRows() {
        if (this.table !== 'sequence_completions') return [];
        const rows = this.applyQuery(completions);
        rows.forEach((row) => Object.assign(row, this.payload));
        return clone(rows);
    }

    deleteRows() {
        if (this.table !== 'sequence_completions') return [];
        const removeIds = new Set(this.applyQuery(completions).map((row) => row.id));
        completions = completions.filter((row) => !removeIds.has(row.id));
        return [];
    }
}

function getTableRows(table) {
    if (table === 'courses') return courses;
    if (table === 'asanas') return asanas;
    if (table === 'stages') return [];
    if (table === 'props') return [];
    if (table === 'program_curriculum') return programCurriculum;
    if (table === 'sequence_completions') return completions;
    if (table === 'curriculum_optional_stage_enrollments') {
        return optionalStageEnrollments;
    }
    if (table === 'curriculum_mastery_decisions') return masteryDecisions;
    if (table === 'user_preferences') return preferences;
    if (table === 'completion_rating_options') return ratingOptions;
    return [];
}

export function createBrowserTestSupabaseClient() {
    restoreMockState();
    return {
        auth: {
            async getSession() { return { data: { session }, error: null }; },
            async getUser() { return { data: { user: session?.user || null }, error: session ? null : new Error('No session') }; },
            async signInAnonymously({ options } = {}) {
                const id = crypto.randomUUID();
                session = { user: { id, is_anonymous: true, app_metadata: { role: 'user' }, user_metadata: options?.data || {} }, access_token: `mock-access-${id}`, refresh_token: `mock-refresh-${id}` };
                mockSessions.push(session);
                notifyAuth('SIGNED_IN');
                return { data: { session }, error: null };
            },
            async setSession(tokens) {
                const found = mockSessions.find(item => item.refresh_token === tokens.refresh_token);
                if (!found) return { data: {}, error: new Error('Expired session') };
                session = found;
                notifyAuth('SIGNED_IN');
                return { data: { session }, error: null };
            },
            async signOut() {
                if (session) mockSessions = mockSessions.filter(item => item.user.id !== session.user.id);
                session = null;
                notifyAuth('SIGNED_OUT');
                return { error: null };
            },
            onAuthStateChange(callback) {
                authSubscribers.add(callback);
                if (session) setTimeout(() => callback('INITIAL_SESSION', session), 0);
                return { data: { subscription: { unsubscribe: () => authSubscribers.delete(callback) } } };
            },
        },
        from(table) {
            return {
                select(columns) { return new Query(table).select(columns); },
                insert(payload) { return new Query(table, 'insert', payload); },
                upsert(payload) { return new Query(table, 'upsert', payload); },
                update(payload) { return new Query(table, 'update', payload); },
                delete() { return new Query(table, 'delete'); },
            };
        },
        async rpc(name, params = {}) {
            if (name === 'import_device_profile') {
                if (!session) return { data: null, error: new Error('No session') };
                const userId = session.user.id;
                if ([...completions, ...masteryDecisions, ...optionalStageEnrollments, ...preferences].some(row => row.user_id === userId)) return { data: null, error: new Error('Profile must be empty') };
                const backup = params.p_backup;
                completions.push(...backup.completions.map(row => ({ ...row, user_id: userId, id: crypto.randomUUID() })));
                masteryDecisions.push(...backup.mastery.map(row => ({ ...row, user_id: userId, id: crypto.randomUUID() })));
                optionalStageEnrollments.push(...backup.enrollments.map(row => ({ ...row, user_id: userId, id: crypto.randomUUID() })));
                preferences.push({ user_id: userId, preferences: backup.preferences });
                saveMockState();
                return { data: null, error: null };
            }
            if (name === 'get_today_curriculum_practice') {
                return { data: clone(nextPractice(params.p_repeat_node_id, params.p_curriculum_slug)), error: null };
            }
            return { data: null, error: new Error(`Browser test mock does not implement rpc ${name}`) };
        },
    };
}

export const browserTestSupabaseConfig = {
    url: 'mock://browser-test',
    target: 'browser-test',
    keyType: 'mock',
    storageKey: 'yoga-evolution-browser-test-auth',
};
