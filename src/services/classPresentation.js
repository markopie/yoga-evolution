import { sequenceProps } from './sequenceTeaching.js';

export function classCover(record, course, environment = {}) {
    const excluded = new Set(record.excludedProps || []);
    const recorded = sequenceProps(course, environment).props
        .filter(prop => !excluded.has(`sequence:${prop}`))
        .map(prop => environment.registry?.[prop]?.label || prop);
    const additional = record.additionalProps.filter(prop => !excluded.has(`additional:${prop}`));
    return {
        name: record.name,
        sequence: course?.title || 'Sequence unavailable',
        props: [...new Set([...recorded, ...additional])],
        students: record.students.map(student => student.name),
    };
}

export function drawClassCover(pdf, cover, font = 'helvetica') {
    const margin = 20, width = pdf.internal.pageSize.getWidth() - margin * 2;
    const bottom = pdf.internal.pageSize.getHeight() - 20;
    let y = 26;
    const text = (value, size, colour = [48, 63, 56]) => {
        pdf.setFont(font, 'normal'); pdf.setFontSize(size); pdf.setTextColor(...colour);
        for (const line of pdf.splitTextToSize(String(value), width)) {
            if (y + size * .5 > bottom) { pdf.addPage(); y = 26; }
            pdf.text(line, margin, y); y += size * .5;
        }
    };
    text('CLASS PRACTICE', 10, [105, 121, 107]); y += 10;
    text(cover.name, 26); y += 6;
    text(cover.sequence, 13, [105, 121, 107]); y += 10;
    pdf.setDrawColor(207, 216, 207); pdf.line(margin, y, margin + width, y); y += 14;
    for (const [heading, items, empty] of [
        ['Props', cover.props, 'No props selected.'],
        [`Students (${cover.students.length})`, cover.students, 'No students added.'],
    ]) {
        text(heading, 15); y += 4;
        for (const item of items.length ? items : [empty]) { text(item, 11); y += 2; }
        y += 12;
    }
    pdf.addPage();
}
