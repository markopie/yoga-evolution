import { chromium } from 'playwright';
import { test as base, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

// Playwright worker processes do not auto-load .env, so read the endpoint here.
function loadDotEnv() {
    try {
        for (const line of readFileSync(new URL('../../.env', import.meta.url), 'utf8').split('\n')) {
            const idx = line.indexOf('=');
            if (idx <= 0) continue;
            const key = line.slice(0, idx).trim();
            const value = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
            if (!(key in process.env)) process.env[key] = value;
        }
    } catch { /* .env is optional */ }
}
loadDotEnv();

// When CHROMIUM_WSS_URL is set (e.g. in .env), browser tests run against that
// remote Chrome over CDP. The remote browser cannot reach this machine's
// localhost, so a localtunnel is opened to the local web server and baseURL
// is redirected through it. The bypass-tunnel-reminder header is set per-page
// (not just per-context) so it applies to subresource requests too, not just
// top-level navigations. Both the browser and tunnel are worker-scoped.
// Local launch remains the fallback so the suite still works without the endpoint.
const WS_ENDPOINT = process.env.CHROMIUM_WSS_URL?.trim();

async function openTunnel(port) {
    const { default: localtunnel } = await import('localtunnel');
    return localtunnel({ port: Number(port) });
}

function waitForServer(url, timeoutMs = 90_000) {
    return new Promise((resolve, reject) => {
        const start = Date.now();
        const check = () => {
            import('node:http').then(({ default: http }) => {
                const req = http.get(url, (res) => {
                    res.destroy();
                    resolve();
                });
                req.on('error', () => {
                    if (Date.now() - start > timeoutMs) reject(new Error(`Server at ${url} did not start`));
                    else setTimeout(check, 1000);
                });
            });
        };
        check();
    });
}

export const test = base.extend({
    browser: [
        async ({ playwright }, use) => {
            const browser = WS_ENDPOINT
                ? await chromium.connectOverCDP(WS_ENDPOINT, { timeout: 60_000 })
                : await playwright.chromium.launch();
            await use(browser);
            await browser.close();
        },
        { scope: 'worker' },
    ],

    _tunnel: [
        async ({}, use) => {
            if (!WS_ENDPOINT) {
                await use(null);
                return;
            }
            const port = process.env.PLAYWRIGHT_PORT || 4173;
            await waitForServer(`http://localhost:${port}/`);
            const tunnel = await openTunnel(port);
            await use(tunnel);
            await tunnel.close();
        },
        { scope: 'worker' },
    ],

    baseURL: async ({ _tunnel }, use) => {
        if (_tunnel) {
            await use(_tunnel.url);
        } else {
            await use(undefined);
        }
    },

    // Set the bypass header on every page so subresource requests also skip
    // the localtunnel interstitial. contextOptions only covers top-level
    // navigations; page-level headers cover all requests.
    page: async ({ page, _tunnel }, use) => {
        if (_tunnel) {
            await page.setExtraHTTPHeaders({ 'bypass-tunnel-reminder': '1' });
        }
        await use(page);
    },
});

export { expect };
