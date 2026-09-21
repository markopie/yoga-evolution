import { expect, test } from '@playwright/test';

test('test banner follows the explicitly configured environment', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#loginScreen')).toHaveAttribute('data-ready', 'true');
  const banner = page.locator('#environmentBanner');
  const label = (process.env.VITE_APP_ENV || '').trim();

  if (!label || ['production', 'prod', 'live'].includes(label.toLowerCase())) {
    await expect(banner).toBeHidden();
    await expect(banner).toBeEmpty();
  } else {
    await expect(banner).toBeVisible();
    await expect(banner).toHaveText(`TEST SITE - ${label}`);
    await expect(banner).toHaveAttribute('data-environment', label);
  }
});

test('interface symbols survive the production build as UTF-8', async ({ page }) => {
  const response = await page.goto('/');
  expect(await response.text()).not.toContain('\uFFFD');
  await expect(page.locator('#loginLogo')).toHaveText('🧘');
  await expect(page.locator('#prevBtn')).toHaveText('◀ Prev');
  await expect(page.locator('#nextBtn')).toHaveText('Next ▶');
  await expect(page.locator('#completeBtn')).toHaveText('✓ Complete');
  await expect(page.locator('#editCourseCloseBtn')).toHaveText('✕');
  await expect(page.locator('#builderSearch')).toHaveAttribute(
    'placeholder', 'Search by name or ID — or batch: Title; Category; IDs…',
  );
});
