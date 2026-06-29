import { defineConfig, devices } from "@playwright/test";
import {
  e2eApiUrl,
  e2ePlatformEnv,
  e2ePlatformPort,
  e2ePlatformUrl,
  e2eRequestLogWorkerUrl,
  e2eRuntimeEnv,
} from "./e2e/env";

function shellQuote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function shellEnv(env: Record<string, string>) {
  return Object.entries(env)
    .map(([key, value]) => `${key}=${shellQuote(value)}`)
    .join(" ");
}

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: e2ePlatformUrl,
    screenshot: "only-on-failure",
    trace: "on-first-retry",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command: `${shellEnv(e2eRuntimeEnv)} pnpm exec tsx scripts/e2e/request-log-worker.ts`,
      url: `${e2eRequestLogWorkerUrl}/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: `${shellEnv(e2eRuntimeEnv)} pnpm --filter @repo/api exec tsx src/index.ts`,
      url: `${e2eApiUrl}/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: `${shellEnv(
        e2ePlatformEnv,
      )} pnpm --filter @repo/platform exec vite --host 127.0.0.1 --port ${e2ePlatformPort} --strictPort`,
      url: e2ePlatformUrl,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
