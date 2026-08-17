import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { copyFile, mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { expect, test as base, type Browser, type Page } from "@playwright/test";
import { Pool } from "pg";
import { z } from "zod";

import { zh } from "../../i18n/messages";
import { ensureDirectory, sha256File, writeJson } from "../../scripts/test/evidence";
import {
  artifactName,
  completeStep,
  scanSecrets,
  timestamp,
  type ArtifactReference,
  type StepEvidence,
} from "./evidence";
import { waitForMagicLink, type MagicLink } from "./mailbox-client";

const execFileAsync = promisify(execFile);

const uuid = z.string().uuid();
const identitySchema = z.object({ id: uuid, email: z.string().email(), name: z.string().min(1) }).strict();
const pairStateSchema = z.object({
  roundId: z.string().min(1),
  adminBaseUrl: z.string().url(),
  mailpitApiBaseUrl: z.string().url(),
  databaseUrl: z.string().min(1),
  iamLogPath: z.string().min(1),
  adminStdoutPath: z.string().min(1),
  adminStderrPath: z.string().min(1),
  sessionCookieName: z.string().min(1),
  administratorPasswordPath: z.string().refine((value) => path.isAbsolute(value)),
  identities: z.object({
    administrator: identitySchema,
    suspended: identitySchema,
    deleted: identitySchema,
    memberTarget: identitySchema,
    rbacTarget: identitySchema,
    deleteTarget: identitySchema,
  }).strict(),
}).strict();

export type PairState = Readonly<z.infer<typeof pairStateSchema>>;

type PendingStep = Readonly<{
  caseId: string;
  stepId: string;
  expected: string;
  actual: string;
  started: ReturnType<typeof timestamp>;
  finished: ReturnType<typeof timestamp>;
  viewport: Readonly<{ width: number; height: number }>;
  screenshot: ArtifactReference;
  rpc: ArtifactReference;
  sql: ArtifactReference;
  logs: ArtifactReference;
  requestId: string | null;
  commandId: string | null;
}>;

type StepOptions = Readonly<{
  viewport?: Readonly<{ width: number; height: number }>;
}>;

export type PairJourney = Readonly<{
  caseId: string;
  page: Page;
  state: PairState;
  step(stepId: string, expected: string, work: () => Promise<void>, options?: StepOptions): Promise<void>;
  requestMagicLink(stepId: string, email: string): Promise<MagicLink>;
  consumeMagicLink(stepId: string, link: MagicLink, callbackUrl?: string): Promise<void>;
  replayMagicLink(stepId: string, link: MagicLink): Promise<void>;
  rejectCredentials(stepId: string, email: string, password?: string): Promise<void>;
  authenticate(prefix: string, email: string): Promise<void>;
}>;

function caseId(title: string): string {
  const value = /^(IAM-(?:SEC|E2E)-[A-Z0-9]+-[0-9]{3})\b/u.exec(title)?.[1];
  if (value === undefined) throw new Error("pair test title must begin with a catalog case ID");
  return value;
}

async function loadState(): Promise<PairState> {
  const pathname = process.env.PAIR_STATE_FILE;
  if (pathname === undefined || !path.isAbsolute(pathname)) throw new Error("PAIR_STATE_FILE is invalid");
  return Object.freeze(pairStateSchema.parse(JSON.parse(await readFile(pathname, "utf8")) as unknown));
}

async function artifact(root: string, pathname: string): Promise<ArtifactReference> {
  return Object.freeze({
    path: path.relative(root, pathname).split(path.sep).join("/"),
    sha256: await sha256File(pathname),
  });
}

async function redactFile(pathname: string, secrets: readonly string[]): Promise<void> {
  const content = await readFile(pathname);
  if (!secrets.some((secret) => secret.length > 0 && content.includes(secret))) return;
  let redacted = content.toString("utf8");
  for (const secret of secrets) {
    if (secret.length > 0) redacted = redacted.replaceAll(secret, "[REDACTED]");
  }
  await writeFile(pathname, redacted, { encoding: "utf8", flag: "w", mode: 0o600 });
}

async function redactTrace(tracePath: string, secrets: readonly string[]): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "kokoro-pair-trace-"));
  const replacement = `${tracePath}.redacted.zip`;
  try {
    await execFileAsync("unzip", ["-q", tracePath, "-d", root]);
    const queue = [root];
    while (queue.length > 0) {
      const directory = queue.pop();
      if (directory === undefined) break;
      const entries = await readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        const pathname = path.join(directory, entry.name);
        if (entry.isDirectory()) queue.push(pathname);
        else await redactFile(pathname, secrets);
      }
    }
    await execFileAsync("zip", ["-q", "-X", "-r", replacement, "."], { cwd: root });
    await rename(replacement, tracePath);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(replacement, { force: true });
  }
}

async function logLines(pathname: string): Promise<readonly string[]> {
  try {
    return (await readFile(pathname, "utf8")).split("\n").filter((line) => line.trim().length > 0);
  } catch {
    return [];
  }
}

function parsedJson(line: string): Readonly<Record<string, unknown>> | null {
  try {
    const value: unknown = JSON.parse(line);
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? value as Readonly<Record<string, unknown>>
      : null;
  } catch {
    return null;
  }
}

async function captureRuntimeEvidence(input: Readonly<{
  caseRoot: string;
  stepId: string;
  startedEpochMs: number;
  finishedEpochMs: number;
  state: PairState;
  pool: Pool;
}>): Promise<Readonly<{
  rpcPath: string;
  sqlPath: string;
  logsPath: string;
  requestId: string | null;
  commandId: string | null;
}>> {
  const [iamSource, adminStdout, adminStderr, users, sessions, organizations, members, sites, siteMembers, receipts, events] = await Promise.all([
    logLines(input.state.iamLogPath),
    logLines(input.state.adminStdoutPath),
    logLines(input.state.adminStderrPath),
    input.pool.query(`SELECT id, email, name, platform_role, status, version::text, deleted_at, created_at, updated_at FROM public.iam_user ORDER BY created_at, id`),
    input.pool.query(`SELECT id, user_id, active_organization_id, active_site_id, expires, revoked_at, revoke_reason, created_at, updated_at FROM public.iam_session ORDER BY created_at, id`),
    input.pool.query(`SELECT id, slug, name, status, version::text, deleted_at, created_at, updated_at FROM public.iam_organization ORDER BY created_at, id`),
    input.pool.query(`SELECT m.id, m.organization_id, m.user_id, r.key AS role_key, m.status, m.version::text, m.deleted_at, m.created_at, m.updated_at FROM public.iam_member m LEFT JOIN public.iam_role r ON r.id = m.role_id ORDER BY m.created_at, m.id`),
    input.pool.query(`SELECT id, code, name, status, version::text, deleted_at, created_at, updated_at FROM public.iam_site ORDER BY created_at, id`),
    input.pool.query(`SELECT m.id, m.site_id, m.user_id, r.key AS role_key, m.status, m.version::text, m.deleted_at, m.created_at, m.updated_at FROM public.iam_site_member m LEFT JOIN public.iam_site_role r ON r.id = m.role_id ORDER BY m.created_at, m.id`),
    input.pool.query(`SELECT command_id, kind, status, result_ref, error_code, claimed_at, completed_at, updated_at FROM public.iam_command_receipt ORDER BY claimed_at, command_id`),
    input.pool.query(`SELECT id, kind, actor_user_id, target_user_id, organization_id, site_id, session_id, request_id, command_id, metadata, created_at FROM public.iam_security_event ORDER BY created_at, id`),
  ]);
  const lower = input.startedEpochMs - 500;
  const upper = input.finishedEpochMs + 1_000;
  const iamRecords = iamSource
    .map(parsedJson)
    .filter((record): record is Readonly<Record<string, unknown>> => record !== null)
    .filter((record) => typeof record.time !== "number" || (record.time >= lower && record.time <= upper));
  const rpcRecords = iamRecords.filter((record) => typeof record.service === "string" && typeof record.method === "string");
  const commandRecord = [...rpcRecords].reverse().find((record) => typeof record.commandId === "string");
  const requestRecord = commandRecord ?? rpcRecords.at(-1);
  const requestId = typeof requestRecord?.requestId === "string" ? requestRecord.requestId : null;
  const commandId = typeof commandRecord?.commandId === "string" ? commandRecord.commandId : null;
  const requestIds = new Set(rpcRecords.flatMap((record) => typeof record.requestId === "string" ? [record.requestId] : []));
  const adminRecords = [...adminStdout, ...adminStderr]
    .map((line) => ({ line, json: parsedJson(line) }))
    .filter(({ json }) => json === null || typeof json.requestId !== "string" || requestIds.has(json.requestId));

  const rpcPath = path.join(input.caseRoot, "rpc", `${input.stepId}.json`);
  const sqlPath = path.join(input.caseRoot, "sql", `${input.stepId}.json`);
  const logsPath = path.join(input.caseRoot, "logs", `${input.stepId}.json`);
  await Promise.all([
    writeJson(rpcPath, { window: { lowerEpochMs: lower, upperEpochMs: upper }, records: rpcRecords }),
    writeJson(sqlPath, {
      allowlist: ["iam_user", "iam_session", "iam_organization", "iam_member+iam_role", "iam_site", "iam_site_member+iam_site_role", "iam_command_receipt", "iam_security_event"],
      users: users.rows,
      sessions: sessions.rows,
      organizations: organizations.rows,
      members: members.rows,
      sites: sites.rows,
      siteMembers: siteMembers.rows,
      commandReceipts: receipts.rows,
      securityEvents: events.rows,
    }),
    writeJson(logsPath, { iam: iamRecords, admin: adminRecords }),
  ]);
  return Object.freeze({ rpcPath, sqlPath, logsPath, requestId, commandId });
}

async function consumeInEphemeralContext(
  browser: Browser,
  state: PairState,
  callbackUrl: string,
): Promise<Readonly<{ name: string; value: string; domain: string; path: string; expires: number; httpOnly: boolean; secure: boolean; sameSite: "Strict" | "Lax" | "None" }>> {
  const context = await browser.newContext();
  try {
    const callback = await context.newPage();
    try {
      await callback.goto(callbackUrl, { waitUntil: "networkidle" });
    } catch {
      throw new Error("Magic Link callback navigation failed");
    }
    const cookie = (await context.cookies(state.adminBaseUrl)).find((item) => item.name === state.sessionCookieName);
    if (cookie === undefined || cookie.value.length < 32) throw new Error("Magic Link callback did not create a Session cookie");
    return Object.freeze(cookie);
  } finally {
    await context.close();
  }
}

async function replayInEphemeralContext(browser: Browser, state: PairState, callbackUrl: string): Promise<string> {
  const context = await browser.newContext();
  try {
    const callback = await context.newPage();
    try {
      await callback.goto(callbackUrl, { waitUntil: "networkidle" });
      return new URL(callback.url()).pathname;
    } catch {
      throw new Error("Magic Link replay navigation failed");
    }
  } finally {
    await context.close();
  }
}

export const test = base.extend<{ journey: PairJourney }>({
  journey: async ({ browser }, fixtureReady, testInfo) => {
    const state = await loadState();
    const currentCaseId = caseId(testInfo.title);
    const evidenceRoot = process.env.PAIR_EVIDENCE_ROOT;
    if (evidenceRoot === undefined) throw new Error("PAIR_EVIDENCE_ROOT is missing");
    const caseRoot = path.join(evidenceRoot, "cases", currentCaseId);
    await mkdir(caseRoot, { recursive: false, mode: 0o700 });
    for (const directory of ["screenshots", "rpc", "sql", "logs", "video"]) {
      await ensureDirectory(path.join(caseRoot, directory));
    }
    const harPath = path.join(caseRoot, "network.har");
    const tracePath = path.join(caseRoot, "trace.zip");
    const videoPath = path.join(caseRoot, "video.webm");
    const context = await browser.newContext({
      baseURL: state.adminBaseUrl,
      viewport: { width: 1440, height: 1_000 },
      recordHar: { path: harPath, content: "omit", mode: "full" },
      recordVideo: { dir: path.join(caseRoot, "video"), size: { width: 1_280, height: 888 } },
    });
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    const page = await context.newPage();
    const video = page.video();
    const pool = new Pool({ connectionString: state.databaseUrl, max: 2 });
    const pending: PendingStep[] = [];
    const runtimeSecrets = new Set<string>();
    const administratorPassword = await readFile(state.administratorPasswordPath, "utf8");
    runtimeSecrets.add(administratorPassword);

    const step = async (
      stepId: string,
      expected: string,
      work: () => Promise<void>,
      options: StepOptions = {},
    ): Promise<void> => {
      const started = timestamp();
      let actual = expected;
      let caught = false;
      try {
        if (options.viewport !== undefined) await page.setViewportSize(options.viewport);
        await work();
      } catch {
        actual = "step failed";
        caught = true;
      }
      await page.waitForTimeout(150);
      const finished = timestamp();
      const screenshotPath = path.join(caseRoot, "screenshots", artifactName(currentCaseId, stepId, "png"));
      await page.screenshot({ path: screenshotPath, fullPage: true });
      const runtime = await captureRuntimeEvidence({
        caseRoot,
        stepId,
        startedEpochMs: started.epochMs,
        finishedEpochMs: finished.epochMs,
        state,
        pool,
      });
      pending.push(Object.freeze({
        caseId: currentCaseId,
        stepId,
        expected,
        actual,
        started,
        finished,
        viewport: page.viewportSize() ?? { width: 1440, height: 1_000 },
        screenshot: await artifact(evidenceRoot, screenshotPath),
        rpc: await artifact(evidenceRoot, runtime.rpcPath),
        sql: await artifact(evidenceRoot, runtime.sqlPath),
        logs: await artifact(evidenceRoot, runtime.logsPath),
        requestId: runtime.requestId,
        commandId: runtime.commandId,
      }));
      if (caught) throw new Error(`${currentCaseId}/${stepId} failed`);
    };

    const requestMagicLink = async (stepId: string, email: string): Promise<MagicLink> => {
      const createdAfterEpochMs = Date.now() - 1_000;
      await step(stepId, "uniform verification state", async () => {
        await page.goto("/login");
        await page.getByLabel(zh["auth.login.email"]).fill(email);
        await page.getByRole("button", { name: zh["auth.login.submit"] }).click();
        await expect(page.getByRole("heading", { name: zh["auth.verify.title"] })).toBeVisible();
      });
      const link = await waitForMagicLink({
        apiBaseUrl: state.mailpitApiBaseUrl,
        expectedWebOrigin: state.adminBaseUrl,
        recipient: email,
        createdAfterEpochMs,
      });
      runtimeSecrets.add(link.callbackUrl);
      const token = new URL(link.callbackUrl).searchParams.get("token");
      if (token !== null) runtimeSecrets.add(token);
      return link;
    };

    const consumeMagicLink = async (stepId: string, link: MagicLink, callbackUrl = link.callbackUrl): Promise<void> => {
      await step(stepId, "authenticated IAM overview", async () => {
        const cookie = await consumeInEphemeralContext(browser, state, callbackUrl);
        runtimeSecrets.add(cookie.value);
        await context.addCookies([cookie]);
        await page.goto("/");
        await expect(page.getByRole("heading", { name: zh["overview.title"] })).toBeVisible();
      });
    };

    const replayMagicLink = async (stepId: string, link: MagicLink): Promise<void> => {
      await step(stepId, "replayed link rejected", async () => {
        const replayPath = await replayInEphemeralContext(browser, state, link.callbackUrl);
        expect(["/auth/verify", "/login"]).toContain(replayPath);
        await page.goto("/");
        await expect(page.getByRole("heading", { name: zh["overview.title"] })).toBeVisible();
      });
    };

    const journey: PairJourney = Object.freeze({
      caseId: currentCaseId,
      page,
      state,
      step,
      requestMagicLink,
      consumeMagicLink,
      replayMagicLink,
      async rejectCredentials(stepId: string, email: string, password = administratorPassword) {
        await step(stepId, "invalid credentials are rejected uniformly", async () => {
          await page.goto("/login");
          await page.getByLabel(zh["auth.login.email"]).fill(email);
          await page.getByLabel(zh["auth.login.password"]).fill(password);
          await page.getByRole("button", { name: zh["auth.login.submit"] }).click();
          await page.waitForURL(/\/login\?error=invalid_credentials$/u);
          await expect(page.locator(".auth-error")).toBeVisible();
        });
      },
      async authenticate(prefix: string, email: string) {
        await step(prefix, "SQL-bootstrapped administrator is authenticated", async () => {
          await page.goto("/login");
          await page.getByLabel(zh["auth.login.email"]).fill(email);
          await page.getByLabel(zh["auth.login.password"]).fill(administratorPassword);
          await page.getByRole("button", { name: zh["auth.login.submit"] }).click();
          await expect(page.getByRole("heading", { name: zh["overview.title"] })).toBeVisible();
        });
      },
    });

    try {
      await fixtureReady(journey);
    } finally {
      await context.tracing.stop({ path: tracePath });
      await context.close();
      await pool.end();
      if (video !== null) {
        const recorded = await video.path();
        try {
          await rename(recorded, videoPath);
        } catch {
          await copyFile(recorded, videoPath);
        }
      }
      const secrets = [...runtimeSecrets];
      await redactFile(harPath, secrets);
      await redactTrace(tracePath, secrets);
      const retainedScan = await scanSecrets(caseRoot, secrets);
      if (retainedScan.status !== "PASS") throw new Error(`${currentCaseId} retained a callback or Session secret`);
      const [trace, har, recordedVideo] = await Promise.all([
        artifact(evidenceRoot, tracePath),
        artifact(evidenceRoot, harPath),
        artifact(evidenceRoot, videoPath),
      ]);
      const steps: StepEvidence[] = pending.map((item) => completeStep({
        caseId: item.caseId,
        stepId: item.stepId,
        expected: item.expected,
        actual: item.actual,
        started: item.started,
        finished: item.finished,
        viewport: item.viewport,
        artifacts: {
          screenshot: item.screenshot,
          trace,
          video: recordedVideo,
          har,
          rpc: item.rpc,
          sql: item.sql,
          logs: item.logs,
        },
        requestId: item.requestId,
        commandId: item.commandId,
      }));
      await writeJson(path.join(caseRoot, "case.json"), {
        schemaVersion: 1,
        roundId: state.roundId,
        caseId: currentCaseId,
        status: steps.length > 0 && steps.every((item) => item.status === "PASS") ? "PASS" : "FAIL",
        attempts: 1,
        retries: 0,
        steps,
      });
    }
  },
});

export { expect };

export function uniqueValue(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}
