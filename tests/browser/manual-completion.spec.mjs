import { expect, test } from '@playwright/test';
import { createProfile } from './profile-helpers.mjs';

async function expectCleanPlayer(page) {
  await expect(page.locator('#practiceWorkspace')).toBeHidden();
  await expect(page.locator('#sequenceSelect')).toHaveValue('');
  const state = await page.evaluate(() => ({
    sequence: window.currentSequence?.title ?? null,
    active: window.activePlaybackList?.length ?? 0,
  }));
  expect(state).toEqual({ sequence: null, active: 0 });
}

test('manual completion clears the player after rating', async ({ page }) => {
  await createProfile(page, 'Manual completion test');
  await page.locator('#manualLibraryPanel > summary').click();
  await page.locator('#sequenceSelect').selectOption({ index: 1 });
  await expect(page.locator('#practiceWorkspace')).toBeVisible();

  await page.evaluate(() => window.saveCurrentSequenceCompletion({ durationSeconds: 60 }));
  await expect(page.locator('#ratingOverlay')).toBeVisible();
  await page.locator('.rating-overlay__button[data-rating="4"]').click();
  await expect(page.locator('#historyBackdrop')).toBeVisible();
  await expectCleanPlayer(page);

  await page.locator('#historyCloseBtn').click();
  await expect(page.locator('#historyBackdrop')).toBeHidden();
  await expectCleanPlayer(page);
});

test('manual outside-app confirmation clears the player after rating', async ({ page }) => {
  await createProfile(page, 'Manual confirmation test');
  await page.locator('#manualLibraryPanel > summary').click();
  await page.locator('#sequenceSelect').selectOption({ index: 1 });
  await expect(page.locator('#practiceWorkspace')).toBeVisible();

  await page.evaluate(() => { void window.triggerSequenceEnd(); });
  await expect(page.locator('#manualCompletionOverlay')).toBeVisible();
  await page.locator('#confirmManualCompletionBtn').click();
  await expect(page.locator('#ratingOverlay')).toBeVisible();
  await page.locator('.rating-overlay__button[data-rating="4"]').click();
  await expect(page.locator('#historyBackdrop')).toBeVisible();
  await expectCleanPlayer(page);

  await page.locator('#historyCloseBtn').click();
  await expect(page.locator('#historyBackdrop')).toBeHidden();
  await expectCleanPlayer(page);
});
