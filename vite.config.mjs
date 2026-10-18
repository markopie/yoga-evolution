import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { watch: { ignored: ['**/.runtime/**', '**/playwright-report/**', '**/test-results/**'] } },
  // Remote-browser test runs reach the Playwright preview through a tunnel hostname.
  preview: {
    allowedHosts: process.env.PLAYWRIGHT_PREVIEW === '1' ? ['.loca.lt', '.trycloudflare.com'] : [],
  },
});

