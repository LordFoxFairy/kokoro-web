import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadPairCaseLedger } from "./case-ledger";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Pair case evidence ledger", () => {
  it("WEB-CONTRACT-PAIR-001 records missing interrupted case evidence as a failure", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "kokoro-pair-case-ledger-"));
    temporaryRoots.push(root);
    const complete = path.join(root, "IAM-E2E-AUTH-001");
    await mkdir(complete);
    await writeFile(path.join(complete, "case.json"), JSON.stringify({
      caseId: "IAM-E2E-AUTH-001",
      status: "PASS",
      retries: 0,
      attempts: 1,
      steps: [{ stepId: "login" }],
    }));

    const cases = await loadPairCaseLedger(root, ["IAM-E2E-AUTH-001", "IAM-E2E-SESSION-001"]);

    expect(cases).toEqual([
      expect.objectContaining({ caseId: "IAM-E2E-AUTH-001", status: "PASS", attempts: 1 }),
      expect.objectContaining({
        caseId: "IAM-E2E-SESSION-001",
        status: "FAIL",
        attempts: 0,
        failure: "case evidence is missing",
      }),
    ]);
  });
});
