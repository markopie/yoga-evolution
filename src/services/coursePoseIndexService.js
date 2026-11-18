import { normalisePoseId, poseIdFromSequenceNode } from '../utils/poseId.js';
import { extractTier } from '../utils/sequenceUtils.js';

const MAX_POSE_FILTER_IDS = 20;
// Keep linked evidence within the sequence engine's playback depth.
const MAX_MACRO_DEPTH = 12;

function stageKey(value) {
    return String(value ?? '').trim().replace(/^0+(?=\d+$)/, '');
}

export function parsePoseFilterIds(raw) {
    const tokens = Array.isArray(raw) ? raw : String(raw ?? '').split(',');
    const ids = new Set();
    for (const token of tokens) {
        const value = String(token ?? '').trim().replace(/^#+/, '');
        const slash = value.indexOf('/');
        const id = normalisePoseId(slash < 0 ? value : value.slice(0, slash));
        if (id) ids.add(slash < 0 ? id : id + '/' + stageKey(value.slice(slash + 1)));
        if (ids.size === MAX_POSE_FILTER_IDS) break;
    }
    return [...ids];
}

function courseId(course) {
    return String(course.supabaseId ?? course.id ?? '');
}

function isVisible(course, profileId) {
    return course.isSystem === true || Boolean(profileId && course.userId === profileId);
}

function canReference(source, target) {
    return target && !target.is_alias && (target.isSystem === true || (!source.isSystem && source.userId === target.userId));
}

// Old sequence text can link by title. Ambiguous titles and ID spellings
// cannot establish the identity of an authored entry.
function indexUnique(index, key, value) {
    if (key) index.set(key, index.has(key) ? null : value);
}

function entryStage(node, asana) {
    const rawId = stageKey(node[7]?.stageId ?? node[7]?.originalJson?.stage_id);
    const key = String(node[3] || '');
    if (!asana?.variations) return { stageId: rawId, variation: key, stageTitle: '' };
    const stages = Object.entries(asana.variations);
    const matches = rawId
        ? stages.filter(([, value]) => stageKey(value?.id) === rawId)
        : stages.filter(([label]) => key && label.toLowerCase() === key.toLowerCase());
    if (matches.length !== 1 || !matches[0][1]) return { stageId: '', variation: key, stageTitle: '' };
    const [variation, value] = matches[0];
    return { stageId: stageKey(value.id), variation, stageTitle: String(value.title || '') };
}

/**
 * Search the loaded, profile-visible authored entries. Each map key is the
 * same sequence object Browse uses. Partial matches are retained so a course
 * can cover all targets across lessons even when no one lesson does.
 */
export function findSequencePoseMatches(courses, targets, { profileId = null, asanaLibrary = {} } = {}) {
    const selected = parsePoseFilterIds(targets);
    const results = new Map();
    if (!selected.length) return results;
    const targetSet = new Set(selected);
    const selectedPoses = new Set(selected.map(target => target.split('/')[0]));
    const posesById = new Map();
    for (const [key, asana] of Object.entries(asanaLibrary || {})) {
        indexUnique(posesById, normalisePoseId(asana?.id ?? key), asana);
    }

    const visible = courses.filter(course => course && isVisible(course, profileId));
    const byId = new Map(), byTitle = new Map();
    for (const course of visible) {
        indexUnique(byId, courseId(course), course);
        indexUnique(byTitle, String(course.title || '').trim().toLowerCase(), course);
    }

    const entries = new Map();
    for (const course of visible) {
        const hits = [], links = [];
        const nodes = Array.isArray(course.poses) ? course.poses : [];
        for (const [index, node] of nodes.entries()) {
            if (!Array.isArray(node)) continue;
            // Native JSON retains the original ordinal even when the adapter skips an empty entry.
            const entryIndex = Number.isInteger(node[5]) ? node[5] : index;
            const token = String(Array.isArray(node[0]) ? node[0][0] : node[0]).trim();
            if (/^MACRO:/i.test(token)) {
                const ref = token.slice(6).trim();
                const titleKey = ref.toLowerCase();
                const idMatch = byId.get(ref);
                const titleMatch = byTitle.get(titleKey);
                // Playback accepts either spelling. A numeric title must not silently redirect an ID link.
                if (byId.has(ref) && byTitle.has(titleKey) && idMatch !== titleMatch) continue;
                // Native links always use IDs. Legacy text may use a unique title.
                const link = byId.has(ref) || node[7]?.originalJson?.type === 'macro'
                    ? idMatch : titleMatch;
                if (canReference(course, link)) links.push({ link, entryIndex });
                continue;
            }
            const poseId = poseIdFromSequenceNode(node);
            if (!selectedPoses.has(poseId) || posesById.get(poseId) === null) continue;
            const stage = entryStage(node, posesById.get(poseId));
            const duration = Number(node[1]);
            const match = {
                poseId, ...stage, entryIndex,
                sourceSequenceId: courseId(course), sourceTitle: String(course.title || ''),
                duration: Number.isFinite(duration) && duration > 0 ? duration : null,
                tier: node[7]?.tier || extractTier(node[4]) || null,
            };
            if (targetSet.has(poseId)) hits.push({ ...match, target: poseId });
            const stageTarget = poseId + '/' + stage.stageId;
            if (stage.stageId && targetSet.has(stageTarget)) hits.push({ ...match, target: stageTarget });
        }
        entries.set(course, { hits, links });
    }

    for (const course of visible) {
        const root = course.is_alias ? byId.get(String(course.redirect_id)) : course;
        if (!canReference(course, root)) continue;
        const queue = [{ sequence: root, path: [] }];
        const visited = new Set([root]);
        const occurrences = [], matched = new Set();
        for (let i = 0; i < queue.length; i++) {
            const { sequence, path } = queue[i];
            const { hits, links } = entries.get(sequence);
            for (const hit of hits) {
                occurrences.push({ ...hit, kind: path.length ? 'linked' : 'direct', path });
                matched.add(hit.target);
            }
            if (path.length >= MAX_MACRO_DEPTH) continue;
            for (const { link, entryIndex } of links) {
                if (visited.has(link)) continue;
                // Playback also stops a macro which revisits the same title on its current path.
                const title = String(link.title || '').trim();
                if (title && (title === String(sequence.title || '').trim() || path.some(step => step.title.trim() === title))) continue;
                visited.add(link);
                const step = { sequenceId: courseId(sequence), title: String(sequence.title || ''), entryIndex };
                queue.push({ sequence: link, path: [...path, step] });
            }
        }
        if (matched.size) results.set(course, {
            matchedTargets: selected.filter(target => matched.has(target)), occurrences,
        });
    }
    return results;
}
