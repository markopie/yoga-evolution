// src/ui/courseUI.js
// Course/Sequence dropdown rendering + collage/plate renderers

import { matchesSequence, sequenceLabel } from '../services/sequenceTeaching.js';
import { fetchCourseIdsByPoseIds, parsePoseFilterIds } from "../services/coursePoseIndexService.js";
import { poseIdFromSequenceNode } from "../utils/poseId.js";

// ─────────────────────────────────────────────────────────────────────────────
// TEACHING CARD GROUPS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds a responsive <div class="collage"> element from a list of image URLs.
 * Uses <picture> with a mobile srcset for bandwidth savings.
 */
export function renderCollage(poseIds) {
    const wrap = document.createElement("div");
    wrap.className = "teaching-card-group";
    poseIds.forEach(id => {
        const asana = window.findAsanaByIdOrPlate?.(id) || window.asanaLibrary?.[id];
        wrap.appendChild(window.renderTeachingCard({ asana, poseId: id }));
    });
    return wrap;
}

/**
 * Renders a named plate section inside a detail view.
 * Shows a list of plate tokens as text-first teaching cards.
 *
 * @param {string}  title      - Section header text ("Final Poses", etc.)
 * @param {Array}   plates     - Array of plate IDs to render.
 * @param {Set}     globalSeen - Cross-section de-dup Set; mutated in place.
 * @param {string}  fallbackId - Fallback plate ID to try if the main list yields no images.
 */
export function renderPlateSection(title, plates, globalSeen, fallbackId) {
    const wrap   = document.createElement("div");
    const header = document.createElement("div");
    header.className   = "section-title";
    header.textContent = title;
    wrap.appendChild(header);

    const targets = (plates && plates.length) ? plates : [];
    if (!targets.length && !fallbackId) {
        const msg = document.createElement("div");
        msg.className   = "msg";
        msg.textContent = "–";
        wrap.appendChild(msg);
        return wrap;
    }

    const seen    = new Set();

    const processIds = (idList) => {
        for (const p of idList) {
            if (!p || p === "undefined") continue;
            const g = globalSeen || null;
            if (!seen.has(p) && !(g && g.has(p))) {
                seen.add(p);
                if (g) g.add(p);
            }
        }
    };
    processIds(targets);

    if (!seen.size && fallbackId) seen.add(fallbackId);

    if (targets.length) {
        const meta = document.createElement("div");
        meta.className        = "muted";
        meta.style.marginTop  = "4px";
        meta.style.fontSize   = "0.8rem";
        meta.textContent      = `Ref Plates: ${targets.join(", ")}`;
        wrap.appendChild(meta);
    }

    if (seen.size) wrap.appendChild(renderCollage([...seen]));

    return wrap;
}

// ─────────────────────────────────────────────────────────────────────────────
// CATEGORY FILTER DROPDOWN
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Rebuilds the category filter <select> from the current global courses list.
 * Groups categories by their parent prefix (e.g., "Asana > Standing").
 */
export function renderCategoryFilter() {
    const filterEl = document.getElementById("categoryFilter");
    if (!filterEl) return;

    const courses = window.courses || [];

    const uniqueCats = new Set();
    courses.forEach(c => {
        const cat = c.category ? c.category.trim() : "Uncategorized";
        uniqueCats.add(cat);
    });

    const currentVal = filterEl.value;
    filterEl.innerHTML = `<option value="ALL">📂 All Collections</option>`;

    const structuredCats = {};
    Array.from(uniqueCats).sort().forEach(cat => {
        const parts = cat.split(">");
        let group = "General";
        let label = cat;
        if (parts.length > 1) {
            group = parts[0].trim();
            label = parts.slice(1).join(">").trim();
        }
        if (!structuredCats[group]) structuredCats[group] = [];
        structuredCats[group].push({ value: cat, label });
    });

    Object.keys(structuredCats).sort().forEach(groupName => {
        let parentEl = filterEl;
        if (groupName !== "General") {
            const optgroup = document.createElement("optgroup");
            optgroup.label = groupName;
            filterEl.appendChild(optgroup);
            parentEl = optgroup;
        }

        structuredCats[groupName].forEach(item => {
            const opt = document.createElement("option");
            opt.value = item.value;

            let icon = "📄";
            if (groupName === "General" || item.value === item.label) {
                icon = "📁";
                if (item.value.includes("Asana"))       icon = "🧘";
                else if (item.value.includes("Therapeutic")) icon = "❤️";
                else if (item.value.includes("Pranayama"))   icon = "🌬️";
            }
            opt.textContent = `${icon} ${item.label}`;
            parentEl.appendChild(opt);
        });
    });

    filterEl.value = currentVal || "ALL";
    filterEl.onchange = () => {
        const sel = document.getElementById("sequenceSelect");
        if (sel) {
            sel.value = ""; // Clear sequence if user changes category
            sel.dispatchEvent(new Event("change"));
        }
        renderCourseUI();
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// COURSE SELECTOR (SEQUENCE DROPDOWN)
// ─────────────────────────────────────────────────────────────────────────────

export function updateActiveCategoryTitle() {
    const filterEl = document.getElementById("categoryFilter");
    const activeTitleEl = document.getElementById("activeCategoryTitle");
    if (!activeTitleEl) return;

    let displayCat = null;
    let didChangeFilter = false;

    // The player source comes from its active practice, never the manual picker.
    const practice = window.currentCurriculumPractice;
    if (practice) {
        const sources = practice.is_composed_practice
            ? (practice.composition_parts || []).map(part => part.source_name).filter(Boolean)
            : [];
        displayCat = [...new Set(sources)].join(' · ') || practice.source_name
            || window.currentSequence?.category?.split('>')[0].trim();
    } else if (window.currentSequence) {
        const courseCat = window.currentSequence.category || "Uncategorized";

        // Auto-update the category dropdown to match the selected sequence
        // if user found it via "All Collections"
        if (filterEl && filterEl.value === "ALL") {
            filterEl.value = courseCat;
            didChangeFilter = true;
        }

        const parts = courseCat.split(">");
        displayCat = parts[0].trim();
    }
    // Otherwise, if no sequence is selected but a filter IS applied
    else if (filterEl && filterEl.value !== "ALL" && filterEl.value) {
        const parts = filterEl.value.split(">");
        displayCat = parts[0].trim();
    }

    if (displayCat) {
        activeTitleEl.textContent = displayCat;
        activeTitleEl.style.display = "block";
    } else {
        activeTitleEl.style.display = "none";
    }

    // Rebuild sequence options properly if we forcefully changed the category dropdown above
    if (didChangeFilter && typeof renderCourseUI === "function") {
        renderCourseUI();
    }
}

function courseContainsPose(course, targets) {
    if (!targets.length) return true;
    const poses = course.poses || [];
    return poses.some((node) => targets.includes(poseIdFromSequenceNode(node)));
}

const poseFilterIndexState = {
    target: '',
    ids: null,
    loading: false,
    error: null,
    requestId: 0,
};

function courseId(course) {
    const id = course?.supabaseId ?? course?.id;
    return id == null ? '' : String(id);
}

async function requestPoseFilterMatches(poseFilter) {
    const targets = parsePoseFilterIds(poseFilter);
    const targetKey = targets.join(',');

    if (!targetKey) {
        poseFilterIndexState.requestId += 1;
        poseFilterIndexState.target = '';
        poseFilterIndexState.ids = null;
        poseFilterIndexState.loading = false;
        poseFilterIndexState.error = null;
        return;
    }

    if (poseFilterIndexState.target === targetKey && (poseFilterIndexState.loading || poseFilterIndexState.ids || poseFilterIndexState.error)) {
        return;
    }

    const requestId = poseFilterIndexState.requestId + 1;
    poseFilterIndexState.target = targetKey;
    poseFilterIndexState.ids = null;
    poseFilterIndexState.loading = true;
    poseFilterIndexState.error = null;
    poseFilterIndexState.requestId = requestId;

    try {
        const ids = await fetchCourseIdsByPoseIds(targets);
        if (poseFilterIndexState.requestId !== requestId) return;
        poseFilterIndexState.ids = ids;
        poseFilterIndexState.loading = false;
        poseFilterIndexState.error = null;
        renderCourseUI();
    } catch (error) {
        if (poseFilterIndexState.requestId !== requestId) return;
        console.warn('[courseUI] Falling back to local pose filtering:', error);
        poseFilterIndexState.ids = null;
        poseFilterIndexState.loading = false;
        poseFilterIndexState.error = error;
        renderCourseUI();
    }
}

function setupPoseSequenceFilter() {
    const input = document.getElementById('poseSequenceFilter');
    const clearBtn = document.getElementById('clearPoseSequenceFilter');
    if (!input || input.dataset.wired === 'true') return;

    let timer = null;
    const rerender = () => {
        clearTimeout(timer);
        timer = setTimeout(() => renderCourseUI(), 80);
    };

    document.getElementById('sequenceSearch')?.addEventListener('input', rerender);
    input.dataset.wired = 'true';
    input.addEventListener('input', rerender);

    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            input.value = '';
            renderCourseUI();
            input.focus();
        });
    }
}

/**
 * Rebuilds the sequence <select> filtered by the current category selection.
 * Groups courses by their category string and sorts alphabetically.
 */
export function renderCourseUI() {
    const sel      = document.getElementById("sequenceSelect");
    const filterEl = document.getElementById("categoryFilter");
    const poseFilterEl = document.getElementById("poseSequenceFilter");
    const poseStatusEl = document.getElementById("poseSequenceFilterStatus");
    if (!sel) return;

    const courses    = window.courses || [];
    const filterVal  = filterEl ? filterEl.value : "ALL";
    const poseFilter = poseFilterEl ? poseFilterEl.value.trim() : "";
    const poseTargets = parsePoseFilterIds(poseFilter);
    const poseTargetKey = poseTargets.join(',');
    const currentVal = sel.value;
    let matchedCount = 0;
    let outsideCount = 0;

    requestPoseFilterMatches(poseTargets.length ? poseTargets : '');

    sel.innerHTML = `<option value="">Choose a sequence</option>`;

    const grouped = {};
    // While the pose ID filter is active the title search is ignored so a stale
    // query can't silently hide matches; matches outside the collection are counted.
    const searchingByPose = poseTargetKey.length > 0;
    courses.forEach((course, idx) => {
        const cat = course.category ? course.category.trim() : "Uncategorized";
        const inCollection = filterVal === "ALL" || cat === filterVal;
        if (!searchingByPose) {
            if (!matchesSequence(course, document.getElementById('sequenceSearch')?.value || '')) return;
            if (!inCollection) return;
        }
        if (searchingByPose) {
            const useIndex = poseFilterIndexState.target === poseTargetKey && poseFilterIndexState.ids;
            const fallbackToLocalScan = poseFilterIndexState.target === poseTargetKey && poseFilterIndexState.error;
            const indexLoading = poseFilterIndexState.target === poseTargetKey && poseFilterIndexState.loading;

            if (useIndex && !poseFilterIndexState.ids.has(courseId(course))) return;
            if (!useIndex && fallbackToLocalScan && !courseContainsPose(course, poseTargets)) return;
            if (!useIndex && !fallbackToLocalScan && !indexLoading) return;
            if (!inCollection) {
                outsideCount += 1;
                return;
            }
        }
        matchedCount += 1;
        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push({ course, idx });
    });

    // Inside renderCourseUI()
    Object.keys(grouped).sort().forEach(catName => {
        const groupEl   = document.createElement("optgroup");
        groupEl.label   = catName;

        grouped[catName].forEach(item => {
            const opt = document.createElement("option");
            opt.value = String(item.idx);

            // Tagging Aliases ensures they are indexed and distinguishable in search.
            const aliasSuffix = item.course.is_alias ? " 🏷️ (Alias)" : "";
            opt.textContent = sequenceLabel(item.course) + aliasSuffix;

            groupEl.appendChild(opt);
        });
        sel.appendChild(groupEl);
    });

    if (currentVal) {
        const exists = Array.from(sel.options).some(o => o.value === currentVal);
        if (exists) sel.value = currentVal;
        else sel.value = "";
    }

    window.refreshPracticeNavigation?.();
    window.dispatchEvent(new Event('yoga:sequences-updated'));
    if (!matchedCount) sel.firstElementChild.textContent = 'No matching sequences';
    if (poseStatusEl) renderPoseFilterStatus(poseStatusEl, {
        poseTargets, matchedCount, outsideCount, filterEl, filterVal,
    });
}

function renderPoseFilterStatus(statusEl, { poseTargets, matchedCount, outsideCount, filterEl, filterVal }) {
    const targetKey = poseTargets.join(',');
    statusEl.replaceChildren();
    if (!targetKey) return;

    const isCurrent = poseFilterIndexState.target === targetKey;
    if (isCurrent && poseFilterIndexState.loading) {
        statusEl.textContent = 'Searching matching poses...';
        return;
    }

    const poseLabel = poseTargets.length > 1 ? `any of poses ${poseTargets.join(', ')}` : `pose ${poseTargets[0]}`;
    const plural = (n) => `${n} sequence${n === 1 ? '' : 's'}`;
    const verb = matchedCount === 1 ? 'contains' : 'contain';
    const offline = isCurrent && poseFilterIndexState.error ? ' (offline scan)' : '';

    if (filterVal === 'ALL') {
        statusEl.textContent = `${plural(matchedCount)} ${verb} ${poseLabel} across all collections${offline}`;
        return;
    }

    const collectionName = filterEl?.selectedOptions?.[0]?.textContent.replace(/^\S+\s/, '') || filterVal;
    statusEl.textContent = `${plural(matchedCount)} in ${collectionName} ${verb} ${poseLabel}${offline}`;
    if (!outsideCount) return;

    statusEl.append(` · ${outsideCount} more in other collections `);
    const showAll = document.createElement('button');
    showAll.type = 'button';
    showAll.className = 'tiny sequence-pose-filter__show-all';
    showAll.textContent = 'Show all collections';
    showAll.addEventListener('click', () => {
        filterEl.value = 'ALL';
        renderCourseUI();
        document.getElementById('sequenceSelect')?.focus();
    });
    statusEl.append(showAll);
}

/**
 * Master entry point — rebuilds both the category filter and the course list.
 * Called after data is loaded or a sequence is saved.
 */
export function renderSequenceDropdown() {
    renderCategoryFilter();
    setupPoseSequenceFilter();
    renderCourseUI();
}

// Expose for legacy calls (wiring.js, app.js fragments)
window.renderSequenceDropdown = renderSequenceDropdown;
window.renderCourseUI         = renderCourseUI;
window.renderCategoryFilter   = renderCategoryFilter;
window.updateActiveCategoryTitle = updateActiveCategoryTitle;
