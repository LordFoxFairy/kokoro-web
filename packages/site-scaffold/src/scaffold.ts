import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import type { SiteContractFloor, SiteDomainBinding } from "@kokoro/site-app-kit";
import { list as listTar } from "tar";

const TEMPLATE_ROOT = fileURLToPath(new URL("../templates/site/", import.meta.url));
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const PACKAGE_PATTERN = /^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/u;
const SITE_KEY_PATTERN = /^[a-z][a-z0-9-]{1,62}$/u;

export interface ImmutablePackageArtifact {
  readonly name:
    | "@kokoro/site-app-kit"
    | "@kokoro/site-client"
    | "@kokoro/session-client"
    | "@kokoro/bff-runtime"
    | "@kokoro/site-runtime-node"
    | "@kokoro/chat-surface"
    | "@kokoro/chat-app"
    | "@kokoro/site-bff"
    | "@kokoro/account-app";
  readonly version: string;
  readonly archivePath: string;
  readonly sha256: string;
}

export interface SiteDeploymentTarget {
  readonly provider: string;
  readonly projectRef: string;
  readonly region: string;
}

export interface CreateSiteProjectInput {
  readonly directory: string;
  readonly packageName: string;
  readonly siteKey: string;
  readonly displayName: string;
  readonly releaseId: string;
  readonly artifactSha256: string;
  readonly profileRevision: string;
  readonly domains: readonly SiteDomainBinding[];
  readonly deployment: SiteDeploymentTarget;
  readonly contractFloor: SiteContractFloor;
  readonly packages: readonly [
    ImmutablePackageArtifact,
    ImmutablePackageArtifact,
    ImmutablePackageArtifact,
    ImmutablePackageArtifact,
    ImmutablePackageArtifact,
    ImmutablePackageArtifact,
    ImmutablePackageArtifact,
    ImmutablePackageArtifact,
    ImmutablePackageArtifact,
  ];
}

export interface CreatedSiteProject {
  readonly directory: string;
  readonly packageName: string;
  readonly siteKey: string;
  readonly releaseId: string;
  readonly packageArtifacts: Readonly<Record<string, string>>;
  readonly generatedFiles: readonly string[];
}

const FORBIDDEN_RUNTIME_COUPLING = [
  /(?:request|req)\.headers(?:\.host|\.get\(\s*["'](?:host|x-forwarded-host)["']\s*\)|\[\s*["'](?:host|x-forwarded-host)["']\s*\])/iu,
  /\bheaders\(\)\s*(?:\.get\(\s*["'](?:host|x-forwarded-host)["']\s*\)|\.host)/iu,
  /new URL\([^)]*\)\.(?:host|hostname)/iu,
  /process\.env(?:\.(?:PLATFORM_URL|DATABASE_URL|NEXT_PUBLIC_PLATFORM_URL)|\[\s*["'](?:PLATFORM_URL|DATABASE_URL|NEXT_PUBLIC_PLATFORM_URL)["']\s*\])/u,
  /https?:\/\/[^\s"']*platform/iu,
  /(?:from\s*|import\s*\(|require\s*\()["'](?:@kokoro\/admin|@kokoro\/platform|@prisma\/client)/u,
  /\bshared(?:Account|Session)\b/u,
] as const;

function sha256(content: Uint8Array | string): string {
  return createHash("sha256").update(content).digest("hex");
}

function assertSafeDirectory(directory: string): string {
  const target = resolve(directory);
  const parent = dirname(target);
  if (target === parent || target === resolve(sep)) {
    throw new TypeError("refusing to scaffold into a filesystem root");
  }
  return target;
}

async function assertTargetDoesNotExist(target: string): Promise<void> {
  try {
    await lstat(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  throw new Error(`refusing to overwrite existing Site target: ${target}`);
}

function requireText(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) throw new TypeError(`${field} must not be empty`);
  return normalized;
}

async function assertPackageArtifactInput(artifact: ImmutablePackageArtifact): Promise<void> {
  if (!SHA256_PATTERN.test(artifact.sha256)) {
    throw new TypeError(`${artifact.name} sha256 must be lowercase SHA-256`);
  }
  if (artifact.version.trim().length === 0 || artifact.version !== artifact.version.trim()) {
    throw new TypeError(`${artifact.name} version must be a non-empty exact package version`);
  }
  const stat = await lstat(artifact.archivePath);
  if (!stat.isFile()) throw new TypeError(`${artifact.name} archivePath must be a regular file`);
  if (stat.size === 0 || stat.size > 64 * 1024 * 1024) {
    throw new TypeError(`${artifact.name} archive must be between 1 byte and 64 MiB`);
  }
}

async function readPackageIdentity(archivePath: string): Promise<{ readonly name: string; readonly version: string }> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  let matches = 0;
  let invalidEntry = false;
  await listTar({
    file: archivePath,
    strict: true,
    onReadEntry(entry) {
      if (entry.path !== "package/package.json") {
        entry.resume();
        return;
      }
      matches += 1;
      if (matches !== 1 || entry.type !== "File") invalidEntry = true;
      entry.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes <= 64 * 1024) chunks.push(chunk);
      });
    },
  });
  if (matches !== 1 || invalidEntry || bytes > 64 * 1024) {
    throw new Error("package archive must contain exactly one bounded package/package.json file");
  }
  let manifest: unknown;
  try {
    manifest = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("package archive contains invalid package/package.json JSON");
  }
  if (manifest === null || typeof manifest !== "object") {
    throw new Error("package archive manifest must be an object");
  }
  const { name, version } = manifest as { readonly name?: unknown; readonly version?: unknown };
  if (typeof name !== "string" || typeof version !== "string") {
    throw new Error("package archive manifest must declare string name and version");
  }
  return { name, version };
}

async function verifyCopiedPackageArtifact(
  artifact: ImmutablePackageArtifact,
  copiedArchivePath: string,
): Promise<void> {
  const actual = sha256(await readFile(copiedArchivePath));
  if (actual !== artifact.sha256) {
    throw new Error(`${artifact.name} package digest mismatch`);
  }
  const identity = await readPackageIdentity(copiedArchivePath);
  if (identity.name !== artifact.name || identity.version !== artifact.version) {
    throw new Error(
      `${artifact.name} package identity mismatch: expected ${artifact.name}@${artifact.version}`,
    );
  }
}

async function listTemplateFiles(directory: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const relative = join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...(await listTemplateFiles(join(directory, entry.name), relative)));
    else if (entry.isFile()) files.push(relative);
  }
  return files;
}

function render(template: string, replacements: Readonly<Record<string, string>>): string {
  let result = template;
  for (const [token, value] of Object.entries(replacements)) result = result.replaceAll(token, value);
  const unresolved = result.match(/__[A-Z0-9_]+__/gu);
  if (unresolved !== null) throw new Error(`unresolved Site template token: ${unresolved[0]}`);
  return result;
}

export function assertNoForbiddenRuntimeCoupling(source: string): void {
  for (const forbidden of FORBIDDEN_RUNTIME_COUPLING) {
    if (forbidden.test(source)) throw new Error(`forbidden Site runtime coupling matched ${forbidden}`);
  }
}

async function publishStagingDirectory(staging: string, target: string): Promise<void> {
  await mkdir(target, { mode: 0o700 });
  const incompleteMarker = join(target, ".kokoro-scaffold-incomplete");
  try {
    await writeFile(incompleteMarker, "incomplete\n", { encoding: "utf8", flag: "wx", mode: 0o600 });
    const entries = await readdir(staging);
    for (const entry of entries.sort((left, right) => left.localeCompare(right))) {
      await rename(join(staging, entry), join(target, entry));
    }
    await rm(incompleteMarker);
    await rm(staging, { recursive: true, force: true });
  } catch (error) {
    // `mkdir(target)` succeeded in this call, so this function exclusively owns cleanup.
    await rm(target, { recursive: true, force: true });
    throw error;
  }
}

export async function createSiteProject(input: CreateSiteProjectInput): Promise<CreatedSiteProject> {
  const target = assertSafeDirectory(input.directory);
  await assertTargetDoesNotExist(target);
  if (!PACKAGE_PATTERN.test(input.packageName)) throw new TypeError("packageName must be scoped");
  if (!SITE_KEY_PATTERN.test(input.siteKey)) throw new TypeError("siteKey must be a stable lowercase slug");
  if (!SHA256_PATTERN.test(input.artifactSha256)) {
    throw new TypeError("artifactSha256 must be lowercase SHA-256");
  }
  const requiredArtifacts = [
    "@kokoro/site-app-kit",
    "@kokoro/site-client",
    "@kokoro/session-client",
    "@kokoro/bff-runtime",
    "@kokoro/site-runtime-node",
    "@kokoro/chat-surface",
    "@kokoro/chat-app",
    "@kokoro/site-bff",
    "@kokoro/account-app",
  ] as const;
  if (
    input.packages.length !== requiredArtifacts.length ||
    requiredArtifacts.some((name) => input.packages.filter((artifact) => artifact.name === name).length !== 1)
  ) {
    throw new TypeError("the complete immutable Site runtime package closure is required");
  }
  await Promise.all(input.packages.map(assertPackageArtifactInput));

  await mkdir(dirname(target), { recursive: true });
  const staging = await mkdtemp(join(dirname(target), `.${basename(target)}.staging-`));
  try {
    const artifact = (name: ImmutablePackageArtifact["name"]): ImmutablePackageArtifact => {
      const value = input.packages.find((candidate) => candidate.name === name);
      if (value === undefined) throw new TypeError("required package artifact missing");
      return value;
    };
    const appKit = artifact("@kokoro/site-app-kit");
    const client = artifact("@kokoro/site-client");
    const sessionClient = artifact("@kokoro/session-client");
    const bffRuntime = artifact("@kokoro/bff-runtime");
    const nodeRuntime = artifact("@kokoro/site-runtime-node");
    const chatSurface = artifact("@kokoro/chat-surface");
    const chatApp = artifact("@kokoro/chat-app");
    const siteBff = artifact("@kokoro/site-bff");
    const accountApp = artifact("@kokoro/account-app");

    const replacements = {
      __PACKAGE_NAME_JSON__: JSON.stringify(input.packageName),
      __SITE_KEY_JSON__: JSON.stringify(input.siteKey),
      __DISPLAY_NAME_JSON__: JSON.stringify(requireText(input.displayName, "displayName")),
      __RELEASE_ID_JSON__: JSON.stringify(requireText(input.releaseId, "releaseId")),
      __ARTIFACT_SHA256_JSON__: JSON.stringify(input.artifactSha256),
      __PROFILE_REVISION_JSON__: JSON.stringify(requireText(input.profileRevision, "profileRevision")),
      __DOMAINS_JSON__: JSON.stringify(input.domains, null, 2),
      __CONTRACT_FLOOR_JSON__: JSON.stringify(input.contractFloor, null, 2),
      __DEPLOYMENT_JSON__: JSON.stringify(input.deployment, null, 2),
      __APP_KIT_VERSION_JSON__: JSON.stringify(appKit.version),
      __SITE_CLIENT_VERSION_JSON__: JSON.stringify(client.version),
      __APP_KIT_SHA256_JSON__: JSON.stringify(appKit.sha256),
      __SITE_CLIENT_SHA256_JSON__: JSON.stringify(client.sha256),
      __SESSION_CLIENT_VERSION_JSON__: JSON.stringify(sessionClient.version),
      __SESSION_CLIENT_SHA256_JSON__: JSON.stringify(sessionClient.sha256),
      __BFF_RUNTIME_VERSION_JSON__: JSON.stringify(bffRuntime.version),
      __BFF_RUNTIME_SHA256_JSON__: JSON.stringify(bffRuntime.sha256),
      __SITE_RUNTIME_NODE_VERSION_JSON__: JSON.stringify(nodeRuntime.version),
      __SITE_RUNTIME_NODE_SHA256_JSON__: JSON.stringify(nodeRuntime.sha256),
      __CHAT_SURFACE_VERSION_JSON__: JSON.stringify(chatSurface.version),
      __CHAT_SURFACE_SHA256_JSON__: JSON.stringify(chatSurface.sha256),
      __CHAT_APP_VERSION_JSON__: JSON.stringify(chatApp.version),
      __CHAT_APP_SHA256_JSON__: JSON.stringify(chatApp.sha256),
      __SITE_BFF_VERSION_JSON__: JSON.stringify(siteBff.version),
      __SITE_BFF_SHA256_JSON__: JSON.stringify(siteBff.sha256),
      __ACCOUNT_APP_VERSION_JSON__: JSON.stringify(accountApp.version),
      __ACCOUNT_APP_SHA256_JSON__: JSON.stringify(accountApp.sha256),
    } as const;

    const templateFiles = await listTemplateFiles(TEMPLATE_ROOT);
    for (const relative of templateFiles) {
      const destination = join(staging, relative);
      await mkdir(dirname(destination), { recursive: true });
      const rendered = render(await readFile(join(TEMPLATE_ROOT, relative), "utf8"), replacements);
      assertNoForbiddenRuntimeCoupling(rendered);
      await writeFile(destination, rendered, { encoding: "utf8", mode: relative.endsWith(".sh") ? 0o755 : 0o644 });
    }

    await mkdir(join(staging, "vendor"), { recursive: true });
    const copiedAppKit = join(staging, "vendor", "site-app-kit.tgz");
    const copiedClient = join(staging, "vendor", "site-client.tgz");
    const copiedSessionClient = join(staging, "vendor", "session-client.tgz");
    const copiedBffRuntime = join(staging, "vendor", "bff-runtime.tgz");
    const copiedNodeRuntime = join(staging, "vendor", "site-runtime-node.tgz");
    const copiedChatSurface = join(staging, "vendor", "chat-surface.tgz");
    const copiedChatApp = join(staging, "vendor", "chat-app.tgz");
    const copiedSiteBff = join(staging, "vendor", "site-bff.tgz");
    const copiedAccountApp = join(staging, "vendor", "account-app.tgz");
    for (const [artifact, destination] of [
      [appKit, copiedAppKit],
      [client, copiedClient],
      [sessionClient, copiedSessionClient],
      [bffRuntime, copiedBffRuntime],
      [nodeRuntime, copiedNodeRuntime],
      [chatSurface, copiedChatSurface],
      [chatApp, copiedChatApp],
      [siteBff, copiedSiteBff],
      [accountApp, copiedAccountApp],
    ] as const) {
      await copyFile(artifact.archivePath, destination, constants.COPYFILE_EXCL);
      await verifyCopiedPackageArtifact(artifact, destination);
    }

    await publishStagingDirectory(staging, target);
    return Object.freeze({
      directory: target,
      packageName: input.packageName,
      siteKey: input.siteKey,
      releaseId: input.releaseId,
      packageArtifacts: Object.freeze({
        [appKit.name]: appKit.sha256,
        [client.name]: client.sha256,
        [sessionClient.name]: sessionClient.sha256,
        [bffRuntime.name]: bffRuntime.sha256,
        [nodeRuntime.name]: nodeRuntime.sha256,
        [chatSurface.name]: chatSurface.sha256,
        [chatApp.name]: chatApp.sha256,
        [siteBff.name]: siteBff.sha256,
        [accountApp.name]: accountApp.sha256,
      }),
      generatedFiles: Object.freeze([
        ...templateFiles,
        "vendor/site-app-kit.tgz",
        "vendor/site-client.tgz",
        "vendor/session-client.tgz",
        "vendor/bff-runtime.tgz",
        "vendor/site-runtime-node.tgz",
        "vendor/chat-surface.tgz",
        "vendor/chat-app.tgz",
        "vendor/site-bff.tgz",
        "vendor/account-app.tgz",
      ]),
    });
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

export function packageArchiveName(path: string): string {
  return basename(path);
}
