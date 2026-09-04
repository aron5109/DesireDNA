import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end configuration. The app runs against an in-memory PostgREST stub
 * (tests/e2e/postgrest-stub.mjs) with throwaway keys, so no real Supabase
 * project or secret is involved.
 *
 * Set PLAYWRIGHT_CHROMIUM_EXECUTABLE when Chromium is provided by the
 * environment rather than by `npx playwright install`.
 */
const PORT = 3111;
const STUB_PORT = 54321;

const testEnvironment = {
  NEXT_PUBLIC_APP_URL: `http://127.0.0.1:${PORT}`,
  NEXT_PUBLIC_E2E_SHORT_QUIZ: "true",
  SUPABASE_URL: `http://127.0.0.1:${STUB_PORT}`,
  SUPABASE_SERVICE_ROLE_KEY: "end-to-end-service-role-key-not-real",
  PROFILE_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
  PROFILE_ENCRYPTION_KEY_VERSION: "1",
  SHARE_CODE_HMAC_KEY: "end-to-end-share-code-hmac-key-not-real",
  OWNER_TOKEN_HMAC_KEY: "end-to-end-owner-token-hmac-key-not-real",
  RATE_LIMIT_HMAC_KEY: "end-to-end-rate-limit-hmac-key-not-real",
  CRON_SECRET: "end-to-end-cron-secret-value-not-real",
};

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {},
  },
  projects: [
    {
      name: "mobile",
      // The layout is mobile-first, so the primary run is a phone viewport.
      use: { ...devices["Pixel 7"] },
    },
  ],
  webServer: [
    {
      command: `node tests/e2e/postgrest-stub.mjs`,
      port: STUB_PORT,
      reuseExistingServer: !process.env.CI,
      env: { STUB_PORT: String(STUB_PORT) },
    },
    {
      command: `npx next dev --port ${PORT}`,
      port: PORT,
      reuseExistingServer: !process.env.CI,
      env: testEnvironment,
    },
  ],
});
