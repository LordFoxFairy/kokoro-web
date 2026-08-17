import { randomBytes, createHash } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, type WriteStream } from "node:fs";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";

import { z } from "zod";

const pairEnvironmentSchema = z.object({
  PAIR_IAM_SOURCE_REPO: z.string().refine((value) => path.isAbsolute(value)),
  PAIR_POSTGRES_OWNER_URL: z.string().refine((value) => {
    try {
      return ["postgres:", "postgresql:"].includes(new URL(value).protocol);
    } catch {
      return false;
    }
  }),
}).passthrough();

export type PairRuntimeConfig = Readonly<{
  iamSourceRepository: string;
  postgresOwnerUrl: string;
}>;

export type PairResources = Readonly<{
  roundId: string;
  databaseName: string;
  iamWorktree: string;
  secretDirectory: string;
  browserOutput: string;
}>;

export type RoundSecrets = Readonly<{
  administratorPassword: Readonly<{ path: string; value: string }>;
  authSecret: Readonly<{ path: string; value: string }>;
  jwtEncryptionKey: Readonly<{ path: string; value: string }>;
  userWebToken: Readonly<{ path: string; value: string }>;
  adminWebToken: Readonly<{ path: string; value: string }>;
  backendToken: Readonly<{ path: string; value: string }>;
}>;

export type TrackedProcess = Readonly<{
  name: string;
  pid: number;
  child: ChildProcess;
  stdout: WriteStream;
  stderr: WriteStream;
}>;

export type StoppedProcess = Readonly<{
  name: string;
  pid: number;
  exitCode: number | null;
  signal: "SIGTERM" | "SIGKILL";
}>;

export function loadPairRuntimeConfig(
  source: Readonly<Record<string, string | undefined>> = process.env,
): PairRuntimeConfig {
  const parsed = pairEnvironmentSchema.safeParse(source);
  if (!parsed.success) throw new Error("invalid pair configuration");
  return Object.freeze({
    iamSourceRepository: path.normalize(parsed.data.PAIR_IAM_SOURCE_REPO),
    postgresOwnerUrl: parsed.data.PAIR_POSTGRES_OWNER_URL,
  });
}

export function createPairResources(root: string, pairRunId: string, round: 1 | 2): PairResources {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/u.test(pairRunId) || (round !== 1 && round !== 2)) {
    throw new Error("invalid pair resource identity");
  }
  const identity = createHash("sha256").update(pairRunId).digest("hex").slice(0, 12);
  const roundId = `${pairRunId}-r${String(round)}`;
  const roundRoot = path.resolve(root, roundId);
  return Object.freeze({
    roundId,
    databaseName: `kokoro_iam_pair_${identity}_r${String(round)}`,
    iamWorktree: path.join(roundRoot, "iam"),
    secretDirectory: path.join(roundRoot, "secrets"),
    browserOutput: path.join(roundRoot, "browser"),
  });
}

async function secret(directory: string, name: string): Promise<Readonly<{ path: string; value: string }>> {
  const value = randomBytes(32).toString("hex");
  const pathname = path.join(directory, name);
  await writeFile(pathname, value, { encoding: "utf8", flag: "wx", mode: 0o600 });
  await chmod(pathname, 0o600);
  return Object.freeze({ path: pathname, value });
}

async function passwordSecret(directory: string): Promise<Readonly<{ path: string; value: string }>> {
  const value = randomBytes(32).toString("base64url");
  const pathname = path.join(directory, "administrator-password");
  await writeFile(pathname, value, { encoding: "utf8", flag: "wx", mode: 0o600 });
  await chmod(pathname, 0o600);
  return Object.freeze({ path: pathname, value });
}

export async function writeRoundSecrets(directory: string): Promise<RoundSecrets> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const [administratorPassword, authSecret, jwtEncryptionKey, userWebToken, adminWebToken, backendToken] = await Promise.all([
    passwordSecret(directory),
    secret(directory, "auth-secret"),
    secret(directory, "iam-jwt-encryption-key"),
    secret(directory, "iam-user-web-token"),
    secret(directory, "iam-admin-web-token"),
    secret(directory, "iam-backend-token"),
  ]);
  return Object.freeze({ administratorPassword, authSecret, jwtEncryptionKey, userWebToken, adminWebToken, backendToken });
}

export async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("loopback port allocation failed");
  await new Promise<void>((resolve, reject) => server.close((error) => {
    if (error) reject(error);
    else resolve();
  }));
  return address.port;
}

export async function startTrackedProcess(input: Readonly<{
  name: string;
  command: string;
  args: readonly string[];
  cwd: string;
  environment: NodeJS.ProcessEnv;
  stdoutPath: string;
  stderrPath: string;
}>): Promise<TrackedProcess> {
  const stdout = createWriteStream(input.stdoutPath, { flags: "wx", mode: 0o600 });
  const stderr = createWriteStream(input.stderrPath, { flags: "wx", mode: 0o600 });
  const child = spawn(input.command, [...input.args], {
    cwd: input.cwd,
    env: input.environment,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.pipe(stdout);
  child.stderr?.pipe(stderr);
  await new Promise<void>((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  }).catch(async (error: unknown) => {
    await Promise.all([
      new Promise<void>((resolve) => stdout.end(resolve)),
      new Promise<void>((resolve) => stderr.end(resolve)),
    ]);
    throw error;
  });
  if (child.pid === undefined) throw new Error(`${input.name} did not expose a PID`);
  return Object.freeze({ name: input.name, pid: child.pid, child, stdout, stderr });
}

function signalGroup(process: TrackedProcess, signal: NodeJS.Signals): void {
  try {
    globalThis.process.kill(-process.pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

export async function stopTrackedProcess(process: TrackedProcess): Promise<StoppedProcess> {
  let signal: StoppedProcess["signal"] = "SIGTERM";
  if (process.child.exitCode === null && process.child.signalCode === null) signalGroup(process, signal);
  const exit = new Promise<Readonly<{ code: number | null; signal: NodeJS.Signals | null }>>((resolve) => {
    if (process.child.exitCode !== null || process.child.signalCode !== null) {
      resolve({ code: process.child.exitCode, signal: process.child.signalCode });
      return;
    }
    process.child.once("exit", (code, childSignal) => resolve({ code, signal: childSignal }));
  });
  const result = await Promise.race([
    exit,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 10_000)),
  ]);
  let finished = result;
  if (finished === null) {
    signal = "SIGKILL";
    signalGroup(process, signal);
    finished = await exit;
  }
  await Promise.all([
    new Promise<void>((resolve) => process.stdout.end(resolve)),
    new Promise<void>((resolve) => process.stderr.end(resolve)),
  ]);
  return Object.freeze({
    name: process.name,
    pid: process.pid,
    exitCode: finished.code,
    signal,
  });
}
