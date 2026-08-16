import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { runCommand, timestamp } from "../../scripts/test/evidence";
import { categoryFileStatuses } from "../../scripts/test/run-acceptance";
import { probeGeneratedRpc, startGeneratedIamFixture } from "../../scripts/test/smoke-runtime";

const appRoot = resolve(import.meta.dirname, "../..");

describe("Admin runtime evidence and generated listener", () => {
  it("WEB-CONTRACT-RUNTIME-001 calls a real generated ConnectRPC listener", async () => {
    const fixture = await startGeneratedIamFixture();
    try {
      const evidence = await probeGeneratedRpc(fixture.baseUrl);
      expect(evidence).toEqual(expect.objectContaining({
        service: "kokoro.iam.v1.IamAdministrationService",
        method: "ListUsers",
        itemCount: 0,
      }));
      expect(fixture.operations()).toEqual(["ListUsers"]);
    } finally {
      await fixture.close();
    }
  });

  it("WEB-CONTRACT-RUNTIME-001 records local UTC duration exit and separate command logs", async () => {
    const root = await mkdtemp(join(await realpath(tmpdir()), "kokoro-admin-evidence-"));
    try {
      const value = timestamp(new Date("2026-08-16T12:30:45.123Z"));
      expect(value.utc).toBe("2026-08-16T12:30:45.123Z");
      expect(value.local).toMatch(/^2026-08-16T\d{2}:30:45\.123[-+]\d{2}:\d{2}$/u);
      const command = await runCommand({
        name: "fixture",
        command: process.execPath,
        args: ["-e", "process.stdout.write('out'); process.stderr.write('err')"],
        cwd: process.cwd(),
        evidenceRoot: root,
      });
      expect(command.exitCode).toBe(0);
      expect(command.durationMs).toBeGreaterThanOrEqual(0);
      expect(await readFile(join(root, command.stdoutPath), "utf8")).toBe("out");
      expect(await readFile(join(root, command.stderrPath), "utf8")).toBe("err");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("WEB-CONTRACT-RUNTIME-001 maps executed case IDs and reports pending or unclassified assertions", async () => {
    const root = await mkdtemp(join(await realpath(tmpdir()), "kokoro-admin-vitest-result-"));
    const reportPath = join(root, "result.json");
    const testFile = join(appRoot, "test/contract/runtime-listener.test.ts");
    await writeFile(reportPath, JSON.stringify({
      numTotalTests: 4,
      numPassedTests: 1,
      numFailedTests: 0,
      numPendingTests: 2,
      numTodoTests: 1,
      testResults: [{
        name: testFile,
        status: "passed",
        assertionResults: [
          { title: "WEB-CONTRACT-RUNTIME-001 executes the listener", status: "passed" },
          { title: "WEB-CONTRACT-BUILD-001 pending boundary", status: "pending" },
          { title: "WEB-SEC-SECRET-001 todo secret scan", status: "todo" },
          { title: "unclassified assertion", status: "passed" },
        ],
      }],
    }));

    try {
      const summary = await categoryFileStatuses(appRoot, reportPath);
      expect(summary).toEqual(expect.objectContaining({ skipped: 2, todos: 1, unclassified: 1 }));
      const caseStatuses: unknown = Reflect.get(summary, "caseStatuses");
      expect(caseStatuses).toBeInstanceOf(Map);
      if (!(caseStatuses instanceof Map)) return;
      const fileStatuses: unknown = caseStatuses.get("test/contract/runtime-listener.test.ts");
      expect(fileStatuses).toBeInstanceOf(Map);
      if (!(fileStatuses instanceof Map)) return;
      expect(fileStatuses.get("WEB-CONTRACT-RUNTIME-001")).toBe(true);
      expect(fileStatuses.get("WEB-CONTRACT-BUILD-001")).toBe(false);
      expect(fileStatuses.get("WEB-SEC-SECRET-001")).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
