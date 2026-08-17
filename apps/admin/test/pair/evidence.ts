import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { filesBelow, sha256File, timestamp, type EvidenceTimestamp } from "../../scripts/test/evidence";

export { timestamp };

const caseIdPattern = /^(?:IAM-(?:SEC|E2E))-[A-Z0-9]+-[0-9]{3}$/u;
const digestPattern = /^[a-f0-9]{64}$/u;

export type ArtifactReference = Readonly<{ path: string; sha256: string }>;
export type StepArtifacts = Readonly<{
  screenshot: ArtifactReference | null;
  trace: ArtifactReference | null;
  video: ArtifactReference | null;
  har: ArtifactReference | null;
  rpc: ArtifactReference | null;
  sql: ArtifactReference | null;
  logs: ArtifactReference | null;
}>;

export type StepEvidence = Readonly<{
  caseId: string;
  stepId: string;
  expected: string;
  actual: string;
  status: "PASS" | "FAIL";
  started: EvidenceTimestamp;
  finished: EvidenceTimestamp;
  durationMs: number;
  viewport: Readonly<{ width: number; height: number }>;
  artifacts: StepArtifacts;
  requestId: string | null;
  commandId: string | null;
}>;

export function artifactName(caseId: string, stepId: string, extension: string): string {
  if (!caseIdPattern.test(caseId) || !/^[a-z0-9]+$/u.test(extension)) throw new Error("invalid artifact name");
  const normalizedStep = stepId.trim().toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "");
  if (normalizedStep.length === 0) throw new Error("invalid artifact name");
  return `${caseId}--${normalizedStep}.${extension}`;
}

export function completeStep(input: Readonly<{
  caseId: string;
  stepId: string;
  expected: string;
  actual: string;
  started: EvidenceTimestamp;
  finished: EvidenceTimestamp;
  viewport: Readonly<{ width: number; height: number }>;
  artifacts: StepArtifacts;
  requestId: string | null;
  commandId: string | null;
}>): StepEvidence {
  if (!caseIdPattern.test(input.caseId) || input.stepId.trim().length === 0) throw new Error("invalid step identity");
  if (input.finished.epochMs < input.started.epochMs) throw new Error("invalid step duration");
  for (const [name, artifact] of Object.entries(input.artifacts)) {
    if (artifact === null) throw new Error(`missing step artifact: ${name}`);
    if (artifact.path.length === 0 || !digestPattern.test(artifact.sha256)) {
      throw new Error(`invalid step artifact: ${name}`);
    }
  }
  return Object.freeze({
    ...input,
    status: input.expected === input.actual ? "PASS" : "FAIL",
    durationMs: input.finished.epochMs - input.started.epochMs,
  });
}

export function safeMailEvidence(messageId: string, receivedAt: string, callbackUrl: string): Readonly<{
  messageId: string;
  receivedAt: string;
  callbackSha256: string;
}> {
  if (messageId.trim().length === 0 || !Number.isFinite(Date.parse(receivedAt))) throw new Error("invalid mail evidence");
  return Object.freeze({
    messageId,
    receivedAt,
    callbackSha256: createHash("sha256").update(callbackUrl).digest("hex"),
  });
}

export async function scanSecrets(root: string, secrets: readonly string[]): Promise<Readonly<{
  status: "PASS" | "FAIL";
  scannedFiles: number;
  matches: readonly string[];
}>> {
  const files = await filesBelow(root);
  const matches: string[] = [];
  for (const file of files) {
    const content = await readFile(file);
    if (secrets.some((secret) => secret.length > 0 && content.includes(secret))) {
      matches.push(path.relative(root, file).split(path.sep).join("/"));
    }
  }
  return Object.freeze({
    status: matches.length === 0 ? "PASS" : "FAIL",
    scannedFiles: files.length,
    matches: Object.freeze(matches.sort()),
  });
}

export async function writeChecksums(root: string): Promise<string> {
  const checksumPath = path.join(root, "sha256sums.txt");
  const files = (await filesBelow(root)).filter((file) => path.resolve(file) !== path.resolve(checksumPath));
  const entries = await Promise.all(files.map(async (file) => ({
    file: path.relative(root, file).split(path.sep).join("/"),
    hash: await sha256File(file),
  })));
  entries.sort((left, right) => left.file.localeCompare(right.file));
  await writeFile(
    checksumPath,
    `${entries.map((entry) => `${entry.hash}  ${entry.file}`).join("\n")}\n`,
    { encoding: "utf8", flag: "wx", mode: 0o600 },
  );
  return checksumPath;
}

export async function verifyChecksums(root: string): Promise<Readonly<{
  status: "PASS" | "FAIL";
  checked: number;
  mismatches: readonly string[];
}>> {
  const source = await readFile(path.join(root, "sha256sums.txt"), "utf8");
  const mismatches: string[] = [];
  let checked = 0;
  for (const line of source.trim().split("\n")) {
    if (line.length === 0) continue;
    const match = /^([a-f0-9]{64})  ([^\n]+)$/u.exec(line);
    if (match === null) throw new Error("invalid checksum inventory");
    const expected = match[1] ?? "";
    const relative = match[2] ?? "";
    const pathname = path.resolve(root, relative);
    const prefix = `${path.resolve(root)}${path.sep}`;
    if (!pathname.startsWith(prefix)) throw new Error("invalid checksum path");
    checked += 1;
    try {
      if (await sha256File(pathname) !== expected) mismatches.push(relative);
    } catch {
      mismatches.push(relative);
    }
  }
  return Object.freeze({
    status: mismatches.length === 0 ? "PASS" : "FAIL",
    checked,
    mismatches: Object.freeze(mismatches.sort()),
  });
}
