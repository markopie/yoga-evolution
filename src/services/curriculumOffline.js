import { ACTIVE_CURRICULUM_SLUG } from '../config/curriculumConfig.js';
import { supabase } from './supabaseClient.js';
import {
    listQueuedCompletions,
    loadSnapshot,
    saveSnapshot,
} from './offlineStore.js';
import {
    optionalStageEligibility,
    optionalStageSet,
} from '../utils/curriculumOptionalStages.js';
import { latestLowRatedCurriculumNode } from '../utils/curriculumAdaptive.js';

// Version 4 invalidates v3 snapshots so activation cannot mix curricula or
// miss the persistent low-rating retry and milestone metadata contracts.
const SNAPSHOT_VERSION = 4;
const NETWORK_TIMEOUT_MS = 4000;
const PAGE_SIZE = 1000;
const refreshes = new Map();

function userKey(userId = window.currentUserId) {
    return userId ? String(userId) : 'anonymous';
}

function snapshotKey(userId, curriculumSlug = ACTIVE_CURRICULUM_SLUG) {
    return `curriculum-read-model-v${SNAPSHOT_VERSION}:${curriculumSlug}:${userKey(userId)}`;
}

function todayKey(userId, curriculumSlug = ACTIVE_CURRICULUM_SLUG) {
    return `curriculum-today-v${SNAPSHOT_VERSION}:${curriculumSlug}:${userKey(userId)}`;
}

function isOffline() {
    return typeof navigator !== 'undefined' && navigator.onLine === false;
}

function errorMessage(error) {
    if (error instanceof Error && error.message) return error.message;
    if (typeof error === 'string') return error;
    try {
        return JSON.stringify(error);
    } catch {
        return 'Unknown error';
    }
}

function withTimeout(promise, timeoutMs = NETWORK_TIMEOUT_MS) {
    let timeout;
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            timeout = setTimeout(
                () => reject(new Error('The local Yoga server did not respond in time.')),
                timeoutMs,
            );
        }),
    ]).finally(() => clearTimeout(timeout));
}

async function fetchCurriculumNodes(curriculumSlug) {
    const nodes = [];
    for (let from = 0; ; from += PAGE_SIZE) {
        const { data, error } = await supabase
            .from('program_curriculum')
            .select(`id, curriculum_slug, program_name, week_number, day_number,
                     order_index, node_type, day_role, recovery_type, is_visible,
                     estimated_minutes, sequence_id, is_active, is_rest_day,
                     source_name, source_key, source_course, source_reference,
                     practice_track, curriculum_phase, intensity, primary_focus,
                     curriculum_payload, completion_requirement, level_number,
                     special_instructions, requires_user_selection, source_policy,
                     source_sequence_order, curriculum_unit_id, adaptive_behavior`)
            .eq('curriculum_slug', curriculumSlug)
            .eq('is_active', true)
            .eq('is_visible', true)
            .order('order_index')
            .range(from, from + PAGE_SIZE - 1);
        if (error) throw error;
        nodes.push(...(data || []));
        if (!data || data.length < PAGE_SIZE) break;
    }
    return nodes;
}

async function fetchCurriculumCompletions(userId, nodes) {
    if (!userId || !nodes.length) return [];
    const nodeIds = new Set(nodes.map((node) => String(node.id)));
    const completions = [];
    for (let from = 0; ; from += PAGE_SIZE) {
        const { data, error } = await supabase
            .from('sequence_completions')
            .select('id, curriculum_node_id, sequence_id, rating, completed, completed_at')
            .eq('user_id', userId)
            .not('curriculum_node_id', 'is', null)
            .order('completed_at')
            .range(from, from + PAGE_SIZE - 1);
        if (error) throw error;
        completions.push(...(data || []).filter(
            (row) => nodeIds.has(String(row.curriculum_node_id)),
        ));
        if (!data || data.length < PAGE_SIZE) break;
    }
    return completions;
}

async function fetchMasteryDecisions(userId, curriculumSlug) {
    if (!userId) return [];
    const { data, error } = await supabase
        .from('curriculum_mastery_decisions')
        .select('repeat_group, mastered_at')
        .eq('user_id', userId)
        .eq('curriculum_slug', curriculumSlug);
    if (error) {
        console.warn('[Offline] Mastery decisions were not included in the curriculum snapshot:', error);
        return [];
    }
    return data || [];
}

async function fetchOptionalStageEnrollments(userId, curriculumSlug) {
    if (!userId) return [];
    const { data, error } = await supabase
        .from('curriculum_optional_stage_enrollments')
        .select('stage_key, accepted_at')
        .eq('user_id', userId)
        .eq('curriculum_slug', curriculumSlug);
    if (error) {
        console.warn('[Offline] Optional-stage enrollments were not included in the curriculum snapshot:', error);
        return [];
    }
    return data || [];
}

async function performRefresh(userId, curriculumSlug) {
    if (!supabase) throw new Error('The curriculum service is unavailable.');
    const nodes = await fetchCurriculumNodes(curriculumSlug);
    const [completions, masteryDecisions, optionalStageEnrollments] = await Promise.all([
        fetchCurriculumCompletions(userId, nodes),
        fetchMasteryDecisions(userId, curriculumSlug),
        fetchOptionalStageEnrollments(userId, curriculumSlug),
    ]);
    const snapshot = {
        version: SNAPSHOT_VERSION,
        curriculumSlug,
        userId: userId ? String(userId) : null,
        nodes,
        completions,
        masteryDecisions,
        optionalStageEnrollments,
        updatedAt: new Date().toISOString(),
    };
    await saveSnapshot(snapshotKey(userId, curriculumSlug), snapshot);
    return snapshot;
}

export async function refreshCurriculumSnapshot({
    userId = window.currentUserId,
    curriculumSlug = ACTIVE_CURRICULUM_SLUG,
    timeoutMs = 12000,
} = {}) {
    if (isOffline()) throw new Error('Reconnect to refresh offline practices.');
    if (!supabase) throw new Error('The curriculum service is unavailable.');
    const key = snapshotKey(userId, curriculumSlug);
    if (!refreshes.has(key)) {
        const refresh = performRefresh(userId, curriculumSlug)
            .finally(() => refreshes.delete(key));
        refreshes.set(key, refresh);
    }
    return await withTimeout(refreshes.get(key), timeoutMs);
}

export async function loadCurriculumSnapshot({
    userId = window.currentUserId,
    curriculumSlug = ACTIVE_CURRICULUM_SLUG,
} = {}) {
    return await loadSnapshot(snapshotKey(userId, curriculumSlug));
}

async function queuedCurriculumCompletions(userId) {
    if (!userId) return [];
    const queued = await listQueuedCompletions().catch(() => []);
    return queued.flatMap((item) => item.rows || [])
        .filter((row) =>
            String(row.user_id || '') === String(userId)
            && row.curriculum_node_id != null);
}

export async function loadCurriculumReadModel({
    userId = window.currentUserId,
    curriculumSlug = ACTIVE_CURRICULUM_SLUG,
    preferNetwork = true,
    timeoutMs = NETWORK_TIMEOUT_MS,
} = {}) {
    let snapshot = null;
    let networkError = null;
    const shouldTryNetwork = preferNetwork && !isOffline() && Boolean(supabase);
    if (shouldTryNetwork) {
        try {
            snapshot = await refreshCurriculumSnapshot({
                userId,
                curriculumSlug,
                timeoutMs,
            });
        } catch (error) {
            networkError = error;
            console.warn('[Curriculum] Online refresh failed; checking the saved curriculum:', error);
        }
    }
    snapshot ||= await loadCurriculumSnapshot({ userId, curriculumSlug });
    if (!snapshot?.nodes?.length) {
        if (networkError) {
            throw new Error(
                `Could not load the curriculum from the server: ${errorMessage(networkError)}`,
                { cause: networkError },
            );
        }
        if (isOffline() || !preferNetwork) {
            throw new Error('No offline curriculum is saved on this device. Reconnect and refresh the offline pack.');
        }
        if (!supabase) throw new Error('The curriculum service is unavailable.');
        throw new Error('No curriculum data was returned by the server.');
    }
    const queued = await queuedCurriculumCompletions(userId);
    return {
        ...snapshot,
        completions: [...(snapshot.completions || []), ...queued],
        offline: !shouldTryNetwork || Boolean(networkError),
    };
}

function completedNodeIds(completions) {
    return new Set(
        (completions || [])
            .filter((row) => row.completed !== false)
            .map((row) => String(row.curriculum_node_id)),
    );
}

function masteredRepeatGroups(decisions) {
    return new Set((decisions || []).map((row) => String(row.repeat_group || '')).filter(Boolean));
}

function courseForSequence(sequenceId) {
    return (window.courses || []).find((course) =>
        String(course.supabaseId || course.id) === String(sequenceId));
}

function practiceFromNode(node, repeated = false) {
    const sequenceId = node.sequence_id
        ?? node.curriculum_payload?.practice_composition?.[0]?.sequence_id
        ?? null;
    const course = sequenceId != null ? courseForSequence(sequenceId) : null;
    const nonSequence = ['rest', 'recovery'].includes(String(node.node_type || '').toLowerCase());
    return {
        ...node,
        curriculum_node_id: node.id,
        resolved_node_type: node.node_type,
        resolved_sequence_id: sequenceId,
        resolved_course_title: course?.title || node.source_reference || null,
        resolution_reason: nonSequence
            ? `${node.node_type === 'rest' ? 'Rest' : 'Recovery'} node: no sequence required.`
            : repeated
                ? 'Repeat: low rating on previous attempt.'
                : 'Offline curriculum sequence.',
    };
}

export async function resolveOfflinePractice({
    repeatNodeId = null,
    userId = window.currentUserId,
    curriculumSlug = ACTIVE_CURRICULUM_SLUG,
} = {}) {
    const snapshot = await loadCurriculumReadModel({
        userId,
        curriculumSlug,
        preferNetwork: false,
    });
    const ordered = [...snapshot.nodes].sort(
        (a, b) => Number(a.order_index) - Number(b.order_index),
    );
    let node;
    if (repeatNodeId != null) {
        node = ordered.find((item) => String(item.id) === String(repeatNodeId));
    } else {
        node = latestLowRatedCurriculumNode(ordered, snapshot.completions);
        const completed = completedNodeIds(snapshot.completions);
        const mastered = masteredRepeatGroups(snapshot.masteryDecisions);
        const enrolledStages = optionalStageSet(snapshot.optionalStageEnrollments);
        node ||= ordered.find((item) => {
            if (completed.has(String(item.id))) return false;
            if (!optionalStageEligibility(item, enrolledStages).eligible) return false;
            const repeatGroup = item.curriculum_payload?.repeat_group;
            return !(repeatGroup
                && item.curriculum_payload?.mastery_skippable
                && mastered.has(String(repeatGroup)));
        });
    }
    if (!node) throw new Error('No remaining curriculum practice is available offline.');
    const enrolledStages = optionalStageSet(snapshot.optionalStageEnrollments);
    const stageEligibility = optionalStageEligibility(node, enrolledStages);
    return {
        ...practiceFromNode(
            node,
            repeatNodeId != null
                || node === latestLowRatedCurriculumNode(ordered, snapshot.completions),
        ),
        optional_stage_enrolled:
            Boolean(stageEligibility.stageKey)
            && !stageEligibility.requiresChoice
            && stageEligibility.eligible,
    };
}

export async function saveResolvedPractice(
    practice,
    {
        userId = window.currentUserId,
        curriculumSlug = ACTIVE_CURRICULUM_SLUG,
    } = {},
) {
    if (!practice || !userId) return;
    await saveSnapshot(todayKey(userId, curriculumSlug), practice);
}

export async function loadTodayPractice({
    repeatNodeId = null,
    userId = window.currentUserId,
    curriculumSlug = ACTIVE_CURRICULUM_SLUG,
    timeoutMs = NETWORK_TIMEOUT_MS,
} = {}) {
    if (!isOffline() && supabase) {
        const rpcParams = {
            p_curriculum_slug: curriculumSlug,
            p_user_id: userId || null,
        };
        if (repeatNodeId != null) rpcParams.p_repeat_node_id = repeatNodeId;
        try {
            const { data, error } = await withTimeout(
                supabase.rpc('get_today_curriculum_practice', rpcParams),
                timeoutMs,
            );
            if (error) throw error;
            const practice = Array.isArray(data) ? data[0] : data;
            if (!practice) throw new Error('No curriculum practice returned.');
            await saveResolvedPractice(practice, { userId, curriculumSlug });
            void refreshCurriculumSnapshot({ userId, curriculumSlug }).catch((error) =>
                console.warn('[Offline] Curriculum snapshot refresh failed:', error.message));
            return { practice, offline: false };
        } catch (error) {
            console.warn('[Offline] Today practice request failed; using the saved curriculum:', error.message);
        }
    }

    try {
        return {
            practice: await resolveOfflinePractice({ repeatNodeId, userId, curriculumSlug }),
            offline: true,
        };
    } catch (error) {
        const saved = await loadSnapshot(todayKey(userId, curriculumSlug));
        if (saved && (repeatNodeId == null
            || String(saved.curriculum_node_id) === String(repeatNodeId))) {
            return { practice: saved, offline: true };
        }
        throw error;
    }
}
