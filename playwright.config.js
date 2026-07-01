// vim: tabstop=2 shiftwidth=2 expandtab
//
// Playwright regression suite for the gallery UI (currently the map). Drives the
// RUNNING local stack, so bring it up first (docker compose up -d) with some
// geotagged albums, and install the browser once (npx playwright install chromium).
// Run:  npm run e2e        (headless)   |   npm run e2e:ui   (interactive debugger)
//
// Auth: global-setup logs in with the debug-data throwaway admin creds and saves a
// storageState the tests reuse (no per-test login). Override the target with
// MAP_CHECK_URL. Tiles are stubbed per-test so blocked OSM imagery never masks a
// real console error.

const { defineConfig, devices } = require('@playwright/test');
const path = require('path');

module.exports = defineConfig({
  testDir: './e2e',
  timeout: 30000,
  expect: { timeout: 10000 },
  // The suite shares one stack + one dataset, so run serially to avoid contention.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  globalSetup: require.resolve('./e2e/global-setup.js'),
  use: {
    baseURL: process.env.MAP_CHECK_URL || 'http://localhost:3000',
    viewport: { width: 1280, height: 900 },
    storageState: path.join(__dirname, 'e2e/.auth/state.json'),
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
