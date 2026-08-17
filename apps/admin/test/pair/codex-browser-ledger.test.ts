import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadCodexBrowserCompletion } from "./codex-browser-ledger";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function timestamp(second: number): Readonly<{ utc: string; local: string }> {
  return {
    utc: `2026-08-16T17:30:${String(second).padStart(2, "0")}.000Z`,
    local: `2026-08-16 13:30:${String(second).padStart(2, "0")} GMT-4`,
  };
}

async function fixture(): Promise<Readonly<{ root: string; doneFile: string }>> {
  const root = await mkdtemp(path.join(tmpdir(), "kokoro-codex-browser-ledger-"));
  temporaryRoots.push(root);
  return Object.freeze({ root, doneFile: path.join(root, "codex-browser.done") });
}

describe("Codex in-app browser completion ledger", () => {
  it("IAM-E2E-FRESH-001 rejects a blocked marker instead of treating file existence as success", async () => {
    const { root, doneFile } = await fixture();
    await writeFile(path.join(root, "manual-browser-ledger.json"), JSON.stringify({
      schemaVersion: 1,
      browser: "Codex In-App Browser",
      overall: "BLOCKED",
      accepted: false,
      entries: [],
    }));
    await writeFile(doneFile, JSON.stringify({
      schemaVersion: 1,
      decision: "BLOCKED",
      ledger: "manual-browser-ledger.json",
      completedAt: timestamp(1),
    }));

    await expect(loadCodexBrowserCompletion(doneFile, root, ["IAM-E2E-AUTH-001"]))
      .rejects.toThrow("Codex browser acceptance reported BLOCKED");
  });

  it("IAM-E2E-FRESH-001 rejects PASS when a required case or screenshot is missing", async () => {
    const { root, doneFile } = await fixture();
    await writeFile(path.join(root, "manual-browser-ledger.json"), JSON.stringify({
      schemaVersion: 1,
      browser: "Codex In-App Browser",
      overall: "PASS",
      accepted: true,
      entries: [{
        category: "认证",
        caseId: "IAM-E2E-AUTH-001",
        step: "consume-link",
        status: "PASS",
        started: timestamp(1),
        finished: timestamp(2),
        expected: "Session created",
        actual: "Session created",
        url: "http://127.0.0.1:3100/",
        screenshot: "screenshots/manual/auth.png",
      }],
    }));
    await writeFile(doneFile, JSON.stringify({
      schemaVersion: 1,
      decision: "PASS",
      ledger: "manual-browser-ledger.json",
      completedAt: timestamp(3),
    }));

    await expect(loadCodexBrowserCompletion(doneFile, root, [
      "IAM-E2E-AUTH-001",
      "IAM-E2E-SESSION-001",
    ])).rejects.toThrow("Codex browser case inventory mismatch");
  });

  it("IAM-E2E-FRESH-001 accepts only exact passing cases with timestamped screenshot evidence", async () => {
    const { root, doneFile } = await fixture();
    await mkdir(path.join(root, "screenshots", "manual"), { recursive: true });
    await writeFile(path.join(root, "screenshots", "manual", "auth.png"), "png-auth");
    await writeFile(path.join(root, "screenshots", "manual", "session.png"), "png-session");
    await writeFile(path.join(root, "manual-browser-ledger.json"), JSON.stringify({
      schemaVersion: 1,
      browser: "Codex In-App Browser",
      overall: "PASS",
      accepted: true,
      entries: [
        {
          category: "认证",
          caseId: "IAM-E2E-AUTH-001",
          step: "consume-link",
          status: "PASS",
          started: timestamp(1),
          finished: timestamp(2),
          expected: "Session created",
          actual: "Session created",
          url: "http://127.0.0.1:3100/",
          screenshot: "screenshots/manual/auth.png",
        },
        {
          category: "会话",
          caseId: "IAM-E2E-SESSION-001",
          step: "revoke-session",
          status: "PASS",
          started: timestamp(3),
          finished: timestamp(4),
          expected: "Session revoked",
          actual: "Session revoked",
          url: "http://127.0.0.1:3100/sessions",
          screenshot: "screenshots/manual/session.png",
        },
      ],
    }));
    await writeFile(doneFile, JSON.stringify({
      schemaVersion: 1,
      decision: "PASS",
      ledger: "manual-browser-ledger.json",
      completedAt: timestamp(5),
    }));

    await expect(loadCodexBrowserCompletion(doneFile, root, [
      "IAM-E2E-AUTH-001",
      "IAM-E2E-SESSION-001",
    ])).resolves.toEqual(expect.objectContaining({
      decision: "PASS",
      caseIds: ["IAM-E2E-AUTH-001", "IAM-E2E-SESSION-001"],
      stepCount: 2,
    }));
  });
});
