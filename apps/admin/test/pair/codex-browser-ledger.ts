import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

const timestampSchema = z.object({
  utc: z.string().datetime({ offset: true }),
  local: z.string().min(1),
}).strict();

const entrySchema = z.object({
  category: z.string().min(1),
  caseId: z.string().regex(/^(?:IAM-(?:SEC|E2E))-[A-Z0-9]+-[0-9]{3}$/u),
  step: z.string().min(1),
  status: z.enum(["PASS", "FAIL", "BLOCKED"]),
  started: timestampSchema,
  finished: timestampSchema,
  expected: z.string().min(1),
  actual: z.string().min(1),
  url: z.string().url(),
  screenshot: z.string().min(1),
  metrics: z.unknown().optional(),
}).strict();

const ledgerSchema = z.object({
  schemaVersion: z.literal(1),
  browser: z.literal("Codex In-App Browser"),
  overall: z.enum(["PASS", "FAIL", "BLOCKED"]),
  accepted: z.boolean(),
  entries: z.array(entrySchema).min(1),
}).strict();

const completionSchema = z.object({
  schemaVersion: z.literal(1),
  decision: z.enum(["PASS", "FAIL", "BLOCKED"]),
  ledger: z.string().min(1),
  completedAt: timestampSchema,
}).strict();

export type CodexBrowserCompletion = Readonly<{
  decision: "PASS";
  caseIds: readonly string[];
  stepCount: number;
  ledgerPath: string;
}>;

function containedPath(root: string, relative: string): string {
  if (path.isAbsolute(relative)) throw new Error("Codex browser evidence path must be relative");
  const normalizedRoot = path.resolve(root);
  const pathname = path.resolve(normalizedRoot, relative);
  if (!pathname.startsWith(`${normalizedRoot}${path.sep}`)) {
    throw new Error("Codex browser evidence path escapes its round");
  }
  return pathname;
}

function assertSafeEvidenceUrl(value: string): void {
  const url = new URL(value);
  for (const key of url.searchParams.keys()) {
    if (/token|secret|password|credential/iu.test(key)) {
      throw new Error("Codex browser ledger contains a credential URL");
    }
  }
}

export async function loadCodexBrowserCompletion(
  doneFile: string,
  evidenceRoot: string,
  expectedIds: readonly string[],
): Promise<CodexBrowserCompletion> {
  const completion = completionSchema.parse(JSON.parse(await readFile(doneFile, "utf8")) as unknown);
  if (completion.decision !== "PASS") {
    throw new Error(`Codex browser acceptance reported ${completion.decision}`);
  }

  const ledgerPath = containedPath(evidenceRoot, completion.ledger);
  const ledger = ledgerSchema.parse(JSON.parse(await readFile(ledgerPath, "utf8")) as unknown);
  if (ledger.overall !== "PASS" || !ledger.accepted || ledger.entries.some((entry) => entry.status !== "PASS")) {
    throw new Error("Codex browser ledger is not accepted");
  }

  const caseIds = [...new Set(ledger.entries.map((entry) => entry.caseId))].sort();
  const exactExpectedIds = [...expectedIds].sort();
  if (JSON.stringify(caseIds) !== JSON.stringify(exactExpectedIds)) {
    throw new Error("Codex browser case inventory mismatch");
  }

  const screenshotPaths = new Set<string>();
  for (const entry of ledger.entries) {
    const started = Date.parse(entry.started.utc);
    const finished = Date.parse(entry.finished.utc);
    if (!Number.isFinite(started) || !Number.isFinite(finished) || finished < started) {
      throw new Error("Codex browser step timestamp is invalid");
    }
    assertSafeEvidenceUrl(entry.url);
    const screenshotPath = containedPath(evidenceRoot, entry.screenshot);
    if (screenshotPaths.has(screenshotPath)) throw new Error("Codex browser screenshot is reused");
    screenshotPaths.add(screenshotPath);
    const screenshot = await stat(screenshotPath);
    if (!screenshot.isFile() || screenshot.size === 0) throw new Error("Codex browser screenshot is missing");
  }

  return Object.freeze({
    decision: "PASS",
    caseIds: Object.freeze(caseIds),
    stepCount: ledger.entries.length,
    ledgerPath,
  });
}
