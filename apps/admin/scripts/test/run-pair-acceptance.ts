import { execFile, execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { access, chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { hostname, platform, release, tmpdir, userInfo } from "node:os";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { createClient, type Interceptor } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-node";
import { Client } from "pg";
import { z } from "zod";

import { IamAuthAdapterService } from "../../generated/iam/proto/kokoro/iam/v1/auth_adapter_pb";
import { loadP0Catalog } from "./catalog";
import {
  ensureDirectory,
  runCommand,
  timestamp,
  writeJson,
  type CommandEvidence,
} from "./evidence";
import {
  scanSecrets,
  verifyChecksums,
  writeChecksums,
} from "../../test/pair/evidence";
import { loadPairCaseLedger } from "../../test/pair/case-ledger";
import { startLocalMailbox, type LocalMailbox } from "../../test/pair/local-mailbox";
import {
  loadCodexBrowserCompletion,
  type CodexBrowserCompletion,
} from "../../test/pair/codex-browser-ledger";
import {
  availablePort,
  createPairResources,
  loadPairRuntimeConfig,
  startTrackedProcess,
  stopTrackedProcess,
  writeRoundSecrets,
  type PairResources,
  type RoundSecrets,
  type StoppedProcess,
  type TrackedProcess,
} from "../../test/pair/fixture";

const execFileAsync = promisify(execFile);
const acceptedProviderCommit = "fc88313bba9201b88af6d4fc623fcf42a7e8b0eb";

const providerSchema = z.object({
  repository: z.literal("kokoro-iam"),
  commit: z.literal(acceptedProviderCommit),
  tree: z.string().regex(/^[a-f0-9]{40}$/u),
  protoSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  migrationSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  catalogSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  acceptedRunId: z.string().min(1),
  files: z.array(z.object({ path: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/u) }).strict()),
}).strict();

const repositoryManifestSchema = z.object({
  reportType: z.literal("kokoro-admin-web-repository-acceptance"),
  runId: z.string().min(1),
  candidate: z.object({ commit: z.string().regex(/^[a-f0-9]{40}$/u) }).passthrough(),
  decisions: z.object({ adminWebRepository: z.literal("PASS") }).passthrough(),
}).passthrough();

const playwrightReportSchema = z.object({
  suites: z.array(z.object({
    specs: z.array(z.object({
      title: z.string(),
      tests: z.array(z.object({
        expectedStatus: z.string(),
        results: z.array(z.object({
          status: z.string(),
          retry: z.number().int().nonnegative(),
        }).passthrough()),
      }).passthrough()),
    }).passthrough()),
  }).passthrough()),
  stats: z.object({
    expected: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    unexpected: z.number().int().nonnegative(),
    flaky: z.number().int().nonnegative(),
  }).passthrough(),
}).passthrough();

type SeedIdentity = Readonly<{ id: string; email: string; name: string }>;
type RoundSeed = Readonly<{
  administrator: SeedIdentity;
  suspended: SeedIdentity;
  deleted: SeedIdentity;
  memberTarget: SeedIdentity;
  rbacTarget: SeedIdentity;
  deleteTarget: SeedIdentity;
  targetSessionToken: string;
}>; 

type DatabaseFixture = Readonly<{
  name: string;
  role: string;
  runtimePassword: string;
  ownerDatabaseUrl: string;
  runtimeDatabaseUrl: string;
}>;

type RoundOutcome = Readonly<{
  round: 1 | 2;
  roundId: string;
  evidenceRoot: string;
  decision: "PASS" | "FAIL";
  manifestPath: string;
  reportPath: string;
  checksum: Awaited<ReturnType<typeof verifyChecksums>>;
  caseIds: readonly string[];
}>;

function output(command: string, args: readonly string[], cwd: string): string {
  return execFileSync(command, [...args], { cwd, encoding: "utf8" }).trim();
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function grepMatches(value: string, grep: string): boolean {
  try {
    return new RegExp(grep, "u").test(value);
  } catch {
    return value.includes(grep);
  }
}

function runIdentity(commit: string, smoke: boolean, serveForCodexBrowser: boolean): string {
  const explicit = argument("--run-id");
  if (explicit !== undefined) {
    if (!/^[a-z0-9][a-z0-9._-]{0,119}$/u.test(explicit)) throw new Error("--run-id is invalid");
    return explicit;
  }
  const prefix = serveForCodexBrowser ? "codex-browser" : smoke ? "pair-smoke" : "pair";
  return `${prefix}-${new Date().toISOString().replace(/[-:.]/gu, "").replace("Z", "Z-")}${commit.slice(0, 12)}`;
}

function quoteIdentifier(value: string): string {
  if (!/^[a-z][a-z0-9_]{0,62}$/u.test(value)) throw new Error("invalid PostgreSQL identifier");
  return `"${value}"`;
}

function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function withDatabase(connectionString: string, database: string): string {
  const url = new URL(connectionString);
  if (url.hostname.length === 0) url.hostname = "127.0.0.1";
  if (url.username.length === 0) url.username = userInfo().username;
  url.pathname = `/${database}`;
  url.search = "";
  url.searchParams.set("schema", "public");
  url.hash = "";
  return url.toString();
}

function runtimeDatabaseUrl(connectionString: string, database: string, role: string, password: string): string {
  const url = new URL(withDatabase(connectionString, database));
  if (url.hostname.length === 0) url.hostname = "127.0.0.1";
  url.username = role;
  url.password = password;
  return url.toString();
}

function psqlDatabaseUrl(connectionString: string): string {
  const url = new URL(connectionString);
  url.search = "";
  url.hash = "";
  return url.toString();
}

async function commandOutput(command: string, args: readonly string[], cwd: string, environment: NodeJS.ProcessEnv = process.env): Promise<string> {
  const result = await execFileAsync(command, [...args], { cwd, env: environment, encoding: "utf8", maxBuffer: 10 * 1_024 * 1_024 });
  return result.stdout.trim();
}

async function waitForUrl(url: string, process: TrackedProcess, timeoutMs = 45_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (process.child.exitCode !== null || process.child.signalCode !== null) {
      throw new Error(`${process.name} exited before ${url} became ready`);
    }
    try {
      const response = await fetch(url, { redirect: "manual" });
      if (response.status >= 200 && response.status < 400) return;
    } catch {
      // The exact supervised listener is still starting.
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${process.name} readiness timeout`);
}

async function fileExists(pathname: string): Promise<boolean> {
  try {
    await access(pathname);
    return true;
  } catch {
    return false;
  }
}

async function requiredCommand(input: Readonly<{
  name: string;
  command: string;
  args: readonly string[];
  cwd: string;
  evidenceRoot: string;
  environment?: NodeJS.ProcessEnv;
}>): Promise<CommandEvidence> {
  const result = await runCommand(input);
  if (result.exitCode !== 0) throw new Error(`${input.name} failed with exit ${String(result.exitCode)}`);
  return result;
}

async function acceptedAdminCandidate(repositoryRoot: string, appRoot: string): Promise<Readonly<{
  runId: string;
  commit: string;
  manifestPath: string;
}>> {
  const root = path.join(appRoot, "reports", "accepted");
  const entries = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse();
  for (const entry of entries) {
    const manifestPath = path.join(root, entry, "manifest.json");
    try {
      const manifest = repositoryManifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")) as unknown);
      const changed = output("git", ["diff", "--name-only", `${manifest.candidate.commit}..HEAD`], repositoryRoot)
        .split("\n")
        .filter(Boolean);
      if (changed.every((file) => file.startsWith("apps/admin/reports/accepted/"))) {
        return Object.freeze({ runId: manifest.runId, commit: manifest.candidate.commit, manifestPath });
      }
    } catch {
      // Continue until an exact accepted repository candidate is found.
    }
  }
  throw new Error("no accepted Admin Web repository candidate matches the current source tree");
}

async function createDatabaseFixture(ownerUrl: string, resources: PairResources): Promise<DatabaseFixture> {
  const role = resources.databaseName.replace("kokoro_iam_pair_", "iam_pair_");
  const runtimePassword = randomBytes(32).toString("hex");
  const admin = new Client({ connectionString: ownerUrl });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${quoteIdentifier(resources.databaseName)}`);
  } finally {
    await admin.end();
  }
  return Object.freeze({
    name: resources.databaseName,
    role,
    runtimePassword,
    ownerDatabaseUrl: withDatabase(ownerUrl, resources.databaseName),
    runtimeDatabaseUrl: runtimeDatabaseUrl(ownerUrl, resources.databaseName, role, runtimePassword),
  });
}

async function grantRuntimeRole(ownerUrl: string, database: DatabaseFixture): Promise<void> {
  const cluster = new Client({ connectionString: ownerUrl });
  await cluster.connect();
  try {
    await cluster.query(
      `CREATE ROLE ${quoteIdentifier(database.role)} LOGIN PASSWORD ${quoteLiteral(database.runtimePassword)} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
    );
    await cluster.query(`GRANT CONNECT ON DATABASE ${quoteIdentifier(database.name)} TO ${quoteIdentifier(database.role)}`);
  } finally {
    await cluster.end();
  }
  const owner = new Client({ connectionString: database.ownerDatabaseUrl });
  await owner.connect();
  try {
    await owner.query(`GRANT USAGE ON SCHEMA public TO ${quoteIdentifier(database.role)}`);
    await owner.query(`GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO ${quoteIdentifier(database.role)}`);
    await owner.query(`REVOKE INSERT, UPDATE ON TABLE public."_prisma_migrations" FROM ${quoteIdentifier(database.role)}`);
  } finally {
    await owner.end();
  }
}

async function dropDatabaseFixture(ownerUrl: string, database: DatabaseFixture | undefined): Promise<Readonly<{
  databaseDropped: boolean;
  roleDropped: boolean;
}>> {
  if (database === undefined) return Object.freeze({ databaseDropped: true, roleDropped: true });
  const admin = new Client({ connectionString: ownerUrl });
  await admin.connect();
  try {
    await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()", [database.name]);
    await admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(database.name)}`);
    await admin.query(`DROP ROLE IF EXISTS ${quoteIdentifier(database.role)}`);
    const state = await admin.query(
      "SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = $1) AS database_exists, EXISTS(SELECT 1 FROM pg_roles WHERE rolname = $2) AS role_exists",
      [database.name, database.role],
    );
    const row = state.rows[0] as Readonly<{ database_exists: boolean; role_exists: boolean }> | undefined;
    return Object.freeze({ databaseDropped: row?.database_exists === false, roleDropped: row?.role_exists === false });
  } finally {
    await admin.end();
  }
}

function workloadInterceptor(token: string): Interceptor {
  return (next) => async (request) => {
    request.header.set("authorization", `Bearer ${token}`);
    request.header.set("x-kokoro-request-id", randomUUID());
    return next(request);
  };
}

async function bootstrapAdministrator(input: Readonly<{
  iamWorktree: string;
  database: DatabaseFixture;
  secrets: RoundSecrets;
  roundId: string;
  evidenceRoot: string;
}>): Promise<SeedIdentity> {
  const administrator = Object.freeze({
    id: randomUUID(),
    email: `admin-${input.roundId}@example.test`.toLowerCase(),
    name: "Pair Administrator",
  });
  const passwordHash = await commandOutput(process.execPath, [
    "--input-type=module",
    "--eval",
    "import { hash } from '@node-rs/argon2'; process.stdout.write(await hash(process.env.ADMIN_PASSWORD));",
  ], input.iamWorktree, { ...process.env, ADMIN_PASSWORD: input.secrets.administratorPassword.value });
  const wrapperPath = path.join(input.secrets.administratorPassword.path, "..");
  const bootstrapPath = path.join(wrapperPath, "bootstrap-administrator.psql");
  await writeFile(bootstrapPath, [
    "\\getenv ADMIN_USER_ID ADMIN_USER_ID",
    "\\getenv ADMIN_EMAIL ADMIN_EMAIL",
    "\\getenv ADMIN_NAME ADMIN_NAME",
    "\\getenv ADMIN_PASSWORD_HASH ADMIN_PASSWORD_HASH",
    `\\i ${path.join(input.iamWorktree, "scripts", "bootstrap", "administrator.sql")}`,
    "",
  ].join("\n"), { encoding: "utf8", flag: "wx", mode: 0o600 });
  await requiredCommand({
    name: "iam_bootstrap_administrator",
    command: "psql",
    args: [psqlDatabaseUrl(input.database.ownerDatabaseUrl), "--no-psqlrc", "--file", bootstrapPath],
    cwd: input.iamWorktree,
    evidenceRoot: input.evidenceRoot,
    environment: {
      ...process.env,
      ADMIN_USER_ID: administrator.id,
      ADMIN_EMAIL: administrator.email,
      ADMIN_NAME: administrator.name,
      ADMIN_PASSWORD_HASH: passwordHash,
    },
  });
  return administrator;
}

async function seedRound(iamBaseUrl: string, database: DatabaseFixture, secrets: RoundSecrets, roundId: string, administrator: SeedIdentity): Promise<RoundSeed> {
  const transport = createConnectTransport({
    baseUrl: iamBaseUrl,
    httpVersion: "1.1",
    interceptors: [workloadInterceptor(secrets.userWebToken.value)],
  });
  const auth = createClient(IamAuthAdapterService, transport);
  const create = async (key: string, label: string): Promise<SeedIdentity> => {
    const email = `${key}-${roundId}@example.test`.toLowerCase();
    const response = await auth.createUser({ requestId: randomUUID(), email, name: label });
    if (response.user === undefined) throw new Error(`seed User ${key} was not returned`);
    return Object.freeze({ id: response.user.id, email: response.user.email, name: response.user.name });
  };
  const [suspended, deleted, memberTarget, rbacTarget, deleteTarget] = await Promise.all([
    create("suspended", "Suspended Administrator"),
    create("deleted", "Deleted Administrator"),
    create("member", "Member Target"),
    create("rbac", "RBAC Target"),
    create("delete", "Delete Target"),
  ]);
  const owner = new Client({ connectionString: database.ownerDatabaseUrl });
  await owner.connect();
  try {
    await owner.query("UPDATE public.iam_user SET platform_role = 'admin', status = 'suspended', updated_at = now(), version = version + 1 WHERE id = $1", [suspended.id]);
    await owner.query(
      "UPDATE public.iam_user SET platform_role = 'admin', status = 'deleted', deleted_at = now(), deleted_by = $1, delete_reason = $2, updated_at = now(), version = version + 1 WHERE id = $3",
      [administrator.id, "Pair fixture deleted login identity", deleted.id],
    );
  } finally {
    await owner.end();
  }
  const targetSessionToken = `${randomUUID()}-${randomUUID()}`;
  const session = await auth.createSession({
    requestId: randomUUID(),
    session: {
      id: randomUUID(),
      sessionToken: targetSessionToken,
      userId: deleteTarget.id,
      expires: timestampFromDate(new Date(Date.now() + 3_600_000)),
    },
  });
  if (session.session === undefined) throw new Error("target Session fixture was not returned");
  return Object.freeze({ administrator, suspended, deleted, memberTarget, rbacTarget, deleteTarget, targetSessionToken });
}

async function canBindLoopbackPort(port: number): Promise<boolean> {
  const server = createServer();
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", resolve);
    });
    return true;
  } catch {
    return false;
  } finally {
    if (server.listening) {
      await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
    }
  }
}

async function cleanupLocalMailbox(mailbox: LocalMailbox | undefined): Promise<boolean> {
  if (mailbox === undefined) return true;
  await mailbox.close();
  const [smtpReleased, apiReleased] = await Promise.all([
    canBindLoopbackPort(mailbox.smtpPort),
    canBindLoopbackPort(mailbox.apiPort),
  ]);
  return smtpReleased && apiReleased;
}

async function writeStateFile(input: Readonly<{
  resources: PairResources;
  roundId: string;
  adminBaseUrl: string;
  localMailbox: LocalMailbox;
  database: DatabaseFixture;
  iamLogPath: string;
  adminStdoutPath: string;
  adminStderrPath: string;
  seed: RoundSeed;
  administratorPasswordPath: string;
}>): Promise<string> {
  const pathname = path.join(input.resources.secretDirectory, "pair-state.json");
  await writeFile(pathname, `${JSON.stringify({
    roundId: input.roundId,
    adminBaseUrl: input.adminBaseUrl,
    // Retained until the browser journey state schema is renamed independently.
    mailpitApiBaseUrl: input.localMailbox.apiBaseUrl,
    databaseUrl: input.database.ownerDatabaseUrl,
    iamLogPath: input.iamLogPath,
    adminStdoutPath: input.adminStdoutPath,
    adminStderrPath: input.adminStderrPath,
    sessionCookieName: "kokoro.admin.session-token",
    administratorPasswordPath: input.administratorPasswordPath,
    identities: {
      administrator: input.seed.administrator,
      suspended: input.seed.suspended,
      deleted: input.seed.deleted,
      memberTarget: input.seed.memberTarget,
      rbacTarget: input.seed.rbacTarget,
      deleteTarget: input.seed.deleteTarget,
    },
  }, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  await chmod(pathname, 0o600);
  return pathname;
}

async function stopped(process: TrackedProcess | undefined): Promise<StoppedProcess | null> {
  return process === undefined ? null : stopTrackedProcess(process);
}

async function waitForCodexBrowser(
  doneFile: string,
  evidenceRoot: string,
  expectedIds: readonly string[],
  adminProcess: TrackedProcess,
  iamProcess: TrackedProcess,
): Promise<CodexBrowserCompletion> {
  const deadline = Date.now() + 2 * 60 * 60 * 1_000;
  while (Date.now() < deadline) {
    if (await fileExists(doneFile)) {
      return loadCodexBrowserCompletion(doneFile, evidenceRoot, expectedIds);
    }
    for (const process of [adminProcess, iamProcess]) {
      if (process.child.exitCode !== null || process.child.signalCode !== null) {
        throw new Error(`${process.name} exited during Codex browser acceptance`);
      }
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Codex browser acceptance completion marker timed out");
}

function processGone(pid: number | undefined): boolean {
  if (pid === undefined) return true;
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
}

async function runRound(input: Readonly<{
  round: 1 | 2;
  runId: string;
  smoke: boolean;
  serveForCodexBrowser: boolean;
  grep: string | undefined;
  appRoot: string;
  repositoryRoot: string;
  stagingRoot: string;
  resultsRoot: string;
  runtimeConfig: ReturnType<typeof loadPairRuntimeConfig>;
  provider: z.infer<typeof providerSchema>;
  webCandidate: Readonly<{ runId: string; commit: string; manifestPath: string }> | null;
}>): Promise<RoundOutcome> {
  const resources = createPairResources(input.stagingRoot, input.runId, input.round);
  const roundRoot = path.join(input.resultsRoot, `round-${String(input.round)}`);
  await mkdir(roundRoot, { recursive: false, mode: 0o700 });
  for (const directory of ["commands", "logs", "process", "security", "cases"]) {
    await ensureDirectory(path.join(roundRoot, directory));
  }
  const started = timestamp();
  let database: DatabaseFixture | undefined;
  let localMailbox: LocalMailbox | undefined;
  let iamProcess: TrackedProcess | undefined;
  let adminProcess: TrackedProcess | undefined;
  let secrets: RoundSecrets | undefined;
  let seed: RoundSeed | undefined;
  let playwright: CommandEvidence | undefined;
  let codexBrowserCompletion: CodexBrowserCompletion | undefined;
  let failure: string | null = null;
  let worktreeAdded = false;
  let cleanup: Readonly<Record<string, unknown>> = {};
  try {
    await ensureDirectory(path.dirname(resources.iamWorktree));
    await requiredCommand({
      name: "iam_worktree_add",
      command: "git",
      args: ["worktree", "add", "--detach", resources.iamWorktree, input.provider.commit],
      cwd: input.runtimeConfig.iamSourceRepository,
      evidenceRoot: roundRoot,
    });
    worktreeAdded = true;
    if (output("git", ["rev-parse", "HEAD"], resources.iamWorktree) !== input.provider.commit) {
      throw new Error("detached IAM worktree is not the frozen provider commit");
    }
    await requiredCommand({
      name: "iam_install",
      command: "pnpm",
      args: ["install", "--frozen-lockfile"],
      cwd: resources.iamWorktree,
      evidenceRoot: roundRoot,
    });
    database = await createDatabaseFixture(input.runtimeConfig.postgresOwnerUrl, resources);
    await requiredCommand({
      name: "iam_migrate",
      command: "pnpm",
      args: ["db:migrate"],
      cwd: resources.iamWorktree,
      evidenceRoot: roundRoot,
      environment: { ...process.env, DATABASE_URL: database.ownerDatabaseUrl, FORCE_COLOR: "0" },
    });
    await grantRuntimeRole(input.runtimeConfig.postgresOwnerUrl, database);
    await requiredCommand({
      name: "iam_build",
      command: "pnpm",
      args: ["build"],
      cwd: resources.iamWorktree,
      evidenceRoot: roundRoot,
      environment: { ...process.env, DATABASE_URL: database.runtimeDatabaseUrl, FORCE_COLOR: "0" },
    });
    secrets = await writeRoundSecrets(resources.secretDirectory);
    const administrator = await bootstrapAdministrator({
      iamWorktree: resources.iamWorktree,
      database,
      secrets,
      roundId: resources.roundId,
      evidenceRoot: roundRoot,
    });
    localMailbox = await startLocalMailbox();
    const iamPort = await availablePort();
    const iamBaseUrl = `http://127.0.0.1:${String(iamPort)}`;
    const iamLogPath = path.join(roundRoot, "logs", "iam.stdout.log");
    const iamStderrPath = path.join(roundRoot, "logs", "iam.stderr.log");
    iamProcess = await startTrackedProcess({
      name: "iam",
      command: process.execPath,
      args: [path.join(resources.iamWorktree, "dist", "main.js")],
      cwd: resources.iamWorktree,
      environment: {
        ...process.env,
        NODE_ENV: "production",
        DATABASE_URL: database.runtimeDatabaseUrl,
        KOKORO_IAM_BIND_HOST: "127.0.0.1",
        KOKORO_IAM_PORT: String(iamPort),
        KOKORO_IAM_BASE_URL: iamBaseUrl,
        KOKORO_IAM_JWT_ISSUER: iamBaseUrl,
        KOKORO_IAM_JWT_AUDIENCE: "kokoro-services",
        KOKORO_IAM_ACCESS_TTL_SECONDS: "300",
        KOKORO_IAM_JWT_ENCRYPTION_KEY_FILE: secrets.jwtEncryptionKey.path,
        KOKORO_IAM_USER_WEB_TOKEN_FILE: secrets.userWebToken.path,
        KOKORO_IAM_ADMIN_WEB_TOKEN_FILE: secrets.adminWebToken.path,
        KOKORO_IAM_BACKEND_TOKEN_FILE: secrets.backendToken.path,
        FORCE_COLOR: "0",
      },
      stdoutPath: iamLogPath,
      stderrPath: iamStderrPath,
    });
    await waitForUrl(`${iamBaseUrl}/readyz`, iamProcess);
    seed = await seedRound(iamBaseUrl, database, secrets, resources.roundId, administrator);

    const adminPort = await availablePort();
    const adminBaseUrl = `http://127.0.0.1:${String(adminPort)}`;
    const adminStdoutPath = path.join(roundRoot, "logs", "admin.stdout.log");
    const adminStderrPath = path.join(roundRoot, "logs", "admin.stderr.log");
    adminProcess = await startTrackedProcess({
      name: "admin-web",
      command: process.execPath,
      args: [path.join(input.appRoot, "node_modules", "next", "dist", "bin", "next"), "start", "-H", "127.0.0.1", "-p", String(adminPort)],
      cwd: input.appRoot,
      environment: {
        ...process.env,
        NODE_ENV: "production",
        AUTH_URL: adminBaseUrl,
        AUTH_SECRET_FILE: secrets.authSecret.path,
        AUTH_SECURE_COOKIES: "false",
        KOKORO_IAM_BASE_URL: iamBaseUrl,
        KOKORO_IAM_ADMIN_WEB_TOKEN_FILE: secrets.adminWebToken.path,
        MAGIC_LINK_MAX_AGE: "600",
        EMAIL_FROM: "no-reply@kokoro.local",
        EMAIL_SERVER_HOST: "127.0.0.1",
        EMAIL_SERVER_PORT: String(localMailbox.smtpPort),
        FORCE_COLOR: "0",
      },
      stdoutPath: adminStdoutPath,
      stderrPath: adminStderrPath,
    });
    await waitForUrl(`${adminBaseUrl}/login`, adminProcess);
    const stateFile = await writeStateFile({
      resources,
      roundId: resources.roundId,
      adminBaseUrl,
      localMailbox,
      database,
      iamLogPath,
      adminStdoutPath,
      adminStderrPath,
      seed,
      administratorPasswordPath: secrets.administratorPassword.path,
    });
    if (input.serveForCodexBrowser) {
      const doneFile = path.join(roundRoot, "codex-browser.done");
      const sessionFile = path.join(roundRoot, "codex-browser-session.json");
      await writeJson(sessionFile, {
        schemaVersion: 1,
        status: "READY",
        roundId: resources.roundId,
        adminBaseUrl,
        localMailboxBaseUrl: localMailbox.apiBaseUrl,
        administrator: seed.administrator,
        administratorPasswordPath: secrets.administratorPassword.path,
        evidenceRoot: roundRoot,
        doneFile,
      });
      process.stdout.write([
        `CODEX_BROWSER_SESSION=${sessionFile}`,
        `CODEX_BROWSER_ADMIN_URL=${adminBaseUrl}`,
        `CODEX_BROWSER_LOCAL_MAILBOX_URL=${localMailbox.apiBaseUrl}`,
        `CODEX_BROWSER_ADMIN_EMAIL=${seed.administrator.email}`,
        `CODEX_BROWSER_EVIDENCE_ROOT=${roundRoot}`,
        `CODEX_BROWSER_DONE_FILE=${doneFile}`,
        "",
      ].join("\n"));
      const expectedIds = (await loadP0Catalog(path.join(input.appRoot, "test", "catalog", "p0.yaml"))).cases
        .filter((entry) => entry.category === "pair_e2e")
        .map((entry) => entry.id)
        .sort();
      codexBrowserCompletion = await waitForCodexBrowser(
        doneFile,
        roundRoot,
        expectedIds,
        adminProcess,
        iamProcess,
      );
    } else {
      const playwrightArgs = ["exec", "playwright", "test", "--config", "playwright.config.ts"];
      if (input.grep !== undefined) playwrightArgs.push("--grep", input.grep);
      playwright = await runCommand({
        name: "playwright",
        command: "pnpm",
        args: playwrightArgs,
        cwd: input.appRoot,
        evidenceRoot: roundRoot,
        environment: {
          ...process.env,
          PAIR_STATE_FILE: stateFile,
          PAIR_EVIDENCE_ROOT: roundRoot,
          PAIR_ADMIN_BASE_URL: adminBaseUrl,
          PAIR_SLOW_MO_MS: process.env.PAIR_SLOW_MO_MS ?? "0",
          FORCE_COLOR: "0",
        },
      });
      if (playwright.exitCode !== 0) throw new Error(`Playwright exited with ${String(playwright.exitCode)}`);
    }
  } catch (error) {
    failure = error instanceof Error ? error.message : "unknown round failure";
  } finally {
    const adminStopped = await stopped(adminProcess);
    const iamStopped = await stopped(iamProcess);
    const mailboxListenersReleased = await cleanupLocalMailbox(localMailbox).catch(() => false);
    const databaseCleanup = await dropDatabaseFixture(input.runtimeConfig.postgresOwnerUrl, database).catch(() => ({
      databaseDropped: false,
      roleDropped: false,
    }));
    let worktreeRemoved = !worktreeAdded;
    if (worktreeAdded) {
      await execFileAsync("git", ["worktree", "remove", "--force", resources.iamWorktree], {
        cwd: input.runtimeConfig.iamSourceRepository,
      }).catch(() => undefined);
      await execFileAsync("git", ["worktree", "prune"], { cwd: input.runtimeConfig.iamSourceRepository }).catch(() => undefined);
      worktreeRemoved = !await fileExists(resources.iamWorktree);
    }
    cleanup = Object.freeze({
      admin: adminStopped,
      iam: iamStopped,
      adminProcessGone: processGone(adminProcess?.pid),
      iamProcessGone: processGone(iamProcess?.pid),
      mailboxListenersReleased,
      ...databaseCleanup,
      worktreeRemoved,
    });
    await writeJson(path.join(roundRoot, "process", "cleanup.json"), cleanup);
    await rm(resources.secretDirectory, { recursive: true, force: true });
  }

  const knownSecrets = secrets === undefined ? [] : [
    secrets.authSecret.value,
    secrets.administratorPassword.value,
    secrets.jwtEncryptionKey.value,
    secrets.userWebToken.value,
    secrets.adminWebToken.value,
    secrets.backendToken.value,
    database?.runtimePassword ?? "",
    seed?.targetSessionToken ?? "",
  ];
  if (input.serveForCodexBrowser) {
    const secretScan = await scanSecrets(roundRoot, knownSecrets);
    await writeJson(path.join(roundRoot, "security", "secret-scan.json"), secretScan);
    const cleanupPass = Object.values(cleanup).every((value) => value === true || value === null || typeof value === "object");
    const decision = failure === null
      && codexBrowserCompletion?.decision === "PASS"
      && cleanupPass
      && secretScan.status === "PASS"
      ? "PASS"
      : "FAIL";
    const finished = timestamp();
    const reportFile = path.join(roundRoot, "report.md");
    await writeFile(reportFile, [
      "# Codex In-App Browser Acceptance Session",
      "",
      `- Round ID: \`${resources.roundId}\``,
      `- Started local / UTC: \`${started.local}\` / \`${started.utc}\``,
      `- Finished local / UTC: \`${finished.local}\` / \`${finished.utc}\``,
      `- Completed cases / steps: \`${String(codexBrowserCompletion?.caseIds.length ?? 0)} / ${String(codexBrowserCompletion?.stepCount ?? 0)}\``,
      `- Case IDs: \`${codexBrowserCompletion?.caseIds.join(", ") ?? "none"}\``,
      `- Secret scan: \`${secretScan.status}\` across \`${String(secretScan.scannedFiles)}\` artifacts`,
      `- Cleanup: \`${JSON.stringify(cleanup)}\``,
      `- \`CODEX_BROWSER_SESSION_DECISION=${decision}\``,
      ...(failure === null ? [] : [`- Failure: \`${failure.replaceAll("`", "'")}\``]),
      "",
    ].join("\n"), { encoding: "utf8", flag: "wx", mode: 0o600 });
    const manifestPath = path.join(roundRoot, "manifest.json");
    await writeJson(manifestPath, {
      schemaVersion: 1,
      reportType: "kokoro-admin-codex-browser-session",
      runId: input.runId,
      round: input.round,
      roundId: resources.roundId,
      started,
      finished,
      decision,
      candidate: {
        webRepositoryHead: output("git", ["rev-parse", "HEAD"], input.repositoryRoot),
        iamProvider: input.provider,
      },
      cleanup,
      secretScan,
      completion: codexBrowserCompletion ?? null,
      failure,
    });
    await writeChecksums(roundRoot);
    const checksum = await verifyChecksums(roundRoot);
    return Object.freeze({
      round: input.round,
      roundId: resources.roundId,
      evidenceRoot: roundRoot,
      decision: decision === "PASS" && checksum.status === "PASS" ? "PASS" : "FAIL",
      manifestPath,
      reportPath: reportFile,
      checksum,
      caseIds: codexBrowserCompletion?.caseIds ?? Object.freeze([]),
    });
  }

  const reportPath = path.join(roundRoot, "playwright-report.json");
  let playwrightState: z.infer<typeof playwrightReportSchema> | null = null;
  if (await fileExists(reportPath)) {
    try {
      playwrightState = playwrightReportSchema.parse(JSON.parse(await readFile(reportPath, "utf8")) as unknown);
    } catch {
      if (failure === null) failure = "Playwright report failed schema validation";
    }
  } else if (failure === null) {
    failure = "Playwright report is missing";
  }
  const pairCases = (await loadP0Catalog(path.join(input.appRoot, "test", "catalog", "p0.yaml"))).cases
    .filter((entry) => entry.category === "pair_e2e");
  const expectedIds = pairCases
    .filter((entry) => input.grep === undefined || grepMatches(`${entry.id} ${entry.title}`, input.grep))
    .map((entry) => entry.id)
    .sort();
  const casesRoot = path.join(roundRoot, "cases");
  const caseDirectories = (await readdir(casesRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const cases = await loadPairCaseLedger(casesRoot, expectedIds);
  const exactCases = JSON.stringify(caseDirectories) === JSON.stringify(expectedIds);
  const reportPass = playwrightState !== null
    && playwrightState.stats.expected === expectedIds.length
    && playwrightState.stats.skipped === 0
    && playwrightState.stats.unexpected === 0
    && playwrightState.stats.flaky === 0
    && playwrightState.suites.flatMap((suite) => suite.specs).flatMap((spec) => spec.tests)
      .every((test) => test.expectedStatus === "passed"
        && test.results.length === 1
        && test.results[0]?.status === "passed"
        && test.results[0].retry === 0);
  const cleanupPass = Object.values(cleanup).every((value) => value === true || value === null || typeof value === "object");
  const casePass = exactCases && cases.every((entry) => entry.status === "PASS" && entry.retries === 0 && entry.attempts === 1 && entry.steps.length > 0);
  const secretScan = await scanSecrets(roundRoot, knownSecrets);
  await writeJson(path.join(roundRoot, "security", "secret-scan.json"), secretScan);
  const decision = failure === null && playwright?.exitCode === 0 && reportPass && cleanupPass && casePass && secretScan.status === "PASS"
    ? "PASS"
    : "FAIL";
  const finished = timestamp();
  const reportFile = path.join(roundRoot, "report.md");
  await writeFile(reportFile, [
    `# IAM + Admin Web Pair Round ${String(input.round)}`,
    "",
    `- Round ID: \`${resources.roundId}\``,
    `- Started local / UTC: \`${started.local}\` / \`${started.utc}\``,
    `- Finished local / UTC: \`${finished.local}\` / \`${finished.utc}\``,
    `- Frozen IAM commit: \`${input.provider.commit}\``,
    `- Admin repository accepted run: \`${input.webCandidate?.runId ?? "SMOKE-NOT-APPLICABLE"}\``,
    `- Visible Chromium cases: \`${String(cases.length)}\``,
    `- Retry / skip / unexpected / flaky: \`0 / ${String(playwrightState?.stats.skipped ?? -1)} / ${String(playwrightState?.stats.unexpected ?? -1)} / ${String(playwrightState?.stats.flaky ?? -1)}\``,
    `- Secret scan: \`${secretScan.status}\` across \`${String(secretScan.scannedFiles)}\` artifacts`,
    "",
    "## Cases",
    "",
    "| Case | Status | Steps | Attempts |",
    "| --- | --- | ---: | ---: |",
    ...cases.map((entry) => `| ${entry.caseId} | ${entry.status} | ${String(entry.steps.length)} | ${String(entry.attempts)} |`),
    "",
    "## Cleanup",
    "",
    `- Exact resources: \`${JSON.stringify(cleanup)}\``,
    "",
    "## Decision",
    "",
    `- \`PAIR_ROUND_DECISION=${decision}\``,
    ...(failure === null ? [] : [`- Failure: \`${failure.replaceAll("`", "'")}\``]),
    "",
  ].join("\n"), { encoding: "utf8", flag: "wx", mode: 0o600 });
  const manifestPath = path.join(roundRoot, "manifest.json");
  await writeJson(manifestPath, {
    schemaVersion: 1,
    reportType: "kokoro-admin-iam-pair-round",
    runId: input.runId,
    round: input.round,
    roundId: resources.roundId,
    started,
    finished,
    decision,
    smoke: input.smoke,
    candidate: {
      webRepositoryHead: output("git", ["rev-parse", "HEAD"], input.repositoryRoot),
      acceptedWebRepository: input.webCandidate,
      iamProvider: input.provider,
    },
    freshness: {
      databaseName: database?.name ?? resources.databaseName,
      runtimeRole: database?.role ?? null,
      localMailbox: localMailbox === undefined ? null : {
        kind: "in-process-smtp-api-fixture",
        host: "127.0.0.1",
        smtpPort: localMailbox.smtpPort,
        apiPort: localMailbox.apiPort,
      },
      iamWorktree: resources.iamWorktree,
      distinctSecretDirectory: resources.secretDirectory,
      browserEvidenceRoot: roundRoot,
    },
    environment: {
      host: hostname(),
      os: `${platform()} ${release()}`,
      node: process.version,
      pnpm: output("pnpm", ["--version"], input.repositoryRoot),
      chromium: playwrightState === null ? null : "Playwright Chromium 1.51.1",
    },
    rules: {
      retries: 0,
      skips: playwrightState?.stats.skipped ?? -1,
      unexpected: playwrightState?.stats.unexpected ?? -1,
      flaky: playwrightState?.stats.flaky ?? -1,
      expectedCases: expectedIds,
      exactCases,
    },
    cases,
    cleanup,
    secretScan,
    failure,
  });
  await writeChecksums(roundRoot);
  const checksum = await verifyChecksums(roundRoot);
  return Object.freeze({
    round: input.round,
    roundId: resources.roundId,
    evidenceRoot: roundRoot,
    decision: decision === "PASS" && checksum.status === "PASS" ? "PASS" : "FAIL",
    manifestPath,
    reportPath: reportFile,
    checksum,
    caseIds: Object.freeze(cases.map((entry) => entry.caseId)),
  });
}

async function main(): Promise<void> {
  const appRoot = process.cwd();
  const repositoryRoot = path.resolve(appRoot, "../..");
  const serveForCodexBrowser = hasFlag("--serve-for-codex-browser");
  const smoke = hasFlag("--smoke") || serveForCodexBrowser;
  const runtimeConfig = loadPairRuntimeConfig();
  const provider = providerSchema.parse(JSON.parse(await readFile(path.join(appRoot, "contracts", "iam", "provider.json"), "utf8")) as unknown);
  const sourceCommit = output("git", ["rev-parse", provider.commit], runtimeConfig.iamSourceRepository);
  if (sourceCommit !== provider.commit) throw new Error("PAIR_IAM_SOURCE_REPO does not contain the frozen provider commit");
  const head = output("git", ["rev-parse", "HEAD"], repositoryRoot);
  const dirty = output("git", ["status", "--porcelain"], repositoryRoot);
  if (!smoke && dirty !== "") throw new Error("formal pair acceptance requires a clean kokoro-web candidate");
  const webCandidate = smoke ? null : await acceptedAdminCandidate(repositoryRoot, appRoot);
  const runId = runIdentity(head, smoke, serveForCodexBrowser);
  const resultsRoot = path.join(appRoot, "test-results", runId);
  await ensureDirectory(path.dirname(resultsRoot));
  await mkdir(resultsRoot, { recursive: false, mode: 0o700 });
  await ensureDirectory(path.join(resultsRoot, "commands"));
  const stagingRoot = await mkdtemp(path.join(await realpath(tmpdir()), "kokoro-admin-pair-"));
  const buildSecretRoot = path.join(stagingRoot, "build-secrets");
  const buildSecrets = await writeRoundSecrets(buildSecretRoot);
  const started = timestamp();
  const rounds: RoundOutcome[] = [];
  try {
    await requiredCommand({
      name: "admin_install",
      command: "pnpm",
      args: ["install", "--frozen-lockfile"],
      cwd: repositoryRoot,
      evidenceRoot: resultsRoot,
    });
    await requiredCommand({
      name: "admin_build",
      command: "pnpm",
      args: ["build"],
      cwd: appRoot,
      evidenceRoot: resultsRoot,
      environment: {
        ...process.env,
        NODE_ENV: "production",
        AUTH_URL: "http://127.0.0.1:31999",
        AUTH_SECRET_FILE: buildSecrets.authSecret.path,
        AUTH_SECURE_COOKIES: "false",
        KOKORO_IAM_BASE_URL: "http://127.0.0.1:7199",
        KOKORO_IAM_ADMIN_WEB_TOKEN_FILE: buildSecrets.adminWebToken.path,
        MAGIC_LINK_MAX_AGE: "600",
        EMAIL_FROM: "no-reply@kokoro.local",
        EMAIL_SERVER_HOST: "127.0.0.1",
        EMAIL_SERVER_PORT: "1025",
        FORCE_COLOR: "0",
      },
    });
    const grep = serveForCodexBrowser ? undefined : argument("--grep") ?? (smoke ? "IAM-E2E-AUTH-001" : undefined);
    const roundCount = smoke ? 1 : 2;
    for (let round = 1; round <= roundCount; round += 1) {
      const outcome = await runRound({
        round: round as 1 | 2,
        runId,
        smoke,
        serveForCodexBrowser,
        grep,
        appRoot,
        repositoryRoot,
        stagingRoot,
        resultsRoot,
        runtimeConfig,
        provider,
        webCandidate,
      });
      rounds.push(outcome);
      if (outcome.decision !== "PASS") break;
    }
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
  }
  const finished = timestamp();
  const expectedRoundCount = smoke ? 1 : 2;
  const distinctRoundIds = new Set(rounds.map((round) => round.roundId)).size === rounds.length;
  const allPass = rounds.length === expectedRoundCount
    && distinctRoundIds
    && rounds.every((round) => round.decision === "PASS" && round.checksum.status === "PASS");
  const productDecision = allPass ? "PASS" : "FAIL";
  const combinedReport = path.join(resultsRoot, "report.md");
  await writeFile(combinedReport, [
    "# IAM + Admin Web Browser Pair Acceptance",
    "",
    `- Run ID: \`${runId}\``,
    `- Mode: \`${serveForCodexBrowser ? "CODEX_IN_APP_BROWSER" : smoke ? "NON_FORMAL_SMOKE" : "FORMAL"}\``,
    `- Started local / UTC: \`${started.local}\` / \`${started.utc}\``,
    `- Finished local / UTC: \`${finished.local}\` / \`${finished.utc}\``,
    `- Frozen IAM provider: \`${provider.commit}\``,
    `- Admin repository accepted run: \`${webCandidate?.runId ?? "SMOKE-NOT-APPLICABLE"}\``,
    "",
    "## Rounds",
    "",
    "| Round | Round ID | Decision | Cases | Checksums |",
    "| ---: | --- | --- | ---: | --- |",
    ...rounds.map((round) => `| ${String(round.round)} | ${round.roundId} | ${round.decision} | ${String(round.caseIds.length)} | ${round.checksum.status} (${String(round.checksum.checked)}) |`),
    "",
    "## Overall Mark",
    "",
    `- \`PRODUCT_PAIR_DECISION=${productDecision}\``,
    `- Distinct fresh round identities: \`${distinctRoundIds ? "PASS" : "FAIL"}\``,
    serveForCodexBrowser
      ? "- Every case owns per-step local/UTC timestamps and a distinct in-app-browser screenshot; the round also owns process logs, a secret scan, and an ordered SHA-256 inventory."
      : "- Every case owns per-step local/UTC timestamps, screenshot, trace, video, HAR, RPC, bounded SQL, logs, and SHA-256 references.",
    "",
  ].join("\n"), { encoding: "utf8", flag: "wx", mode: 0o600 });
  const combinedManifest = path.join(resultsRoot, "manifest.json");
  await writeJson(combinedManifest, {
    schemaVersion: 1,
    reportType: "kokoro-admin-iam-pair-acceptance",
    runId,
    mode: serveForCodexBrowser ? "CODEX_IN_APP_BROWSER" : smoke ? "NON_FORMAL_SMOKE" : "FORMAL",
    started,
    finished,
    candidate: {
      webRepositoryHead: head,
      acceptedWebRepository: webCandidate,
      iamProvider: provider,
      dirtyAtStart: dirty !== "",
    },
    rules: {
      requiredRounds: expectedRoundCount,
      executedRounds: rounds.length,
      distinctRoundIds,
      retries: 0,
    },
    rounds: rounds.map((round) => ({
      round: round.round,
      roundId: round.roundId,
      decision: round.decision,
      manifest: path.relative(resultsRoot, round.manifestPath),
      report: path.relative(resultsRoot, round.reportPath),
      checksum: round.checksum,
      caseIds: round.caseIds,
    })),
    decision: productDecision,
  });
  await writeChecksums(resultsRoot);
  const checksum = await verifyChecksums(resultsRoot);
  process.stdout.write(`\n[pair] PRODUCT_PAIR_DECISION=${productDecision}\n`);
  process.stdout.write(`[pair] CHECKSUM_DECISION=${checksum.status}\n`);
  process.stdout.write(`[pair] report=${combinedReport}\n`);
  if (productDecision !== "PASS" || checksum.status !== "PASS") process.exitCode = 1;
}

const entry = process.argv[1] === undefined ? "" : path.resolve(process.argv[1]);
if (entry === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    process.stderr.write(`Pair acceptance runner failed: ${error instanceof Error ? error.stack ?? error.message : "unknown error"}\n`);
    process.exitCode = 1;
  });
}
