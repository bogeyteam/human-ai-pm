import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 90000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    headless: true,
    screenshot: "only-on-failure",
    video: "off",
    trace: "retain-on-failure",
  },
  reporter: [["list"]],
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
  // Auto-start the Next.js dev server if it's not already running.
  // Skipped when E2E_BASE_URL is set to something other than localhost,
  // so the same suite can target prod/preview without spawning a local dev.
  webServer:
    process.env.E2E_BASE_URL && !process.env.E2E_BASE_URL.includes("localhost")
      ? undefined
      : {
          command: "pnpm next dev",
          url: "http://localhost:3000",
          timeout: 60000,
          reuseExistingServer: true,
          stdout: "ignore",
          stderr: "pipe",
        },
});
