import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { constants as fileConstants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
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
import { redeemAccountInChromium } from "./web-chat-credit-runtime-browser.mjs";

export { prepareStandaloneCandidate, startStrictPublicProxy };

const execFileAsync = promisify(execFile);
const WEB_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const PNPM = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const MAXIMUM_CHILD_OUTPUT_BYTES = 16 * 1024 * 1024;
const MAXIMUM_TEXT_LENGTH = 4_096;
const SHA256 = /^[0-9a-f]{64}$/u;
const HOSTNAME = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/u;
const REDEMPTION_CODE =
  /KC1-[0-9A-HJKMNP-TV-Z]{8}-[0-9A-HJKMNP-TV-Z]{10}-[0-9A-HJKMNP-TV-Z]{32}-[0-9A-HJKMNP-TV-Z]{8}/u;
const REDEMPTION_CODE_LENGTH = 65;
const LOGICAL_REPLAY_IDENTITY_FIELDS = Object.freeze([
  "operation",
  "command_id",
  "idempotency_key",
  "digest_algorithm",
  "request_digest",
]);
const OWNER_TIMESTAMP =
  /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)\.\d{3}Z$/u;

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
  "KOKORO_WEB_FIXTURE_REDEMPTION_CODE_FILE",
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

function ownerTimestamp(value) {
  if (typeof value !== "string") return null;
  const match = OWNER_TIMESTAMP.exec(value);
  if (match === null) return null;
  const [, year, month, day, hour, minute, second] = match;
  const calendar = new Date(0);
  calendar.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
  calendar.setUTCHours(Number(hour), Number(minute), Number(second), 0);
  if (
    calendar.getUTCFullYear() !== Number(year) || calendar.getUTCMonth() !== Number(month) - 1 ||
    calendar.getUTCDate() !== Number(day) || calendar.getUTCHours() !== Number(hour) ||
    calendar.getUTCMinutes() !== Number(minute) || calendar.getUTCSeconds() !== Number(second)
  ) return null;
  const instant = Date.parse(value);
  return Number.isFinite(instant) ? instant : null;
}

export function validateLogicalReplay(logicalRequest, initialResponse, replayResponse) {
  const submittedCommand = logicalRequest?.body?.command;
  const initial = initialResponse?.command_receipt;
  const replay = replayResponse?.command_receipt;
  const initialUpdatedAt = ownerTimestamp(initial?.updated_at);
  const replayUpdatedAt = ownerTimestamp(replay?.updated_at);
  const submittedIdentity = submittedCommand !== null && typeof submittedCommand === "object" &&
      !Array.isArray(submittedCommand)
    ? { ...submittedCommand, operation: "submit_message" }
    : null;
  const matchesSubmittedIdentity = (receipt) => submittedIdentity !== null &&
    LOGICAL_REPLAY_IDENTITY_FIELDS.every((field) => isDeepStrictEqual(receipt?.[field], submittedIdentity[field]));
  if (
    initial === null || typeof initial !== "object" || replay === null || typeof replay !== "object" ||
    !matchesSubmittedIdentity(initial) || !matchesSubmittedIdentity(replay) ||
    !isDeepStrictEqual(initial.payload, replay.payload) ||
    (initial.status !== "accepted" && initial.status !== "applied") || replay.status !== "applied" ||
    initialUpdatedAt === null || replayUpdatedAt === null ||
    (initial.status === "accepted" ? replayUpdatedAt < initialUpdatedAt : replay.updated_at !== initial.updated_at)
  ) throw new Error("WEB_FIXTURE_LOGICAL_REPLAY_INVALID");
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
  if (name === "KOKORO_WEB_FIXTURE_REDEMPTION_CODE_FILE") {
    if (contents.length !== REDEMPTION_CODE_LENGTH || !REDEMPTION_CODE.test(contents)) {
      throw new Error("WEB_FIXTURE_REDEMPTION_CODE_INVALID");
    }
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
    if (name === "KOKORO_WEB_FIXTURE_REDEMPTION_CODE_FILE" && (metadata.mode & 0o777) !== 0o600) {
      throw new Error("WEB_FIXTURE_REDEMPTION_CODE_FILE_INVALID");
    }
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
  const lifecycleEvidenceFile = join(root, "lifecycle-evidence.json");
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
    lifecycleEvidenceFile,
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
      "publicTlsCertificateFile", "publicTlsKeyFile", "observationFile", "lifecycleEvidenceFile",
    ]) || value.schemaVersion !== 1 || value.kind !== "web-chat-credit-runtime-state"
  ) throw new Error("WEB_FIXTURE_RUNTIME_STATE_INVALID");
  return Object.freeze(value);
}

async function readExactMaterial(state, name) {
  const path = state.runtimeMaterialFiles[name];
  if (typeof path !== "string") throw new Error("WEB_FIXTURE_RUNTIME_STATE_INVALID");
  return readFile(path, "utf8");
}

function exactPrivateFile(metadata) {
  return metadata.isFile() && !metadata.isSymbolicLink() &&
    metadata.size >= 1n && metadata.size <= 1024n * 1024n &&
    (metadata.mode & 0o777n) === 0o600n;
}

function samePrivateFile(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size &&
    left.mode === right.mode && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}

async function readRedemptionCode(state) {
  const path = state.runtimeMaterialFiles.KOKORO_WEB_FIXTURE_REDEMPTION_CODE_FILE;
  if (typeof path !== "string" || !isAbsolute(path) || path.length > MAXIMUM_TEXT_LENGTH) {
    throw new Error("WEB_FIXTURE_REDEMPTION_CODE_FILE_INVALID");
  }
  let handle;
  try {
    const pathBefore = await lstat(path, { bigint: true });
    if (!exactPrivateFile(pathBefore)) throw new Error("WEB_FIXTURE_REDEMPTION_CODE_FILE_INVALID");
    handle = await open(path, fileConstants.O_RDONLY | fileConstants.O_NOFOLLOW);
    const openedBefore = await handle.stat({ bigint: true });
    if (!exactPrivateFile(openedBefore) || !samePrivateFile(pathBefore, openedBefore)) {
      throw new Error("WEB_FIXTURE_REDEMPTION_CODE_FILE_INVALID");
    }
    const contents = await handle.readFile("utf8");
    const [openedAfter, pathAfter] = await Promise.all([
      handle.stat({ bigint: true }),
      lstat(path, { bigint: true }),
    ]);
    if (
      !exactPrivateFile(openedAfter) || !exactPrivateFile(pathAfter) ||
      !samePrivateFile(openedBefore, openedAfter) || !samePrivateFile(openedAfter, pathAfter)
    ) throw new Error("WEB_FIXTURE_REDEMPTION_CODE_FILE_INVALID");
    validateRuntimeMaterial("KOKORO_WEB_FIXTURE_REDEMPTION_CODE_FILE", contents);
    return contents;
  } catch (error) {
    if (error instanceof Error && error.message === "WEB_FIXTURE_REDEMPTION_CODE_INVALID") throw error;
    throw new Error("WEB_FIXTURE_REDEMPTION_CODE_FILE_INVALID", { cause: error });
  } finally {
    await handle?.close().catch(() => undefined);
  }
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
  const childClosed = new Promise((resolvePromise) => child.once("close", (code, signal) => {
    resolvePromise(Object.freeze({ code, signal }));
  }));
  let childOutputBytes = 0;
  let childOutputOverflow = false;
  const logScanners = new Map();
  const drain = (streamName, chunk) => {
    childOutputBytes += chunk.length;
    const previous = logScanners.get(streamName) ?? "";
    const combined = `${previous}${Buffer.from(chunk).toString("latin1")}`;
    logScanners.set(streamName, combined.slice(-(REDEMPTION_CODE_LENGTH - 1)));
    if (REDEMPTION_CODE.test(combined)) logScanners.set("redemption-code-found", "1");
    if (childOutputBytes > MAXIMUM_CHILD_OUTPUT_BYTES) {
      childOutputOverflow = true;
      child.kill("SIGTERM");
    }
  };
  child.stdout.on("data", (chunk) => drain("stdout", chunk));
  child.stderr.on("data", (chunk) => drain("stderr", chunk));
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
    await childClosed;
    throw error;
  }
  const record = Object.freeze({
    schemaVersion: 1,
    kind: "web-chat-credit-runtime-serve",
    publicOrigin: state.publicOrigin,
    publicCertificateAuthorityFile: state.publicCertificateAuthorityFile,
    readiness: "ready",
  });
  let closePromise;
  return Object.freeze({
    record,
    exited,
    async close() {
      if (closePromise !== undefined) return closePromise;
      closePromise = (async () => {
        let closeError;
        try {
          await proxy.close();
        } catch (error) {
          closeError = error;
        }
        const terminationRequested = child.exitCode === null && child.signalCode === null;
        if (terminationRequested) child.kill("SIGTERM");
        const termination = await childClosed;
        if (
          closeError === undefined &&
          !(
            termination.code === 0 ||
            (terminationRequested && termination.code === 143 && termination.signal === null) ||
            (terminationRequested && termination.code === null && termination.signal === "SIGTERM")
          )
        ) closeError = new Error("WEB_FIXTURE_CANDIDATE_EXIT_INVALID");
        if (childOutputOverflow && closeError === undefined) {
          closeError = new Error("WEB_FIXTURE_CHILD_OUTPUT_LIMIT_EXCEEDED");
        }
        if (closeError !== undefined) throw closeError;
        await writeFile(state.lifecycleEvidenceFile, `${JSON.stringify({
          schemaVersion: 1,
          kind: "web-chat-credit-runtime-lifecycle-evidence",
          serverLogLeakFree: logScanners.get("redemption-code-found") !== "1",
          webRuntimeClosed: true,
        })}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
      })();
      return closePromise;
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

const SESSION_MUTATION_FAILURE_PHASES = new Set([
  "WEB_FIXTURE_SESSION_CREATE_FAILED",
  "WEB_FIXTURE_SESSION_SUBMIT_FAILED",
  "WEB_FIXTURE_SESSION_REPLAY_FAILED",
]);
const SITE_SESSION_FAILURE_PHASES = new Set([
  "auth_session_read",
  "runtime_assembly",
  "grant_authority",
  "grant_validation",
  "upstream_transport",
  "upstream_contract",
  "proxy_internal",
]);

function stableSessionFailureSource(error, fallbackCode) {
  if (error.stableCode === "SESSION_ACCESS_GRANT_REQUIRED") {
    if (error.action === "refresh_grant") return "_SESSION_UPSTREAM";
    if (error.action === "reauthenticate") return "_SITE_AUTH";
  }
  if (error.stableCode === "INTERNAL_UNAVAILABLE" && SESSION_MUTATION_FAILURE_PHASES.has(fallbackCode)) {
    if (SITE_SESSION_FAILURE_PHASES.has(error.failurePhase)) {
      return `_SITE_BFF_${error.failurePhase.toUpperCase()}`;
    }
    if (error.action === "retry_same_cursor" && error.retryClass === "after_delay") {
      return "_SESSION_UPSTREAM";
    }
    if (error.action === "reconcile_receipt" && error.retryClass === "reconcile_receipt") {
      return "_SESSION_UPSTREAM";
    }
  }
  return "";
}

function stableFixtureFailure(error, fallbackCode) {
  if (error instanceof Error && /^WEB_FIXTURE_[A-Z0-9_]{3,120}$/u.test(error.message)) {
    return error;
  }
  if (error instanceof Error && error.name === "SessionClientError") {
    if (typeof error.stableCode === "string" && /^[A-Z][A-Z0-9_]{2,63}$/u.test(error.stableCode)) {
      return new Error(
        `${fallbackCode}_${error.stableCode}${stableSessionFailureSource(error, fallbackCode)}`,
        { cause: error },
      );
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
  validateLogicalReplay(submitted.logicalRequest, submitted.receipt, replay);
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
  const rawCode = await readRedemptionCode(state);
  const redemptionBrowser = options.redemptionBrowser ?? Object.freeze({ redeem: redeemAccountInChromium });
  const redemptionInput = Object.freeze({
    publicOrigin: state.publicOrigin,
    candidateHost: state.candidateHost,
    publicCertificateAuthorityFile: state.publicCertificateAuthorityFile,
    publicTlsCertificateFile: state.publicTlsCertificateFile,
    auth,
    rawCode,
  });
  const redemption = admitRedemptionEvidence(await fixturePhase(
    "WEB_FIXTURE_BROWSER_REDEMPTION_FAILED",
    () => redemptionBrowser.redeem(redemptionInput),
  ));
  const journeyEvidence = createWebRuntimeJourneyEvidence({
    generatedSiteHostResolved: true,
    browserSessionTurn: true,
    userMessageCount: terminalSnapshot.userMessageCount,
    assistantTerminalCount: terminalSnapshot.assistantTerminalCount,
    accountDashboardReadCount: 2,
    availableDecreased,
    consumedIncreased,
    availableConsumedDeltaEqual,
    internalReferenceLeakFree: before.internalReferenceLeakFree && after.internalReferenceLeakFree,
    ...redemption,
  });
  if (!availableDecreased || !consumedIncreased || !availableConsumedDeltaEqual) {
    throw new Error("WEB_FIXTURE_CREDIT_DELTA_INVALID");
  }
  await writeFile(state.observationFile, `${JSON.stringify(journeyEvidence)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  return Object.freeze({
    schemaVersion: 1,
    kind: "web-chat-credit-runtime-exercised",
    browserJourneyClosed: true,
  });
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
  "accountRedemptionPage",
  "redemptionPreviewed",
  "redemptionConfirmed",
  "redemptionBalanceIncreased",
  "redemptionProductVisible",
  "redemptionSameFlowReplay",
  "redemptionRecoveryContinuedViaUi",
  "redemptionSecretLeakFree",
  "browserMutationAuthorityEnforced",
  "browserTlsAuthorityPinned",
  "browserProfileRemoved",
  "redemptionDashboardReadCount",
  "redemptionExecuteRequestCount",
  "redemptionRecoveryRequestCount",
  "browserConsoleCount",
  "browserPageErrorCount",
  "serverLogLeakFree",
  "webRuntimeClosed",
]);

const REDEMPTION_EVIDENCE_FIELDS = Object.freeze([
  "accountRedemptionPage",
  "redemptionPreviewed",
  "redemptionConfirmed",
  "redemptionBalanceIncreased",
  "redemptionProductVisible",
  "redemptionSameFlowReplay",
  "redemptionRecoveryContinuedViaUi",
  "redemptionSecretLeakFree",
  "browserMutationAuthorityEnforced",
  "browserTlsAuthorityPinned",
  "browserProfileRemoved",
  "redemptionDashboardReadCount",
  "redemptionExecuteRequestCount",
  "redemptionRecoveryRequestCount",
  "browserConsoleCount",
  "browserPageErrorCount",
]);

const LIFECYCLE_EVIDENCE_FIELDS = Object.freeze([
  "serverLogLeakFree",
  "webRuntimeClosed",
]);

const JOURNEY_EVIDENCE_FIELDS = Object.freeze(
  OBSERVATION_FIELDS.filter((name) => !LIFECYCLE_EVIDENCE_FIELDS.includes(name)),
);

function admitRedemptionEvidence(input) {
  if (
    !exactObject(input, REDEMPTION_EVIDENCE_FIELDS) ||
    REDEMPTION_EVIDENCE_FIELDS.filter((name) => !name.endsWith("Count"))
      .some((name) => input[name] !== true) ||
    input.redemptionDashboardReadCount !== 3 || input.redemptionExecuteRequestCount !== 2 ||
    input.redemptionRecoveryRequestCount !== 1 ||
    input.browserConsoleCount !== 0 || input.browserPageErrorCount !== 0
  ) throw new Error("WEB_FIXTURE_BROWSER_REDEMPTION_EVIDENCE_INVALID");
  return Object.freeze(Object.fromEntries(REDEMPTION_EVIDENCE_FIELDS.map(
    (name) => [name, input[name]],
  )));
}

function assertJourneyEvidence(input) {
  if (
    input === null || typeof input !== "object" || Array.isArray(input) ||
    Object.keys(input).length !== JOURNEY_EVIDENCE_FIELDS.length ||
    JOURNEY_EVIDENCE_FIELDS.some((name) => !Object.hasOwn(input, name))
  ) throw new Error("WEB_FIXTURE_OBSERVATION_INVALID");
  const booleans = JOURNEY_EVIDENCE_FIELDS.filter((name) => !name.endsWith("Count"));
  if (booleans.some((name) => typeof input[name] !== "boolean")) {
    throw new Error("WEB_FIXTURE_OBSERVATION_INVALID");
  }
  if (
    !Number.isSafeInteger(input.userMessageCount) || input.userMessageCount < 0 || input.userMessageCount > 1 ||
    !Number.isSafeInteger(input.assistantTerminalCount) || input.assistantTerminalCount < 0 || input.assistantTerminalCount > 1 ||
    !Number.isSafeInteger(input.accountDashboardReadCount) || input.accountDashboardReadCount < 0 || input.accountDashboardReadCount > 2 ||
    !Number.isSafeInteger(input.redemptionDashboardReadCount) || input.redemptionDashboardReadCount < 0 || input.redemptionDashboardReadCount > 3 ||
    !Number.isSafeInteger(input.redemptionExecuteRequestCount) || input.redemptionExecuteRequestCount < 0 || input.redemptionExecuteRequestCount > 2 ||
    !Number.isSafeInteger(input.redemptionRecoveryRequestCount) || input.redemptionRecoveryRequestCount < 0 || input.redemptionRecoveryRequestCount > 1 ||
    !Number.isSafeInteger(input.browserConsoleCount) || input.browserConsoleCount < 0 || input.browserConsoleCount > 1_000_000 ||
    !Number.isSafeInteger(input.browserPageErrorCount) || input.browserPageErrorCount < 0 || input.browserPageErrorCount > 1_000_000 ||
    (input.browserSessionTurn && (input.userMessageCount !== 1 || input.assistantTerminalCount !== 1)) ||
    ((input.availableDecreased || input.consumedIncreased || input.availableConsumedDeltaEqual) && input.accountDashboardReadCount !== 2) ||
    ((input.accountRedemptionPage || input.redemptionPreviewed || input.redemptionConfirmed ||
      input.redemptionBalanceIncreased || input.redemptionProductVisible ||
      input.redemptionSameFlowReplay) &&
      (input.redemptionDashboardReadCount !== 3 || input.redemptionExecuteRequestCount !== 2 ||
        input.redemptionRecoveryRequestCount !== 1 ||
        input.browserConsoleCount !== 0 || input.browserPageErrorCount !== 0))
  ) throw new Error("WEB_FIXTURE_OBSERVATION_INVALID");
}

function createWebRuntimeJourneyEvidence(input) {
  assertJourneyEvidence(input);
  return Object.freeze({
    schemaVersion: 1,
    kind: "web-chat-credit-runtime-journey-evidence",
    ...Object.fromEntries(JOURNEY_EVIDENCE_FIELDS.map((name) => [name, input[name]])),
  });
}

export function createWebRuntimeObservation(input) {
  if (
    input === null || typeof input !== "object" || Array.isArray(input) ||
    Object.keys(input).length !== OBSERVATION_FIELDS.length ||
    OBSERVATION_FIELDS.some((name) => !Object.hasOwn(input, name)) ||
    input.serverLogLeakFree !== true || input.webRuntimeClosed !== true
  ) throw new Error("WEB_FIXTURE_OBSERVATION_INVALID");
  assertJourneyEvidence(Object.fromEntries(
    JOURNEY_EVIDENCE_FIELDS.map((name) => [name, input[name]]),
  ));
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
  const files = [state.observationFile, state.lifecycleEvidenceFile];
  const metadata = await Promise.all(files.map((path) => lstat(path).catch(() => null)));
  if (metadata.some((value) =>
    value === null || !value.isFile() || value.isSymbolicLink() ||
    value.size < 1 || value.size > 16 * 1024
  )) throw new Error("WEB_FIXTURE_OBSERVATION_UNAVAILABLE");
  let journey;
  let lifecycle;
  try {
    [journey, lifecycle] = await Promise.all(files.map(async (path) => JSON.parse(await readFile(path, "utf8"))));
  } catch {
    throw new Error("WEB_FIXTURE_OBSERVATION_INVALID");
  }
  if (
    !exactObject(journey, ["schemaVersion", "kind", ...JOURNEY_EVIDENCE_FIELDS]) ||
    journey.schemaVersion !== 1 || journey.kind !== "web-chat-credit-runtime-journey-evidence" ||
    !exactObject(lifecycle, ["schemaVersion", "kind", ...LIFECYCLE_EVIDENCE_FIELDS]) ||
    lifecycle.schemaVersion !== 1 || lifecycle.kind !== "web-chat-credit-runtime-lifecycle-evidence"
  ) {
    throw new Error("WEB_FIXTURE_OBSERVATION_INVALID");
  }
  return createWebRuntimeObservation({
    ...Object.fromEntries(JOURNEY_EVIDENCE_FIELDS.map((name) => [name, journey[name]])),
    ...Object.fromEntries(LIFECYCLE_EVIDENCE_FIELDS.map((name) => [name, lifecycle[name]])),
  });
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
