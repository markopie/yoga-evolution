import { loadSnapshot, saveSnapshot } from './offlineStore.js';
import { withNetworkTimeout } from './networkTimeout.js';

// The source-order attribution below follows the published v4 builder. Preview
// curricula have different composition rules and cannot supply this evidence.
const SOURCE_SLUG = 'iyengar_integrated_source_faithful_v4';
const GEM = 'yoga_a_gem_for_women';
const BREATH = 'light_on_pranayama';
const BOOKS = new Set(['light_on_yoga', 'how_to_use_yoga', 'yoga_the_iyengar_way', GEM, BREATH]);
const COLUMNS = 'id,sequence_id,source_key,source_course,source_sequence_order,'
    + 'parts:curriculum_payload->practice_composition,lop_id:curriculum_payload->>lop_course_id';
const LIVE_REFRESH_MS = 30 * 60 * 1000;
const RETRY_MS = 60 * 1000;

function sequenceId(value) {
    const id = String(value ?? '');
    return /^[1-9]\d*$/.test(id) ? id : null;
}

function orderEvidence(row) {
    const parts = Array.isArray(row.parts) ? row.parts : [];
    let id = sequenceId(row.sequence_id);
    let sourceKey = row.source_key;
    let sourceCourse = row.source_course;
    let conflict = false;
    if (sourceKey === 'integrated_recovery') {
        // Here v4 writes the breathing lesson's order onto a composed recovery
        // node. The quiet asana and the day on the calendar own no such order.
        const breathing = parts.filter(part => part?.role === 'appended_pranayama');
        id = sequenceId(row.lop_id);
        if (!id || row.sequence_id != null || breathing.length !== 1) return null;
        const [part] = breathing;
        sourceKey = BREATH;
        sourceCourse = part.source_course;
        conflict = part.source_key !== BREATH || sequenceId(part.sequence_id) !== id;
    } else {
        if (!BOOKS.has(sourceKey) || !id) return null;
        const primary = parts.filter(part => part?.role === 'primary_asana' || part?.role === 'primary_pranayama');
        if (primary.length === 1) {
            const [part] = primary;
            conflict = sequenceId(part.sequence_id) !== id || sourceKey !== part.source_key
                || sourceCourse !== part.source_course;
            if (part.delivery_variant_course_id != null && sequenceId(part.delivery_variant_course_id) !== id) conflict = true;
            if (sourceKey === GEM) {
                // Early / Developing / Full deliveries all refer to one authored sheet.
                id = sequenceId(part.authored_source_course_id);
                if (!id) return null;
            } else if (part.authored_source_course_id != null && sequenceId(part.authored_source_course_id) !== id) {
                conflict = true;
            }
        } else if (parts.length || sourceKey === GEM) {
            return null;
        }
    }
    const position = row.source_sequence_order;
    if (!Number.isSafeInteger(position) || position < 0 || !sourceCourse) conflict = true;
    return [id, { sourceKey, sourceCourse, position: conflict ? null : position, conflict }];
}

export function collectDiscoverySourceOrder(rows) {
    const order = new Map();
    for (const row of rows) {
        const evidence = orderEvidence(row);
        if (!evidence) continue;
        const [id, next] = evidence;
        const previous = order.get(id);
        if (!previous) {
            order.set(id, next);
        } else if (next.conflict || next.position !== previous.position
            || next.sourceKey !== previous.sourceKey || next.sourceCourse !== previous.sourceCourse) {
            previous.conflict = true;
            previous.position = null;
        }
    }
    return order;
}

export async function fetchDiscoverySourceOrder(client, pageSize = 500) {
    const rows = [];
    let total = null;
    let lastId = 0;
    for (;;) {
        const { data, count, error } = await withNetworkTimeout(client.from('program_curriculum')
            .select(COLUMNS, { count: 'exact' })
            .eq('curriculum_slug', SOURCE_SLUG)
            .eq('is_active', true)
            .eq('is_visible', true)
            .order('id')
            .range(rows.length, rows.length + pageSize - 1));
        if (error) throw error;
        if (!Array.isArray(data)) throw Error('Missing source-order page.');
        if (count != null) {
            if (!Number.isSafeInteger(count) || count < 0 || (total != null && count !== total)) {
                throw Error('Source catalogue changed during download.');
            }
            total = count;
        }
        for (const row of data) {
            const id = Number(row.id);
            if (!Number.isSafeInteger(id) || id <= lastId) throw Error('Unstable source-order page.');
            lastId = id;
            rows.push(row);
        }
        if (total != null) {
            if (rows.length === total) break;
            if (!data.length || rows.length > total) throw Error('Incomplete source-order download.');
        } else if (!data.length) {
            // A short page alone can be a server-side cap. Without a count
            // require an empty page before replacing the last complete snapshot.
            break;
        }
    }
    return collectDiscoverySourceOrder(rows);
}

// Only compact evidence from the shared schedule is cached. Never put a user's
// curriculum progress, courses or session into this project-specific snapshot.
export function createDiscoveryOrderStore({ read = loadSnapshot, save = saveSnapshot } = {}) {
    let order = null;
    let status = 'idle';
    let currentKey = null;
    let lastOnline = null;
    let lastAttempt = 0;
    let generation = 0;
    let pending = null;
    const empty = new Map();

    function request(client, project, online, onUpdate) {
        const key = project ? 'discovery-source-order-v1:' + project + ':' + SOURCE_SLUG : null;
        if (key !== currentKey) {
            currentKey = key;
            order = null;
            lastOnline = null;
        }
        // Renders during a request and the render that reports its result must
        // share the request. A reconnect immediately retries with the live source.
        const retryAfter = status === 'live' ? LIVE_REFRESH_MS : RETRY_MS;
        if (online === lastOnline && (pending || !online || Date.now() - lastAttempt < retryAfter)) return pending;
        lastOnline = online;
        const ticket = ++generation;
        status = 'loading';
        const run = async () => {
            let next = order;
            let live = false;
            if (key && client && online) {
                try {
                    next = await fetchDiscoverySourceOrder(client);
                    live = true;
                } catch (error) {
                    console.warn('[Discovery] Course order could not be refreshed:', error);
                }
            }
            if (!next && key) {
                try {
                    const cached = await read(key);
                    if (Array.isArray(cached)) next = new Map(cached);
                } catch { /* This device may have no readable offline data. */ }
            }
            if (ticket !== generation) return;
            order = next;
            status = live ? 'live' : next ? 'cached' : 'unavailable';
            if (live) {
                try { await save(key, [...next]); } catch { /* Keep live results if device storage is unavailable. */ }
            }
        };
        pending = Promise.resolve().then(run).finally(() => {
            if (ticket !== generation) return;
            lastAttempt = Date.now();
            pending = null;
            onUpdate?.();
        });
        return pending;
    }

    return { request, getOrder: () => order ?? empty, getStatus: () => status };
}

const store = createDiscoveryOrderStore();
export const getDiscoverySourceOrder = store.getOrder;
export const getDiscoverySourceOrderStatus = store.getStatus;
export const requestDiscoverySourceOrder = store.request;
