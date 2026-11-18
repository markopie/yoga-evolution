// src/ui/courseUI.js
// Course/Sequence dropdown rendering + collage/plate renderers

import { matchesSequence, sequenceLabel } from '../services/sequenceTeaching.js';
import { findSequencePoseMatches, parsePoseFilterIds } from "../services/coursePoseIndexService.js";
import { renderDiscoveryResults } from "./poseDiscovery.js";
import { supabase, supabaseConfig } from '../services/supabaseClient.js';
import { requestDiscoverySourceOrder } from '../services/discoverySourceOrder.js';

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

function setupPoseSequenceFilter() {
    const input = document.getElementById('poseSequenceFilter');
    if (!input || input.dataset.wired === 'true') return;
    input.dataset.wired = 'true';
    let timer;
    const rerender = () => {
        clearTimeout(timer);
        timer = setTimeout(renderCourseUI, 80);
    };
    document.getElementById('sequenceSearch')?.addEventListener('input', rerender);
    input.addEventListener('input', rerender);
    document.getElementById('poseMatchMode').addEventListener('change', renderCourseUI);
    document.getElementById('clearPoseSequenceFilter').addEventListener('click', () => {
        input.value = '';
        renderCourseUI();
        input.focus();
    });
    window.addEventListener('offline', renderCourseUI);
    window.addEventListener('online', renderCourseUI);
    let profile = window.currentUserId;
    window.addEventListener('yoga:verified-session', () => {
        if (window.currentUserId !== profile) {
            input.value = '';
            document.getElementById('poseMatchMode').value = 'any';
            renderCourseUI();
        }
        profile = window.currentUserId;
    });
}

export function renderCourseUI() {
    const sel = document.getElementById('sequenceSelect');
    if (!sel) return;
    const courses = window.courses || [];
    const filter = document.getElementById('categoryFilter');
    const collection = filter?.value || 'ALL';
    const targets = parsePoseFilterIds(document.getElementById('poseSequenceFilter')?.value);
    if (targets.length) {
        requestDiscoverySourceOrder(supabase, supabaseConfig?.url, navigator.onLine !== false, renderCourseUI);
    }
    const mode = document.getElementById('poseMatchMode')?.value || 'any';
    const matches = targets.length ? findSequencePoseMatches(courses, targets, {
        profileId: window.currentUserId, asanaLibrary: window.asanaLibrary,
    }) : null;
    const titleQuery = document.getElementById('sequenceSearch')?.value || '';
    const previous = sel.value;
    const groups = new Map();
    const visibleMatches = new Map();
    const collectionCourses = [];
    const sequenceHits = [];
    let outside = 0;
    courses.forEach((course, index) => {
        if (!matchesSequence(course, titleQuery)) return;
        const category = course.category?.trim() || 'Uncategorized';
        const inCollection = collection === 'ALL' || category === collection;
        if (targets.length) {
            if (inCollection) collectionCourses.push(course);
            const match = matches.get(course);
            if (!match) return;
            if (inCollection) visibleMatches.set(course, match);
            if (mode === 'all' && match.matchedTargets.length !== targets.length) return;
            if (!inCollection) { outside++; return; }
            sequenceHits.push(course);
        } else if (!inCollection) {
            return;
        }
        if (!groups.has(category)) groups.set(category, []);
        groups.get(category).push({ course, index });
    });
    const first = new Option(groups.size ? 'Choose a sequence' : 'No matching sequences', '');
    sel.replaceChildren(first);
    for (const category of [...groups.keys()].sort()) {
        const group = document.createElement('optgroup');
        group.label = category;
        for (const { course, index } of groups.get(category)) {
            group.append(new Option(sequenceLabel(course) + (course.is_alias ? ' 🏷️ (Alias)' : ''), String(index)));
        }
        sel.append(group);
    }
    if (previous && [...sel.options].some(option => option.value === previous)) sel.value = previous;
    renderDiscoveryResults({ targets, mode, visibleMatches, collectionCourses, allMatches: matches || visibleMatches,
        allCourses: courses, sequenceHits, outside, filter, renderCourseUI });
    window.refreshPracticeNavigation?.();
    window.dispatchEvent(new Event('yoga:sequences-updated'));
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
