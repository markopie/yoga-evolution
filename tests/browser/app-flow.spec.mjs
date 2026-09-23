import { createProfile } from './profile-helpers.mjs';
import { expect, test } from '@playwright/test';

async function openProfile(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await createProfile(page);

  return errors;
}

async function openCurriculumMapFromProgress(page) {
  await page.locator('#userEmailDisplay').click();
  await page.locator('#histTabCurriculum').click();
}

test('app loads with a saved profile and normal UI has no dev label', async ({ page }) => {
  const errors = await openProfile(page);

  await expect(page.locator('#loginScreen')).toBeHidden();
  await expect(page.locator('#mainAppContainer')).toBeVisible();
  await expect(page.locator('body')).not.toContainText('Testing v2 DEV');
  await expect(page.locator('body')).not.toContainText(/Integrated Iyengar Practice Path - Testing/i);
  expect(errors).toEqual([]);
});

test('Start Today loads a playable practice and rating advances to the next node', async ({ page }) => {
  await openProfile(page);

  await expect(page.locator('#practicePlaybackControls')).toBeHidden();
  await expect(page.locator('#practiceWorkspace')).toBeHidden();
  await expect(page.locator('#markCurriculumCompleteBtn')).toBeHidden();
  await expect(page.locator('#resetCurriculumTestProgressBtn')).toBeHidden();

  await page.getByRole('button', { name: /start today's practice/i }).click();
  await expect(page.locator('#curriculumPracticeSummary')).toContainText(/Week 1 [·,] Day 1/);
  await expect(page.locator('#poseName')).not.toContainText('Select a sequence');
  await expect(page.locator('#practicePlaybackControls')).toBeVisible();
  await expect(page.locator('#practiceWorkspace')).toBeVisible();

  await page.evaluate(() => window.markCurrentCurriculumNodeCompleteForTesting());
  await expect(page.locator('#ratingOverlay')).toBeVisible();
  await page.getByRole('button', { name: /good/i }).click();

  await expect(page.locator('#ratingOverlay')).toBeHidden();
  await expect(page.locator('#historyBackdrop')).toBeVisible();
  await expect(page.locator('#histTabCurrent')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#practiceWorkspace')).toBeHidden();
});

test('first Focus Mode entry resumes its countdown if the opening audio stalls', async ({ page }) => {
  await openProfile(page);
  await page.getByRole('button', { name: /start today's practice/i }).click();
  await page.evaluate(() => {
    window.__playbackAudioCueTimeoutMs = 150;
    window.playAsanaAudio = () => new Promise(() => {});
  });

  await page.getByRole('button', { name: /^start practice$/i }).click();
  await expect(page.locator('#focusOverlay')).toBeVisible();
  const initial = await page.locator('#focusTimer').textContent();
  await expect.poll(
    () => page.locator('#focusTimer').textContent(),
    { timeout: 3_000 },
  ).not.toBe(initial);
});

test('previous restores the right side of a bilateral first pose on every preview cycle', async ({ page }) => {
  await openProfile(page);
  await page.getByRole('button', { name: /start today's practice/i }).click();

  const next = page.locator('#nextBtn');
  const previous = page.locator('#prevBtn');
  const cardMeta = page.locator('#collageWrap .teaching-card__meta');
  const startPractice = page.getByRole('button', { name: /^start practice$/i });

  await expect(startPractice).toHaveCSS('background-color', 'rgb(29, 29, 31)');
  await expect(startPractice).toHaveCSS('color', 'rgb(255, 255, 255)');

  // Dismiss the sequence briefing using the control presented in the card.
  await page.getByRole('button', { name: /preview first pose/i }).click();
  await expect(cardMeta).toContainText('Side: Right');

  for (let cycle = 0; cycle < 2; cycle += 1) {
    await next.click();
    await expect(cardMeta).toContainText('Side: Left');

    await previous.click();
    await expect(cardMeta).toContainText('Side: Right');
    await expect(page.locator('#collageWrap .teaching-card__name')).toContainText('Mountain Pose');
  }
});

test('low completion rating repeats the same curriculum node', async ({ page }) => {
  await openProfile(page);

  await page.getByRole('button', { name: /start today's practice/i }).click();
  await expect(page.locator('#curriculumPracticeSummary')).toContainText(/Week 1 [·,] Day 1/);

  await page.evaluate(() => window.markCurrentCurriculumNodeCompleteForTesting());
  await expect(page.locator('#ratingOverlay')).toBeVisible();
  await page.getByRole('button', { name: /hard/i }).click();

  await expect(page.locator('#ratingOverlay')).toBeHidden();
  await expect(page.locator('#curriculumPracticeSummary')).toContainText(/Week 1 [·,] Day 1/);
});

test('three easy ratings can skip remaining nodes in a mastery repeat group', async ({ page }) => {
  await openProfile(page);
  await page.evaluate(() => {
    window.__masteryPrompt = '';
    window.confirm = (message) => {
      window.__masteryPrompt = message;
      return true;
    };
  });
  await page.getByRole('button', { name: /start today's practice/i }).click();

  await page.evaluate(() => window.markCurrentCurriculumNodeCompleteForTesting());
  await expect(page.locator('#ratingOverlay')).toBeVisible();
  await page.getByRole('button', { name: /good/i }).click();
  await expect(page.locator('#historyBackdrop')).toBeVisible();
  await expect(page.locator('#histTabCurrent')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#practiceWorkspace')).toBeHidden();
  expect(await page.evaluate(() => window.__masteryPrompt)).toBe('');
});

test('Start Today can load composed and recovery curriculum nodes', async ({ page }) => {
  await openProfile(page);

  await page.evaluate(() => window.startTodayPractice(9004));
  await expect(page.locator('#curriculumPracticeSummary')).toContainText('Mock Combined Asana');
  await expect(page.locator('#curriculumPracticeSummary')).toContainText('Mock Quiet Pranayama');
  await expect(page.locator('#poseName')).not.toContainText('Select a sequence');

  await page.evaluate(() => window.startTodayPractice(9007));
  await expect(page.locator('#curriculumPracticeSummary')).toContainText(/Rest|Savasana/i);
  await expect(page.locator('body')).toContainText('Recovery Day - Rest Day');
});

test('optional curriculum stage does not interrupt completion with a prompt', async ({ page }) => {
  await openProfile(page);

  let prompted = false;
  page.on('dialog', async (dialog) => {
    prompted = true;
    await dialog.dismiss();
  });
  await page.evaluate(() => window.startTodayPractice(9010));
  await expect(page.locator('#curriculumPracticeSummary')).toContainText('Core curriculum complete');
  await expect(page.locator('#practiceWorkspace')).toBeHidden();
  expect(prompted).toBe(false);
});

test('Curriculum Map opens, renders summary/counts, and stations have forgiving hit targets', async ({ page }) => {
  await openProfile(page);

  await openCurriculumMapFromProgress(page);
  await expect(page.getByRole('tab', { name: 'List view' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.cr-summary')).toContainText('0 of 7 practices');
  await expect(page.locator('.cr-summary')).toContainText('Chapter 1');
  await expect(page.locator('.cr-summary')).toContainText('Week 1 of up to 2');
  const modalBox = await page.locator('#historyBackdrop .progress-modal').boundingBox();
  const viewport = page.viewportSize();
  expect(modalBox?.width).toBeLessThanOrEqual(viewport?.width);
  expect(modalBox?.height).toBeLessThanOrEqual(viewport?.height);

  await page.getByRole('tab', { name: 'Map view' }).click();
  await expect(page.getByTestId('curriculum-map')).toBeVisible();
  await expect(page.getByTestId('curriculum-detail')).toBeVisible();
  await expect(page.getByTestId('curriculum-map')).toContainText('after LOY W30');

  await page.getByRole('tab', { name: 'List view' }).click();
  await expect(page.locator('.cr-level-label').first()).toHaveText('Chapter 1 — Weeks 1–2');
  await expect(page.locator('.cr-practice-block-label').first()).toHaveText('Weeks 1–2');
  await expect(page.locator('#cr-list-view')).not.toContainText('loy_course_1');
  await page.getByRole('button', { name: 'Expand all' }).click();
  await expect(page.locator('#cr-list-view details:not([open])')).toHaveCount(0);
  await expect(page.getByTestId('curriculum-milestone')).toContainText('After Light on Yoga Week 30');
  await page.getByRole('button', { name: 'Collapse all' }).click();
  await expect(page.locator('#cr-list-view details[open]')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Map view' }).click();

  const visibleStation = page.getByTestId('curriculum-station').first();
  const hitTarget = page.getByTestId('curriculum-station-hit-target').first();
  await expect(visibleStation).toBeVisible();
  await expect(hitTarget).toBeVisible();

  const sizes = await Promise.all([
    visibleStation.getAttribute('r').then(Number),
    hitTarget.getAttribute('r').then(Number),
  ]);
  expect(sizes[1]).toBeGreaterThan(sizes[0] + 8);
  await expect(hitTarget).toHaveCSS('fill', 'rgba(0, 0, 0, 0)');

  const secondTarget = page.getByTestId('curriculum-station-hit-target').nth(1);
  await secondTarget.click();
  await expect(page.getByTestId('curriculum-detail')).toContainText('How to Use Yoga');
});

test('Curriculum Map stations support keyboard activation', async ({ page }) => {
  await openProfile(page);

  await openCurriculumMapFromProgress(page);
  await page.getByRole('tab', { name: 'Map view' }).click();
  await expect(page.getByTestId('curriculum-map')).toBeVisible();

  const thirdTarget = page.getByTestId('curriculum-station-hit-target').nth(2);
  await thirdTarget.focus();
  await page.keyboard.press('Enter');

  await expect(page.getByTestId('curriculum-detail')).toContainText('Light on Pranayama');
});

test('Curriculum Map preserves the duration dial position on close', async ({ page }) => {
  await openProfile(page);

  await page.locator('#manualLibraryPanel > summary').click();
  const dial = page.locator('#durationDial');
  await expect(dial).toBeVisible();
  await dial.fill('37');
  await expect(dial).toHaveValue('37');

  await openCurriculumMapFromProgress(page);
  await page.getByRole('tab', { name: 'Map view' }).click();
  await expect(page.getByTestId('curriculum-map')).toBeVisible();

  // Reproduce the browser-side mutation seen after a mobile modal interaction.
  await dial.evaluate((input) => {
    input.value = '82';
  });
  await expect(dial).toHaveValue('82');

  await page.locator('#historyCloseBtn').click();
  await expect(page.locator('#historyBackdrop')).toBeHidden();
  await expect(dial).toHaveValue('37');
  await expect(page.locator('#userEmailDisplay')).toBeFocused();
});

test('installed app cold-starts, advances, and reopens with the computer unavailable', async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name === 'iphone-layout', 'Playwright WebKit cannot reliably reload a service-worker-controlled page while offline.');
  await openProfile(page);

  await page.evaluate(async () => {
    await window.refreshCurriculumSnapshot();
    await navigator.serviceWorker.ready;
  });
  await expect.poll(async () => page.evaluate(async () => {
    const cache = await caches.open('yoga-shell-v20');
    return (await cache.keys()).length;
  })).toBeGreaterThan(5);

  // A page opened before the worker finished installing is not necessarily
  // controlled until its next navigation. This reload represents launching
  // the installed PWA after the initial download.
  if (!await page.evaluate(() => Boolean(navigator.serviceWorker.controller))) {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('#mainAppContainer')).toBeVisible({ timeout: 10_000 });
  }
  await expect.poll(() =>
    page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

  await context.setOffline(true);

  await page.reload({ waitUntil: 'domcontentloaded' });

  await expect(page.locator('#mainAppContainer')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('#connectionModeDisplay'))
    .toHaveText('Offline');

  await page.getByRole('button', { name: /start today's practice/i }).click();
  await expect(page.locator('#curriculumPracticeSummary')).toContainText(/Week 1 [·,] Day 1/);
  await expect(page.locator('#practiceWorkspace')).toBeVisible();

  await page.evaluate(() => window.markCurrentCurriculumNodeCompleteForTesting());
  await expect(page.locator('#ratingOverlay')).toBeVisible();
  await page.getByRole('button', { name: /good/i }).click();
  await expect(page.locator('#curriculumPracticeSummary')).toContainText(/Week 1 [·,] Day 2/);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('#mainAppContainer')).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: /start today's practice/i }).click();
  await expect(page.locator('#curriculumPracticeSummary')).toContainText(/Week 1 [·,] Day 2/);

  await page.locator('#userEmailDisplay').click();
  await page.locator('#histTabCurriculum').click();
  await expect(page.getByTestId('curriculum-map')).toBeVisible();
  await expect(page.locator('.cr-summary')).toContainText('1 of 7 practices');
});
