import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { watch: { ignored: ['**/.runtime/**', '**/playwright-report/**', '**/test-results/**'] } },
});
