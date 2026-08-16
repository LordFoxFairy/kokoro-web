import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { createWriteStream } from "node:fs";
import { chmod, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@connectrpc/connect";
import { connectNodeAdapter, createConnectTransport } from "@connectrpc/connect-node";

import { IamAdministrationService } from "../../generated/iam/proto/kokoro/iam/v1/administration_pb";
import { ensureDirectory, runCommand, timestamp, writeJson } from "./evidence";
import { scanProductionBundle } from "./production-boundary";

export type GeneratedIamFixture = Readonly<{
  baseUrl: string;
  operations(): readonly string[];
  close(): Promise<void>;
}>;

export type GeneratedRpcEvidence = Readonly<{
  service: string;
  method: string;
  requestId: string;
  itemCount: number;
  nextCursor: string | null;
}>;

export type AdminHttpEvidence = Readonly<{
  login: Readonly<{ status: number; contentType: string; secureHeaders: boolean }>;
  protectedRoute: Readonly<{ status: number; location: string | null }>;
}>;

const requiredHeaders: Readonly<Record<string, string>> = Object.freeze({
  "content-security-policy": "frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
});

export async function startGeneratedIamFixture(): Promise<GeneratedIamFixture> {
  const operations: string[] = [];
  const handler = connectNodeAdapter({
    routes(router) {
      router.service(IamAdministrationService, {
        listUsers() {
          operations.push("ListUsers");
          return { users: [], page: { nextCursor: "" } };
        },
      });
    },
  });
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("generated IAM fixture did not bind TCP");
  let closed = false;
  return Object.freeze({
    baseUrl: `http://127.0.0.1:${String(address.port)}`,
    operations: () => Object.freeze([...operations]),
    async close() {
      if (closed) return;
      closed = true;
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  });
}

export async function probeGeneratedRpc(baseUrl: string): Promise<GeneratedRpcEvidence> {
  const requestId = randomUUID();
  const client = createClient(IamAdministrationService, createConnectTransport({
    baseUrl,
    httpVersion: "1.1",
  }));
  const response = await client.listUsers({ requestId, query: "", includeDeleted: false, page: { limit: 1 } });
  return Object.freeze({
    service: IamAdministrationService.typeName,
    method: "ListUsers",
    requestId,
    itemCount: response.users.length,
    nextCursor: response.page?.nextCursor || null,
  });
}

export async function probeAdminHttp(baseUrl: string): Promise<AdminHttpEvidence> {
  const login = await fetch(`${baseUrl}/login`, { redirect: "manual" });
  const protectedRoute = await fetch(`${baseUrl}/users`, { redirect: "manual" });
  const location = protectedRoute.headers.get("location");
  return Object.freeze({
    login: Object.freeze({
      status: login.status,
      contentType: login.headers.get("content-type") ?? "",
      secureHeaders: Object.entries(requiredHeaders).every(([name, value]) => login.headers.get(name) === value),
    }),
    protectedRoute: Object.freeze({
      status: protectedRoute.status,
      location: location === null ? null : `${new URL(location, baseUrl).pathname}${new URL(location, baseUrl).search}`,
    }),
  });
}

async function availablePort(): Promise<number> {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("port fixture did not bind TCP");
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function secret(directory: string, name: string): Promise<Readonly<{ path: string; value: string }>> {
  const value = randomBytes(32).toString("hex");
  const pathname = path.join(directory, name);
  await writeFile(pathname, `${value}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  await chmod(pathname, 0o600);
  return Object.freeze({ path: pathname, value });
}

async function waitForLogin(baseUrl: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("Admin process exited before login became available");
    try {
      if ((await fetch(`${baseUrl}/login`)).status === 200) return;
    } catch {
      // Listener startup is asynchronous; poll until the bounded deadline.
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Admin login did not become available before deadline");
}

async function stopChild(child: ChildProcess): Promise<number> {
  if (child.exitCode !== null) return child.exitCode;
  child.kill("SIGTERM");
  return new Promise<number>((resolve) => {
    const deadline = setTimeout(() => child.kill("SIGKILL"), 10_000);
    child.once("exit", (code, signal) => {
      clearTimeout(deadline);
      resolve(code ?? (signal === "SIGTERM" ? 0 : -1));
    });
  });
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

async function main(): Promise<void> {
  const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const explicitOutput = argument("--output-root");
  const outputRoot = explicitOutput === undefined
    ? path.join(appRoot, "test-results", `smoke-${new Date().toISOString().replace(/[-:.]/gu, "")}-${String(process.pid)}`)
    : path.resolve(explicitOutput);
  for (const directory of ["build", "http", "logs", "process", "rpc"]) {
    await ensureDirectory(path.join(outputRoot, directory));
  }

  let secretDirectory: string | undefined;
  let fixture: GeneratedIamFixture | undefined;
  let stdout: ReturnType<typeof createWriteStream> | undefined;
  let stderr: ReturnType<typeof createWriteStream> | undefined;
  let child: ChildProcess | undefined;
  const started = timestamp();
  let processExit = -1;
  try {
    secretDirectory = await mkdtemp(path.join(await realpath(tmpdir()), "kokoro-admin-smoke-"));
    const authSecret = await secret(secretDirectory, "auth-secret");
    const workloadToken = await secret(secretDirectory, "workload-token");
    fixture = await startGeneratedIamFixture();
    const port = await availablePort();
    const baseUrl = `http://127.0.0.1:${String(port)}`;
    const runtimeEnvironment: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: "production",
      AUTH_URL: "https://admin.example.test",
      AUTH_SECRET_FILE: authSecret.path,
      AUTH_SECURE_COOKIES: "true",
      KOKORO_IAM_BASE_URL: fixture.baseUrl,
      KOKORO_IAM_ADMIN_WEB_TOKEN_FILE: workloadToken.path,
      MAGIC_LINK_MAX_AGE: "600",
      EMAIL_FROM: "no-reply@kokoro.local",
      EMAIL_SERVER_HOST: "127.0.0.1",
      EMAIL_SERVER_PORT: "1025",
      FORCE_COLOR: "0",
    };
    if (process.argv.includes("--build")) {
      const build = await runCommand({
        name: "smoke_build",
        command: "pnpm",
        args: ["exec", "next", "build"],
        cwd: appRoot,
        evidenceRoot: outputRoot,
        environment: runtimeEnvironment,
      });
      if (build.exitCode !== 0) throw new Error("Admin smoke build failed");
    }
    stdout = createWriteStream(path.join(outputRoot, "logs", "admin.stdout.log"), { flags: "wx", mode: 0o600 });
    stderr = createWriteStream(path.join(outputRoot, "logs", "admin.stderr.log"), { flags: "wx", mode: 0o600 });
    child = spawn("pnpm", ["exec", "next", "start", "--hostname", "127.0.0.1", "--port", String(port)], {
      cwd: appRoot,
      env: runtimeEnvironment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (child.stdout === null || child.stderr === null) throw new Error("Admin process pipes are unavailable");
    child.stdout.pipe(stdout);
    child.stderr.pipe(stderr);
    await waitForLogin(baseUrl, child);

    const rpc = await probeGeneratedRpc(fixture.baseUrl);
    const http = await probeAdminHttp(baseUrl);
    await writeJson(path.join(outputRoot, "rpc", "smoke.json"), { recordedAt: timestamp(), ...rpc });
    await writeJson(path.join(outputRoot, "http", "smoke.json"), { recordedAt: timestamp(), ...http });
    if (http.login.status !== 200 || !http.login.contentType.includes("text/html") || !http.login.secureHeaders) {
      throw new Error("Admin public login smoke failed");
    }
    if (![303, 307, 308].includes(http.protectedRoute.status) || http.protectedRoute.location !== "/login") {
      throw new Error("Admin protected redirect smoke failed");
    }
    const build = await scanProductionBundle(appRoot, [authSecret.value, workloadToken.value]);
    if (build.violations.length > 0) throw new Error(`production boundary failed: ${build.violations.join(", ")}`);

    await writeJson(path.join(outputRoot, "build", "boundary.json"), { recordedAt: timestamp(), ...build });
  } finally {
    if (child !== undefined) processExit = await stopChild(child);
    let iamFixtureClosed = fixture === undefined;
    let secretDirectoryRemoved = secretDirectory === undefined;
    const cleanup = await Promise.allSettled([
      ...(stdout === undefined ? [] : [new Promise<void>((resolve) => stdout?.end(resolve))]),
      ...(stderr === undefined ? [] : [new Promise<void>((resolve) => stderr?.end(resolve))]),
      ...(fixture === undefined ? [] : [fixture.close().then(() => { iamFixtureClosed = true; })]),
      ...(secretDirectory === undefined ? [] : [
        rm(secretDirectory, { recursive: true, force: true }).then(() => { secretDirectoryRemoved = true; }),
      ]),
    ]);
    await writeJson(path.join(outputRoot, "process", "smoke.json"), {
      started,
      finished: timestamp(),
      adminExitCode: processExit,
      iamFixtureClosed,
      secretDirectoryRemoved,
    });
    const cleanupErrors = cleanup.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
    if (cleanupErrors.length > 0) throw new AggregateError(cleanupErrors, "Admin smoke cleanup failed");
  }
  process.stdout.write(`ADMIN_RUNTIME_SMOKE=PASS\nSMOKE_EVIDENCE=${outputRoot}\n`);
}

const entry = process.argv[1] === undefined ? "" : path.resolve(process.argv[1]);
if (entry === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    process.stderr.write(`Admin runtime smoke failed: ${error instanceof Error ? error.stack ?? error.message : "unknown error"}\n`);
    process.exitCode = 1;
  });
}
