import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  availablePort,
  createPairResources,
  loadPairRuntimeConfig,
  startTrackedProcess,
  stopTrackedProcess,
  writeRoundSecrets,
} from "./fixture";

describe("pair acceptance fixture", () => {
  it("IAM-E2E-FRESH-001 derives distinct exact-scoped resources for both rounds", () => {
    const root = resolve(tmpdir(), "kokoro-pair-root");
    const first = createPairResources(root, "pair-20260816T153000Z-candidate", 1);
    const second = createPairResources(root, "pair-20260816T153000Z-candidate", 2);

    expect(first.roundId).not.toBe(second.roundId);
    expect(first.databaseName).toMatch(/^kokoro_iam_pair_[a-f0-9]{12}_r1$/u);
    expect(second.databaseName).toMatch(/^kokoro_iam_pair_[a-f0-9]{12}_r2$/u);
    expect(first.iamWorktree).not.toBe(second.iamWorktree);
    expect(first.secretDirectory).not.toBe(second.secretDirectory);
    expect(first.browserOutput).not.toBe(second.browserOutput);
  });

  it("IAM-E2E-FRESH-001 loads pair inputs from Env and writes distinct exact-0600 secrets", async () => {
    expect(loadPairRuntimeConfig({
      PAIR_IAM_SOURCE_REPO: "/workspace/kokoro-iam",
      PAIR_POSTGRES_OWNER_URL: "postgresql:///postgres",
    })).toEqual({
      iamSourceRepository: "/workspace/kokoro-iam",
      postgresOwnerUrl: "postgresql:///postgres",
    });
    expect(() => loadPairRuntimeConfig({
      PAIR_IAM_SOURCE_REPO: "../kokoro-iam",
      PAIR_POSTGRES_OWNER_URL: "postgresql:///postgres",
    })).toThrow("invalid pair configuration");

    const root = await mkdtemp(join(tmpdir(), "kokoro-pair-secrets-"));
    try {
      const secrets = await writeRoundSecrets(root);
      const entries = Object.values(secrets);
      expect(new Set(entries.map((entry) => entry.value)).size).toBe(entries.length);
      expect(secrets.administratorPassword.value).toMatch(/^[A-Za-z0-9_-]{43}$/u);
      for (const entry of entries) {
        expect(await readFile(entry.path, "utf8")).toBe(entry.value);
        expect((await stat(entry.path)).mode & 0o777).toBe(0o600);
      }
      for (const entry of entries.filter((entry) => entry !== secrets.administratorPassword)) {
        expect(entry.value).toMatch(/^[a-f0-9]{64}$/u);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("IAM-E2E-FRESH-001 allocates loopback ports and stops the exact supervised PID", async () => {
    const port = await availablePort();
    expect(port).toBeGreaterThan(0);
    expect(port).toBeLessThanOrEqual(65_535);

    const root = await mkdtemp(join(tmpdir(), "kokoro-pair-process-"));
    try {
      const child = await startTrackedProcess({
        name: "fixture-child",
        command: process.execPath,
        args: ["-e", "setInterval(() => {}, 1000)"],
        cwd: root,
        environment: process.env,
        stdoutPath: join(root, "stdout.log"),
        stderrPath: join(root, "stderr.log"),
      });
      expect(child.pid).toBeGreaterThan(0);
      process.kill(child.pid, 0);
      const stopped = await stopTrackedProcess(child);
      expect(stopped.pid).toBe(child.pid);
      expect(stopped.signal).toBe("SIGTERM");
      expect(() => process.kill(child.pid, 0)).toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
