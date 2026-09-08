import { defineConfig } from '@playwright/test';

// Records the end-to-end walkthrough. Target a deployment with
// PLAYWRIGHT_BASE_URL, or omit it to start a local dev server (which needs
// GEMINI_API_KEY in .dev.vars). `npm run video` runs this and lifts the clip
// to clause-walkthrough.webm.
const remote = process.env.PLAYWRIGHT_BASE_URL;

export default defineConfig({
  testDir: './tests/video',
  fullyParallel: false,
  workers: 1,
  timeout: 300_000,
  expect: { timeout: 30_000 },
  reporter: [['list']],
  use: {
    baseURL: remote || 'http://127.0.0.1:5173',
    viewport: { width: 1440, height: 900 },
    video: { mode: 'on', size: { width: 1440, height: 900 } },
    trace: 'retain-on-failure',
  },
  ...(remote ? {} : {
    webServer: {
      command: 'npm run dev',
      url: 'http://127.0.0.1:5173',
      timeout: 180_000,
      reuseExistingServer: true,
    },
  }),
});
