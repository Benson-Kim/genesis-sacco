import { defineConfig, type PlaywrightTestConfig } from '@playwright/test';

/**
 * Minimal E2E happy-path harness (MASTER_PROMPT section 4). Module-specific
 * flows are added per BUILD_PROMPTS P15 alongside each dashboard feature;
 * this config + the smoke spec are what P14 needs to get `web:e2e` green in
 * CI once a review-app URL is available.
 */
const config: PlaywrightTestConfig = {
  testDir: './e2e',
  timeout: 30_000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
  },
};

// Only spin up a local dev server when no review-app URL was supplied —
// built as a conditional assignment (not a ternary defaulting to
// `undefined`) because `exactOptionalPropertyTypes` rejects explicitly
// setting an optional property to `undefined`.
if (!process.env.E2E_BASE_URL) {
  config.webServer = { command: 'npm run dev', url: 'http://localhost:3000', reuseExistingServer: true };
}

export default defineConfig(config);
