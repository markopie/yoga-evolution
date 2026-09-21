const jsZipModulePromise = import('jszip');

export function getCategoryInitials(categoryValue) {
    const mainCategory = String(categoryValue || '')
        .split('>')[0]
        .trim();

    if (!mainCategory) return '';

    const compact = mainCategory.replace(/[^A-Za-z0-9]/g, '');
    if (compact.length >= 2 && compact.length <= 5 && compact === compact.toUpperCase()) {
        return compact;
    }

    return mainCategory
        .split(/[\s/&+-]+/)
        .map(part => part.match(/[A-Za-z0-9]/)?.[0] || '')
        .join('')
        .toUpperCase()
        .slice(0, 6);
}

export function sanitizeFilename(title) {
    const base = String(title || 'Yoga-Sequence')
        .trim()
        .replace(/\.pdf$/i, '')
        .replace(/[/\\?%*:|"<>]/g, '-')
        .replace(/\s+/g, ' ')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');

    return `${base || 'Yoga-Sequence'}.pdf`;
}

export function buildPdfFilename(title, categoryValue, options = {}) {
    if (options.skipCategoryInitials) {
        return sanitizeFilename(title || 'Yoga-Sequence');
    }

    const initials = getCategoryInitials(categoryValue);
    const suffix = initials ? ` (${initials})` : '';
    return sanitizeFilename(`${title || 'Yoga-Sequence'}${suffix}`);
}

export function getUniqueFilename(filename, usedNames) {
    if (!usedNames.has(filename)) {
        usedNames.add(filename);
        return filename;
    }

    const base = filename.replace(/\.pdf$/i, '');
    let suffix = 2;
    let candidate = `${base} ${suffix}.pdf`;
    while (usedNames.has(candidate)) {
        suffix += 1;
        candidate = `${base} ${suffix}.pdf`;
    }
    usedNames.add(candidate);
    return candidate;
}

export function buildSequenceExportData(input = {}) {
    const title = String(input.title || '').trim() || 'Untitled Sequence';
    const category = String(input.category || '').trim();
    const playbackMode = input.playbackMode || 'standard';

    return {
        title,
        category,
        notes: String(input.notes || '').trim(),
        poses: Array.isArray(input.poses) ? input.poses.map(pose => ({
            ...pose,
            props: Array.isArray(pose?.props) ? [...pose.props] : [],
        })) : [],
        courseId: input.courseId || '',
        playbackMode,
        filename: buildPdfFilename(title, category, {
            skipCategoryInitials: playbackMode === 'flow' || playbackMode === 'cycle',
        }),
    };
}

export function resolveLinkedSequence(identifier, courses = []) {
    const needle = String(identifier || '').trim();
    if (!needle) return null;
    const lowerNeedle = needle.toLowerCase();

    return courses.find(course =>
        String(course.title || '').trim().toLowerCase() === lowerNeedle
        || String(course.id || '').trim() === needle
        || String(course.supabaseId || '').trim() === needle
    ) || null;
}

export function courseToPdfPoses(course, environment = {}) {
    const courses = environment.courses || [];
    const asanaLibrary = environment.asanaLibrary || {};
    const getHoldTimes = environment.getHoldTimes;
    const sequenceIsFlow = course?.playbackMode === 'flow' || course?.isFlow;
    const libraryArray = Object.values(asanaLibrary);

    return (course?.poses || []).map(pose => {
        const rawId = Array.isArray(pose?.[0]) ? pose[0][0] : pose?.[0] || '';
        const idString = String(rawId);

        if (idString === 'LOOP_START' || idString === 'LOOP_END') {
            return {
                id: idString,
                name: idString === 'LOOP_START' ? `Repeat Block (${pose[1]} Rounds)` : 'End Repeat Block',
                duration: idString === 'LOOP_START' ? Number(pose[1]) || 2 : 0,
                variation: '',
                note: '',
            };
        }

        if (idString.startsWith('MACRO:')) {
            const identifier = idString.replace('MACRO:', '').trim();
            const subCourse = resolveLinkedSequence(identifier, courses);
            return {
                id: idString,
                name: `[Sequence] ${subCourse ? subCourse.title : identifier}`,
                duration: Number(pose[1]) || 1,
                variation: '',
                note: pose[4] || '',
            };
        }

        const id = idString.padStart(3, '0');
        const asana = libraryArray.find(item => String(item.id || item.asanaNo) === id);
        const originalJson = pose?.[7]?.originalJson || null;
        const variation = pose?.[3] || '';
        const tier = originalJson?.tier;
        const holdTier = tier === 'S' ? 'short' : (tier === 'L' ? 'long' : 'standard');
        const holdTimes = asana && getHoldTimes
            ? getHoldTimes(asana, variation || null)
            : { standard: 30, flow: 5 };

        return {
            id,
            name: asana ? (asana.name || asana.english || id) : id,
            duration: Number(pose?.[1])
                || (sequenceIsFlow ? (holdTimes.flow || holdTimes.standard || 5) : (holdTimes.standard || 30)),
            variation,
            note: originalJson
                ? (originalJson.note || '')
                : [pose?.[2], pose?.[4]].filter(Boolean).join(' | ').trim(),
            holdTier,
            side: pose?.[7]?.explicitSide || '',
            props: [...(pose?.[7]?.props || [])],
        };
    });
}

export function collectLinkedSequences(poses, environment = {}, visited = new Set()) {
    const linked = [];
    const courses = environment.courses || [];

    (poses || []).forEach(pose => {
        const idString = String(pose?.id ?? (Array.isArray(pose?.[0]) ? pose[0][0] : pose?.[0]) ?? '');
        if (!idString.startsWith('MACRO:')) return;

        const identifier = idString.replace('MACRO:', '').trim();
        const course = resolveLinkedSequence(identifier, courses);
        if (!course) return;

        const courseKey = String(course.id || course.supabaseId || course.title || identifier);
        if (visited.has(courseKey)) return;
        visited.add(courseKey);
        linked.push(course);
        linked.push(...collectLinkedSequences(courseToPdfPoses(course, environment), environment, visited));
    });

    return linked;
}

export function linkedCourseExportData(course, environment = {}) {
    const category = course.categoryName || course.category || '';
    return buildSequenceExportData({
        title: course.title || 'Linked Sequence',
        category: course.category || category,
        notes: course.condition_notes || '',
        poses: courseToPdfPoses(course, environment),
        courseId: course.id || course.supabaseId,
        playbackMode: course.playbackMode
            || (course.isFlow ? 'flow' : (course.isCycle ? 'cycle' : 'standard')),
    });
}

export async function createSequenceDownload(mainData, linkedCourses, options = {}) {
    const renderPdf = options.renderPdf;
    if (typeof renderPdf !== 'function') {
        throw new TypeError('createSequenceDownload requires a renderPdf function.');
    }

    if (!linkedCourses?.length) {
        return {
            blob: await renderPdf(mainData),
            filename: mainData.filename,
            kind: 'pdf',
        };
    }

    const ZipClass = options.ZipClass || (await jsZipModulePromise).default;
    const zip = new ZipClass();
    const usedNames = new Set();
    const mainFilename = getUniqueFilename(mainData.filename, usedNames);
    const mainPdf = await renderPdf(mainData);
    zip.file(mainFilename, typeof mainPdf?.arrayBuffer === 'function'
        ? await mainPdf.arrayBuffer()
        : mainPdf);

    for (const linkedData of linkedCourses) {
        const linkedFilename = getUniqueFilename(linkedData.filename, usedNames);
        const linkedPdf = await renderPdf(linkedData);
        zip.file(linkedFilename, typeof linkedPdf?.arrayBuffer === 'function'
            ? await linkedPdf.arrayBuffer()
            : linkedPdf);
    }

    return {
        blob: await zip.generateAsync({ type: 'blob' }),
        filename: sanitizeFilename(`${mainData.title || 'Yoga-Sequence'} sequence PDFs`)
            .replace(/\.pdf$/i, '.zip'),
        kind: 'zip',
    };
}

export async function runDownloadWithButtonState(button, generate, options = {}) {
    if (!button || button.dataset.generating === 'true') return false;

    const originalText = button.textContent;
    button.dataset.generating = 'true';
    button.disabled = true;
    button.textContent = options.generatingText || 'Generating…';

    try {
        await generate();
        return true;
    } finally {
        button.textContent = originalText;
        button.disabled = false;
        delete button.dataset.generating;
    }
}
