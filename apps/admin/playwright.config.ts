import path from "node:path";

import { defineConfig, devices } from "@playwright/test";

const evidenceRoot = process.env.PAIR_EVIDENCE_ROOT;
const baseURL = process.env.PAIR_ADMIN_BASE_URL;
if (evidenceRoot === undefined || !path.isAbsolute(evidenceRoot)) {
  throw new Error("PAIR_EVIDENCE_ROOT must be an absolute path");
}
if (baseURL === undefined || !URL.canParse(baseURL)) {
  throw new Error("PAIR_ADMIN_BASE_URL must be a valid URL");
}

export default defineConfig({
  testDir: "./test/pair",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  outputDir: path.join(evidenceRoot, "playwright-output"),
  reporter: [
    ["list"],
    ["json", { outputFile: path.join(evidenceRoot, "playwright-report.json") }],
    ["junit", { outputFile: path.join(evidenceRoot, "playwright-junit.xml") }],
  ],
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    headless: true,
    launchOptions: {
      slowMo: Number(process.env.PAIR_SLOW_MO_MS ?? "0"),
    },
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
