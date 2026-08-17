import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  artifactName,
  completeStep,
  safeMailEvidence,
  scanSecrets,
  timestamp,
  verifyChecksums,
  writeChecksums,
} from "./evidence";
import { extractMagicLink } from "./mailbox-client";

describe("pair acceptance evidence", () => {
  it("IAM-E2E-FRESH-001 records stable local and UTC step evidence with every required artifact", () => {
    const started = timestamp(new Date("2026-08-16T15:30:45.123Z"));
    const finished = timestamp(new Date("2026-08-16T15:30:46.456Z"));
    const digest = "a".repeat(64);

    expect(artifactName("IAM-E2E-AUTH-001", "request link", "png"))
      .toBe("IAM-E2E-AUTH-001--request-link.png");
    expect(completeStep({
      caseId: "IAM-E2E-AUTH-001",
      stepId: "request-link",
      expected: "uniform verification state",
      actual: "uniform verification state",
      started,
      finished,
      viewport: { width: 1440, height: 1000 },
      artifacts: {
        screenshot: { path: "screenshots/request.png", sha256: digest },
        trace: { path: "traces/auth.zip", sha256: digest },
        video: { path: "video/auth.webm", sha256: digest },
        har: { path: "har/auth.har", sha256: digest },
        rpc: { path: "rpc/auth.json", sha256: digest },
        sql: { path: "sql/auth.json", sha256: digest },
        logs: { path: "logs/auth.json", sha256: digest },
      },
      requestId: "d7bc5c11-7c0d-4d1c-a717-601bbb44c288",
      commandId: null,
    })).toEqual(expect.objectContaining({
      status: "PASS",
      durationMs: 1_333,
      started: expect.objectContaining({ utc: "2026-08-16T15:30:45.123Z" }),
    }));
    expect(() => completeStep({
      caseId: "IAM-E2E-AUTH-001",
      stepId: "missing-video",
      expected: "complete evidence",
      actual: "incomplete evidence",
      started,
      finished,
      viewport: { width: 1440, height: 1000 },
      artifacts: {
        screenshot: { path: "screenshots/request.png", sha256: digest },
        trace: { path: "traces/auth.zip", sha256: digest },
        video: null,
        har: { path: "har/auth.har", sha256: digest },
        rpc: { path: "rpc/auth.json", sha256: digest },
        sql: { path: "sql/auth.json", sha256: digest },
        logs: { path: "logs/auth.json", sha256: digest },
      },
      requestId: null,
      commandId: null,
    })).toThrow("video");
  });

  it("IAM-E2E-AUTH-001 retains only callback digests and rejects generated secrets in evidence", async () => {
    const callback = "http://127.0.0.1:3100/api/auth/callback/nodemailer?token=raw-token&email=admin%40example.test";
    const safe = safeMailEvidence("message-1", "2026-08-16T15:30:45.123Z", callback);

    expect(JSON.stringify(safe)).not.toContain(callback);
    expect(JSON.stringify(safe)).not.toContain("raw-token");
    expect(safe).toEqual(expect.objectContaining({
      messageId: "message-1",
      callbackSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    }));

    const root = await mkdtemp(join(tmpdir(), "kokoro-pair-secret-scan-"));
    try {
      await writeFile(join(root, "safe.json"), JSON.stringify(safe));
      await writeFile(join(root, "unsafe.har"), "prefix raw-secret suffix");
      expect(await scanSecrets(root, ["raw-secret", "raw-token"])).toEqual({
        status: "FAIL",
        scannedFiles: 2,
        matches: ["unsafe.har"],
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("IAM-E2E-AUTH-001 extracts only the expected Auth.js callback from a captured SMTP message", () => {
    const callback = extractMagicLink({
      ID: "message-1",
      Created: "2026-08-16T15:30:45.123Z",
      Text: "Sign in ( http://127.0.0.1:3100/api/auth/callback/nodemailer?token=raw-token&email=admin%40example.test )",
      HTML: "<a href=\"http://127.0.0.1:3100/api/auth/callback/nodemailer?token=raw-token&amp;email=admin%40example.test\">Sign in</a>",
    }, "http://127.0.0.1:3100");

    expect(callback.callbackUrl).toContain("/api/auth/callback/nodemailer?");
    expect(JSON.stringify(callback.evidence)).not.toContain("raw-token");
    expect(() => extractMagicLink({
      ID: "message-2",
      Created: "2026-08-16T15:30:45.123Z",
      Text: "Sign in ( https://attacker.example/callback?token=raw-token )",
      HTML: "",
    }, "http://127.0.0.1:3100")).toThrow("valid Auth.js callback");
  });

  it("IAM-E2E-FRESH-001 writes and verifies an ordered checksum inventory", async () => {
    const root = await mkdtemp(join(tmpdir(), "kokoro-pair-checksums-"));
    try {
      await writeFile(join(root, "b.txt"), "b\n");
      await writeFile(join(root, "a.txt"), "a\n");
      const checksumPath = await writeChecksums(root);
      const lines = (await readFile(checksumPath, "utf8")).trim().split("\n");
      expect(lines).toHaveLength(2);
      expect(lines[0]).toMatch(/  a\.txt$/u);
      expect(lines[1]).toMatch(/  b\.txt$/u);
      expect(await verifyChecksums(root)).toEqual({ status: "PASS", checked: 2, mismatches: [] });
      await writeFile(join(root, "a.txt"), "changed\n");
      expect(await verifyChecksums(root)).toEqual({ status: "FAIL", checked: 2, mismatches: ["a.txt"] });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
