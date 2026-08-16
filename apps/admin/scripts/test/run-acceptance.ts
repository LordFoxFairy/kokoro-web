import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { hostname, platform, release, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { loadP0Catalog, type P0Catalog } from "./catalog";
import {
  ensureDirectory,
  filesBelow,
  runCommand,
  sha256File,
  timestamp,
  writeJson,
  type CommandEvidence,
} from "./evidence";

type AdminCategory = "unit" | "component" | "contract" | "integration" | "security";
type ResultStatus = "PASS" | "FAIL" | "NOT_STARTED";

export type CategoryTestEvidence = Readonly<{
  caseStatuses: ReadonlyMap<string, ReadonlyMap<string, boolean>>;
  skipped: number;
  todos: number;
  unclassified: number;
}>;

type CaseResult = Readonly<{
  id: string;
  category: string;
  title: string;
  status: ResultStatus;
  started: CommandEvidence["started"] | null;
  finished: CommandEvidence["finished"] | null;
  durationMs: number | null;
  attempts: 0 | 1;
  testFile: string | null;
  evidence: readonly string[];
  requirements: readonly string[];
  acceptance: readonly string[];
}>;

const categoryInputs: readonly Readonly<{ name: AdminCategory; path: string }>[] = [
  { name: "unit", path: "test/unit" },
  { name: "component", path: "test/component" },
  { name: "contract", path: "test/contract" },
  { name: "integration", path: "test/integration" },
  { name: "security", path: "test/security" },
];

const providerSchema = z.object({
  repository: z.literal("kokoro-iam"),
  commit: z.string().regex(/^[a-f0-9]{40}$/u),
  tree: z.string().regex(/^[a-f0-9]{40}$/u),
  protoSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  migrationSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  catalogSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  acceptedRunId: z.string().min(1),
  files: z.array(z.object({ path: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/u) }).strict()),
}).strict();

const vitestJsonSchema = z.object({
  numPendingTests: z.number().int().nonnegative(),
  numTodoTests: z.number().int().nonnegative(),
  testResults: z.array(z.object({
    name: z.string(),
    status: z.string(),
    assertionResults: z.array(z.object({
      title: z.string(),
      status: z.string(),
    }).passthrough()).default([]),
  }).passthrough()),
}).passthrough();

const caseIdPattern = /^(?:WEB-(?:UNIT|COMP|CONTRACT|INT|SEC)|IAM-(?:SEC|E2E))-[A-Z0-9]+-[0-9]{3}(?=\s|$)/u;

function output(command: string, args: readonly string[], cwd: string): string {
  return execFileSync(command, [...args], { cwd, encoding: "utf8" }).trim();
}

function runId(commit: string): string {
  const index = process.argv.indexOf("--run-id");
  const explicit = index < 0 ? undefined : process.argv[index + 1];
  if (explicit !== undefined) {
    if (!/^[a-z0-9][a-z0-9._-]{0,119}$/u.test(explicit)) throw new Error("--run-id is invalid");
    return explicit;
  }
  return `admin-${new Date().toISOString().replace(/[-:.]/gu, "").replace("Z", "Z-")}${commit.slice(0, 12)}`;
}

function markdown(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

function seconds(value: number | null): string {
  return value === null ? "-" : `${(value / 1_000).toFixed(3)}s`;
}

async function secret(directory: string, name: string): Promise<Readonly<{ path: string; value: string }>> {
  const value = randomBytes(32).toString("hex");
  const pathname = path.join(directory, name);
  await writeFile(pathname, `${value}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  await chmod(pathname, 0o600);
  return Object.freeze({ path: pathname, value });
}

export async function categoryFileStatuses(
  appRoot: string,
  jsonPath: string,
): Promise<CategoryTestEvidence> {
  const report = vitestJsonSchema.parse(JSON.parse(await readFile(jsonPath, "utf8")) as unknown);
  const caseStatuses = new Map<string, Map<string, boolean>>();
  let unclassified = 0;
  for (const result of report.testResults) {
    const relative = path.relative(appRoot, result.name).split(path.sep).join("/");
    const fileStatuses = caseStatuses.get(relative) ?? new Map<string, boolean>();
    caseStatuses.set(relative, fileStatuses);
    for (const assertion of result.assertionResults) {
      const id = assertion.title.match(caseIdPattern)?.[0];
      if (id === undefined) {
        unclassified += 1;
        continue;
      }
      const passed = result.status === "passed" && assertion.status === "passed";
      fileStatuses.set(id, (fileStatuses.get(id) ?? true) && passed);
    }
  }
  return Object.freeze({
    caseStatuses,
    skipped: report.numPendingTests,
    todos: report.numTodoTests,
    unclassified,
  });
}

function caseEvidence(category: AdminCategory, testCase: P0Catalog["cases"][number]): string[] {
  const evidence = [
    `junit/${category}.xml`,
    `json/${category}.json`,
    `coverage/${category}/coverage-summary.json`,
    `commands/test_${category}.stdout.log`,
  ];
  if (testCase.evidence.includes("http")) evidence.push("http/smoke.json");
  if (testCase.evidence.includes("rpc")) evidence.push("rpc/smoke.json");
  if (testCase.evidence.includes("logs")) evidence.push("logs/admin.stdout.log", "logs/admin.stderr.log");
  if (testCase.evidence.includes("build-manifest") || testCase.evidence.includes("bundle-scan")) {
    evidence.push("build/boundary.json");
  }
  return [...new Set(evidence)];
}

async function secretScan(
  evidenceRoot: string,
  forbidden: readonly string[],
): Promise<Readonly<{ status: "PASS" | "FAIL"; scannedFiles: number; matches: readonly string[] }>> {
  const readable = /\.(?:json|log|md|txt|xml)$/u;
  const files = (await filesBelow(evidenceRoot)).filter((file) => readable.test(file));
  const matches: string[] = [];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    if (forbidden.some((value) => value.length > 0 && source.includes(value))) {
      matches.push(path.relative(evidenceRoot, file));
    }
  }
  return Object.freeze({
    status: matches.length === 0 ? "PASS" : "FAIL",
    scannedFiles: files.length,
    matches: Object.freeze(matches.sort()),
  });
}

async function main(): Promise<void> {
  const appRoot = process.cwd();
  const repositoryRoot = path.resolve(appRoot, "../..");
  const catalog = await loadP0Catalog(path.join(appRoot, "test/catalog/p0.yaml"));
  const started = timestamp();
  const commit = output("git", ["rev-parse", "HEAD"], repositoryRoot);
  const id = runId(commit);
  const resultsRoot = path.join(appRoot, "test-results");
  await ensureDirectory(resultsRoot);
  const evidenceRoot = path.join(resultsRoot, id);
  await mkdir(evidenceRoot, { recursive: false, mode: 0o700 });
  for (const directory of ["commands", "coverage", "json", "junit", "security"]) {
    await ensureDirectory(path.join(evidenceRoot, directory));
  }

  const provider = providerSchema.parse(
    JSON.parse(await readFile(path.join(appRoot, "contracts/iam/provider.json"), "utf8")) as unknown,
  );
  const branch = output("git", ["branch", "--show-current"], repositoryRoot);
  const tree = output("git", ["rev-parse", "HEAD^{tree}"], repositoryRoot);
  const dirtyBeforeSource = output("git", ["status", "--porcelain"], repositoryRoot);
  const candidate = {
    repository: "kokoro-web",
    branch,
    commit,
    tree,
    dirtyBefore: dirtyBeforeSource !== "",
    catalogSha256: await sha256File(path.join(appRoot, "test/catalog/p0.yaml")),
  };
  const environment = {
    host: hostname(),
    os: `${platform()} ${release()}`,
    node: process.version,
    pnpm: output("pnpm", ["--version"], repositoryRoot),
    timezoneOffset: started.timezoneOffset,
    chromium: "Pair acceptance-owned; not executed in repository acceptance",
  };

  const secretDirectory = await mkdtemp(path.join(await realpath(tmpdir()), "kokoro-admin-acceptance-"));
  const authSecret = await secret(secretDirectory, "auth-secret");
  const workloadToken = await secret(secretDirectory, "workload-token");
  const buildEnvironment: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "production",
    AUTH_URL: "https://admin.example.test",
    AUTH_SECRET_FILE: authSecret.path,
    AUTH_SECURE_COOKIES: "true",
    KOKORO_IAM_BASE_URL: "https://iam.example.test",
    KOKORO_IAM_ADMIN_WEB_TOKEN_FILE: workloadToken.path,
    MAGIC_LINK_MAX_AGE: "600",
    EMAIL_FROM: "no-reply@example.test",
    EMAIL_SERVER_HOST: "smtp.example.test",
    EMAIL_SERVER_PORT: "587",
    FORCE_COLOR: "0",
  };

  const commands: CommandEvidence[] = [];
  const execute = async (
    name: string,
    command: string,
    args: readonly string[],
    cwd = appRoot,
    environment: NodeJS.ProcessEnv = { ...process.env, FORCE_COLOR: "0" },
  ): Promise<CommandEvidence> => {
    const result = await runCommand({ name, command, args, cwd, evidenceRoot, environment });
    commands.push(result);
    return result;
  };

  const categoryCommands = new Map<AdminCategory, CommandEvidence>();
  const categoryFiles = new Map<AdminCategory, CategoryTestEvidence>();
  try {
    await execute("install", "pnpm", ["install", "--frozen-lockfile"], repositoryRoot);
    await execute("proto_check", "pnpm", ["proto:check"]);
    for (const category of categoryInputs) {
      const junit = path.join(evidenceRoot, "junit", `${category.name}.xml`);
      const json = path.join(evidenceRoot, "json", `${category.name}.json`);
      const coverage = path.join(evidenceRoot, "coverage", category.name);
      await ensureDirectory(coverage);
      const result = await execute(`test_${category.name}`, "pnpm", [
        "exec",
        "vitest",
        "run",
        category.path,
        "--reporter=default",
        "--reporter=junit",
        "--reporter=json",
        `--outputFile.junit=${junit}`,
        `--outputFile.json=${json}`,
        "--coverage",
        "--coverage.provider=v8",
        `--coverage.reportsDirectory=${coverage}`,
        "--coverage.reporter=json-summary",
        "--coverage.reporter=text",
      ]);
      categoryCommands.set(category.name, result);
      if (result.exitCode === 0) categoryFiles.set(category.name, await categoryFileStatuses(appRoot, json));
    }
    await execute("typecheck", "pnpm", ["typecheck"]);
    await execute("lint", "pnpm", ["lint", "--max-warnings=0"]);
    await execute("build", "pnpm", ["build"], appRoot, buildEnvironment);
    await execute("runtime_smoke", "pnpm", [
      "exec",
      "tsx",
      "scripts/test/smoke-runtime.ts",
      "--output-root",
      evidenceRoot,
    ]);
  } finally {
    await rm(secretDirectory, { recursive: true, force: true });
  }

  const dirtyAfterSource = output("git", ["status", "--porcelain"], repositoryRoot);
  const finished = timestamp();
  const scan = await secretScan(evidenceRoot, [authSecret.value, workloadToken.value]);
  await writeJson(path.join(evidenceRoot, "security", "secret-scan.json"), scan);

  const cases: CaseResult[] = catalog.cases.map((testCase) => {
    if (testCase.category === "pair_e2e") {
      return Object.freeze({
        id: testCase.id,
        category: testCase.category,
        title: testCase.title,
        status: "NOT_STARTED" as const,
        started: null,
        finished: null,
        durationMs: null,
        attempts: 0 as const,
        testFile: null,
        evidence: Object.freeze([]),
        requirements: testCase.requirements,
        acceptance: testCase.acceptance,
      });
    }
    const category = testCase.category as AdminCategory;
    const command = categoryCommands.get(category);
    const fileStatus = testCase.testFile === null
      ? false
      : categoryFiles.get(category)?.caseStatuses.get(testCase.testFile)?.get(testCase.id) === true;
    const status: ResultStatus = command?.exitCode === 0 && fileStatus ? "PASS" : "FAIL";
    return Object.freeze({
      id: testCase.id,
      category,
      title: testCase.title,
      status,
      started: command?.started ?? null,
      finished: command?.finished ?? null,
      durationMs: command?.durationMs ?? null,
      attempts: 1 as const,
      testFile: testCase.testFile,
      evidence: Object.freeze(caseEvidence(category, testCase)),
      requirements: testCase.requirements,
      acceptance: testCase.acceptance,
    });
  });

  const categoryRows = [...categoryInputs.map(({ name }) => {
    const categoryCases = cases.filter((testCase) => testCase.category === name);
    const command = categoryCommands.get(name);
    return {
      category: name,
      status: categoryCases.every((testCase) => testCase.status === "PASS") ? "PASS" : "FAIL",
      total: categoryCases.length,
      passed: categoryCases.filter((testCase) => testCase.status === "PASS").length,
      failed: categoryCases.filter((testCase) => testCase.status === "FAIL").length,
      pending: 0,
      started: command?.started ?? null,
      finished: command?.finished ?? null,
      durationMs: command?.durationMs ?? null,
    };
  }), {
    category: "pair_e2e",
    status: "NOT_STARTED",
    total: cases.filter((testCase) => testCase.category === "pair_e2e").length,
    passed: 0,
    failed: 0,
    pending: cases.filter((testCase) => testCase.category === "pair_e2e").length,
    started: null,
    finished: null,
    durationMs: null,
  }];

  const skipped = [...categoryFiles.values()].reduce((total, result) => total + result.skipped, 0);
  const todos = [...categoryFiles.values()].reduce((total, result) => total + result.todos, 0);
  const unclassified = [...categoryFiles.values()].reduce((total, result) => total + result.unclassified, 0);
  const gatePass = commands.every((command) => command.exitCode === 0);
  const adminCasesPass = cases.filter((testCase) => testCase.category !== "pair_e2e")
    .every((testCase) => testCase.status === "PASS" && testCase.attempts === 1);
  const repositoryDecision = gatePass
    && adminCasesPass
    && skipped === 0
    && todos === 0
    && unclassified === 0
    && scan.status === "PASS"
    && !candidate.dirtyBefore
    && dirtyAfterSource === ""
    ? "PASS"
    : "FAIL";
  const pairDecision = repositoryDecision === "PASS" ? "NOT_READY" : "FAIL";
  const failureLines = [
    ...commands.filter((command) => command.exitCode !== 0)
      .map((command) => `- Gate ${command.name}: exit ${String(command.exitCode)}; see \`${command.stderrPath}\`.`),
    ...cases.filter((testCase) => testCase.category !== "pair_e2e" && testCase.status !== "PASS")
      .map((testCase) => `- Case ${testCase.id}: ${testCase.status}; test \`${testCase.testFile ?? "missing"}\`.`),
    ...(skipped === 0 ? [] : [`- Skipped assertions: ${String(skipped)}.`]),
    ...(todos === 0 ? [] : [`- Todo assertions: ${String(todos)}.`]),
    ...(unclassified === 0 ? [] : [`- Unclassified assertions: ${String(unclassified)}.`]),
    ...(scan.status === "PASS" ? [] : [`- Secret scan: ${String(scan.matches.length)} retained artifact matches.`]),
    ...(!candidate.dirtyBefore ? [] : ["- Candidate working tree was dirty before acceptance."]),
    ...(dirtyAfterSource === "" ? [] : ["- Candidate working tree was dirty after acceptance."]),
  ];

  const report = [
    "---",
    "report_type: kokoro-admin-web-repository-acceptance",
    `run_id: ${id}`,
    `admin_web_repository_decision: ${repositoryDecision}`,
    `product_pair_decision: ${pairDecision}`,
    `started_at_utc: ${started.utc}`,
    `finished_at_utc: ${finished.utc}`,
    `started_at_local: ${started.local}`,
    `finished_at_local: ${finished.local}`,
    `timezone_offset: ${started.timezoneOffset}`,
    "---",
    "",
    "# Kokoro Admin Web Repository Acceptance Report",
    "",
    "## Overall Mark",
    "",
    "| Scope | Decision | Meaning |",
    "|---|---|---|",
    `| Admin Web repository | **${repositoryDecision}** | All repository-owned classified gates and runtime evidence. |`,
    `| Product pair | **${pairDecision}** | Two fresh visible Chromium rounds remain pair-owned. |`,
    "",
    "## Time And Candidate",
    "",
    "| Field | Value |",
    "|---|---|",
    `| Started local / UTC | \`${started.local}\` / \`${started.utc}\` |`,
    `| Finished local / UTC | \`${finished.local}\` / \`${finished.utc}\` |`,
    `| Timezone offset | \`${started.timezoneOffset}\` |`,
    `| Duration | \`${seconds(finished.epochMs - started.epochMs)}\` |`,
    `| Branch | \`${markdown(branch)}\` |`,
    `| Commit / tree | \`${commit}\` / \`${tree}\` |`,
    `| Dirty before / after | \`${String(candidate.dirtyBefore)}\` / \`${String(dirtyAfterSource !== "")}\` |`,
    `| Web catalog SHA-256 | \`${candidate.catalogSha256}\` |`,
    "",
    "## Frozen IAM Provider",
    "",
    "| Commit / tree | Proto | Migration | Catalog | Accepted run |",
    "|---|---|---|---|---|",
    `| \`${provider.commit}\` / \`${provider.tree}\` | \`${provider.protoSha256}\` | \`${provider.migrationSha256}\` | \`${provider.catalogSha256}\` | \`${provider.acceptedRunId}\` |`,
    "",
    "## Runtime Inventory",
    "",
    "| Field | Value |",
    "|---|---|",
    ...Object.entries(environment).map(([key, value]) => `| ${markdown(key)} | \`${markdown(value)}\` |`),
    "",
    "## Gate Ledger",
    "",
    "| Gate | Result | Start local / UTC | Finish local / UTC | Duration | Exit | Evidence |",
    "|---|---|---|---|---:|---:|---|",
    ...commands.map((command) => `| ${command.name} | ${command.exitCode === 0 ? "PASS" : "FAIL"} | ${command.started.local} / ${command.started.utc} | ${command.finished.local} / ${command.finished.utc} | ${seconds(command.durationMs)} | ${String(command.exitCode)} | \`${command.stdoutPath}\`, \`${command.stderrPath}\` |`),
    "",
    "## Category Summary",
    "",
    "| Category | Result | Total | Passed | Failed | Pending | Start local / UTC | Finish local / UTC |",
    "|---|---|---:|---:|---:|---:|---|---|",
    ...categoryRows.map((row) => `| ${row.category} | ${row.status} | ${String(row.total)} | ${String(row.passed)} | ${String(row.failed)} | ${String(row.pending)} | ${row.started === null ? "-" : `${row.started.local} / ${row.started.utc}`} | ${row.finished === null ? "-" : `${row.finished.local} / ${row.finished.utc}`} |`),
    "",
    "## Case Ledger",
    "",
    "| Case | Category | Result | Test file | Start local / UTC | Finish local / UTC | Attempts | Evidence |",
    "|---|---|---|---|---|---|---:|---|",
    ...cases.map((testCase) => `| ${testCase.id} | ${testCase.category} | ${testCase.status} | ${testCase.testFile ?? "Pair-owned"} | ${testCase.started === null ? "-" : `${testCase.started.local} / ${testCase.started.utc}`} | ${testCase.finished === null ? "-" : `${testCase.finished.local} / ${testCase.finished.utc}`} | ${String(testCase.attempts)} | ${testCase.evidence.map((file) => `\`${file}\``).join(", ") || "Pending pair evidence"} |`),
    "",
    "## Runtime And Browser Evidence",
    "",
    "Repository runtime evidence: `http/smoke.json`, `rpc/smoke.json`, `build/boundary.json`, `process/smoke.json`, and Admin logs.",
    "Screenshots, trace, video, HAR, per-step timestamps, browser RPC/SQL/log correlation, and two fresh visible Chromium rounds remain `NOT_STARTED` until pair acceptance.",
    "",
    "## Integrity",
    "",
    `- Secret scan: \`${scan.status}\` across \`${String(scan.scannedFiles)}\` retained text artifacts; matches: \`${String(scan.matches.length)}\`.`,
    "- Retry count: `0`.",
    `- Skip/todo/unclassified count: \`${String(skipped)} / ${String(todos)} / ${String(unclassified)}\`.`,
    "- Ordered SHA-256 values: `sha256sums.txt`.",
    "",
    "## Failure Ledger",
    "",
    ...(failureLines.length === 0
      ? ["No Admin Web repository-owned gate or P0 case failed."]
      : failureLines),
    "",
    "## Decision",
    "",
    `- \`ADMIN_WEB_REPOSITORY_DECISION=${repositoryDecision}\``,
    `- \`PRODUCT_PAIR_DECISION=${pairDecision}\``,
    `- Decision local / UTC: \`${finished.local}\` / \`${finished.utc}\``,
    "",
  ].join("\n");
  const reportPath = path.join(evidenceRoot, "report.md");
  await writeFile(reportPath, report, { encoding: "utf8", flag: "wx", mode: 0o600 });

  const rawEvidenceFiles = (await filesBelow(evidenceRoot))
    .filter((file) => !file.endsWith("manifest.json") && !file.endsWith("sha256sums.txt"));
  const evidenceSha256: Record<string, string> = {};
  for (const file of rawEvidenceFiles) evidenceSha256[path.relative(evidenceRoot, file)] = await sha256File(file);
  const manifestPath = path.join(evidenceRoot, "manifest.json");
  await writeJson(manifestPath, {
    schemaVersion: 1,
    reportType: "kokoro-admin-web-repository-acceptance",
    runId: id,
    started,
    finished,
    candidate: { ...candidate, dirtyAfter: dirtyAfterSource !== "" },
    provider,
    environment,
    decisions: { adminWebRepository: repositoryDecision, productPair: pairDecision },
    rules: { retries: 0, skips: skipped, todos, unclassified, chromiumRoundsRequired: 2 },
    commands,
    categories: categoryRows,
    cases,
    secretScan: scan,
    evidenceSha256,
  });
  const checksumFiles = (await filesBelow(evidenceRoot)).filter((file) => !file.endsWith("sha256sums.txt"));
  const checksums = (await Promise.all(checksumFiles.map(async (file) => ({
    file: path.relative(evidenceRoot, file),
    hash: await sha256File(file),
  })))).sort((left, right) => left.file.localeCompare(right.file));
  await writeFile(
    path.join(evidenceRoot, "sha256sums.txt"),
    `${checksums.map((entry) => `${entry.hash}  ${entry.file}`).join("\n")}\n`,
    { encoding: "utf8", flag: "wx", mode: 0o600 },
  );

  process.stdout.write(`\n[acceptance] ADMIN_WEB_REPOSITORY_DECISION=${repositoryDecision}\n`);
  process.stdout.write(`[acceptance] PRODUCT_PAIR_DECISION=${pairDecision}\n`);
  process.stdout.write(`[acceptance] report=${path.relative(appRoot, reportPath)}\n`);
  process.stdout.write(`[acceptance] manifest=${path.relative(appRoot, manifestPath)}\n`);
  if (repositoryDecision !== "PASS") process.exitCode = 1;
}

const entry = process.argv[1] === undefined ? "" : path.resolve(process.argv[1]);
if (entry === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    process.stderr.write(`Admin acceptance runner failed: ${error instanceof Error ? error.stack ?? error.message : "unknown error"}\n`);
    process.exitCode = 1;
  });
}
