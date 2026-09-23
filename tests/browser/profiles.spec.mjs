import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createProfile } from './profile-helpers.mjs';

test('a new device offers create/import and has no password, passkey or MFA controls', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#loginScreen')).toHaveAttribute('data-ready', 'true');
    await expect(page.locator('#noProfilesMessage')).toBeVisible();
    await expect(page.locator('input[type=password], #mfaPanel, #passkeyEnrollmentPrompt')).toHaveCount(0);
    await expect(page.locator('#profileImportFile')).toBeVisible();
});

test('create, reopen, and switch profiles without credentials or theme initialization errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await createProfile(page, 'Alice');
    const alice = await page.evaluate(() => window.currentUserId);
    await page.reload();
    await expect(page.locator('#mainAppContainer')).toBeVisible();
    await page.locator('#settingsToggleButton').click();
    await page.locator('#signOutBtn').click();
    await expect(page.locator('#deviceProfileList')).toContainText('Alice');
    await createProfile(page, 'Bob');
    expect(await page.evaluate(() => window.currentUserId)).not.toBe(alice);
    await page.locator('#settingsToggleButton').click();
    await page.locator('#signOutBtn').click();
    await page.getByRole('button', { name: 'Alice', exact: true }).click();
    await expect(page.locator('#mainAppContainer')).toBeVisible();
    expect(await page.evaluate(() => window.currentUserId)).toBe(alice);
    expect(errors).toEqual([]);
});

test('profile files transfer progress and settings as an independent copy without session tokens', async ({ page }) => {
    await createProfile(page, 'Alice');
    const originalId = await page.evaluate(() => window.currentUserId);
    await page.getByRole('button', { name: /start today's practice/i }).click();
    await expect(page.locator('#curriculumPracticeSummary')).toContainText(/Week 1 [·,] Day 1/);
    await expect(page.locator('#practiceWorkspace')).toBeVisible();
    await page.evaluate(() => window.markCurrentCurriculumNodeCompleteForTesting());
    await page.getByRole('button', { name: /good/i }).click();
    await expect(page.locator('#ratingOverlay')).toBeHidden();
    await page.getByRole('button', { name: 'Preview first pose', exact: true }).click();
    await page.locator('#themeToggle').click();
    const theme = await page.locator('html').getAttribute('data-theme');
    await page.locator('#settingsToggleButton').click();
    const downloaded = page.waitForEvent('download');
    await page.locator('#exportProfileBtn').click();
    const download = await downloaded;
    const content = await readFile(await download.path(), 'utf8');
    const backup = JSON.parse(content);
    expect(backup.completions.length).toBeGreaterThan(0);
    expect(content).not.toMatch(/access_token|refresh_token|user_id|mock-access|mock-refresh/);
    await page.locator('#signOutBtn').click();
    await expect(page.locator('#loginScreen')).toHaveAttribute('data-ready', 'true');
    await page.locator('#profileImportFile').setInputFiles({ name: 'profile.json', mimeType: 'application/json', buffer: Buffer.from(content) });
    await expect(page.locator('#mainAppContainer')).toBeVisible();
    expect(await page.evaluate(() => window.currentUserId)).not.toBe(originalId);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await page.getByRole('button', { name: /start today's practice/i }).click();
    await expect(page.locator('#curriculumPracticeSummary')).toContainText(/Week 1 [·,] Day 2/);
    await page.getByRole('button', { name: 'Preview first pose', exact: true }).click();
    await page.locator('#settingsToggleButton').click();
    await page.locator('#signOutBtn').click();
    await expect(page.locator('#deviceProfileList')).toContainText('Alice (copy)');
    await expect(page.locator('#deviceProfileList')).toContainText('Alice');
});

test('bad profile files leave saved profiles unchanged', async ({ page }) => {
    await createProfile(page, 'Alice');
    await page.locator('#settingsToggleButton').click();
    await page.locator('#signOutBtn').click();
    await expect(page.locator('#loginScreen')).toHaveAttribute('data-ready', 'true');
    await page.locator('#profileImportFile').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"format":"not-yoga"}') });
    await expect(page.locator('#profileMessage')).toContainText('not a supported');
    await expect(page.locator('.device-profile-card')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Alice', exact: true })).toBeVisible();
});

test('another browser cannot discover profiles from this browser', async ({ page, browser }) => {
    await createProfile(page, 'Private profile');
    const otherContext = await browser.newContext();
    try {
        const otherPage = await otherContext.newPage();
        await otherPage.goto(new URL('/', page.url()).href);
        await expect(otherPage.locator('#noProfilesMessage')).toBeVisible();
        await expect(otherPage.locator('body')).not.toContainText('Private profile');
    } finally { await otherContext.close(); }
});
