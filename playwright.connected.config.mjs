import { defineConfig } from '@playwright/test';
import base from './playwright.config.mjs';

// Explicit integration run against the Supabase project in .env.local.
// Keep fixture-based regression tests in the separate default suite.
export default defineConfig({
    ...base,
    testDir: './tests/connected',
    timeout: 180_000,
    expect: { timeout: 30_000 },
    outputDir: '.runtime/connected-results',
    reporter: [['list'], ['html', { outputFolder: '.runtime/connected-report', open: 'never' }]],
    projects: [base.projects[0]],
    webServer: {
        ...base.webServer,
        env: { ...base.webServer.env, VITE_BROWSER_TEST_MOCKS: '0', VITE_APP_ENV: 'testing' },
    },
});
