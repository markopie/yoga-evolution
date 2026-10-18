import { test, expect } from './fixtures.mjs';
import { createProfile } from './profile-helpers.mjs';
import { readFile } from 'node:fs/promises';

async function newClass(page) {
    await page.locator('#navClasses').click();
    await page.getByRole('button', { name: 'New class', exact: true }).click();
    await page.getByLabel('Class name', { exact: true }).fill('Morning class');
    await page.locator('#classesScreen').getByLabel('Choose a sequence').selectOption('102');
}

test('saved classes open as a sheet and cancelled edits preserve the saved class', async ({ page }) => {
    await createProfile(page); await newClass(page);
    await page.getByRole('button', { name: 'Save class', exact: true }).click();
    await expect(page.locator('.class-sheet')).toBeVisible();
    await expect(page.getByLabel('Class name')).toBeHidden();
    await page.getByRole('button', { name: 'Edit class', exact: true }).click();
    await page.getByLabel('Class name').fill('Unsaved name');
    page.once('dialog', dialog => dialog.dismiss());
    await page.getByRole('button', { name: 'Cancel changes', exact: true }).click();
    await expect(page.getByLabel('Class name')).toHaveValue('Unsaved name');
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Cancel changes', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Morning class', exact: true })).toBeVisible();
    await expect(page.locator('.class-sheet')).toBeVisible();
});

test('class students and props save, survive reload, and reuse the existing PDF download', async ({ page }) => {
    await createProfile(page); await newClass(page);
    await page.getByRole('button', { name: 'Add student', exact: true }).click();
    await page.getByLabel('Student name', { exact: true }).fill('Alex private');
    await page.getByLabel('Form received and reviewed').check();
    await expect(page.getByLabel('Reviewed on')).not.toHaveValue('');
    await page.getByLabel('Reviewed on').fill('2026-10-01');
    await page.getByRole('button', { name: 'Add prop', exact: true }).click();
    await page.getByLabel('Prop', { exact: true }).fill('Belt');
    await page.getByRole('button', { name: 'Save class', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Class saved.' })).toBeVisible();
    await page.reload(); await page.locator('#navClasses').click();
    await page.getByRole('button', { name: /Morning class/ }).click();
    await expect(page.locator('.class-sheet-students')).toContainText('Alex private');
    await expect(page.locator('.class-sheet-students')).toContainText('2026-10-01');
    await page.getByRole('button', { name: 'View sequence', exact: true }).click();
    await expect(page.locator('#displayTitle')).toHaveText('Mock Seated Foundation');
    await expect(page.locator('#editCourseBackdrop').getByRole('button', { name: 'Download PDF', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Print sequence', exact: true })).toHaveCount(0);
    const downloaded = page.waitForEvent('download');
    await page.locator('#editCourseBackdrop').getByRole('button', { name: 'Download PDF', exact: true }).click();
    const pdf = await readFile(await (await downloaded).path());
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.toString()).not.toContain('Alex private');
    await page.locator('#editCourseCancelBtn').click();
    await page.getByRole('button', { name: 'Edit class', exact: true }).click();
    await page.getByLabel('Form received and reviewed').uncheck();
    await expect(page.getByLabel('Reviewed on')).toHaveValue('');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    page.once('dialog', d => d.accept());
    await page.getByRole('button', { name: 'Delete class', exact: true }).click();
    await expect(page.getByText('No classes yet.', { exact: false })).toBeVisible();
});

test('classes reuse normal playback and navigation preserves its state', async ({ page }) => {
    await createProfile(page); await newClass(page);
    await page.getByRole('button', { name: 'Save class', exact: true }).click();
    await page.getByRole('button', { name: 'Practise sequence', exact: true }).click();
    await page.getByRole('button', { name: 'Start practice', exact: true }).click();
    await expect(page.locator('#focusOverlay')).toBeVisible();
    await page.locator('#focusPauseBtn').click();
    await expect(page.locator('#startStopBtn')).toHaveText('Resume');
    const before = await page.evaluate(() => ({ id: window.currentSequence.id, index: window.currentIndex, time: window.playbackEngine.remaining }));
    await page.locator('#navClasses').click(); await page.locator('#navProgress').click();
    await expect(page.locator('#histTabCurrent')).toBeVisible();
    await page.locator('#navPractice').click();
    expect(await page.evaluate(() => ({ id: window.currentSequence.id, index: window.currentIndex, time: window.playbackEngine.remaining }))).toEqual(before);
    await expect(page.locator('#activeSequenceTitle')).toHaveText('Mock Seated Foundation');
    await page.locator('#manualLibraryPanel > summary').click();
    await expect(page.locator('#practiceWorkspace')).toBeHidden();
    await page.locator('#returnToPracticeBtn').click();
    await expect(page.locator('#practiceWorkspace')).toBeVisible();
});

test('curriculum retains sequence restriction when returning to library', async ({ page }) => {
    await createProfile(page); await page.locator('#startTodayPracticeBtn').click();
    await page.getByRole('button', { name: /preview first pose/i }).click();
    await page.locator('#manualLibraryPanel > summary').click();
    await expect(page.locator('#sequenceSelect')).toBeDisabled();
    await page.locator('#navClasses').click();
    await expect(page.locator('#manualLibraryPanel')).toBeHidden();
    await page.locator('#navPractice').click();
    await page.locator('#returnToPracticeBtn').click();
    await expect(page.locator('#practiceWorkspace')).toBeVisible();
    expect(await page.evaluate(() => window.currentCurriculumPractice.curriculum_node_id)).toBeTruthy();
});

test('unsaved edits can be kept and write failures preserve entered data', async ({ page }) => {
    await createProfile(page); await newClass(page);
    page.once('dialog', d => d.dismiss()); await page.locator('#navPractice').click();
    await expect(page.getByLabel('Class name')).toHaveValue('Morning class');
    await page.evaluate(() => {
        const set = Storage.prototype.setItem;
        Storage.prototype.setItem = function(key, value) { if (key.startsWith('classes-v1:')) throw new Error('Quota'); return set.call(this, key, value); };
    });
    await page.getByRole('button', { name: 'Save class', exact: true }).click();
    await expect(page.locator('#classesScreen [role="status"]')).toContainText('could not be saved');
    await expect(page.getByLabel('Class name')).toHaveValue('Morning class');
});

test('sequence search combines with collection; Browse has independent category and name filters', async ({ page }) => {
    await createProfile(page); await page.locator('#manualLibraryPanel > summary').click();
    await expect(page.locator('#quickEditBtn')).toBeDisabled();
    await page.locator('#sequenceSearch').fill('seated');
    await expect(page.locator('#sequenceSelect option')).toHaveCount(2);
    await page.locator('#sequenceSearch').fill('102');
    await expect(page.locator('#sequenceSelect option').last()).toContainText('Mock Seated Foundation');
    await page.locator('#sequenceSearch').fill('does not exist');
    await expect(page.locator('#sequenceSelect option')).toHaveCount(1);
    await page.locator('#browseBtn').click();
    await page.locator('#browseSearch').fill('');
    const category = await page.locator('#browseCategory option').nth(1).getAttribute('value');
    await page.locator('#browseCategory').selectOption(category);
    await expect(page.locator('#browseList button').first()).toBeVisible();
    await page.locator('#browseList button').first().click();
    await expect(page.locator('#browseDetail .teaching-card')).toHaveCount(1);
    await expect(page.locator('#browseDetail .teaching-card__meta')).toHaveCount(1);
    await expect(page.locator('#browseDetail button[aria-label="Play pose audio"]')).toBeVisible();
    await page.locator('#browseCloseBtn').click(); await expect(page.locator('#browseBtn')).toBeFocused();
});

test('class backup stays local during import and profiles remain isolated', async ({ page }) => {
    await createProfile(page, 'Teacher'); await newClass(page);
    await page.getByRole('button', { name: 'Add student', exact: true }).click();
    await page.getByLabel('Student name').fill('Private student');
    await page.getByRole('button', { name: 'Save class', exact: true }).click();
    await page.locator('#settingsToggleButton').click();
    const downloaded = page.waitForEvent('download');
    await page.locator('#exportProfileBtn').click();
    const backup = JSON.parse(await readFile(await (await downloaded).path(), 'utf8'));
    expect(backup.classes[0].students[0].name).toBe('Private student');
    await page.locator('#signOutBtn').click();
    await expect(page.locator('#loginScreen')).toHaveAttribute('data-ready', 'true');
    await page.evaluate(() => {
        const rpc = window.supabase.rpc.bind(window.supabase);
        window.supabase.rpc = (name, args) => {
            if (name === 'import_device_profile') sessionStorage.setItem('captured-import', JSON.stringify(args));
            return rpc(name, args);
        };
    });
    await page.locator('#profileImportFile').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
    await expect(page.locator('#mainAppContainer')).toBeVisible();
    const payload = await page.evaluate(() => sessionStorage.getItem('captured-import'));
    expect(payload).not.toContain('classes'); expect(payload).not.toContain('Private student');
    await page.locator('#navClasses').click();
    await page.getByRole('button', { name: /Morning class/ }).click();
    await expect(page.locator('.class-sheet-students')).toContainText('Private student');
    page.once('dialog', d => d.accept());
    await page.getByRole('button', { name: 'Delete class', exact: true }).click();
    await page.locator('#settingsToggleButton').click(); await page.locator('#signOutBtn').click();
    await expect(page.locator('#loginScreen')).toHaveAttribute('data-ready', 'true');
    await page.getByRole('button', { name: 'Teacher', exact: true }).click();
    await expect(page.locator('#mainAppContainer')).toBeVisible();
    await page.locator('#navClasses').click();
    await expect(page.getByRole('button', { name: /Morning class/ })).toBeVisible();
});

test('missing sequences retain class records and allow a replacement', async ({ page }) => {
    await createProfile(page); await newClass(page);
    await page.getByRole('button', { name: 'Save class', exact: true }).click();
    await page.evaluate(() => { window.courses = window.courses.filter(c => String(c.supabaseId || c.id) !== '102'); });
    await page.getByRole('button', { name: 'Back to classes', exact: true }).click();
    await page.getByRole('button', { name: /Morning class/ }).click();
    await expect(page.getByText('Sequence unavailable. Choose a replacement sequence.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Practise sequence', exact: true })).toBeDisabled();
    await expect(page.locator('#classesScreen').getByRole('button', { name: 'View sequence', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Edit class', exact: true }).click();
    await page.locator('#classesScreen').getByLabel('Choose a sequence').selectOption('103');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Practise sequence', exact: true })).toBeEnabled();
});
