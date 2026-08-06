import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { isDeepStrictEqual, promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  admitDashboard,
  createProductionJourneyRuntime,
} from "./web-chat-credit-runtime-journey.mjs";
import {
  availableLoopbackPort,
  generatePublicTls,
  prepareStandaloneCandidate,
  startStrictPublicProxy,
  waitForCandidateProcess,
} from "./web-chat-credit-runtime-network.mjs";

export { prepareStandaloneCandidate, startStrictPublicProxy };

const execFileAsync = promisify(execFile);
const WEB_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const PNPM = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const MAXIMUM_CHILD_OUTPUT_BYTES = 16 * 1024 * 1024;
const MAXIMUM_TEXT_LENGTH = 4_096;
const SHA256 = /^[0-9a-f]{64}$/u;
const HOSTNAME = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/u;

const SITE_PACKAGES = Object.freeze([
  "@kokoro/site-app-kit",
  "@kokoro/site-client",
  "@kokoro/session-client",
  "@kokoro/bff-runtime",
  "@kokoro/site-runtime-node",
  "@kokoro/chat-surface",
  "@kokoro/asset-client",
  "@kokoro/chat-app",
  "@kokoro/site-bff",
  "@kokoro/account-app",
  "@kokoro/media-app",
]);

export const REQUIRED_RUNTIME_MATERIALS = Object.freeze([
  "KOKORO_WEB_FIXTURE_UPSTREAM_ENDPOINTS_FILE",
  "KOKORO_WEB_FIXTURE_BROWSER_AUTH_FILE",
  "KOKORO_WEB_FIXTURE_AUTH_SECRET_FILE",
  "KOKORO_WEB_FIXTURE_PLATFORM_CSRF_FILE",
  "KOKORO_WEB_FIXTURE_BROWSER_CSRF_SECRET_FILE",
  "KOKORO_WEB_FIXTURE_SITE_WORKLOAD_CREDENTIAL_FILE",
  "KOKORO_WEB_FIXTURE_SITE_MTLS_CERT_FILE",
  "KOKORO_WEB_FIXTURE_SITE_MTLS_KEY_FILE",
  "KOKORO_WEB_FIXTURE_PLATFORM_CA_FILE",
  "KOKORO_WEB_FIXTURE_SESSION_CA_FILE",
]);

function safeEnvironment(source) {
  const output = {};
  for (const name of ["PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "LC_CTYPE"]) {
    if (typeof source[name] === "string" && source[name].length > 0) output[name] = source[name];
  }
  return { ...output, CI: "1", NEXT_TELEMETRY_DISABLED: "1" };
}

async function run(command, args, cwd, extraEnvironment = {}) {
  return execFileAsync(command, args, {
    cwd,
    env: { ...safeEnvironment(process.env), ...extraEnvironment },
    maxBuffer: MAXIMUM_CHILD_OUTPUT_BYTES,
  });
}

function required(environment, name) {
  const value = environment[name];
  if (typeof value !== "string" || value.length === 0 || value.length > MAXIMUM_TEXT_LENGTH || value !== value.trim()) {
    throw new Error(`WEB_FIXTURE_${name}_INVALID`);
  }
  return value;
}

function boundedIdentifier(environment, name, maximum = 256) {
  const value = required(environment, name);
  if (value.length > maximum || Array.from(value).some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 || code === 127;
  })) throw new Error(`WEB_FIXTURE_${name}_INVALID`);
  return value;
}

function exactPublicOrigin(environment, candidateHost) {
  const value = required(environment, "KOKORO_WEB_FIXTURE_PUBLIC_ORIGIN");
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("WEB_FIXTURE_PUBLIC_ORIGIN_INVALID");
  }
  if (
    parsed.protocol !== "https:" || parsed.origin !== value || parsed.hostname !== candidateHost ||
    parsed.username !== "" || parsed.password !== "" || parsed.pathname !== "/" ||
    parsed.search !== "" || parsed.hash !== "" || parsed.port === "" ||
    !/^[1-9][0-9]{0,4}$/u.test(parsed.port) || Number(parsed.port) > 65_535
  ) throw new Error("WEB_FIXTURE_PUBLIC_ORIGIN_INVALID");
  return value;
}

async function privateDirectory(environment) {
  const directory = resolve(required(environment, "KOKORO_WEB_FIXTURE_PRIVATE_DIR"));
  if (!isAbsolute(directory)) throw new Error("WEB_FIXTURE_PRIVATE_DIR_INVALID");
  const metadata = await lstat(directory).catch(() => null);
  if (metadata === null || !metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error("WEB_FIXTURE_PRIVATE_DIR_INVALID");
  }
  return directory;
}

function exactObject(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function httpsOrigin(value) {
  if (typeof value !== "string") return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && parsed.origin === value && parsed.username === "" &&
      parsed.password === "" && parsed.pathname === "/" && parsed.search === "" && parsed.hash === "";
  } catch {
    return false;
  }
}

function credentialMaterial(value) {
  return value.length >= 32 && value.length <= 4_096 && Array.from(value).every((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code > 32 && code !== 127;
  });
}

function validateRuntimeMaterial(name, contents) {
  if (name === "KOKORO_WEB_FIXTURE_UPSTREAM_ENDPOINTS_FILE") {
    let value;
    try {
      value = JSON.parse(contents);
    } catch {
      throw new Error("WEB_FIXTURE_UPSTREAM_ENDPOINTS_INVALID");
    }
    if (
      !exactObject(value, ["schemaVersion", "platformOrigin", "sessionOrigin"]) ||
      value.schemaVersion !== 1 || !httpsOrigin(value.platformOrigin) || !httpsOrigin(value.sessionOrigin)
    ) throw new Error("WEB_FIXTURE_UPSTREAM_ENDPOINTS_INVALID");
    return;
  }
  if (name === "KOKORO_WEB_FIXTURE_BROWSER_AUTH_FILE") {
    let value;
    try {
      value = JSON.parse(contents);
    } catch {
      throw new Error("WEB_FIXTURE_BROWSER_AUTH_INVALID");
    }
    if (
      !exactObject(value, ["schemaVersion", "email", "password"]) || value.schemaVersion !== 1 ||
      typeof value.email !== "string" || value.email.length < 3 || value.email.length > 320 ||
      /[\u0000-\u001f\u007f]/u.test(value.email) ||
      typeof value.password !== "string" || value.password.length < 15 || value.password.length > 1_024 ||
      /[\u0000\r\n]/u.test(value.password)
    ) throw new Error("WEB_FIXTURE_BROWSER_AUTH_INVALID");
    return;
  }
  if (name.endsWith("_CERT_FILE") || name.endsWith("_CA_FILE")) {
    if (!/^-----BEGIN CERTIFICATE-----\r?\n[\s\S]+\r?\n-----END CERTIFICATE-----\r?\n?$/u.test(contents)) {
      throw new Error("WEB_FIXTURE_CERTIFICATE_INVALID");
    }
    return;
  }
  if (name.endsWith("_KEY_FILE")) {
    if (!/^-----BEGIN (?:EC |RSA )?PRIVATE KEY-----\r?\n[\s\S]+\r?\n-----END (?:EC |RSA )?PRIVATE KEY-----\r?\n?$/u.test(contents)) {
      throw new Error("WEB_FIXTURE_PRIVATE_KEY_INVALID");
    }
    return;
  }
  if (!credentialMaterial(contents)) throw new Error("WEB_FIXTURE_CREDENTIAL_MATERIAL_INVALID");
}

async function materialFiles(environment) {
  const files = {};
  const missing = [];
  for (const name of REQUIRED_RUNTIME_MATERIALS) {
    const path = environment[name];
    if (typeof path !== "string" || path.length === 0) {
      missing.push(name);
      continue;
    }
    if (!isAbsolute(path) || path.length > MAXIMUM_TEXT_LENGTH || path !== path.trim()) {
      throw new Error(`WEB_FIXTURE_${name}_INVALID`);
    }
    const metadata = await lstat(path).catch(() => null);
    if (
      metadata === null || !metadata.isFile() || metadata.isSymbolicLink() ||
      metadata.size < 1 || metadata.size > 1024 * 1024
    ) throw new Error(`WEB_FIXTURE_${name}_INVALID`);
    let contents;
    try {
      contents = await readFile(path, "utf8");
    } catch {
      throw new Error(`WEB_FIXTURE_${name}_INVALID`);
    }
    validateRuntimeMaterial(name, contents);
    files[name] = path;
  }
  return { files: Object.freeze(files), missing: Object.freeze(missing) };
}

async function packSitePackage(packageName, packageDirectory) {
  const before = new Set(await readdir(packageDirectory));
  await run(PNPM, ["--filter", packageName, "pack", "--pack-destination", packageDirectory], WEB_ROOT);
  const created = (await readdir(packageDirectory)).filter((name) => !before.has(name) && name.endsWith(".tgz"));
  if (created.length !== 1) throw new Error("WEB_FIXTURE_PACKAGE_ARCHIVE_INVALID");
  const archivePath = join(packageDirectory, created[0]);
  const packageDirectoryName = packageName.slice("@kokoro/".length);
  const manifest = JSON.parse(await readFile(join(WEB_ROOT, "packages", packageDirectoryName, "package.json"), "utf8"));
  if (manifest.name !== packageName || typeof manifest.version !== "string" || manifest.version.length === 0) {
    throw new Error("WEB_FIXTURE_PACKAGE_IDENTITY_INVALID");
  }
  return Object.freeze({
    name: packageName,
    version: manifest.version,
    archivePath,
    sha256: createHash("sha256").update(await readFile(archivePath)).digest("hex"),
  });
}

async function buildCandidate(input) {
  const packageDirectory = join(input.privateDirectory, "packages");
  await mkdir(packageDirectory, { mode: 0o700 });
  const packages = [];
  for (const packageName of SITE_PACKAGES) {
    packages.push(await packSitePackage(packageName, packageDirectory));
  }
  await fixturePhase(
    "WEB_FIXTURE_SCAFFOLD_BUILD_FAILED",
    () => run(PNPM, ["--filter", "@kokoro/site-scaffold", "build"], WEB_ROOT),
  );
  const [{ createSiteProject }, { PLATFORM_PUBLIC_CONTRACT_METADATA }] = await fixturePhase(
    "WEB_FIXTURE_SCAFFOLD_LOAD_FAILED",
    () => Promise.all([
      import("@kokoro/site-scaffold"),
      import("@kokoro/site-client"),
    ]),
  );
  await createSiteProject({
    directory: input.candidateDirectory,
    packageName: "@kokoro/web-chat-credit-runtime-site",
    siteKey: "web-chat-credit-runtime",
    displayName: "Kokoro Runtime Fixture",
    releaseId: input.siteReleaseRef,
    artifactSha256: input.webArtifactDigest,
    profileRevision: "web-chat-credit-runtime.v1",
    domains: [{ hostname: input.candidateHost, environment: "production" }],
    deployment: { provider: "compatibility", projectRef: input.deploymentRef, region: "us-east-1" },
    contractFloor: {
      contract: PLATFORM_PUBLIC_CONTRACT_METADATA.schemaId,
      version: PLATFORM_PUBLIC_CONTRACT_METADATA.contractVersion,
      schemaSha256: PLATFORM_PUBLIC_CONTRACT_METADATA.sourceDigestSha256,
      signature: "web-chat-credit-runtime-fixture-signature",
      signingKeyId: "web-chat-credit-runtime-fixture-key",
    },
    enabledProductIds: [],
    packages,
  });
  await run(PNPM, ["install", "--prefer-offline"], input.candidateDirectory);
  await run(PNPM, ["install", "--offline", "--frozen-lockfile"], input.candidateDirectory);
  await run(PNPM, ["build"], input.candidateDirectory, {
    AUTH_SECRET: "web-chat-credit-runtime-build-secret-2026",
    AUTH_URL: input.publicOrigin,
    KOKORO_SITE_PUBLIC_ORIGIN: input.publicOrigin,
  });
  const server = await lstat(join(input.candidateDirectory, ".next", "standalone", "server.js")).catch(() => null);
  if (server === null || !server.isFile()) throw new Error("WEB_FIXTURE_CANDIDATE_BUILD_INVALID");
}

function setupRecord(input) {
  return Object.freeze({
    schemaVersion: 1,
    kind: "web-chat-credit-runtime-setup",
    siteId: input.siteId,
    candidateHost: input.candidateHost,
    publicOrigin: input.publicOrigin,
    candidateDirectory: input.candidateDirectory,
    runtimeStateFile: input.runtimeStateFile,
    publicCertificateAuthorityFile: input.publicCertificateAuthorityFile,
    chatPath: "/",
    sessionApiPrefix: "/api/session",
    accountPath: "/account",
    accountDashboardPath: "/api/account/dashboard",
    readiness: input.missingRuntimeMaterials.length === 0 ? "ready_to_start" : "runtime_material_required",
    missingRuntimeMaterials: input.missingRuntimeMaterials,
  });
}

async function setupWebChatCreditRuntimeUnsafe(environment, options) {
  const root = await privateDirectory(environment);
  const siteId = boundedIdentifier(environment, "KOKORO_WEB_FIXTURE_SITE_ID");
  const siteReleaseRef = boundedIdentifier(environment, "KOKORO_WEB_FIXTURE_SITE_RELEASE_REF", 128);
  const siteProjectBindingRef = boundedIdentifier(environment, "KOKORO_WEB_FIXTURE_SITE_PROJECT_BINDING_REF");
  const deploymentRef = boundedIdentifier(environment, "KOKORO_WEB_FIXTURE_DEPLOYMENT_REF");
  const webArtifactDigest = required(environment, "KOKORO_WEB_FIXTURE_WEB_ARTIFACT_DIGEST");
  if (!SHA256.test(webArtifactDigest)) throw new Error("WEB_FIXTURE_WEB_ARTIFACT_DIGEST_INVALID");
  const candidateHost = required(environment, "KOKORO_WEB_FIXTURE_CANDIDATE_HOST").toLowerCase();
  if (!HOSTNAME.test(candidateHost) || candidateHost.length > 253) throw new Error("WEB_FIXTURE_CANDIDATE_HOST_INVALID");
  const publicOrigin = exactPublicOrigin(environment, candidateHost);
  const productAudience = boundedIdentifier(environment, "KOKORO_WEB_FIXTURE_PRODUCT_AUDIENCE", 128);
  const projectRef = boundedIdentifier(environment, "KOKORO_WEB_FIXTURE_PROJECT_REF");
  const modelOptionRevisionRef = boundedIdentifier(environment, "KOKORO_WEB_FIXTURE_MODEL_OPTION_REVISION_REF");
  const candidateDirectory = join(root, "candidate");
  const runtimeStateFile = join(root, "runtime-state.json");
  const observationFile = join(root, "observation.json");
  const materials = await materialFiles(environment);
  const publicTls = await generatePublicTls(root, candidateHost);
  const input = {
    privateDirectory: root,
    siteId,
    siteReleaseRef,
    siteProjectBindingRef,
    deploymentRef,
    webArtifactDigest,
    candidateHost,
    publicOrigin,
    candidateDirectory,
    runtimeStateFile,
    ...publicTls,
  };
  if (options.buildCandidate !== false) await buildCandidate(input);
  const state = Object.freeze({
    schemaVersion: 1,
    kind: "web-chat-credit-runtime-state",
    candidateDirectory,
    candidateHost,
    publicOrigin,
    siteId,
    siteReleaseRef,
    siteProjectBindingRef,
    deploymentRef,
    webArtifactDigest,
    productAudience,
    projectRef,
    modelOptionRevisionRef,
    runtimeMaterialFiles: materials.files,
    ...publicTls,
    observationFile,
  });
  await writeFile(runtimeStateFile, `${JSON.stringify(state)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  return setupRecord({
    ...input,
    missingRuntimeMaterials: materials.missing,
  });
}

export async function setupWebChatCreditRuntime(environment, options = {}) {
  return fixturePhase(
    "WEB_FIXTURE_SETUP_FAILED",
    () => setupWebChatCreditRuntimeUnsafe(environment, options),
  );
}

async function readRuntimeState(environment) {
  const root = await privateDirectory(environment);
  const path = join(root, "runtime-state.json");
  const metadata = await lstat(path).catch(() => null);
  if (metadata === null || !metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 1024 * 1024) {
    throw new Error("WEB_FIXTURE_RUNTIME_STATE_INVALID");
  }
  let value;
  try {
    value = JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw new Error("WEB_FIXTURE_RUNTIME_STATE_INVALID");
  }
  if (
    !exactObject(value, [
      "schemaVersion", "kind", "candidateDirectory", "candidateHost", "publicOrigin", "siteId",
      "siteReleaseRef", "siteProjectBindingRef", "deploymentRef", "webArtifactDigest", "productAudience",
      "projectRef", "modelOptionRevisionRef", "runtimeMaterialFiles", "publicCertificateAuthorityFile",
      "publicTlsCertificateFile", "publicTlsKeyFile", "observationFile",
    ]) || value.schemaVersion !== 1 || value.kind !== "web-chat-credit-runtime-state"
  ) throw new Error("WEB_FIXTURE_RUNTIME_STATE_INVALID");
  return Object.freeze(value);
}

async function readExactMaterial(state, name) {
  const path = state.runtimeMaterialFiles[name];
  if (typeof path !== "string") throw new Error("WEB_FIXTURE_RUNTIME_STATE_INVALID");
  return readFile(path, "utf8");
}

async function candidateEnvironment(state, internalPort) {
  const endpoints = JSON.parse(await readExactMaterial(state, "KOKORO_WEB_FIXTURE_UPSTREAM_ENDPOINTS_FILE"));
  const [authSecret, platformCsrfToken, browserCsrfSecret, workloadCredential] = await Promise.all([
    readExactMaterial(state, "KOKORO_WEB_FIXTURE_AUTH_SECRET_FILE"),
    readExactMaterial(state, "KOKORO_WEB_FIXTURE_PLATFORM_CSRF_FILE"),
    readExactMaterial(state, "KOKORO_WEB_FIXTURE_BROWSER_CSRF_SECRET_FILE"),
    readExactMaterial(state, "KOKORO_WEB_FIXTURE_SITE_WORKLOAD_CREDENTIAL_FILE"),
  ]);
  return {
    ...safeEnvironment(process.env),
    NODE_ENV: "production",
    HOSTNAME: "127.0.0.1",
    PORT: String(internalPort),
    AUTH_SECRET: authSecret,
    AUTH_URL: state.publicOrigin,
    KOKORO_SITE_PUBLIC_ORIGIN: state.publicOrigin,
    KOKORO_SITE_RUNTIME_ENVIRONMENT: "production",
    KOKORO_SITE_PROJECT_BINDING_REF: state.siteProjectBindingRef,
    KOKORO_SITE_DEPLOYMENT_REF: state.deploymentRef,
    KOKORO_SITE_RELEASE_REF: state.siteReleaseRef,
    KOKORO_WEB_ARTIFACT_DIGEST: state.webArtifactDigest,
    KOKORO_PLATFORM_WORKLOAD_CREDENTIAL: workloadCredential,
    KOKORO_SESSION_CONTRACT_REVISION: "session-browser-v3",
    KOKORO_SITE_REGION: "us-east-1",
    KOKORO_PRODUCT_AUDIENCE: state.productAudience,
    KOKORO_SITE_RUNTIME_PLATFORM_ORIGIN: endpoints.platformOrigin,
    KOKORO_SITE_RUNTIME_SESSION_ORIGIN: endpoints.sessionOrigin,
    KOKORO_PLATFORM_CSRF_TOKEN: platformCsrfToken,
    KOKORO_BROWSER_CSRF_SECRET: browserCsrfSecret,
    KOKORO_SITE_RUNTIME_MTLS_CERT_FILE: state.runtimeMaterialFiles.KOKORO_WEB_FIXTURE_SITE_MTLS_CERT_FILE,
    KOKORO_SITE_RUNTIME_MTLS_KEY_FILE: state.runtimeMaterialFiles.KOKORO_WEB_FIXTURE_SITE_MTLS_KEY_FILE,
    KOKORO_SITE_RUNTIME_PLATFORM_CA_FILE: state.runtimeMaterialFiles.KOKORO_WEB_FIXTURE_PLATFORM_CA_FILE,
    KOKORO_SITE_RUNTIME_SESSION_CA_FILE: state.runtimeMaterialFiles.KOKORO_WEB_FIXTURE_SESSION_CA_FILE,
  };
}

export async function serveWebChatCreditRuntime(environment) {
  const state = await readRuntimeState(environment);
  if (Object.keys(state.runtimeMaterialFiles).length !== REQUIRED_RUNTIME_MATERIALS.length) {
    throw new Error("WEB_FIXTURE_RUNTIME_MATERIAL_REQUIRED");
  }
  const standaloneDirectory = await prepareStandaloneCandidate(state.candidateDirectory);
  const internalPort = await availableLoopbackPort();
  const child = spawn(process.execPath, ["server.js"], {
    cwd: standaloneDirectory,
    env: await candidateEnvironment(state, internalPort),
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = new Promise((resolvePromise) => child.once("exit", resolvePromise));
  let childOutputBytes = 0;
  const drain = (chunk) => {
    childOutputBytes += chunk.length;
    if (process.env.KOKORO_COMPAT_DEBUG === "1") process.stderr.write(chunk);
    if (childOutputBytes > MAXIMUM_CHILD_OUTPUT_BYTES) child.kill("SIGTERM");
  };
  child.stdout.on("data", drain);
  child.stderr.on("data", drain);
  let proxy;
  try {
    await waitForCandidateProcess(child, internalPort, new URL(state.publicOrigin).host);
    proxy = await startStrictPublicProxy({
      candidateHost: state.candidateHost,
      publicOrigin: state.publicOrigin,
      certificateFile: state.publicTlsCertificateFile,
      privateKeyFile: state.publicTlsKeyFile,
      upstreamPort: internalPort,
    });
  } catch (error) {
    child.kill("SIGTERM");
    if (child.exitCode === null) await exited;
    throw error;
  }
  const record = Object.freeze({
    schemaVersion: 1,
    kind: "web-chat-credit-runtime-serve",
    publicOrigin: state.publicOrigin,
    publicCertificateAuthorityFile: state.publicCertificateAuthorityFile,
    readiness: "ready",
  });
  let closed = false;
  return Object.freeze({
    record,
    exited,
    async close() {
      if (closed) return;
      closed = true;
      await proxy.close();
      if (child.exitCode === null) child.kill("SIGTERM");
      if (child.exitCode === null) await exited;
    },
  });
}

function withTimeout(promise, milliseconds, code) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(code)), milliseconds);
      timer.unref();
    }),
  ]).finally(() => clearTimeout(timer));
}

function stableFixtureFailure(error, fallbackCode) {
  if (error instanceof Error && /^WEB_FIXTURE_[A-Z0-9_]{3,120}$/u.test(error.message)) {
    return error;
  }
  if (error instanceof Error && error.name === "SessionClientError") {
    if (typeof error.stableCode === "string" && /^[A-Z][A-Z0-9_]{2,63}$/u.test(error.stableCode)) {
      const source = error.stableCode === "SESSION_ACCESS_GRANT_REQUIRED"
        ? error.action === "refresh_grant"
          ? "_SESSION_UPSTREAM"
          : error.action === "reauthenticate"
            ? "_SITE_AUTH"
            : ""
        : "";
      return new Error(`${fallbackCode}_${error.stableCode}${source}`, { cause: error });
    }
    if (typeof error.kind === "string" && /^[a-z][a-z_]{1,31}$/u.test(error.kind)) {
      return new Error(`${fallbackCode}_SESSION_${error.kind.toUpperCase()}`, { cause: error });
    }
  }
  return new Error(fallbackCode, { cause: error });
}

async function fixturePhase(fallbackCode, operation) {
  try {
    return await operation();
  } catch (error) {
    throw stableFixtureFailure(error, fallbackCode);
  }
}

function fixturePhaseSync(fallbackCode, operation) {
  try {
    return operation();
  } catch (error) {
    throw stableFixtureFailure(error, fallbackCode);
  }
}

export async function exerciseWebChatCreditRuntime(environment, options = {}) {
  const state = await readRuntimeState(environment);
  if (Object.keys(state.runtimeMaterialFiles).length !== REQUIRED_RUNTIME_MATERIALS.length) {
    throw new Error("WEB_FIXTURE_RUNTIME_MATERIAL_REQUIRED");
  }
  const auth = JSON.parse(await readExactMaterial(state, "KOKORO_WEB_FIXTURE_BROWSER_AUTH_FILE"));
  const runtime = options.runtime ?? null;
  const selectedRuntime = runtime ?? await (async () => {
    const production = await createProductionJourneyRuntime({
      state,
      readExactMaterial: (name) => readExactMaterial(state, name),
    });
    return Object.freeze({
      browser: options.browser ?? production.browser,
      session: options.session ?? production.session,
    });
  })();
  const authentication = await fixturePhase(
    "WEB_FIXTURE_AUTHENTICATION_FAILED",
    () => selectedRuntime.browser.authenticate(auth),
  );
  if (!exactObject(authentication, ["generatedSiteHostResolved"]) || authentication.generatedSiteHostResolved !== true) {
    throw new Error("WEB_FIXTURE_AUTH_REJECTED");
  }
  const before = await fixturePhase(
    "WEB_FIXTURE_DASHBOARD_BEFORE_FAILED",
    async () => admitDashboard(await selectedRuntime.browser.readDashboard()),
  );
  const session = await fixturePhase(
    "WEB_FIXTURE_SESSION_CREATE_FAILED",
    () => selectedRuntime.session.create(state.projectRef),
  );
  if (
    !exactObject(session, ["sessionId", "branchId", "sessionVersion"]) ||
    typeof session.sessionId !== "string" || typeof session.branchId !== "string" ||
    !Number.isSafeInteger(session.sessionVersion) || session.sessionVersion < 1
  ) throw new Error("WEB_FIXTURE_SESSION_RECEIPT_INVALID");
  const stream = fixturePhaseSync(
    "WEB_FIXTURE_SESSION_OPEN_FAILED",
    () => selectedRuntime.session.open(session.sessionId),
  );
  let submitted;
  let terminalWait;
  try {
    terminalWait = withTimeout(stream.terminal, 120_000, "WEB_FIXTURE_SESSION_TERMINAL_TIMEOUT");
    await fixturePhase(
      "WEB_FIXTURE_SESSION_STREAM_FAILED",
      () => withTimeout(stream.ready, 30_000, "WEB_FIXTURE_SESSION_STREAM_TIMEOUT"),
    );
    submitted = await fixturePhase(
      "WEB_FIXTURE_SESSION_SUBMIT_FAILED",
      () => selectedRuntime.session.submit({
        session,
        stream,
        modelOptionRevisionRef: state.modelOptionRevisionRef,
      }),
    );
    const terminal = await fixturePhase(
      "WEB_FIXTURE_SESSION_TERMINAL_FAILED",
      () => terminalWait,
    );
    if (!exactObject(terminal, ["outcome"]) || terminal.outcome !== "completed") {
      throw new Error("WEB_FIXTURE_SESSION_TERMINAL_FAILED");
    }
  } finally {
    void terminalWait?.catch(() => undefined);
    stream.close();
  }
  const replay = await fixturePhase(
    "WEB_FIXTURE_SESSION_REPLAY_FAILED",
    () => selectedRuntime.session.replay(submitted.logicalRequest),
  );
  if (!isDeepStrictEqual(replay, submitted.receipt)) throw new Error("WEB_FIXTURE_LOGICAL_REPLAY_INVALID");
  const terminalSnapshot = await fixturePhase(
    "WEB_FIXTURE_SESSION_SNAPSHOT_FAILED",
    () => selectedRuntime.session.waitForTerminalSnapshot(session.sessionId),
  );
  if (
    !exactObject(terminalSnapshot, ["userMessageCount", "assistantTerminalCount", "costSettled"]) ||
    terminalSnapshot.userMessageCount !== 1 || terminalSnapshot.assistantTerminalCount !== 1 ||
    terminalSnapshot.costSettled !== true
  ) throw new Error("WEB_FIXTURE_SESSION_TERMINAL_INVALID");
  const after = await fixturePhase(
    "WEB_FIXTURE_DASHBOARD_AFTER_FAILED",
    async () => admitDashboard(await selectedRuntime.browser.readDashboard()),
  );
  if (
    before.totals.size !== after.totals.size ||
    [...before.totals.keys()].some((unit) => !after.totals.has(unit))
  ) throw new Error("WEB_FIXTURE_CREDIT_DELTA_INVALID");
  let availableDecreased = false;
  let consumedIncreased = false;
  let availableConsumedDeltaEqual = true;
  for (const [unit, beforeTotal] of before.totals) {
    const afterTotal = after.totals.get(unit);
    const availableDelta = beforeTotal.available - afterTotal.available;
    const consumedDelta = afterTotal.consumed - beforeTotal.consumed;
    if (availableDelta < 0n || consumedDelta < 0n) throw new Error("WEB_FIXTURE_CREDIT_DELTA_INVALID");
    availableDecreased ||= availableDelta > 0n;
    consumedIncreased ||= consumedDelta > 0n;
    availableConsumedDeltaEqual &&= availableDelta === consumedDelta;
  }
  const observation = createWebRuntimeObservation({
    generatedSiteHostResolved: true,
    browserSessionTurn: true,
    userMessageCount: terminalSnapshot.userMessageCount,
    assistantTerminalCount: terminalSnapshot.assistantTerminalCount,
    accountDashboardReadCount: 2,
    availableDecreased,
    consumedIncreased,
    availableConsumedDeltaEqual,
    internalReferenceLeakFree: before.internalReferenceLeakFree && after.internalReferenceLeakFree,
  });
  if (!availableDecreased || !consumedIncreased || !availableConsumedDeltaEqual) {
    throw new Error("WEB_FIXTURE_CREDIT_DELTA_INVALID");
  }
  await writeFile(state.observationFile, `${JSON.stringify(observation)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  return observation;
}

const OBSERVATION_FIELDS = Object.freeze([
  "generatedSiteHostResolved",
  "browserSessionTurn",
  "userMessageCount",
  "assistantTerminalCount",
  "accountDashboardReadCount",
  "availableDecreased",
  "consumedIncreased",
  "availableConsumedDeltaEqual",
  "internalReferenceLeakFree",
]);

export function createWebRuntimeObservation(input) {
  if (
    input === null || typeof input !== "object" || Array.isArray(input) ||
    Object.keys(input).length !== OBSERVATION_FIELDS.length ||
    OBSERVATION_FIELDS.some((name) => !Object.hasOwn(input, name))
  ) throw new Error("WEB_FIXTURE_OBSERVATION_INVALID");
  const booleans = OBSERVATION_FIELDS.filter((name) => !name.endsWith("Count"));
  if (booleans.some((name) => typeof input[name] !== "boolean")) {
    throw new Error("WEB_FIXTURE_OBSERVATION_INVALID");
  }
  if (
    !Number.isSafeInteger(input.userMessageCount) || input.userMessageCount < 0 || input.userMessageCount > 1 ||
    !Number.isSafeInteger(input.assistantTerminalCount) || input.assistantTerminalCount < 0 || input.assistantTerminalCount > 1 ||
    !Number.isSafeInteger(input.accountDashboardReadCount) || input.accountDashboardReadCount < 0 || input.accountDashboardReadCount > 2 ||
    (input.browserSessionTurn && (input.userMessageCount !== 1 || input.assistantTerminalCount !== 1)) ||
    ((input.availableDecreased || input.consumedIncreased || input.availableConsumedDeltaEqual) && input.accountDashboardReadCount !== 2)
  ) throw new Error("WEB_FIXTURE_OBSERVATION_INVALID");
  return Object.freeze({
    schemaVersion: 1,
    kind: "web-chat-credit-runtime-observation",
    ...Object.fromEntries(OBSERVATION_FIELDS.map((name) => [name, input[name]])),
  });
}

function parseCommand(args) {
  const normalized = args[0] === "--" ? args.slice(1) : args;
  if (
    normalized.length !== 1 ||
    !["setup", "serve", "exercise", "observe"].includes(normalized[0])
  ) {
    throw new Error("WEB_FIXTURE_COMMAND_INVALID");
  }
  return normalized[0];
}

async function observeWebChatCreditRuntime(environment) {
  const state = await readRuntimeState(environment);
  const metadata = await lstat(state.observationFile).catch(() => null);
  if (
    metadata === null || !metadata.isFile() || metadata.isSymbolicLink() ||
    metadata.size < 1 || metadata.size > 16 * 1024
  ) throw new Error("WEB_FIXTURE_OBSERVATION_UNAVAILABLE");
  let value;
  try {
    value = JSON.parse(await readFile(state.observationFile, "utf8"));
  } catch {
    throw new Error("WEB_FIXTURE_OBSERVATION_INVALID");
  }
  if (!exactObject(value, ["schemaVersion", "kind", ...OBSERVATION_FIELDS]) ||
      value.schemaVersion !== 1 || value.kind !== "web-chat-credit-runtime-observation") {
    throw new Error("WEB_FIXTURE_OBSERVATION_INVALID");
  }
  return createWebRuntimeObservation(Object.fromEntries(
    OBSERVATION_FIELDS.map((name) => [name, value[name]]),
  ));
}

export async function runWebChatCreditRuntimeFixture(args, environment = process.env) {
  const command = parseCommand(args);
  if (command === "setup") return setupWebChatCreditRuntime(environment);
  if (command === "serve") {
    const runtime = await serveWebChatCreditRuntime(environment);
    await runtime.close();
    return runtime.record;
  }
  if (command === "exercise") return exerciseWebChatCreditRuntime(environment);
  return observeWebChatCreditRuntime(environment);
}

function isMainModule() {
  return process.argv[1] !== undefined && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
}

if (isMainModule()) {
  try {
    const command = parseCommand(process.argv.slice(2));
    if (command === "serve") {
      const runtime = await serveWebChatCreditRuntime(process.env);
      process.stdout.write(`${JSON.stringify(runtime.record)}\n`);
      await Promise.race([
        runtime.exited,
        new Promise((resolvePromise) => {
          process.once("SIGINT", resolvePromise);
          process.once("SIGTERM", resolvePromise);
        }),
      ]);
      await runtime.close();
    } else {
      const result = await runWebChatCreditRuntimeFixture([command]);
      process.stdout.write(`${JSON.stringify(result)}\n`);
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "WEB_FIXTURE_FAILED"}\n`);
    process.exitCode = 1;
  }
}
