import { ACTIVE_CURRICULUM_NAME, ACTIVE_CURRICULUM_SLUG } from '../config/curriculumConfig.js';
import { loadCurriculumReadModel } from '../services/curriculumOffline.js';

const CURRICULUM_SLUG = ACTIVE_CURRICULUM_SLUG;
let dialPositionBeforeRoadmap = null;
let roadmapTriggerBeforeOpen = null;

const MILESTONE_LABELS = {
    loy_course_1_weekly_practice: 'Weekly Practice 1',
    loy_course_2_weekly_practice: 'Weekly Practice 2',
    loy_course_3_weekly_practice: 'Weekly Practice 3-1',
    loy_course_3_final_practice: 'Weekly Practice Final',
};

function milestoneForNode(node) {
    const payload = node?.curriculum_payload || {};
    if (!payload.milestone_key) return null;
    return {
        key: payload.milestone_key,
        label: MILESTONE_LABELS[payload.milestone_key] || 'Weekly Practice Milestone',
        afterSourceWeek: Number(payload.milestone_after_source_week) || null,
        programmeWeek: Number(node.week_number),
    };
}

function captureDurationDialPosition() {
    const dial = document.getElementById('durationDial');
    dialPositionBeforeRoadmap = dial ? String(dial.value) : null;
    dial?.blur();
}

function restoreDurationDialPosition() {
    const savedPosition = dialPositionBeforeRoadmap;
    dialPositionBeforeRoadmap = null;
    if (savedPosition == null) return;

    const dial = document.getElementById('durationDial');
    if (!dial || String(dial.value) === savedPosition) return;

    dial.value = savedPosition;
    window.updateDialUI?.();
    if (window.currentSequence) window.applyDurationDial?.();
}

// ─── Vocabulary helpers ───────────────────────────────────────────────────────

function roleLabel(role) {
    const m = {
        primary_asana:          'Asana',
        appended_pranayama:     'Short Pranayama',
        quiet_asana:            'Quiet Asana',
        light_asana:            'Light Asana',
        primary_pranayama:      'Pranayama',
        supplemental_pranayama: 'Pranayama',
    };
    return m[role] || String(role || '').replace(/_/g, ' ');
}

function nodeTypeLabel(node) {
    if (node.node_type === 'recovery')      return 'Recovery Day';
    if (node.node_type === 'instruction')   return 'Instruction Day';
    if (node.node_type === 'rest')          return 'Rest Day';
    if (node.node_type === 'revision')      return 'Review Practice';
    if (node.node_type === 'consolidation') return 'Consolidation Practice';
    if (node.node_type === 'choice')        return 'Review Practice';
    const comp = node.curriculum_payload?.practice_composition;
    if (Array.isArray(comp) && comp.length > 1) return 'Combined Practice';
    return null;
}

function intensityLabel(band) {
    return { restorative: 'Restorative', light: 'Light', moderate: 'Moderate',
             strong: 'Strong', advanced: 'Advanced' }[band] || null;
}

function ratingMeta(r) {
    return {
        1: { label: 'Too Much',       subtitle: 'Heavy' },
        2: { label: 'Challenging',    subtitle: 'Effortful' },
        3: { label: 'Balanced',       subtitle: 'Right level' },
        4: { label: 'Comfortable',    subtitle: 'Fluid' },
        5: { label: 'Ready for More', subtitle: 'Strong' },
    }[r] || null;
}

function formatDuration(m) {
    if (!m && m !== 0) return null;
    const mins = Math.round(m);
    if (mins < 60) return `${mins} min`;
    const h = Math.floor(mins / 60), r = mins % 60;
    return r ? `${h} hr ${r} min` : `${h} hr`;
}

function esc(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── Status derivation ────────────────────────────────────────────────────────
// Groups completions by curriculum_node_id to avoid double-counting composed nodes.

const DONE_STATUSES = ['completed', 'repeated', 'plateau', 'rest', 'revision'];

function buildCompletionMap(completions) {
    const map = new Map(); // node_id → { count, bestRating, lastAt }
    for (const row of completions) {
        if (!row.curriculum_node_id) continue;
        const id = row.curriculum_node_id;
        const attemptKey = row.completed_at || `${row.sequence_id ?? 'sequence'}:${id}`;
        const existing = map.get(id);
        if (!existing) {
            map.set(id, { count: 1, bestRating: row.rating, lastAt: row.completed_at, attempts: new Set([attemptKey]) });
        } else {
            if (!existing.attempts.has(attemptKey)) {
                existing.attempts.add(attemptKey);
                existing.count = existing.attempts.size;
            }
            if (row.rating != null && (existing.bestRating == null || row.rating > existing.bestRating)) {
                existing.bestRating = row.rating;
            }
            if (row.completed_at > existing.lastAt) existing.lastAt = row.completed_at;
        }
    }
    return map;
}

function resolveCurrentNodeId(nodes, completionMap, explicitCurrentNodeId) {
    if (explicitCurrentNodeId && nodes.some(node => node.id === explicitCurrentNodeId)) {
        return explicitCurrentNodeId;
    }

    const nextNode = nodes.find(node => !completionMap.has(node.id));
    return nextNode?.id ?? null;
}

function deriveNodeStatus(node, completionMap, currentNodeId) {
    if (node.id === currentNodeId) return 'current';

    const rec = completionMap.get(node.id);
    if (!rec) return 'upcoming';

    const nodeType = (node.node_type || '').toLowerCase().trim();
    if (nodeType === 'rest' || nodeType === 'recovery') return 'rest';
    if (['revision', 'choice', 'instruction', 'consolidation', 'assessment'].includes(nodeType)) return 'revision';

    const payload = node.curriculum_payload || {};
    if (payload.plateau_candidate || payload.can_repeat_indefinitely || payload.progression_gate || payload.milestone_type) {
        if (rec.count > 1) return 'plateau';
    }

    if (rec.count > 1) return 'repeated';
    return 'completed';
}

// ─── Data loading ─────────────────────────────────────────────────────────────

async function loadRoadmapData() {
    const snapshot = await loadCurriculumReadModel({
        userId: window.currentUserId,
        curriculumSlug: CURRICULUM_SLUG,
    });
    return {
        nodes: snapshot.nodes,
        completions: snapshot.completions,
        offline: snapshot.offline,
    };
}

// ─── Assemble roadmap nodes ───────────────────────────────────────────────────

function assembleRoadmapNodes(nodes, completions, currentNodeId) {
    const completionMap = buildCompletionMap(completions);
    const effectiveCurrentNodeId = resolveCurrentNodeId(nodes, completionMap, currentNodeId);
    const hasExplicitCurrent = !!currentNodeId && effectiveCurrentNodeId === currentNodeId;
    const curriculumSections = buildCurriculumSections(nodes);

    return nodes.map(node => {
        const rec = completionMap.get(node.id) || null;
        const status = deriveNodeStatus(node, completionMap, effectiveCurrentNodeId);

        // Duration: prefer composed total, fallback to course analysis (not available here), or null
        const payload = node.curriculum_payload || {};
        const durationMinutes =
            node.estimated_minutes ||
            payload.composed_total_duration_minutes ||
            payload.total_duration_minutes ||
            null;
        const curriculumSection = curriculumSectionForNode(node, curriculumSections);

        return {
            ...node,
            status,
            completion_count: rec ? rec.count : 0,
            best_rating:      rec ? rec.bestRating : null,
            last_completed_at: rec ? rec.lastAt : null,
            is_current:       node.id === effectiveCurrentNodeId,
            is_explicit_current: hasExplicitCurrent && node.id === effectiveCurrentNodeId,
            duration_minutes: durationMinutes,
            roadmap_stage_key: curriculumSection.key,
            roadmap_stage_label: curriculumSection.mapLabel,
            roadmap_stage_order: curriculumSection.order,
            source_section_key: curriculumSection.key,
            source_section_label: curriculumSection.listLabel,
            source_section_order: curriculumSection.order,
            source_section_start_week: curriculumSection.startWeek,
            source_section_end_week: curriculumSection.endWeek,
            // Title: derive from source for sequences, type label for rest/revision
            title: buildNodeTitle(node),
        };
    });
}

function buildNodeTitle(node) {
    if (node.node_type === 'recovery') {
        return node.recovery_type
            ? `${tokenLabel(node.recovery_type)} Recovery`
            : 'Recovery Day';
    }
    if (node.node_type === 'instruction') return node.primary_focus || 'Instruction Day';
    if (node.node_type === 'rest')     return 'Rest Day';
    if (node.node_type === 'revision') return 'Review Practice';
    if (node.node_type === 'consolidation') return 'Consolidation Practice';

    const payload = node.curriculum_payload || {};
    const comp = payload.practice_composition;
    if (Array.isArray(comp) && comp.length > 1) {
        // For combined practices, show primary role title if available
        const primary = comp.find(p => p.role === 'primary_asana') || comp[0];
        return primary.title || node.primary_focus || 'Combined Practice';
    }

    // Single sequence: prefer primary_focus as the readable label
    if (node.primary_focus && node.primary_focus !== 'Revision') return node.primary_focus;
    return node.source_reference || 'Practice';
}

function tokenLabel(value) {
    return String(value || '')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (char) => char.toUpperCase());
}

// ─── Group nodes into levels/weeks ───────────────────────────────────────────

function groupIntoLevels(assembledNodes) {
    const levelMap = new Map();

    for (const node of assembledNodes) {
        const sectionKey = node.source_section_key || 'other';
        if (!levelMap.has(sectionKey)) {
            levelMap.set(sectionKey, {
                level_number: node.source_section_order ?? 9999,
                section_key: sectionKey,
                label: node.source_section_label || 'Other curriculum material',
                start_week: node.source_section_start_week,
                end_week: node.source_section_end_week,
                weeks: new Map(),
            });
        }
        const level = levelMap.get(sectionKey);
        const wk = node.week_number;
        if (!level.weeks.has(wk)) level.weeks.set(wk, { week_number: wk, nodes: [] });
        level.weeks.get(wk).nodes.push(node);
    }

    // Convert maps to sorted arrays, compute status for levels/weeks
    return Array.from(levelMap.values())
        .sort((a, b) => a.level_number - b.level_number)
        .map(level => {
            const weeks = Array.from(level.weeks.values())
                .sort((a, b) => a.week_number - b.week_number);
            const allNodes = weeks.flatMap(w => w.nodes);
            const levelStatus = computeGroupStatus(allNodes);
            const weeksWithStatus = weeks.map(week => ({
                ...week,
                status: computeGroupStatus(week.nodes),
            }));
            return { ...level, weeks: weeksWithStatus, status: levelStatus };
        });
}

function computeGroupStatus(nodes) {
    if (nodes.length === 0) return 'upcoming';
    if (nodes.every(n => DONE_STATUSES.includes(n.status))) return 'complete';
    if (nodes.some(n => n.status === 'current' || DONE_STATUSES.includes(n.status))) return 'current';
    return 'upcoming';
}

// ─── Summary ──────────────────────────────────────────────────────────────────

function buildSummary(levels, assembledNodes, currentNode) {
    const completedCount = assembledNodes.filter(n => DONE_STATUSES.includes(n.status)).length;
    const currentPractice = currentNode || assembledNodes[0] || null;
    const isComplete = assembledNodes.length > 0 && completedCount === assembledNodes.length;
    const positionText = currentPractice
        ? `Week ${currentPractice.week_number} · Day ${currentPractice.day_number}`
        : isComplete
            ? 'Complete'
            : completedCount > 0
                ? `${completedCount} completed`
                : 'Not started';
    const positionLabel = currentNode?.is_explicit_current ? 'Current practice' : currentPractice ? 'Next practice' : 'Position';
    const currentWeek = Number(currentPractice?.week_number) || 1;
    const finalWeek = Math.max(...assembledNodes.map(node => Number(node.week_number) || 1));
    const currentChapter = levels.find(level =>
        level.section_key === currentPractice?.source_section_key) || levels[0] || null;
    const chapterStart = Number(currentChapter?.start_week) || currentWeek;
    const chapterEnd = Number(currentChapter?.end_week) || currentWeek;
    const chapterNumber = Number(currentChapter?.level_number) || 1;
    const chapterWeek = currentWeek - chapterStart + 1;
    const chapterWeeks = chapterEnd - chapterStart + 1;
    const currentWeekNodes = assembledNodes.filter(node =>
        Number(node.week_number) === currentWeek);
    const currentWeekDone = currentWeekNodes.filter(node =>
        DONE_STATUSES.includes(node.status)).length;
    const positionPercent = finalWeek > 0
        ? Math.round(((currentWeek - 1) / finalWeek) * 100)
        : 0;

    return {
        current_node_id:     currentNode?.id ?? null,
        current_week_number: currentNode?.week_number ?? null,
        current_day_number:  currentNode?.day_number ?? null,
        position_label:      positionLabel,
        position_text:       positionText,
        total_nodes:         assembledNodes.length,
        completed_nodes:     completedCount,
        chapter_display:     `Chapter ${chapterNumber} · Week ${chapterWeek} of ${chapterWeeks}`,
        week_display:        `${currentWeekDone} of ${currentWeekNodes.length} practices`,
        curriculum_display:  `Week ${currentWeek} of up to ${finalWeek}`,
        position_percent:    positionPercent,
    };
}

// ─── Transit map ──────────────────────────────────────────────────────────────

const SOURCE_ROUTES = [
    { key: 'light_on_yoga', label: 'Light on Yoga', shortLabel: 'LOY', colour: '#00796b' },
    { key: 'yoga_a_gem_for_women', label: 'Yoga: A Gem for Women', shortLabel: 'Gem', colour: '#a23b72' },
    { key: 'yoga_the_iyengar_way', label: 'Yoga the Iyengar Way', shortLabel: 'Iyengar Way', colour: '#c45d14' },
    { key: 'how_to_use_yoga', label: 'How to Use Yoga', shortLabel: 'HTUY', colour: '#6750a4' },
    { key: 'light_on_pranayama', label: 'Light on Pranayama', shortLabel: 'LOP', colour: '#2778b8' },
];

const SOURCE_ROUTE_BY_KEY = new Map(SOURCE_ROUTES.map(route => [route.key, route]));

function sourcePhaseLabel(sourceKey, phaseKey, sourceCourse) {
    const labels = {
        loy_course_1: 'Course 1',
        loy_course_2: 'Course 2',
        loy_course_3: 'Course 3',
        gem_introductory: 'Introductory',
        gem_first_year: 'First Year',
        gem_second_year: 'Second Year',
        gem_third_year: 'Third Year',
        ytiw_course_1: 'Course 1',
        ytiw_course_2: 'Course 2',
        ytiw_course_3: 'Course 3',
        ytiw_course_4: 'Course 4',
        htuy_weeks_1_4: 'Weeks 1–4',
        htuy_weeks_6_9: 'Weeks 6–9',
    };
    if (labels[phaseKey]) return labels[phaseKey];
    return String(sourceCourse || phaseKey || 'Practice').replace(/_/g, ' ');
}

const STREAM_COLOUR = {
    asana: '#1e8e83',
    pranayama: '#5e9ed6',
    revision: '#4a7fa5',
    rest: '#bfb9af',
    combined: '#1e8e83',
};
const LANE_Y = { asana: 60, combined: 60, pranayama: 110, revision: 155, rest: 195 };

function buildCurriculumSections(nodes) {
    const firstWeek = Math.min(...nodes.map(node => Number(node.week_number) || 1));
    const finalWeek = Math.max(...nodes.map(node => Number(node.week_number) || 1));
    const metadataMilestones = [...new Map(nodes
        .map(node => [node.curriculum_payload?.milestone_key, node])
        .filter(([key]) => Boolean(key))).values()]
        .map(node => ({ finalNode: node }))
        .sort((left, right) =>
            Number(left.finalNode.order_index) - Number(right.finalNode.order_index));
    const milestones = metadataMilestones.length
        ? metadataMilestones
        : [127, 141, 172, 148].map(finalSequenceId => ({ finalSequenceId }));
    const sections = [];
    let startWeek = Number.isFinite(firstWeek) ? firstWeek : 1;

    milestones.forEach((milestone, index) => {
        const finalNode = milestone.finalNode || nodes.find(node =>
            Number(node.sequence_id) === milestone.finalSequenceId);
        if (!finalNode) return;
        const endWeek = Number(finalNode.week_number);
        sections.push({
            key: `section_${index + 1}`,
            order: index + 1,
            startWeek,
            endWeek,
            mapLabel: `Chapter ${index + 1} — Weeks ${startWeek}–${endWeek}`,
            listLabel: `Chapter ${index + 1} — Weeks ${startWeek}–${endWeek}`,
        });
        startWeek = endWeek + 1;
    });

    if (startWeek <= finalWeek || sections.length === 0) {
        const order = sections.length + 1;
        sections.push({
            key: `section_${order}`,
            order,
            startWeek,
            endWeek: finalWeek,
            mapLabel: `Chapter ${order} — Weeks ${startWeek}–${finalWeek}`,
            listLabel: `Chapter ${order} — Weeks ${startWeek}–${finalWeek}`,
        });
    }
    return sections;
}

function curriculumSectionForNode(node, sections) {
    const week = Number(node.week_number) || 1;
    return sections.find(section =>
        week >= section.startWeek && week <= section.endWeek)
        || sections.at(-1)
        || {
            key: 'section_1',
            order: 1,
            mapLabel: 'Chapter 1',
            listLabel: 'Chapter 1',
        };
}

function buildLayout(nodes) {
    const width = 1280;
    const left = 150;
    const right = 120;
    const sections = [...new Map(nodes.map(node => [
        node.source_section_key,
        {
            key: node.source_section_key,
            order: node.source_section_order,
            startWeek: node.source_section_start_week,
            endWeek: node.source_section_end_week,
            label: node.roadmap_stage_label,
        },
    ])).values()].sort((a, b) => a.order - b.order);
    const chapterWidth = (width - left - right) / Math.max(1, sections.length);
    const xForWeek = week => {
        const foundIndex = sections.findIndex(section =>
            week >= section.startWeek && week <= section.endWeek);
        const sectionIndex = Math.max(0, foundIndex);
        const section = sections[sectionIndex] || { startWeek: 1, endWeek: 1 };
        const span = Math.max(1, section.endWeek - section.startWeek);
        const fraction = Math.max(0, Math.min(1, (week - section.startWeek) / span));
        return left + (sectionIndex * chapterWidth) + (fraction * chapterWidth);
    };
    const phases = new Map();

    function addPhase(sourceKey, phaseKey, sourceCourse, sequenceId, node, isMaintenance = false) {
        if (!SOURCE_ROUTE_BY_KEY.has(sourceKey)) return;
        const key = `${sourceKey}:${phaseKey || sourceCourse || 'practice'}`;
        if (!phases.has(key)) {
            phases.set(key, {
                key,
                sourceKey,
                label: sourcePhaseLabel(sourceKey, phaseKey, sourceCourse),
                firstWeek: Number(node.week_number),
                lastWeek: Number(node.week_number),
                authoredFirstWeek: isMaintenance ? null : Number(node.week_number),
                authoredLastWeek: isMaintenance ? null : Number(node.week_number),
                sequenceIds: new Set(),
                occurrences: 0,
                maintenanceOccurrences: 0,
                firstMaintenanceWeek: null,
            });
        }
        const phase = phases.get(key);
        phase.firstWeek = Math.min(phase.firstWeek, Number(node.week_number));
        phase.lastWeek = Math.max(phase.lastWeek, Number(node.week_number));
        if (sequenceId != null) phase.sequenceIds.add(Number(sequenceId));
        phase.occurrences += 1;
        if (isMaintenance) {
            phase.maintenanceOccurrences += 1;
            phase.firstMaintenanceWeek = phase.firstMaintenanceWeek == null
                ? Number(node.week_number)
                : Math.min(phase.firstMaintenanceWeek, Number(node.week_number));
        } else {
            phase.authoredFirstWeek = phase.authoredFirstWeek == null
                ? Number(node.week_number)
                : Math.min(phase.authoredFirstWeek, Number(node.week_number));
            phase.authoredLastWeek = phase.authoredLastWeek == null
                ? Number(node.week_number)
                : Math.max(phase.authoredLastWeek, Number(node.week_number));
        }
    }

    nodes.forEach(node => {
        const payload = node.curriculum_payload || {};
        addPhase(
            node.source_key,
            payload.phase_key || node.source_course,
            node.source_course,
            node.sequence_id,
            node,
            payload.repeat_reason === 'lop_completion_maintenance',
        );
        (payload.practice_composition || [])
            .filter(part => part.source_key === 'light_on_pranayama')
            .forEach(part => addPhase(
                part.source_key,
                part.source_course,
                part.source_course,
                part.sequence_id,
                node,
            ));
    });

    const routes = SOURCE_ROUTES.map((route) => {
        const routePhases = [...phases.values()]
            .filter(phase => phase.sourceKey === route.key)
            .sort((a, b) => a.firstWeek - b.firstWeek || a.label.localeCompare(b.label))
            .map(phase => ({
                ...phase,
                sequenceIds: [...phase.sequenceIds],
                x: xForWeek(phase.authoredFirstWeek ?? phase.firstWeek),
                y: 0,
            }));
        return {
            ...route,
            y: 0,
            phases: routePhases,
            firstWeek: Math.min(...routePhases.map(phase => phase.firstWeek)),
            lastWeek: Math.max(...routePhases.map(phase => phase.lastWeek)),
        };
    }).filter(route => route.phases.length);
    // Course labels occupy separate rows above their track. Wrap long names and
    // reserve conservative text bounds so neighboring phases never share space.
    let nextTop = 66;
    routes.forEach(route => {
        const laneEnds = [];
        route.phases.forEach(phase => {
            const lines = [''];
            for (const word of phase.label.split(/\s+/)) {
                const last = lines.length - 1;
                if (lines[last] && `${lines[last]} ${word}`.length > 22) lines.push(word);
                else lines[last] += `${lines[last] ? ' ' : ''}${word}`;
            }
            const labelWidth = Math.max(...lines.map(line => line.length)) * 8;
            const labelX = Math.max(12 + labelWidth / 2, Math.min(width - 12 - labelWidth / 2, phase.x));
            let lane = laneEnds.findIndex(end => end + 16 < labelX - labelWidth / 2);
            if (lane < 0) lane = laneEnds.length;
            laneEnds[lane] = labelX + labelWidth / 2;
            Object.assign(phase, { labelLines: lines, labelX, labelLane: lane });
        });
        const laneHeight = Math.max(1, ...route.phases.map(phase => phase.labelLines.length)) * 16 + 12;
        route.y = nextTop + laneEnds.length * laneHeight + 12;
        route.phases.forEach(phase => {
            phase.y = route.y;
            phase.labelY = route.y - 24 - phase.labelLane * laneHeight
                - (phase.labelLines.length - 1) * 16;
        });
        nextTop = route.y + (route.key === 'light_on_yoga' ? 66 : 28);
    });
    const height = nextTop + 16;
    const currentWeek = Number(nodes.find(node => node.is_current)?.week_number || 1);
    const milestones = [...new Map(nodes
        .map(node => milestoneForNode(node))
        .filter(Boolean)
        .map(milestone => [milestone.key, milestone])).values()]
        .sort((left, right) => left.programmeWeek - right.programmeWeek);

    return {
        width,
        height,
        left,
        right,
        sections,
        routes,
        milestones,
        currentWeek,
        currentX: xForWeek(currentWeek),
        xForWeek,
    };
}

function renderSourceMapSvg(model, selectedStationKey) {
    const { width, height, left, right, sections, routes, milestones, currentWeek, currentX, xForWeek } = model;
    const bottomY = routes.at(-1)?.y || 300;
    const chapterWidth = (width - left - right) / Math.max(1, sections.length);
    let chapterSvg = '';
    sections.forEach((section, index) => {
        const startX = left + (index * chapterWidth);
        const endX = startX + chapterWidth;
        chapterSvg += `<rect x="${startX}" y="29" width="${chapterWidth}" height="${bottomY + 38}" fill="${index % 2 ? '#fbfaf8' : '#ffffff'}"/>`;
        chapterSvg += `<text x="${(startX + endX) / 2}" y="19" text-anchor="middle" class="cr-source-map-chapter">${esc(section.label)}</text>`;
        if (index > 0) chapterSvg += `<line x1="${startX}" y1="28" x2="${startX}" y2="${bottomY + 28}" stroke="#ddd9d2" stroke-width="1.5" stroke-dasharray="4,4"/>`;
    });

    let routeSvg = '';
    routes.forEach(route => {
        const routeStart = xForWeek(route.firstWeek);
        const routeEnd = xForWeek(route.lastWeek);
        const progressEnd = Math.max(routeStart, Math.min(routeEnd, currentX));
        routeSvg += `<text x="${left - 12}" y="${route.y + 4}" text-anchor="end" class="cr-source-map-route-label">${esc(route.shortLabel)}</text>`;
        routeSvg += `<line x1="${routeStart}" y1="${route.y}" x2="${routeEnd}" y2="${route.y}" stroke="${route.colour}" stroke-width="7" stroke-linecap="round" opacity=".22"/>`;
        if (progressEnd > routeStart) {
            routeSvg += `<line x1="${routeStart}" y1="${route.y}" x2="${progressEnd}" y2="${route.y}" stroke="${route.colour}" stroke-width="7" stroke-linecap="round"/>`;
        }
        const maintenanceWeeks = route.phases
            .filter(phase => phase.maintenanceOccurrences > 0)
            .map(phase => phase.firstMaintenanceWeek);
        if (maintenanceWeeks.length) {
            const maintenanceStart = Math.min(...maintenanceWeeks);
            routeSvg += `<line x1="${xForWeek(maintenanceStart)}" y1="${route.y}" x2="${routeEnd}" y2="${route.y}" stroke="${route.colour}" stroke-width="7" stroke-dasharray="8,7" opacity=".45"/>`;
        }

        route.phases.forEach((phase) => {
            const isSelected = phase.key === selectedStationKey;
            const phaseStart = phase.authoredFirstWeek ?? phase.firstWeek;
            const phaseEnd = phase.authoredLastWeek ?? phase.lastWeek;
            const isPast = phaseEnd < currentWeek;
            const isCurrent = phaseStart <= currentWeek && phaseEnd >= currentWeek;
            const fill = isPast || isCurrent ? route.colour : '#ffffff';
            const opacity = isPast || isCurrent ? 1 : .9;
            routeSvg += `<circle cx="${phase.x}" cy="${route.y}" r="18" fill="transparent" data-station-key="${esc(phase.key)}" data-testid="curriculum-station-hit-target" class="cr-map-hit-target" role="button" aria-label="${esc(`${route.label}: ${phase.label}`)}" tabindex="0"/>`;
            if (isSelected) routeSvg += `<circle cx="${phase.x}" cy="${route.y}" r="10" fill="none" stroke="${route.colour}" stroke-width="2" opacity=".55"/>`;
            routeSvg += `<circle cx="${phase.x}" cy="${route.y}" r="${isCurrent ? 7 : 5.5}" fill="${fill}" stroke="${route.colour}" stroke-width="2.5" opacity="${opacity}" data-station-key="${esc(phase.key)}" data-testid="curriculum-station" class="cr-map-station" style="pointer-events:none"/>`;
            routeSvg += `<text x="${phase.labelX}" y="${phase.labelY}" text-anchor="middle" class="cr-source-map-station-label">${phase.labelLines.map((line, i) => `<tspan x="${phase.labelX}" dy="${i ? 16 : 0}">${esc(line)}</tspan>`).join('')}</text>`;
        });
    });

    const loyRoute = routes.find(route => route.key === 'light_on_yoga');
    let milestoneSvg = '';
    if (loyRoute) {
        milestones.forEach((milestone) => {
            const x = xForWeek(milestone.programmeWeek);
            milestoneSvg += `<circle cx="${x}" cy="${loyRoute.y}" r="9" fill="#fff" stroke="${loyRoute.colour}" stroke-width="3" pointer-events="none"/>`;
            milestoneSvg += `<circle cx="${x}" cy="${loyRoute.y}" r="3.5" fill="${loyRoute.colour}" pointer-events="none"/>`;
            milestoneSvg += `<text x="${x}" y="${loyRoute.y + 28}" text-anchor="middle" class="cr-source-map-milestone-label" pointer-events="none">${esc(milestone.label)}</text>`;
            if (milestone.afterSourceWeek) {
                milestoneSvg += `<text x="${x}" y="${loyRoute.y + 46}" text-anchor="middle" class="cr-source-map-milestone-anchor" pointer-events="none">after LOY W${milestone.afterSourceWeek}</text>`;
            }
        });
    }

    const currentSvg = `<line x1="${currentX}" y1="34" x2="${currentX}" y2="${bottomY + 30}" stroke="#263b39" stroke-width="1.5" stroke-dasharray="3,3" opacity=".55" pointer-events="none"/>
      <text x="${currentX}" y="45" text-anchor="middle" class="cr-source-map-current" pointer-events="none">YOU ARE HERE · WEEK ${currentWeek}</text>`;

    return `<svg class="cr-map-svg cr-source-map-svg" data-testid="curriculum-map" viewBox="0 0 ${width} ${height}" aria-label="Five-book curriculum map" role="img">
      ${chapterSvg}${routeSvg}${milestoneSvg}${currentSvg}
    </svg>`;
}

function renderMap(placed, currentNodeId, selectedNodeId) {
    if (placed?.routes) return renderSourceMapSvg(placed, selectedNodeId);
    const lastX = placed.length ? placed[placed.length - 1].x : 400;
    const W = lastX + 60;
    const H = 240;

    function stationFill(node) {
        if (node.status === 'current')   return STREAM_COLOUR[node.stream];
        if (['completed', 'repeated', 'plateau', 'rest', 'revision'].includes(node.status))
            return node.stream === 'rest' ? '#d4cfc7' : STREAM_COLOUR[node.stream];
        return 'none';
    }
    function stationStroke(node) {
        return node.status === 'upcoming' ? '#ccc8c0' : STREAM_COLOUR[node.stream];
    }
    function stationOpacity(node) {
        if (['completed', 'repeated', 'plateau', 'rest', 'revision'].includes(node.status)) return '0.72';
        if (node.status === 'upcoming') return '0.45';
        return '1';
    }

    // Integrated-stage separators
    let previousStage = null;
    const stageSeparators = [];
    placed.forEach((n, i) => {
        if (previousStage !== null && n.roadmap_stage_key !== previousStage) {
            stageSeparators.push((placed[i - 1].x + n.x) / 2);
        }
        previousStage = n.roadmap_stage_key;
    });

    let sepSvg = '';
    stageSeparators.forEach(sx => {
        sepSvg += `<line x1="${sx}" y1="20" x2="${sx}" y2="215" stroke="#e5e2dc" stroke-width="1" stroke-dasharray="4,3"/>`;
    });

    // Integrated-stage labels
    const stageGroups = {};
    placed.forEach(n => {
        if (!stageGroups[n.roadmap_stage_key]) {
            stageGroups[n.roadmap_stage_key] = { label: n.roadmap_stage_label, xs: [] };
        }
        stageGroups[n.roadmap_stage_key].xs.push(n.x);
    });
    let levelLabels = '';
    Object.values(stageGroups).forEach(g => {
        if (!g.label) return;
        const midX = (Math.min(...g.xs) + Math.max(...g.xs)) / 2;
        levelLabels += `<text x="${midX}" y="18" text-anchor="middle" font-size="9" fill="#a8a39a" font-family="-apple-system,BlinkMacSystemFont,sans-serif" letter-spacing="0.08em">${esc(g.label.toUpperCase())}</text>`;
    });

    // Lane lines
    const streams = ['asana', 'pranayama', 'revision'];
    let laneLines = '';
    streams.forEach(stream => {
        const pts = placed.filter(n => n.stream === stream || (stream === 'asana' && n.stream === 'combined'));
        if (pts.length < 2) return;
        const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${LANE_Y[stream]}`).join(' ');
        const colour = STREAM_COLOUR[stream];
        const dimmed = stream !== 'asana' ? ' opacity="0.5"' : '';
        laneLines += `<path d="${d}" stroke="${colour}" stroke-width="${stream === 'asana' ? 3 : 2}" fill="none" stroke-linecap="round"${dimmed}/>`;
    });

    // Vertical connectors
    let connectors = '';
    placed.forEach(n => {
        if (n.stream === 'combined') {
            connectors += `<line x1="${n.x}" y1="${LANE_Y.asana}" x2="${n.x}" y2="${LANE_Y.pranayama}" stroke="${STREAM_COLOUR.combined}" stroke-width="2" stroke-dasharray="3,2" opacity="0.4"/>`;
        } else if (n.stream === 'pranayama') {
            connectors += `<line x1="${n.x}" y1="${LANE_Y.pranayama}" x2="${n.x}" y2="${LANE_Y.asana}" stroke="${STREAM_COLOUR.pranayama}" stroke-width="1.5" stroke-dasharray="2,2" opacity="0.3"/>`;
        } else if (n.stream === 'revision') {
            connectors += `<line x1="${n.x}" y1="${LANE_Y.revision}" x2="${n.x}" y2="${LANE_Y.asana}" stroke="${STREAM_COLOUR.revision}" stroke-width="1.5" stroke-dasharray="2,2" opacity="0.3"/>`;
        }
    });

    // Lane labels
    const laneLabels = [
        { stream: 'asana',     label: 'Asana' },
        { stream: 'pranayama', label: 'Pranayama' },
        { stream: 'revision',  label: 'Revision' },
        { stream: 'rest',      label: 'Rest' },
    ];
    let laneLabelsSvg = '';
    laneLabels.forEach(({ stream, label }) => {
        if (!placed.some(n => n.stream === stream)) return;
        laneLabelsSvg += `<text x="${W - 6}" y="${LANE_Y[stream] + 4}" text-anchor="end" font-size="8.5" fill="#a8a39a" font-family="-apple-system,BlinkMacSystemFont,sans-serif">${esc(label)}</text>`;
    });

    // Stations
    let stations = '';
    placed.forEach(n => {
        const isCurrent     = n.id === currentNodeId;
        const isSelected    = n.id === selectedNodeId;
        const isInterchange = n.stream === 'combined';
        const isRest        = n.stream === 'rest';
        const r   = isRest ? 4 : isInterchange ? 9 : 7;
        const fill   = stationFill(n);
        const stroke = stationStroke(n);
        const sw     = isInterchange ? 2.5 : 2;
        const op     = stationOpacity(n);
        const ariaLabel = `Week ${n.week_number} Day ${n.day_number}: ${n.title}`;

        stations += `<circle cx="${n.x}" cy="${n.y}" r="20" fill="transparent" data-id="${n.id}" data-testid="curriculum-station-hit-target" class="cr-map-hit-target" role="button" aria-label="${esc(ariaLabel)}" tabindex="0" style="cursor:pointer"/>`;

        if (isCurrent) {
            stations += `<circle class="cr-map-pulse" cx="${n.x}" cy="${n.y}" r="${r + 8}" fill="none" stroke="${STREAM_COLOUR[n.stream]}" stroke-width="1.5" opacity="0.3"/>`;
        }
        if (isSelected && !isCurrent) {
            stations += `<circle cx="${n.x}" cy="${n.y}" r="${r + 5}" fill="none" stroke="${STREAM_COLOUR[n.stream]}" stroke-width="2.5" opacity="0.9"/>`;
        }
        if (isSelected && isCurrent) {
            stations += `<circle cx="${n.x}" cy="${n.y}" r="${r + 5}" fill="none" stroke="${STREAM_COLOUR[n.stream]}" stroke-width="2.5" opacity="1"/>`;
        }

        if (isInterchange) {
            const fillP   = ['completed', 'repeated', 'plateau'].includes(n.status) ? STREAM_COLOUR.pranayama : 'none';
            const strokeP = n.status === 'upcoming' ? '#ccc8c0' : STREAM_COLOUR.pranayama;
            const ariaLabelP = `Week ${n.week_number} Day ${n.day_number} pranayama part`;
            stations += `<circle cx="${n.x}" cy="${LANE_Y.pranayama}" r="18" fill="transparent" data-id="${n.id}" data-testid="curriculum-station-hit-target" class="cr-map-hit-target" role="button" aria-label="${esc(ariaLabelP)}" tabindex="0" style="cursor:pointer"/>`;
            stations += `<circle cx="${n.x}" cy="${LANE_Y.pranayama}" r="7" fill="${fillP}" stroke="${strokeP}" stroke-width="2.5" opacity="${op}" data-id="${n.id}" data-testid="curriculum-station" class="cr-map-station" style="pointer-events:none"/>`;
        }

        stations += `<circle cx="${n.x}" cy="${n.y}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" opacity="${op}" data-id="${n.id}" data-testid="curriculum-station" class="cr-map-station" style="pointer-events:none"/>`;

        if (isCurrent) {
            stations += `<text x="${n.x}" y="${n.y - r - 6}" text-anchor="middle" font-size="8" fill="${STREAM_COLOUR[n.stream]}" font-weight="700" font-family="-apple-system,BlinkMacSystemFont,sans-serif">${n.is_explicit_current ? 'YOU ARE HERE' : 'NEXT'}</text>`;
        }

        const labelY = isRest ? n.y + 14 : n.y + r + 13;
        stations += `<text x="${n.x}" y="${labelY}" text-anchor="middle" font-size="8" fill="#a8a39a" font-family="-apple-system,BlinkMacSystemFont,sans-serif">W${n.week_number}·D${n.day_number}</text>`;
    });

    return `<svg class="cr-map-svg" data-testid="curriculum-map" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-label="Practice journey map" role="img">
    <defs>
      <style>
        @keyframes cr-pulse { 0% { r: 15; opacity: 0.3; } 55% { r: 22; opacity: 0.07; } 100% { r: 15; opacity: 0.3; } }
        .cr-map-pulse { animation: cr-pulse 2.6s ease-in-out infinite; }
      </style>
    </defs>
    ${sepSvg}${levelLabels}${laneLines}${connectors}${laneLabelsSvg}${stations}
  </svg>`;
}

// ─── Station detail panel ─────────────────────────────────────────────────────

function _renderStationDetail(node, isIdle) {
    if (isIdle) {
        return `<div class="cr-detail cr-detail--prompt" id="cr-detail-inner">
      <svg class="cr-detail-prompt-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><line x1="12" y1="3" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="21"/><line x1="3" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="21" y2="12"/></svg>
      <span class="cr-detail-prompt-text">Select any station on the map to preview that practice</span>
    </div>`;
    }

    const typeLabel   = nodeTypeLabel(node);
    const dur         = formatDuration(node.duration_minutes);
    const comp        = node.curriculum_payload?.practice_composition;
    const isComposed  = Array.isArray(comp) && comp.length > 1;
    const isToday     = node.status === 'current';
    const isRestNode  = node.node_type === 'rest' || node.node_type === 'recovery' || node.day_role === 'recovery';
    const isRevision  = ['revision', 'choice', 'instruction', 'consolidation'].includes(node.node_type);

    // Source label: suppress for rest/revision, use "Source: <name> — <ref>" for others
    let sourceLabel = null;
    if (!isRestNode && !isRevision && node.source_name && node.source_name !== ACTIVE_CURRICULUM_NAME) {
        sourceLabel = node.source_reference
            ? `${node.source_name} — ${node.source_reference}`
            : node.source_name;
    }

    const starsHtml = node.best_rating != null ? (() => {
        let s = '<span class="cr-stars">';
        for (let i = 1; i <= 5; i++) s += `<span class="${i <= node.best_rating ? 'cr-star--filled' : 'cr-star--empty'}">★</span>`;
        s += '</span>';
        const meta = ratingMeta(node.best_rating);
        if (meta) s += ` <span class="cr-detail-rating-label">${esc(meta.label)}</span>`;
        return s;
    })() : null;

    const partsHtml = isComposed
        ? `<div class="cr-detail-parts">${comp.map((p, idx) => `
          <div class="cr-detail-part">
            <span class="cr-detail-part-label">${esc(roleLabel(p.role))}</span>
            <span class="cr-detail-part-title">Part ${idx + 1}</span>
            ${p.source_name ? `<span class="cr-detail-part-source">Source: ${esc(p.source_name)}${p.source_reference ? ` — ${esc(p.source_reference)}` : ''}</span>` : ''}
            ${p.duration_minutes ? `<span class="cr-detail-part-dur">${formatDuration(p.duration_minutes)}</span>` : ''}
          </div>`).join('')}
        </div>` : '';

    const chipKey = isToday ? 'current' : DONE_STATUSES.includes(node.status) ? 'done' : 'ahead';
    const currentLabel = node.is_explicit_current ? 'Today' : 'Next';
    const chipLabel = isToday
        ? currentLabel
        : { completed: 'Done', repeated: 'Repeated', plateau: 'Plateau', rest: 'Rest', revision: 'Revision', upcoming: 'Not completed' }[node.status] || node.status;

    const eyebrow = isToday
        ? `<div class="cr-detail-week cr-detail-week--today">${node.is_explicit_current ? "Today's Practice" : 'Next Practice'}</div>`
        : `<div class="cr-detail-week">Week ${node.week_number} · Day ${node.day_number}</div>`;

    return `<div class="cr-detail${isToday ? ' cr-detail--today' : ''}" id="cr-detail-inner">
    <div class="cr-detail-head">${eyebrow}<span class="cr-chip cr-chip--${chipKey}">${esc(chipLabel)}</span></div>
    <div class="cr-detail-title">${esc(node.title)}</div>
    ${typeLabel && node.node_type !== 'sequence' ? `<div class="cr-detail-type">${esc(typeLabel)}</div>` : ''}
    <div class="cr-detail-meta">
      ${dur && !isRestNode ? `<span class="cr-detail-meta-item">${esc(dur)}</span>` : ''}
      ${sourceLabel ? `<span class="cr-detail-meta-item">${esc(sourceLabel)}</span>` : ''}
      ${node.day_role ? `<span class="cr-detail-meta-item">${esc(tokenLabel(node.day_role))}</span>` : ''}
      ${node.recovery_type ? `<span class="cr-detail-meta-item">${esc(tokenLabel(node.recovery_type))}</span>` : ''}
      ${node.intensity ? `<span class="cr-detail-meta-item cr-detail-meta-intensity">${esc(intensityLabel(node.intensity) || node.intensity)}</span>` : ''}
    </div>
    ${partsHtml}
    ${node.special_instructions ? `<div class="cr-detail-repeat-note">${esc(node.special_instructions)}</div>` : ''}
    ${starsHtml ? `<div class="cr-detail-rating">${starsHtml}</div>` : ''}
    ${node.completion_count > 1 ? `<div class="cr-detail-repeat-note">${node.completion_count}× completed</div>` : ''}
  </div>`;
}

// ─── Summary strip ────────────────────────────────────────────────────────────

function renderSummaryStrip(summary) {
    const pct = summary.position_percent || 0;
    return `<div class="cr-summary">
    <div class="cr-summary-stats">
      <div class="cr-stat">
        <span class="cr-stat-label">${esc(summary.position_label || 'Position')}</span>
        <span class="cr-stat-value">${esc(summary.position_text || 'Not started')}</span>
      </div>
      <div class="cr-stat">
        <span class="cr-stat-label">Current chapter</span>
        <span class="cr-stat-value">${esc(summary.chapter_display)}</span>
      </div>
      <div class="cr-stat">
        <span class="cr-stat-label">Current week</span>
        <span class="cr-stat-value">${esc(summary.week_display)}</span>
      </div>
      <div class="cr-stat">
        <span class="cr-stat-label">Curriculum position</span>
        <span class="cr-stat-value">${esc(summary.curriculum_display)}</span>
        <span class="cr-stat-sub">Mastering repeated material may shorten the path</span>
      </div>
    </div>
    <div class="cr-progress-bar-wrap" aria-label="Curriculum position: ${pct}%">
      <div class="cr-progress-bar"><div class="cr-progress-bar-fill" style="width:${pct}%"></div></div>
    </div>
  </div>`;
}

// ─── List view ────────────────────────────────────────────────────────────────

function renderStars(rating) {
    if (rating == null) return '';
    const meta = ratingMeta(rating);
    const title = meta ? `${meta.label} — ${meta.subtitle}` : `${rating}/5`;
    let html = `<span class="cr-stars" aria-label="${esc(title)}" title="${esc(title)}">`;
    for (let i = 1; i <= 5; i++) html += `<span class="${i <= rating ? 'cr-star--filled' : 'cr-star--empty'}">★</span>`;
    return html + '</span>';
}

function renderNodeCard(node, currentNodeId) {
    const isCurrent  = node.id === currentNodeId;
    const isRest     = node.node_type === 'rest' || node.node_type === 'recovery' || node.day_role === 'recovery';
    const isRevision = ['revision', 'choice', 'instruction', 'consolidation'].includes(node.node_type);
    const dur        = formatDuration(node.duration_minutes);
    const comp       = node.curriculum_payload?.practice_composition;
    const isComposed = Array.isArray(comp) && comp.length > 1;
    const milestone  = milestoneForNode(node);

    let chipHtml;
    if (isCurrent)                      chipHtml = `<span class="cr-chip cr-chip--current">${node.is_explicit_current ? 'Today' : 'Next'}</span>`;
    else if (isRest)                    chipHtml = `<span class="cr-chip cr-chip--rest">${node.node_type === 'recovery' ? 'Recovery' : 'Rest'}</span>`;
    else if (isRevision)                chipHtml = `<span class="cr-chip cr-chip--revision">${esc(nodeTypeLabel(node) || 'Review')}</span>`;
    else if (node.status === 'plateau') chipHtml = '<span class="cr-chip cr-chip--plateau">Plateau</span>';
    else if (node.status === 'repeated') chipHtml = '<span class="cr-chip cr-chip--repeated">Repeated</span>';
    else if (node.status === 'completed') chipHtml = '<span class="cr-chip cr-chip--done">Done</span>';
    else                                chipHtml = '<span class="cr-chip cr-chip--upcoming">Not completed</span>';

    const composition = Array.isArray(comp) ? comp : [];
    // A recovery day can still be a real composed practice. Only pure
    // recovery/rest nodes should be acknowledgement-only cards.
    const isPlayable = (node.sequence_id != null
        || composition.some(part => part?.sequence_id != null));

    // Source: suppress for rest/revision
    let sourceText = null;
    if (!isRest && !isRevision && node.source_name && node.source_name !== ACTIVE_CURRICULUM_NAME) {
        sourceText = node.source_reference ? `${node.source_name} — ${node.source_reference}` : node.source_name;
    }

    const metaRow = [
        dur && !isRest ? `<span class="cr-node-dur">${esc(dur)}</span>` : '',
        sourceText ? `<span class="cr-node-source">${esc(sourceText)}</span>` : '',
        node.primary_focus && !isRest && !isRevision ? `<span class="cr-node-theme">${esc(node.primary_focus)}</span>` : '',
        node.day_role ? `<span class="cr-node-theme">${esc(tokenLabel(node.day_role))}</span>` : '',
        node.recovery_type ? `<span class="cr-node-theme">${esc(tokenLabel(node.recovery_type))}</span>` : '',
    ].filter(Boolean).join('');

    const partsHtml = isComposed
        ? `<div class="cr-node-parts">${comp.map((p, idx) => `
          <div class="cr-node-part">
            <span class="cr-node-part-label">${esc(roleLabel(p.role))}</span>
            <span class="cr-node-part-title">Part ${idx + 1}</span>
            ${p.source_name ? `<span class="cr-node-part-source">${esc(p.source_name)}</span>` : ''}
          </div>`).join('')}
        </div>` : '';

    const cardMod = [
        isCurrent ? ' cr-node--current' : '',
        DONE_STATUSES.includes(node.status) && !isCurrent ? ' cr-node--done' : '',
        node.status === 'upcoming' ? ' cr-node--upcoming' : '',
        milestone ? ' cr-node--milestone' : '',
    ].join('');

    const activePractice = window.currentCurriculumPractice?.curriculum_node_id === node.id;
    const actionLabel = activePractice
        ? 'Open practice'
        : DONE_STATUSES.includes(node.status) ? 'Practise again' : node.completion_count > 0 ? 'Continue' : 'Practise';

    return `<div class="cr-node${cardMod}${activePractice ? ' cr-node--active-practice' : ''}">
    <div class="cr-node-row">
      <span class="cr-node-day">D${node.day_number}</span>
      <div class="cr-node-body">
        <div class="cr-node-head">
          <span class="cr-node-title">${esc(node.title)}</span>
          ${chipHtml}
          ${milestone ? '<span class="cr-chip cr-chip--milestone">Weekly milestone</span>' : ''}
        </div>
        ${metaRow ? `<div class="cr-node-meta">${metaRow}</div>` : ''}
      </div>
      ${['completed', 'repeated', 'plateau'].includes(node.status) && node.best_rating != null ? `<div class="cr-node-rating">${renderStars(node.best_rating)}</div>` : ''}
      ${isPlayable ? `<button type="button" class="cr-node-practise" data-curriculum-node-id="${esc(node.id)}">${actionLabel}</button>` : ''}
    </div>
    ${partsHtml}
  </div>`;
}

function groupWeeksIntoPracticeBlocks(weeks) {
    const blocks = [];
    for (let offset = 0; offset < weeks.length; offset += 10) {
        const blockWeeks = weeks.slice(offset, offset + 10);
        const nodes = blockWeeks.flatMap(week => week.nodes);
        blocks.push({
            startWeek: blockWeeks[0].week_number,
            endWeek: blockWeeks.at(-1).week_number,
            weeks: blockWeeks,
            nodes,
            status: computeGroupStatus(nodes),
        });
    }
    return blocks;
}

function renderCurriculumWeek(week, currentNodeId) {
    const hasCurrent = week.nodes.some(node => node.id === currentNodeId);
    const allDone = week.nodes.length > 0
        && week.nodes.every(node => DONE_STATUSES.includes(node.status));
    const doneCount = week.nodes.filter(node =>
        DONE_STATUSES.includes(node.status)).length;
    let status = '';
    if (hasCurrent) status = '<span class="cr-week-status cr-week-status--current">Current</span>';
    else if (allDone) status = '<span class="cr-week-status cr-week-status--done">Complete</span>';
    else if (doneCount > 0) status = '<span class="cr-week-status cr-week-status--current">Started</span>';
    const open = hasCurrent || (doneCount > 0 && !allDone) ? ' open' : '';
    const milestone = week.nodes.map(node => milestoneForNode(node)).find(Boolean);
    const milestoneBanner = milestone
        ? `<div class="cr-milestone-banner" data-testid="curriculum-milestone">
            <strong>${esc(milestone.label)}</strong>
            ${milestone.afterSourceWeek ? `<span>After Light on Yoga Week ${milestone.afterSourceWeek}</span>` : ''}
          </div>`
        : '';

    return `<details class="cr-week"${open}>
      <summary class="cr-week-summary">
        <svg class="cr-chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="5,3 11,8 5,13"/></svg>
        <span class="cr-week-label">Week ${week.week_number}</span>
        ${status}
        <span class="cr-week-count">${doneCount}/${week.nodes.length}</span>
      </summary>
      ${milestoneBanner}
      <div class="cr-nodes">
        ${week.nodes.map(node => renderNodeCard(node, currentNodeId)).join('')}
      </div>
    </details>`;
}

function renderListView(levels, currentNodeId) {
    return `<div class="cr-list-toolbar" aria-label="Curriculum list controls">
      <button type="button" class="cr-list-control" id="cr-expand-all">Expand all</button>
      <button type="button" class="cr-list-control" id="cr-collapse-all">Collapse all</button>
      <span class="cr-list-control-status" id="cr-list-control-status" aria-live="polite"></span>
    </div>
    <div class="cr-levels" id="cr-list-view">
    ${levels.map(level => {
        const isComplete = level.status === 'complete';
        const isCurrent = level.status === 'current';
        const chapterStatus = isComplete
            ? '<span class="cr-level-status cr-level-status--done">Complete</span>'
            : isCurrent
                ? '<span class="cr-level-status cr-level-status--current">Current</span>'
                : '<span class="cr-level-status cr-level-status--upcoming">Coming later</span>';
        const blocks = groupWeeksIntoPracticeBlocks(level.weeks).map(block => {
            const hasCurrent = block.nodes.some(node => node.id === currentNodeId);
            const doneCount = block.nodes.filter(node =>
                DONE_STATUSES.includes(node.status)).length;
            const blockStatus = block.status === 'complete'
                ? '<span class="cr-week-status cr-week-status--done">Complete</span>'
                : hasCurrent
                    ? '<span class="cr-week-status cr-week-status--current">Current</span>'
                    : '';
            const open = hasCurrent || (doneCount > 0 && block.status !== 'complete') ? ' open' : '';
            return `<details class="cr-practice-block"${open}>
          <summary class="cr-practice-block-summary">
            <svg class="cr-chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="5,3 11,8 5,13"/></svg>
            <span class="cr-practice-block-label">Weeks ${block.startWeek}–${block.endWeek}</span>
            ${blockStatus}
            <span class="cr-week-count">${doneCount}/${block.nodes.length}</span>
          </summary>
          <div class="cr-practice-block-weeks">
            ${block.weeks.map(week => renderCurriculumWeek(week, currentNodeId)).join('')}
          </div>
        </details>`;
        }).join('');

        return `<details class="cr-level"${isCurrent ? ' open' : ''}>
        <summary class="cr-level-summary">
          <svg class="cr-chevron cr-level-chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="5,3 11,8 5,13"/></svg>
          <span class="cr-level-label">${esc(level.label)}</span>
          ${chapterStatus}
        </summary>
        <div class="cr-practice-blocks">${blocks}</div>
      </details>`;
    }).join('')}
  </div>`;
}

// ─── Map view wrapper ─────────────────────────────────────────────────────────

function sourceStationByKey(model, key) {
    for (const route of model.routes) {
        const phase = route.phases.find(item => item.key === key);
        if (phase) return { ...phase, route };
    }
    return null;
}

function defaultSourceStation(model) {
    for (const route of model.routes) {
        const phase = route.phases.find(item =>
            (item.authoredFirstWeek ?? item.firstWeek) <= model.currentWeek
            && (item.authoredLastWeek ?? item.lastWeek) >= model.currentWeek);
        if (phase) return { ...phase, route };
    }
    const route = model.routes[0];
    const reached = route?.phases.filter(item =>
        (item.authoredFirstWeek ?? item.firstWeek) <= model.currentWeek).at(-1);
    return reached ? { ...reached, route } : route?.phases[0] ? { ...route.phases[0], route } : null;
}

function renderSourceStationDetail(station) {
    if (!station) {
        return `<div class="cr-detail cr-detail--prompt">
          <span class="cr-detail-prompt-text">Select a station to inspect a book phase.</span>
        </div>`;
    }
    const phaseStart = station.authoredFirstWeek ?? station.firstWeek;
    const phaseEnd = station.authoredLastWeek ?? station.lastWeek;
    const weekRange = phaseStart === phaseEnd
        ? `Week ${phaseStart}`
        : `Weeks ${phaseStart}–${phaseEnd}`;
    const courseCount = station.sequenceIds.length;
    const authoredAppearances = station.occurrences - station.maintenanceOccurrences;
    const maintenanceNote = station.maintenanceOccurrences > 0
        ? `<div class="cr-detail-repeat-note">${station.maintenanceOccurrences} later maintenance appearances are shown as dashed track.</div>`
        : '';
    return `<div class="cr-detail cr-source-detail">
      <div class="cr-detail-head"><span class="cr-detail-week">${esc(weekRange)}</span></div>
      <div class="cr-detail-title">${esc(station.label)}</div>
      <div class="cr-detail-type" style="color:${station.route.colour}">${esc(station.route.label)}</div>
      <div class="cr-detail-meta">
        <span class="cr-detail-meta-item">${courseCount} ${courseCount === 1 ? 'course' : 'courses'}</span>
        <span class="cr-detail-meta-item">${authoredAppearances} authored appearances</span>
      </div>
      ${maintenanceNote}
    </div>`;
}

function renderMapView(placed, currentNodeId) {
    const defaultStation = defaultSourceStation(placed);
    const mapSvg = renderMap(placed, currentNodeId, defaultStation?.key);
    return `<div id="cr-map-view">
    <div class="cr-map-content">
      <div class="cr-map-main">
        <div class="cr-map-topbar">
        <div class="cr-map-legend">
            ${placed.routes.map(route => `<span class="cr-legend-item"><span class="cr-legend-line" style="background:${route.colour}"></span>${esc(route.label)}</span>`).join('')}
            <span class="cr-legend-item"><span class="cr-legend-dashed"></span>Maintenance</span>
          </div>
        </div>
        <div class="cr-map-scroll">${mapSvg}</div>
      </div>
      <div class="cr-detail-section">
        <div class="cr-detail-section-label">Source phase</div>
        <div class="cr-detail-wrap" id="cr-detail-wrap" data-testid="curriculum-detail">${renderSourceStationDetail(defaultStation)}</div>
      </div>
    </div>
  </div>`;
}

// ─── Full roadmap render ──────────────────────────────────────────────────────

function renderRoadmap(assembledNodes, levels, summary) {
    const placed = buildLayout(assembledNodes);

    return `
    <div class="cr-program-name">${esc(ACTIVE_CURRICULUM_NAME)}</div>
    ${renderSummaryStrip(summary)}
    <div class="cr-view-toggle" role="tablist" aria-label="Journey view">
      <button class="cr-view-btn" id="cr-btn-map" role="tab" aria-selected="false">Map view</button>
      <button class="cr-view-btn cr-view-btn--active" id="cr-btn-list" role="tab" aria-selected="true">List view</button>
    </div>
    <div id="cr-map-container" style="display:none">${renderMapView(placed, summary.current_node_id)}</div>
    <div id="cr-list-container">${renderListView(levels, summary.current_node_id)}</div>`;
}

// ─── View toggle ──────────────────────────────────────────────────────────────

function wireViewToggle() {
    const mapBtn  = document.getElementById('cr-btn-map');
    const listBtn = document.getElementById('cr-btn-list');
    if (!mapBtn || !listBtn) return;

    function activateView(view) {
        const mapDiv  = document.getElementById('cr-map-container');
        const listDiv = document.getElementById('cr-list-container');
        if (!mapDiv || !listDiv) return;
        if (view === 'map') {
            mapDiv.style.display   = '';
            listDiv.style.display  = 'none';
            mapBtn.classList.add('cr-view-btn--active');     mapBtn.setAttribute('aria-selected', 'true');
            listBtn.classList.remove('cr-view-btn--active'); listBtn.setAttribute('aria-selected', 'false');
        } else {
            mapDiv.style.display   = 'none';
            listDiv.style.display  = '';
            listBtn.classList.add('cr-view-btn--active');   listBtn.setAttribute('aria-selected', 'true');
            mapBtn.classList.remove('cr-view-btn--active'); mapBtn.setAttribute('aria-selected', 'false');
        }
    }

    mapBtn.addEventListener('click',  () => activateView('map'));
    listBtn.addEventListener('click', () => activateView('list'));
}

function wireListControls() {
    const list = document.getElementById('cr-list-view');
    const expand = document.getElementById('cr-expand-all');
    const collapse = document.getElementById('cr-collapse-all');
    const status = document.getElementById('cr-list-control-status');
    if (!list || !expand || !collapse) return;

    const setAll = (open) => {
        list.querySelectorAll('details').forEach((details) => {
            details.open = open;
        });
        if (status) status.textContent = open
            ? 'All curriculum sections expanded.'
            : 'All curriculum sections collapsed.';
    };
    expand.addEventListener('click', () => setAll(true));
    collapse.addEventListener('click', () => setAll(false));
}

function wirePracticeButtons() {
    const body = document.getElementById('curriculumMapBody');
    if (!body || body.dataset.practiceButtonsWired === 'true') return;
    body.dataset.practiceButtonsWired = 'true';

    body.addEventListener('click', async (event) => {
        const button = event.target.closest('.cr-node-practise');
        if (!button) return;
        event.preventDefault();
        event.stopPropagation();
        const nodeId = button.getAttribute('data-curriculum-node-id');
        if (!nodeId || button.disabled) return;

        button.disabled = true;
        button.textContent = 'Loading…';
        const progressBackdrop = body.closest('#historyBackdrop');
        if (progressBackdrop) {
            progressBackdrop.style.display = 'none';
            document.body.classList.remove('modal-open');
        } else {
            closeCurriculumRoadmap();
        }
        try {
            if (typeof window.startTodayPractice !== 'function') {
                throw new Error('The curriculum practice flow is unavailable.');
            }
            await window.startTodayPractice(nodeId);
        } catch (error) {
            console.error('[curriculumRoadmapUI] Failed to open selected practice:', error);
        } finally {
            button.disabled = false;
            button.textContent = 'Practise';
        }
    });
}

// ─── Station click handling ───────────────────────────────────────────────────

function wireMapClicks(assembledNodes, currentNodeId, body) {
    const model = buildLayout(assembledNodes);
    if (!body) return;

    function handleSelect(stationKey) {
        const station = sourceStationByKey(model, stationKey);
        if (!station) return;

        const mapScroll = body.querySelector('.cr-map-scroll');
        if (mapScroll) mapScroll.innerHTML = renderMap(model, currentNodeId, stationKey);

        const detailWrap = document.getElementById('cr-detail-wrap');
        if (detailWrap) {
            detailWrap.innerHTML = renderSourceStationDetail(station);
            if (window.innerWidth < 600) {
                detailWrap.closest('.cr-detail-section')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        }
    }

    body.onclick = e => {
        const circle = e.target.closest('.cr-map-hit-target, .cr-map-station');
        if (circle) handleSelect(circle.getAttribute('data-station-key'));
    };

    body.onkeydown = e => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const circle = e.target.closest('.cr-map-hit-target, .cr-map-station');
        if (!circle) return;
        e.preventDefault();
        handleSelect(circle.getAttribute('data-station-key'));
    };
}

// ─── Open / close ─────────────────────────────────────────────────────────────

export async function openCurriculumRoadmap({ completionNotice = null, embedded = false, focusNodeId = null } = {}) {
    const backdrop = document.getElementById('historyBackdrop');
    const body     = document.getElementById('curriculumMapBody');
    if (!backdrop || !body) return;

    captureDurationDialPosition();

    // Show modal immediately with loading state
    backdrop.style.display = 'flex';
    document.body.classList.add('modal-open');
    body.innerHTML = '<div class="cr-loading cr-loading--full">Loading curriculum map...</div>';

    try {
        const { nodes, completions } = await loadRoadmapData();

        // Get current node from live app state
        const currentPractice = window.currentCurriculumPractice;
        const currentNodeId   = currentPractice?.curriculum_node_id ?? null;

        const assembledNodes = assembleRoadmapNodes(nodes, completions, currentNodeId);
        const currentNode    = assembledNodes.find(n => n.is_current) || null;
        const effectiveCurrentNodeId = currentNode?.id ?? null;
        const levels         = groupIntoLevels(assembledNodes);
        const summary        = buildSummary(levels, assembledNodes, currentNode);

        body.innerHTML = renderRoadmap(assembledNodes, levels, summary);
        if (completionNotice) {
            const notice = document.createElement('div');
            notice.className = 'cr-completion-notice';
            notice.setAttribute('role', 'status');
            notice.innerHTML = `<strong>Practice complete</strong><span>${esc(completionNotice.title || 'Your practice has been recorded.')} · Rating ${esc(completionNotice.rating)}</span>`;
            body.prepend(notice);
        }

        wireViewToggle();
        wireListControls();
        wirePracticeButtons();
        wireMapClicks(assembledNodes, effectiveCurrentNodeId, body);

        const targetNodeId = focusNodeId ?? currentNode?.id ?? null;
        if (targetNodeId != null) {
            const targetButton = [...body.querySelectorAll('[data-curriculum-node-id]')]
                .find((button) => String(button.getAttribute('data-curriculum-node-id')) === String(targetNodeId));
            const targetCard = targetButton?.closest('.cr-node');
            if (targetCard) {
                targetCard.classList.add('cr-node--focused');
                targetCard.closest('details')?.setAttribute('open', '');
                targetCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
    } catch (err) {
        console.error('[curriculumRoadmapUI] Failed to load roadmap:', err);
        body.innerHTML = `<div class="cr-loading cr-loading--error">Failed to load curriculum map. Please try again.</div>`;
    }
}

function closeCurriculumRoadmap() {
    const backdrop = document.getElementById('historyBackdrop');
    if (backdrop) backdrop.style.display = 'none';
    document.body.classList.remove('modal-open');
    restoreDurationDialPosition();
    if (roadmapTriggerBeforeOpen instanceof HTMLElement) roadmapTriggerBeforeOpen.focus();
    roadmapTriggerBeforeOpen = null;
}

export function restoreRoadmapState() {
    restoreDurationDialPosition();
}

// ─── Setup ────────────────────────────────────────────────────────────────────

export function setupCurriculumRoadmapUI() {
    window.openCurriculumRoadmap = openCurriculumRoadmap;
}
