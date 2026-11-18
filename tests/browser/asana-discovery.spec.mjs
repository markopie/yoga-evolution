import { expect, test } from './fixtures.mjs';
import { createProfile } from './profile-helpers.mjs';

test('Any and All distinguish a whole sequence from poses in different lessons of a course', async ({ page }) => {
    await createProfile(page);
    await page.locator('#manualLibraryPanel > summary').click();
    await page.locator('#poseSequenceFilter').fill('0001, #003');
    const choices = page.locator('#sequenceSelect option');
    await expect(choices.filter({ hasText: 'Mock Standing Foundation' })).toHaveCount(1);
    await expect(choices.filter({ hasText: 'Mock Seated Foundation' })).toHaveCount(1);
    await expect(page.locator('#poseCourseMatchInfo')).toBeHidden();
    await page.locator('#poseMatchMode').selectOption('all');
    await expect(choices.filter({ hasText: 'Mock Standing Foundation' })).toHaveCount(0);
    await expect(choices.filter({ hasText: 'Mock Seated Foundation' })).toHaveCount(0);
    await expect(choices.filter({ hasText: 'Mock Linked Macro Practice' })).toHaveCount(1);
    await expect(page.locator('#poseCourseMatchInfo')).toBeVisible();
    await expect(page.locator('#poseSequenceResults')).toContainText(/linked/i);
    const courses = page.locator('#poseCourseResults');
    await expect(courses).toContainText('Light on Yoga');
    await expect(courses).toContainText('Week 1 & 2');
    await expect(courses).toContainText('Week 5 & 6');
    await expect(courses).not.toContainText('Yoga The Iyengar Way');
    await page.locator('#categoryFilter').selectOption('Light on Yoga > Course 1');
    await expect(choices).toHaveCount(1);
    await expect(courses).toContainText('Week 5 & 6');
    await page.locator('#clearPoseSequenceFilter').click();
    await expect(page.locator('#poseDiscovery')).toBeHidden();
});

test('Browse poses selects several targets by name and narrows to one variation', async ({ page }) => {
    await createProfile(page);
    await page.evaluate(() => {
        const pose = window.asanaLibrary['001'];
        pose.iast = 'Tāḍāsana';
        pose.variations.Wall = { id: 71, title: 'Supported at the wall' };
        const entry = window.courses.find(course => course.id === '101').poses[0];
        entry[3] = 'Wall';
        entry[7].stageId = 71;
    });
    await page.locator('#manualLibraryPanel > summary').click();
    await page.locator('#browseBtn').click();
    await page.locator('#browseSearch').fill('tāḍāsana');
    await page.locator('#browseList input[data-search-target="001/71"]').check();
    await page.locator('#browseSearch').fill('staff');
    await page.locator('#browseList input[data-search-target="003"]').check();
    await page.getByRole('button', { name: 'Show matching sequences' }).click();
    await expect(page.locator('#poseSequenceFilter')).toHaveValue('001/71, 003');
    await page.locator('#poseMatchMode').selectOption('all');
    await expect(page.locator('#sequenceSelect option').last()).toContainText('Mock Linked Macro Practice');
    await expect(page.locator('#sequenceSelect option')).toHaveCount(2);
    await expect(page.locator('#poseLearningFocus option').first()).toContainText('Supported at the wall');
});

test('one focus explains observed earlier practice separately from the authors’ lesson advice', async ({ page }) => {
    await createProfile(page);
    await page.locator('#manualLibraryPanel > summary').click();
    await page.locator('#poseSequenceFilter').fill('001, 003');
    const focus = page.locator('#poseLearningFocus');
    const results = page.locator('#poseLearningResults');
    await expect(focus).toHaveValue('001');
    await expect(results).toContainText('Week 1 & 2');
    await expect(results).toContainText('Week 3 & 4');
    await expect(results).toContainText(/alternat/i);
    await expect(results).toContainText(/teacher|authors?/i);
    const teacherLink = results.getByRole('link', { name: /Suggested Scheme of Practice/ }).first();
    const guideOpened = page.context().waitForEvent('page');
    await teacherLink.click();
    const guide = await guideOpened;
    await expect(guide).toHaveURL(new URL('course-sources.html#ytiw_course_1', page.url()).href);
    await expect(guide.locator('#ytiw_course_1 + p')).toContainText('two whole lessons');
    await expect(guide.locator('#map-ytiw_course_2 + ul li')).toHaveCount(36);
    await guide.close();
    const reference = page.locator('#poseReferenceLesson');
    await reference.selectOption('115');
    await expect(results).not.toContainText(/alternat/i);
    await expect(results).toContainText('Week 3 & 4');
    const earlier = results.getByRole('button', { name: 'Week 1 & 2', exact: true }).first();
    await earlier.click();
    await expect(page.locator('#editCourseBackdrop')).toBeVisible();
    await page.locator('#editCourseBackdrop').getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.locator('#editCourseBackdrop')).toBeHidden();
    await focus.selectOption('003');
    await expect(results).not.toContainText('Week 1 & 2');
    await expect(results).not.toContainText(/alternat/i);
    await expect(page.locator('#poseSequenceFilter')).toHaveValue('001, 003');
});

test('offline discovery reads shared and own sequences from an older mixed device snapshot', async ({ page, context }) => {
    await createProfile(page);
    await page.evaluate(async () => {
        const shared = window.courses.find(course => course.id === '101');
        const copy = (id, title, userId) => ({ ...shared, id, supabaseId: id, title, isSystem: false, userId });
        const request = indexedDB.open('yoga-evolution-offline');
        const db = await new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
        try {
            const tx = db.transaction('snapshots', 'readwrite');
            const store = tx.objectStore('snapshots');
            store.delete('courses-v1:' + window.currentUserId);
            store.put({ key: 'courses-v1', value: [
                shared, copy('401', 'My saved practice', window.currentUserId),
                copy('402', 'Someone else’s practice', 'other-fixture-profile'),
            ] });
            await new Promise((resolve, reject) => {
                tx.oncomplete = resolve;
                tx.onerror = () => reject(tx.error);
            });
        } finally { db.close(); }
    });
    await context.setOffline(true);
    await page.evaluate(() => window.loadCourses());
    await page.locator('#manualLibraryPanel > summary').click();
    await page.locator('#poseSequenceFilter').fill('001');
    await expect(page.locator('#poseSequenceFilterStatus')).toContainText(/downloaded|offline/i);
    const choices = page.locator('#sequenceSelect option');
    await expect(choices.filter({ hasText: 'Mock Standing Foundation' })).toHaveCount(1);
    await expect(choices.filter({ hasText: 'My saved practice' })).toHaveCount(1);
    await expect(choices.filter({ hasText: 'Someone else' })).toHaveCount(0);
});

test('earlier practice follows saved source weeks, years and rotation groups across collection filters', async ({ page }) => {
    await createProfile(page);
    await page.locator('#manualLibraryPanel > summary').click();
    await page.locator('#poseSequenceFilter').fill('002');
    const collection = page.locator('#categoryFilter');
    const reference = page.locator('#poseReferenceLesson');
    const results = page.locator('#poseLearningResults');

    await collection.selectOption('How to Use Yoga > Week 2');
    await reference.selectOption('178');
    await expect(results).toContainText('Week 1 · Day 1');
    await expect(results).toContainText('Both source positions are recorded in Supabase');
    await expect(results).not.toContainText('Day 7');
    await page.locator('#sequenceSearch').fill('178');
    await expect(page.locator('#sequenceSelect option')).toHaveCount(2);
    await expect(results).toContainText('Week 1 · Day 1');
    await page.locator('#sequenceSearch').fill('177');
    await expect(page.locator('#sequenceSelect option')).toHaveCount(1);
    await page.locator('#sequenceSearch').fill('');

    await collection.selectOption('Yoga A Gem For Women > Second Year');
    await reference.selectOption('369');
    await expect(results).toContainText('First Year · Day 1, 5');
    await expect(results).toContainText('preceding phase');
    await expect(results).toContainText('Both source positions are recorded in Supabase');

    await collection.selectOption('Yoga The Iyengar Way > Course 2');
    await reference.selectOption('235');
    await expect(results).toContainText('1B (Sitting)');
    await expect(results).toContainText('same B rotation');
    await expect(results).toContainText('Teacher recommendation for month three');

    await collection.selectOption('Yoga The Iyengar Way > Course 4');
    await expect(results).toContainText('daily emphasis');
    await expect(results.getByRole('button', { name: '1 (Standing and Balancing)' })).toHaveCount(0);
});

test('a breath stage finds earlier practices through their saved recovery links and works offline', async ({ page, context }) => {
    await createProfile(page);
    await page.locator('#manualLibraryPanel > summary').click();
    await page.locator('#poseSequenceFilter').fill('203/32');
    await page.locator('#poseReferenceLesson').selectOption('54');
    const results = page.locator('#poseLearningResults');
    await expect(results).toContainText('Week 3 and 4');
    await expect(results).toContainText('Week 1 and 2');
    await expect(results).toContainText('variation #32');
    await expect(results).toContainText('Both source positions are recorded in Supabase');
    await context.setOffline(true);
    await expect(page.locator('#poseOrderStatus')).toContainText('saved on this device');
    await expect(page.locator('#poseReferenceLesson')).toHaveValue('54');
    await expect(results).toContainText('Week 3 and 4');
});
