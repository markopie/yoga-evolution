import { createProfile } from './profile-helpers.mjs';

import { expect, test } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { readFile } from 'node:fs/promises';

const RUN_REAL_LOCAL_SMOKE = process.env.RUN_LOCAL_SUPABASE_SMOKE === '1';
const LOCAL_SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const LOCAL_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
let adminClient;
const testUsers = [];

test.beforeAll(async () => {
  if (!RUN_REAL_LOCAL_SMOKE) return;
  if (!LOCAL_SUPABASE_URL || !LOCAL_SERVICE_ROLE_KEY) {
    throw new Error(
      'The real local smoke test requires VITE_SUPABASE_URL and '
      + 'SUPABASE_SERVICE_ROLE_KEY.',
    );
  }

  adminClient = createClient(
    LOCAL_SUPABASE_URL,
    LOCAL_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  );

});

test.afterAll(async () => {
  if (!adminClient) return;
  for (const id of testUsers) {
    const { error } = await adminClient.auth.admin.deleteUser(id);
    if (error) throw error;
  }
});

test('optional local Supabase smoke: app can reach the real local runtime', async ({ page }, testInfo) => {
  test.skip(
    !RUN_REAL_LOCAL_SMOKE,
    'Run npm run test:browser:local-supabase to test the real local runtime.',
  );

  await page.goto('/');
  if (process.env.LAYOUT_SCREENSHOTS === '1') {
    await page.locator('#loginCard').screenshot({ path: `.runtime/profile-layout-${testInfo.project.name}.png` });
  }
  await page.waitForFunction(() =>
    typeof window.refreshCurriculumSnapshot === 'function');
  const publicCurriculum = await page.evaluate(async () => {
    const snapshot = await window.refreshCurriculumSnapshot({ userId: null });
    return {
      rows: snapshot.nodes.length,
      userId: snapshot.userId,
      weeks: Math.max(...snapshot.nodes.map((node) => node.week_number)),
    };
  });
  expect(publicCurriculum).toEqual({ rows: 2539, userId: null, weeks: 363 });

  await createProfile(page, 'Temporary profile smoke test');
  const originalId = await page.evaluate(() => window.currentUserId);
  testUsers.push(originalId);

  await page.locator('#curriculumMapBtn').click();
  await expect(page.getByTestId('curriculum-map')).toBeVisible();
  await expect(page.locator('.cr-summary')).toContainText(
    'Week 1 of up to 363',
  );

  // The full curriculum has densely grouped phases absent from the small mock.
  const labelProblems = await page.locator('.cr-source-map-svg').evaluate(svg => {
    const labels = [...svg.querySelectorAll('text')].map(el => ({ text: el.textContent, box: el.getBBox() }));
    const problems = [];
    for (let i = 0; i < labels.length; i++) {
      const a = labels[i];
      if (a.box.x < 0 || a.box.x + a.box.width > svg.viewBox.baseVal.width) problems.push(`Clipped: ${a.text}`);
      for (const b of labels.slice(i + 1)) {
        if (a.box.x < b.box.x + b.box.width && a.box.x + a.box.width > b.box.x
          && a.box.y < b.box.y + b.box.height && a.box.y + a.box.height > b.box.y) problems.push(`${a.text} overlaps ${b.text}`);
      }
    }
    return problems;
  });
  expect(labelProblems).toEqual([]);
  if (process.env.LAYOUT_SCREENSHOTS === '1') {
    await page.setViewportSize({ width: 1920, height: 1200 });
    await page.locator('.cr-source-map-svg').screenshot({ path: `.runtime/roadmap-layout-${testInfo.project.name}.png` });
  }

  await page.getByRole('tab', { name: 'List view' }).click();
  await expect(page.locator('.cr-level-label')).toHaveCount(4);
  await expect(page.locator('.cr-level-label')).toHaveText([
    'Chapter 1 — Weeks 1–38',
    'Chapter 2 — Weeks 39–89',
    'Chapter 3 — Weeks 90–361',
    'Chapter 4 — Weeks 362–363',
  ]);

  // Exercise real RLS and the sync trigger, neither of which browser mocks model.
  const writeError = await page.evaluate(async () => {
    const { error } = await window.supabase.from('sequence_completions').insert({
      user_id: window.currentUserId, title: 'Temporary profile transfer verification',
      completed_at: new Date().toISOString(), completed: true, rating: 4,
      duration_seconds: 600,
    });
    return error?.message;
  });
  expect(writeError).toBeUndefined();
  await page.reload();
  await expect(page.locator('#mainAppContainer')).toBeVisible();
  await page.locator('#appSettingsPanel > summary').click();
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#exportProfileBtn').click();
  const download = await downloadPromise;
  const content = await readFile(await download.path(), 'utf8');
  expect(JSON.parse(content).completions).toHaveLength(1);
  expect(content).not.toMatch(/access_token|refresh_token|user_id/);
  await page.locator('#signOutBtn').click();
  await expect(page.locator('#loginScreen')).toHaveAttribute('data-ready', 'true');
  await page.locator('#profileImportFile').setInputFiles({ name: 'profile.json', mimeType: 'application/json', buffer: Buffer.from(content) });
  await expect(page.locator('#mainAppContainer')).toBeVisible();
  const copyId = await page.evaluate(() => window.currentUserId);
  testUsers.push(copyId);
  expect(copyId).not.toBe(originalId);
  const rows = await page.evaluate(async (original) => {
    const own = await window.supabase.from('sequence_completions').select('user_id');
    const other = await window.supabase.from('sequence_completions').select('user_id').eq('user_id', original);
    return { own: own.data, other: other.data, error: own.error || other.error };
  }, originalId);
  expect(rows).toEqual({ own: [{ user_id: copyId }], other: [], error: null });
});
