import test from 'node:test';
import assert from 'node:assert/strict';
import { jsPDF } from 'jspdf';
import { classCover, drawClassCover } from './classPresentation.js';

test('class cover includes names and selected props, excluding form status and dates', () => {
    const record = {
        name: 'Morning class', additionalProps: ['Belt', 'Blanket'],
        excludedProps: ['sequence:block', 'additional:Blanket'],
        students: [{ name: 'Alex', formReviewed: true, reviewedOn: '2026-10-01' }],
    };
    const course = { id: '303', title: 'Sequence', poses: [['001', 30, '', '', '', 0, null, { props: ['block', 'chair'] }]] };
    assert.deepEqual(classCover(record, course, { registry: { chair: { label: 'Chair' } } }), {
        name: 'Morning class', sequence: 'Sequence', props: ['Chair', 'Belt'], students: ['Alex'],
    });
});

test('long class covers paginate within margins and leave a fresh sequence page', () => {
    const pdf = new jsPDF();
    const positions = [];
    const original = pdf.text.bind(pdf);
    pdf.text = (text, x, y, ...args) => { positions.push(y); return original(text, x, y, ...args); };
    drawClassCover(pdf, { name: 'A long class name '.repeat(14), sequence: 'A sequence', props: ['Block'], students: Array.from({ length: 100 }, (_, i) => `Student ${i + 1}`) });
    assert.ok(pdf.getNumberOfPages() > 2);
    assert.ok(positions.every(y => y >= 20 && y < 277));
    assert.match(pdf.output(), /Student 100/);
});
