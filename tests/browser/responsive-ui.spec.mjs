import { expect, test } from '@playwright/test';

import { createProfile as signIn } from './profile-helpers.mjs';

test('profile card fits every control without horizontal scrolling', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#loginScreen')).toHaveAttribute('data-ready', 'true');
  for (const width of [320, 475, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    const layout = await page.locator('#loginCard').evaluate(card => {
      const bounds = card.getBoundingClientRect();
      return {
        overflow: card.scrollWidth - card.clientWidth,
        width: bounds.width,
        controlsFit: [...card.querySelectorAll('input, button')].every(control => {
          const box = control.getBoundingClientRect();
          return box.left >= bounds.left && box.right <= bounds.right;
        }),
      };
    });
    expect(layout.overflow).toBeLessThanOrEqual(1);
    expect(layout.controlsFit).toBe(true);
    if (width === 1280) expect(layout.width).toBeGreaterThan(500);
  }
});

test('core actions are visible and do not cause horizontal overflow', async ({ page }) => {
  await signIn(page);
  await expect(page.locator('#userEmailDisplay')).toBeVisible();
  await expect(page.locator('#startTodayPracticeBtn')).toBeVisible();
  const startButtonFits = await page.locator('#startTodayPracticeBtn').evaluate((element) => ({
    width: element.getBoundingClientRect().width,
    parentWidth: element.parentElement.getBoundingClientRect().width,
    textFits: element.scrollWidth <= element.clientWidth,
  }));
  expect(startButtonFits.width).toBeLessThanOrEqual(startButtonFits.parentWidth);
  expect(startButtonFits.textFits).toBe(true);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test('curriculum map remains usable at every configured viewport', async ({ page }) => {
  await signIn(page);
  await page.locator('#userEmailDisplay').click();
  await page.locator('#histTabCurriculum').click();
  await expect(page.locator('#historyBackdrop')).toBeVisible();
  await expect(page.locator('#historyCloseBtn')).toBeVisible();
  const bounds = await page.locator('#historyBackdrop .progress-modal').boundingBox();
  const viewport = page.viewportSize();
  expect(bounds.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(bounds.height).toBeLessThanOrEqual(viewport.height + 1);
});

test('offline controls are hidden inside Settings while healthy', async ({ page }) => {
  await signIn(page);
  await expect(page.locator('#syncStatusButton')).toBeHidden();
  await expect(page.locator('#offlineMediaPanel')).not.toBeVisible();
  await page.locator('#settingsToggleButton').click();
  await expect(page.locator('#offlineMediaPanel')).toBeVisible();
});
