import { createProfile } from './profile-helpers.mjs';
import { expect, test } from '@playwright/test';

async function openCourseReview(page, courseName) {
    await createProfile(page);
    await page.locator('#manualLibraryPanel > summary').click();
    const select = page.locator('#sequenceSelect');
    const optionValue = await select.locator('option', { hasText: courseName }).getAttribute('value');
    await select.selectOption(optionValue);
    await page.getByRole('button', { name: /preview first pose/i }).click();
    await page.locator('#quickEditBtn').click();
    await expect(page.getByRole('button', { name: 'Download PDF' })).toBeVisible();
}

async function expectNonEmptyDownload(page, expectedExtension) {
    const downloadPromise = page.waitForEvent('download');
    const button = page.getByRole('button', { name: 'Download PDF' });
    await button.click();
    const download = await downloadPromise;
    const stream = await download.createReadStream();
    let byteLength = 0;
    for await (const chunk of stream) byteLength += chunk.length;

    expect(download.suggestedFilename().toLowerCase()).toMatch(expectedExtension);
    expect(byteLength).toBeGreaterThan(100);
    await expect(button).toBeEnabled();
    await expect(button).toHaveText('Download PDF');
}

test.describe('sequence PDF downloads', () => {
    test.beforeEach(async ({ context, page, baseURL }) => {
        const allowedOrigin = new URL(baseURL).origin;
        await context.route('**/*', route => {
            const origin = new URL(route.request().url()).origin;
            if (origin === allowedOrigin) return route.continue();
            return route.abort('blockedbyclient');
        });
        page.__uncaughtErrors = [];
        page.on('pageerror', error => page.__uncaughtErrors.push(error.message));
        page.on('console', message => {
            if (message.type() === 'error') page.__uncaughtErrors.push(message.text());
        });
    });

    test('ordinary course downloads a non-empty PDF without external networking', async ({ page }) => {
        await openCourseReview(page, 'Mock Seated Foundation');
        await expectNonEmptyDownload(page, /\.pdf$/);
        expect(page.__uncaughtErrors).toEqual([]);
    });

    test('linked-macro course downloads a non-empty ZIP without external networking', async ({ page }) => {
        await openCourseReview(page, 'Mock Linked Macro Practice');
        await expectNonEmptyDownload(page, /\.zip$/);
        expect(page.__uncaughtErrors).toEqual([]);
    });
});
