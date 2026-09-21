import assert from 'node:assert/strict';
import { test } from 'node:test';
import JSZip from 'jszip';
import {
    buildPdfFilename,
    buildSequenceExportData,
    collectLinkedSequences,
    courseToPdfPoses,
    createSequenceDownload,
    getUniqueFilename,
    runDownloadWithButtonState,
    sanitizeFilename,
} from './sequencePdfExport.js';

test('generates sanitised PDF filenames and resolves collisions', () => {
    assert.equal(sanitizeFilename('  Practice: One?.pdf '), 'Practice- One.pdf');
    assert.equal(buildPdfFilename('Morning Practice', 'Light on Yoga > Week 1'), 'Morning Practice (LOY).pdf');
    assert.equal(buildPdfFilename('Flow / One', 'Standing', { skipCategoryInitials: true }), 'Flow - One.pdf');

    const used = new Set();
    assert.equal(getUniqueFilename('Same.pdf', used), 'Same.pdf');
    assert.equal(getUniqueFilename('Same.pdf', used), 'Same 2.pdf');
    assert.equal(getUniqueFilename('Same.pdf', used), 'Same 3.pdf');
});

test('converts sequence inputs into independent export data', () => {
    const props = ['belt'];
    const data = buildSequenceExportData({
        title: '  Sanskrit Practice  ',
        category: 'Asana > Standing',
        notes: '  Be steady.  ',
        poses: [{ id: '001', duration: 30, props }],
        courseId: 42,
        playbackMode: 'flow',
    });

    props.push('chair');
    assert.deepEqual(data, {
        title: 'Sanskrit Practice',
        category: 'Asana > Standing',
        notes: 'Be steady.',
        poses: [{ id: '001', duration: 30, props: ['belt'] }],
        courseId: 42,
        playbackMode: 'flow',
        filename: 'Sanskrit Practice.pdf',
    });
});

test('collects nested linked courses once and converts course poses', () => {
    const courses = [
        {
            id: 'a',
            title: 'Course A',
            poses: [
                ['001', 30],
                ['MACRO:b', 1],
                ['MACRO:b', 2],
            ],
        },
        {
            id: 'b',
            title: 'Course B',
            poses: [
                ['002', 45],
                ['MACRO:a', 1],
            ],
        },
    ];
    const environment = {
        courses,
        asanaLibrary: {
            '001': { id: '001', name: 'Pose One' },
            '002': { id: '002', name: 'Pose Two' },
        },
    };

    const linked = collectLinkedSequences([
        { id: 'MACRO:a' },
        { id: 'MACRO:a' },
    ], environment);

    assert.deepEqual(linked.map(course => course.id), ['a', 'b']);
    assert.deepEqual(courseToPdfPoses(courses[0], environment).map(pose => pose.id), [
        '001',
        'MACRO:b',
        'MACRO:b',
    ]);
});

test('creates an ordinary PDF download without invoking ZIP', async () => {
    const pdfBlob = new Blob(['%PDF-1.3\nordinary']);
    const result = await createSequenceDownload(
        { title: 'Ordinary', filename: 'Ordinary.pdf' },
        [],
        { renderPdf: async () => pdfBlob },
    );

    assert.equal(result.kind, 'pdf');
    assert.equal(result.filename, 'Ordinary.pdf');
    assert.equal(result.blob, pdfBlob);
    assert.equal(result.blob.size > 0, true);
});

test('creates a ZIP with distinct collision-safe PDF names', async () => {
    const result = await createSequenceDownload(
        { title: 'Main', filename: 'Same.pdf' },
        [
            { title: 'Linked 1', filename: 'Same.pdf' },
            { title: 'Linked 2', filename: 'Same.pdf' },
        ],
        {
            renderPdf: async data => new Blob([`%PDF-1.3\n${data.title}`]),
        },
    );

    assert.equal(result.kind, 'zip');
    assert.equal(result.filename, 'Main sequence PDFs.zip');
    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
    assert.deepEqual(Object.keys(zip.files).sort(), ['Same 2.pdf', 'Same 3.pdf', 'Same.pdf']);
    for (const file of Object.values(zip.files)) {
        assert.equal((await file.async('uint8array')).byteLength > 0, true);
    }
});

test('restores UI state after a failure and rejects duplicate generation', async () => {
    const button = {
        textContent: 'Download PDF',
        disabled: false,
        dataset: {},
    };
    let release;
    const pending = new Promise(resolve => {
        release = resolve;
    });

    const first = runDownloadWithButtonState(button, () => pending);
    assert.equal(button.textContent, 'Generating…');
    assert.equal(button.disabled, true);
    assert.equal(await runDownloadWithButtonState(button, async () => {}), false);
    release();
    assert.equal(await first, true);
    assert.equal(button.textContent, 'Download PDF');
    assert.equal(button.disabled, false);
    assert.equal(button.dataset.generating, undefined);

    await assert.rejects(
        runDownloadWithButtonState(button, async () => {
            throw new Error('renderer failed');
        }),
        /renderer failed/,
    );
    assert.equal(button.textContent, 'Download PDF');
    assert.equal(button.disabled, false);
    assert.equal(button.dataset.generating, undefined);
});
