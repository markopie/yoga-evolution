import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

const previousWindow = globalThis.window;

before(() => {
    globalThis.window = {};
});

after(() => {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
});

class RecordingPdf {
    static instances = [];

    constructor() {
        this.internal = {
            pageSize: {
                getWidth: () => 210,
                getHeight: () => 297,
            },
        };
        this.textCalls = [];
        this.fontCalls = [];
        this.registeredFonts = [];
        RecordingPdf.instances.push(this);
    }

    addFileToVFS(name) {
        this.registeredFonts.push(name);
    }

    addFont(_file, name) {
        this.registeredFonts.push(name);
    }

    setFont(name, style) {
        this.fontCalls.push([name, style]);
    }

    text(value) {
        this.textCalls.push(value);
    }

    getTextWidth(value) {
        return String(value).length;
    }

    splitTextToSize(value) {
        return [String(value)];
    }

    output() {
        return new Blob(['%PDF-1.3\nrecording']);
    }

    addPage() {}
    line() {}
    rect() {}
    setDrawColor() {}
    setFillColor() {}
    setFontSize() {}
    setLineWidth() {}
    setTextColor() {}
}

test('table PDF creation retains Sanskrit and IAST text with bundled fonts', async () => {
    const { generateTablePdf } = await import('./builderUI.js');
    const devanagari = 'ताडासन';
    const iast = 'Tāḍāsana';
    const blob = await generateTablePdf({
        title: 'Unicode Practice',
        category: 'Asana',
        poses: [{ id: '001', duration: 30, name: 'Mountain Pose' }],
    }, {
        PdfClass: RecordingPdf,
        fontData: {
            devanagari: Promise.resolve(new Uint8Array([1, 2, 3]).buffer),
            iast: Promise.resolve(new Uint8Array([4, 5, 6]).buffer),
        },
        environment: {
            asanaLibrary: {
                '001': {
                    id: '001',
                    english: 'Mountain Pose',
                    devanagari,
                    iast,
                },
            },
            calculateTotalSequenceTime: () => 30,
        },
    });

    const pdf = RecordingPdf.instances.at(-1);
    assert.equal(blob.size > 0, true);
    assert.equal(pdf.textCalls.includes(devanagari), true);
    assert.equal(pdf.textCalls.includes(iast), true);
    assert.equal(pdf.registeredFonts.includes('NotoSansDevanagari'), true);
    assert.equal(pdf.registeredFonts.includes('NotoSerif'), true);
});

test('missing optional fonts use an explicit built-in fallback and still create a PDF', async () => {
    const { generateTablePdf } = await import('./builderUI.js');
    const blob = await generateTablePdf({
        title: 'Fallback Practice',
        poses: [{ id: '001', duration: 30 }],
    }, {
        PdfClass: RecordingPdf,
        fontData: {
            devanagari: null,
            iast: null,
        },
        environment: {
            asanaLibrary: {
                '001': {
                    id: '001',
                    english: 'Mountain Pose',
                    devanagari: 'ताडासन',
                    iast: 'Tāḍāsana',
                },
            },
        },
    });

    const pdf = RecordingPdf.instances.at(-1);
    assert.equal(blob.size > 0, true);
    assert.deepEqual(pdf.registeredFonts, []);
    assert.equal(pdf.fontCalls.some(([name, style]) => name === 'helvetica' && style === 'italic'), true);
});
