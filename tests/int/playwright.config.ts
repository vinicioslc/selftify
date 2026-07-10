import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  timeout: 120_000,
  expect: { timeout: 10_000 },
  retries: 0,
  workers: 1,
  use: {
    baseURL: undefined,
    headless: true,
  },
  projects: [
    {
      name: "server-integration",
      testMatch: "server-api.spec.ts",
    },
  ],
});
