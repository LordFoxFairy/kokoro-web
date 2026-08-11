#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { constants, openSync, closeSync, fsyncSync } from "node:fs";
import { lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const webRoot = resolve(import.meta.dirname, "..");
const SHA256 = /^[0-9a-f]{64}$/u;
const IMAGE = /^(?<repository>[a-z0-9][a-z0-9._/-]*[a-z0-9])(?::(?<tag>[A-Za-z0-9][A-Za-z0-9._-]{0,127}))$/u;
const HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u;
const PACKAGE = /^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/u;
const SITE_KEY = /^[a-z][a-z0-9-]{1,62}$/u;
const RELEASE = /^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/u;
const REQUIRED_ROUTES = new Set([
  "/", "/account", "/login", "/api/account/[action]", "/api/auth/[...nextauth]", "/api/health/live", "/api/health/ready", "/api/session/[...path]",
]);
const FORBIDDEN_ROUTE_PREFIXES = ["/studio", "/library", "/memory", "/payment", "/api/media", "/api/assets", "/api/memory", "/api/payment"];

function record(value, field = "value") {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${field} must be an object`);
  return value;
}
function exactKeys(value, keys, field) {
  const actual = Object.keys(record(value, field)).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new TypeError(`${field} has unknown or missing fields`);
}
function text(value, field, pattern = undefined) {
  if (typeof value !== "string" || value.trim() === "" || value !== value.trim() || (pattern !== undefined && !pattern.test(value))) throw new TypeError(`${field} is invalid`);
  return value;
}
function sha(value, field) { return text(value, field, SHA256); }
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function digest(value) { return createHash("sha256").update(value).digest("hex"); }
function ensureNoProfileFields(value) {
  for (const key of ["provider", "media", "memory", "payment", "products", "enabledProductIds", "sites"]) {
    if (Object.hasOwn(value, key)) throw new TypeError(`core definition forbids ${key}`);
  }
}

/** Parse the fixed, single-Site release definition. */
export function parseCoreSiteDefinition(bytes) {
  let raw;
  try { raw = JSON.parse(Buffer.isBuffer(bytes) ? bytes.toString("utf8") : bytes); } catch { throw new TypeError("core definition must be JSON"); }
  exactKeys(raw, ["schemaVersion", "site", "release", "domain", "deployment", "contractFloor", "packages"], "definition");
  ensureNoProfileFields(raw);
  if (raw.schemaVersion !== 1) throw new TypeError("definition.schemaVersion must be 1");
  exactKeys(raw.site, ["siteKey", "packageName", "displayName"], "site");
  exactKeys(raw.release, ["releaseId", "profileRevision"], "release");
  exactKeys(raw.domain, ["hostname", "environment"], "domain");
  exactKeys(raw.deployment, ["provider", "projectRef", "region"], "deployment");
  exactKeys(raw.contractFloor, ["contract", "version", "schemaSha256", "signature", "signingKeyId"], "contractFloor");
  const site = Object.freeze({
    siteKey: text(raw.site.siteKey, "site.siteKey", SITE_KEY),
    packageName: text(raw.site.packageName, "site.packageName", PACKAGE),
    displayName: text(raw.site.displayName, "site.displayName"),
  });
  const release = Object.freeze({ releaseId: text(raw.release.releaseId, "release.releaseId", RELEASE), profileRevision: text(raw.release.profileRevision, "release.profileRevision", RELEASE) });
  const hostname = text(raw.domain.hostname, "domain.hostname").toLowerCase();
  if (!HOSTNAME.test(hostname) || hostname === "localhost") throw new TypeError("domain.hostname must be a production DNS hostname");
  if (raw.domain.environment !== "production") throw new TypeError("core domain must be production");
  const deployment = Object.freeze({
    provider: text(raw.deployment.provider, "deployment.provider", /^(?:container-registry|oci)$/u),
    projectRef: text(raw.deployment.projectRef, "deployment.projectRef", /^[A-Za-z0-9][A-Za-z0-9._/-]{1,127}$/u),
    region: text(raw.deployment.region, "deployment.region", /^[a-z][a-z0-9-]{1,62}$/u),
  });
  const contractFloor = Object.freeze({
    contract: raw.contractFloor.contract === "platform-public-v1" ? raw.contractFloor.contract : (() => { throw new TypeError("contractFloor.contract is invalid"); })(),
    version: raw.contractFloor.version === "1" ? raw.contractFloor.version : (() => { throw new TypeError("contractFloor.version is invalid"); })(),
    schemaSha256: sha(raw.contractFloor.schemaSha256, "contractFloor.schemaSha256"),
    signature: text(raw.contractFloor.signature, "contractFloor.signature", /^[A-Za-z0-9_-]{43,128}$/u),
    signingKeyId: text(raw.contractFloor.signingKeyId, "contractFloor.signingKeyId", /^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/u),
  });
  if (!Array.isArray(raw.packages) || raw.packages.length === 0) throw new TypeError("packages must be a non-empty array");
  const packageNames = new Set();
  const packages = raw.packages.map((entry, index) => {
    exactKeys(entry, ["name", "version", "archivePath", "sha256"], `packages[${index}]`);
    const name = text(entry.name, `packages[${index}].name`, PACKAGE);
    if (packageNames.has(name)) throw new TypeError(`duplicate package ${name}`);
    packageNames.add(name);
    return Object.freeze({ name, version: text(entry.version, `packages[${index}].version`), archivePath: text(entry.archivePath, `packages[${index}].archivePath`), sha256: sha(entry.sha256, `packages[${index}].sha256`) });
  }).sort((left, right) => left.name.localeCompare(right.name));
  return Object.freeze({ schemaVersion: 1, site, release, domain: Object.freeze({ hostname, environment: "production" }), deployment, contractFloor, packages: Object.freeze(packages) });
}

/** Return the canonical, archive-location-independent source closure and digest. */
export function coreSiteSourceClosure(input) {
  const definition = typeof input === "string" || Buffer.isBuffer(input) ? parseCoreSiteDefinition(input) : input;
  const closure = {
    schemaVersion: definition.schemaVersion,
    site: definition.site,
    release: definition.release,
    domain: definition.domain,
    deployment: definition.deployment,
    contractFloor: definition.contractFloor,
    packages: [...definition.packages].map(({ name, version, sha256: packageSha256 }) => ({ name, version, sha256: packageSha256 })).sort((left, right) => left.name.localeCompare(right.name)),
  };
  const canonical = canonicalJson(closure);
  return Object.freeze({ canonical, sha256: digest(canonical) });
}

function routeName(value) { return value.replace(/\/route$/u, "").replace(/\/page$/u, "") || "/"; }
function routesFromManifest(manifest) {
  const routes = new Set();
  for (const [appPath, route] of Object.entries(record(manifest, "route manifest"))) {
    if (typeof route === "string" && route.startsWith("/")) routes.add(route);
    else if (typeof appPath === "string" && appPath.startsWith("/")) routes.add(routeName(appPath));
  }
  return routes;
}
/** Validate built Next manifests, never template source, against the fixed core route closure. */
export function assertCoreSiteRoutes(manifests) {
  exactKeys(manifests, ["appPaths", "appPathRoutes", "middleware"], "manifests");
  record(manifests.middleware, "middleware");
  const routes = new Set([...routesFromManifest(manifests.appPaths), ...routesFromManifest(manifests.appPathRoutes)]);
  for (const route of REQUIRED_ROUTES) if (!routes.has(route)) throw new Error(`required core route missing: ${route}`);
  for (const route of routes) {
    const forbidden = FORBIDDEN_ROUTE_PREFIXES.find((prefix) => route === prefix || route.startsWith(`${prefix}/`));
    if (forbidden !== undefined) throw new Error(`forbidden core route: ${route}`);
  }
  return [...routes].sort();
}

/** Bind a mutable Buildx tag to the sole immutable digest metadata key. */
export function exactImageReference(tag, metadata) {
  const image = text(tag, "image", IMAGE);
  const match = IMAGE.exec(image);
  if (!match?.groups?.repository.includes("/")) throw new TypeError("image must name a registry/repository");
  if (match?.groups?.tag === "latest") throw new TypeError("image tag must not be latest");
  const rawDigest = record(metadata, "Buildx metadata")["containerimage.digest"];
  if (typeof rawDigest !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(rawDigest)) throw new TypeError("Buildx metadata has no exact containerimage.digest");
  return `${match.groups.repository}@${rawDigest}`;
}

async function defaultRun(command, args, cwd, env = {}) {
  await execFileAsync(command, args, { cwd, env: { ...process.env, CI: "1", NEXT_TELEMETRY_DISABLED: "1", ...env }, maxBuffer: 16 * 1024 * 1024 });
}
async function defaultCreateSiteProject(input) {
  const module = await import(pathToFileURL(resolve(webRoot, "packages/site-scaffold/dist/scaffold.js")));
  return module.createSiteProject(input);
}
async function exists(path) { try { await lstat(path); return true; } catch (error) { if (error?.code === "ENOENT") return false; throw error; } }

/** Create and verify a fixed core Site in an OS temporary directory. */
export async function assembleCoreSite(input) {
  const definition = input.definition;
  const sourceClosure = coreSiteSourceClosure(definition);
  const createSiteProject = input.createSiteProject ?? defaultCreateSiteProject;
  const directory = resolve(input.directory);
  if (await exists(directory)) throw new Error(`core Site target already exists: ${directory}`);
  try {
    await createSiteProject({
      directory,
      packageName: definition.site.packageName,
      siteKey: definition.site.siteKey,
      displayName: definition.site.displayName,
      releaseId: definition.release.releaseId,
      artifactSha256: sourceClosure.sha256,
      profileRevision: definition.release.profileRevision,
      domains: [definition.domain],
      deployment: definition.deployment,
      contractFloor: definition.contractFloor,
      enabledProductIds: [],
      packages: definition.packages,
    });
    for (const relative of ["src/app/studio/page.tsx", "src/app/library/page.tsx", "src/app/api/media/[[...path]]/route.ts", "src/app/api/assets/[[...path]]/route.ts"]) {
      await rm(join(directory, relative), { force: true });
    }
    const chatPage = join(directory, "src/app/page.tsx");
    const chatPageSource = await readFile(chatPage, "utf8");
    if (!chatPageSource.includes("<ChatProduct")) throw new Error("generated core Site has no ChatProduct composition");
    await writeFile(chatPage, chatPageSource.replace("<ChatProduct\n", "<ChatProduct\n      attachmentsEnabled={false}\n"), "utf8");
    const verification = input.verify ?? verifyCoreSiteDirectory;
    const verified = await verification(directory, input.contractKeyringPath);
    return Object.freeze({ directory, sourceClosureSha256: sourceClosure.sha256, ...(verified ?? {}) });
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

async function verifyCoreSiteDirectory(directory, contractKeyringPath) {
  const keyring = contractKeyringPath === undefined ? undefined : await readFile(contractKeyringPath, "utf8");
  const run = defaultRun;
  const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  await run(pnpm, ["install", "--offline"], directory);
  await run(pnpm, ["artifact:verify"], directory, keyring === undefined ? {} : { KOKORO_CONTRACT_KEYRING_JSON: keyring });
  await run(pnpm, ["typecheck"], directory);
  await run(pnpm, ["test"], directory);
  await run(pnpm, ["build"], directory);
  const [appPaths, appPathRoutes, middleware] = await Promise.all([
    readFile(join(directory, ".next/server/app-paths-manifest.json"), "utf8").then(JSON.parse),
    readFile(join(directory, ".next/app-path-routes-manifest.json"), "utf8").then(JSON.parse),
    readFile(join(directory, ".next/server/middleware-manifest.json"), "utf8").then(JSON.parse),
  ]);
  const routes = assertCoreSiteRoutes({ appPaths, appPathRoutes, middleware });
  return { routes, lockSha256: digest(await readFile(join(directory, "pnpm-lock.yaml"))) };
}

function syncDirectory(directory) { const descriptor = openSync(directory, constants.O_RDONLY); try { fsyncSync(descriptor); } finally { closeSync(descriptor); } }
async function writeAtomicReport(path, body) {
  if (await exists(path)) throw new Error(`refusing to overwrite existing report: ${path}`);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.${Date.now()}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(body, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    const descriptor = openSync(temporary, constants.O_RDONLY); try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
    await rename(temporary, path);
    syncDirectory(dirname(path));
  } catch (error) { await rm(temporary, { force: true }); throw error; }
}

/** Buildx-push a prepared directory and write a no-overwrite 0600 report only after a digest exists. */
export async function publishCoreSite(input) {
  if (await exists(input.report)) throw new Error(`refusing to overwrite existing report: ${input.report}`);
  const metadataFile = join(input.directory, `.kokoro-buildx-${process.pid}-${Date.now()}.json`);
  try {
    const run = input.run ?? ((command, args) => defaultRun(command, args, input.directory));
    await run("docker", ["buildx", "build", "--push", "--platform", input.platform, "--metadata-file", metadataFile, "--tag", input.image, input.directory]);
    const image = exactImageReference(input.image, JSON.parse(await readFile(metadataFile, "utf8")));
    await writeAtomicReport(input.report, { ...input.reportBody, image });
    return Object.freeze({ image });
  } finally { await rm(metadataFile, { force: true }); }
}

function argumentsFor(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--push") { values.set(key, true); continue; }
    if (!key.startsWith("--") || values.has(key) || index + 1 === argv.length || argv[index + 1].startsWith("--")) throw new TypeError("invalid release arguments");
    values.set(key, argv[++index]);
  }
  for (const required of ["--definition", "--contract-keyring", "--image", "--platform", "--report"]) if (!values.has(required)) throw new TypeError(`${required} is required`);
  if (values.get("--push") !== true) throw new TypeError("--push is required for immutable OCI publication");
  return values;
}
async function gitCommit() {
  const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: webRoot });
  return stdout.trim();
}
async function main() {
  const args = argumentsFor(process.argv.slice(2));
  const definition = parseCoreSiteDefinition(await readFile(resolve(process.cwd(), args.get("--definition"))));
  const contractKeyringPath = resolve(process.cwd(), args.get("--contract-keyring"));
  await readFile(contractKeyringPath);
  const temporary = await mkdtemp(join(tmpdir(), "kokoro-core-site-"));
  try {
    const assembled = await assembleCoreSite({ definition, directory: join(temporary, definition.site.siteKey), contractKeyringPath });
    await publishCoreSite({
      directory: assembled.directory, image: args.get("--image"), platform: args.get("--platform"), report: resolve(process.cwd(), args.get("--report")),
      reportBody: { schemaVersion: 1, siteKey: definition.site.siteKey, releaseId: definition.release.releaseId, webCommit: await gitCommit(), sourceClosureSha256: assembled.sourceClosureSha256, lockSha256: assembled.lockSha256, routes: assembled.routes },
    });
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
