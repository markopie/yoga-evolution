import { expect } from '@playwright/test';

export async function createProfile(page, name = 'Practice profile') {
    await page.goto('/');
    await expect(page.locator('#loginScreen')).toHaveAttribute('data-ready', 'true');
    await page.locator('#newProfileName').fill(name);
    await page.getByRole('button', { name: 'Create profile', exact: true }).click();
    await expect(page.locator('#mainAppContainer')).toBeVisible();
    await expect(page.locator('#startTodayPracticeBtn')).toBeVisible();
    await page.evaluate(async () => window.refreshCurriculumSnapshot({ userId: window.currentUserId }));
}
