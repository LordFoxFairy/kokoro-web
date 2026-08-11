import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const webRoot = resolve(import.meta.dirname, "../..");
const release = await import(new URL("../../scripts/release-core-site.mjs", import.meta.url));
const sha = (value) => createHash("sha256").update(value).digest("hex");
const execFileAsync = promisify(execFile);
const signature = "a".repeat(86);
const packageArtifacts = ["site-app-kit", "site-client", "session-client", "bff-runtime", "site-runtime-node", "chat-surface", "asset-client", "chat-app", "site-bff", "account-app", "media-app"].map((name, index) => ({ name: `@kokoro/${name}`, version: "1.0.0", sha256: "abcdef"[index % 6].repeat(64) }));
const definition = () => ({ schemaVersion: 1, site: { siteId: "site:core", siteKey: "core-site", packageName: "@kokoro/core-site", displayName: "Kokoro" }, release: { releaseId: "core.2026.08.11.001", profileRevision: "core.v1" }, domain: { hostname: "kokoro.example", environment: "production" }, deployment: { provider: "container-registry", projectRef: "kokoro/core", region: "us-east" }, contractFloor: { contract: "platform-public-v1", version: "1", schemaSha256: "a".repeat(64), signature, signingKeyId: "release-key-1" } });
const exactRoutes = ["/", "/_global-error", "/_not-found", "/account", "/api/account/[action]", "/api/auth/[...nextauth]", "/api/auth/delivery-state", "/api/health/live", "/api/health/ready", "/api/release/metadata", "/api/session/[...path]", "/login", "/register", "/verify-email"];
const allowedManifests = () => ({ appPaths: Object.fromEntries(exactRoutes.map((route) => [`${route === "/" ? "" : route}/page`.replace("//", "/"), "app.js"])), appPathRoutes: Object.fromEntries(exactRoutes.map((route) => [`${route === "/" ? "/page" : `${route}/page`}`, route])), middleware: { version: 3, middleware: {}, functions: {}, sortedMiddleware: [] } });

async function createSignedContractFixture(directory) {
  const metadata = (await import(pathToFileURL(resolve(webRoot, "packages/site-client/src/generated/contracts/openapi/platform-public/contract-metadata.ts")))).PLATFORM_PUBLIC_CONTRACT_METADATA;
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const signingKeyId = "core-release-fixture-key";
  const floorSignature = sign(null, Buffer.from(`${metadata.schemaId}:${metadata.contractVersion}:${metadata.sourceDigestSha256}`), privateKey).toString("base64url");
  const keyringPath = join(directory, "keyring.json");
  await writeFile(keyringPath, JSON.stringify({ schemaVersion: 1, trustMode: "ephemeral_self_signed_fixture_not_production", keys: [{ keyId: signingKeyId, algorithm: "Ed25519", publicKeySpkiBase64url: publicKey.export({ type: "spki", format: "der" }).toString("base64url") }] }));
  return { keyringPath, contractFloor: { contract: metadata.schemaId, version: metadata.contractVersion, schemaSha256: metadata.sourceDigestSha256, signature: floorSignature, signingKeyId } };
}

async function git(directory, args) {
  return execFileAsync("git", args, { cwd: directory, env: { PATH: process.env.PATH, HOME: process.env.HOME }, maxBuffer: 1024 * 1024 });
}

async function initializeGitFixture(directory) {
  await git(directory, ["init", "--initial-branch=main"]);
  await git(directory, ["config", "user.name", "Core Release Test"]);
  await git(directory, ["config", "user.email", "core-release@invalid"]);
  await writeFile(join(directory, "identity.txt"), "A\n");
  await git(directory, ["add", "identity.txt"]);
  await git(directory, ["commit", "-m", "A"]);
  return (await git(directory, ["rev-parse", "HEAD"])).stdout.trim();
}

test("core definition is strict, excludes operator package archives, and canonicalizes the builder closure", () => {
  const parsed = release.parseCoreSiteDefinition(Buffer.from(JSON.stringify(definition())));
  assert.equal(parsed.site.siteKey, "core-site"); assert.equal(parsed.packages, undefined);
  const closure = release.coreSiteSourceClosure({ definition: parsed, packages: packageArtifacts });
  assert.equal(closure.sha256, sha(closure.canonical)); assert.match(closure.canonical, /@kokoro\/chat-app/u);
  for (const mutate of [(value) => { value.unexpected = true; }, (value) => { value.domain.environment = "preview"; }, (value) => { value.domain.hostname = "https://kokoro.example"; }, (value) => { value.sites = [value.site]; }, (value) => { value.deployment.provider = "direct"; }, (value) => { value.provider = "direct"; }, (value) => { value.media = {}; }, (value) => { value.memory = {}; }, (value) => { value.packages = packageArtifacts; }, (value) => { value.contractFloor.signature = "not-a-signature"; }]) { const invalid = definition(); mutate(invalid); assert.throws(() => release.parseCoreSiteDefinition(JSON.stringify(invalid))); }
});

test("core route closure is an exact allowlist and middleware cannot add routes or rewrites", () => {
  assert.deepEqual(release.assertCoreSiteRoutes(allowedManifests()), exactRoutes);
  for (const route of ["/studio", "/library", "/memory", "/api/media/[...path]", "/api/assets/[...path]", "/api/payment/checkout", "/admin-debug", "/api/proxy", "/checkout"]) { const manifests = allowedManifests(); manifests.appPathRoutes[`/bad${route}/page`] = route; assert.throws(() => release.assertCoreSiteRoutes(manifests), new RegExp(route.replace(/[\[\]]/gu, "\\$&"))); }
  for (const middleware of [{ version: 3, middleware: { "/middleware": {} }, functions: {}, sortedMiddleware: ["/"] }, { version: 3, middleware: {}, functions: {}, sortedMiddleware: [], rewrites: [{ source: "/", destination: "/api/proxy" }] }]) assert.throws(() => release.assertCoreSiteRoutes({ ...allowedManifests(), middleware }));
});

test("exact OCI reference accepts only a registry repository and lower-case Buildx digest", () => {
  assert.equal(release.exactImageReference("registry.example/kokoro/core:build-1", { "containerimage.digest": `sha256:${"d".repeat(64)}` }), `registry.example/kokoro/core@sha256:${"d".repeat(64)}`);
  assert.equal(release.exactImageReference("registry.example:5443/kokoro/core:build-1", { "containerimage.digest": `sha256:${"d".repeat(64)}` }), `registry.example:5443/kokoro/core@sha256:${"d".repeat(64)}`);
  for (const image of ["core:tag", "registry.example/kokoro/core", "registry.example/kokoro/core:latest", "localhost:5000/kokoro/core:tag", "registry.invalid/kokoro/core:tag"]) assert.throws(() => release.exactImageReference(image, { "containerimage.digest": `sha256:${"d".repeat(64)}` }));
  for (const metadata of [{}, { digest: `sha256:${"d".repeat(64)}` }, { "containerimage.digest": `sha256:${"D".repeat(64)}` }]) assert.throws(() => release.exactImageReference("registry.example/kokoro/core:tag", metadata));
});

test("git snapshot binds an explicit commit despite replace refs and rejects an A to B checkout race", async () => {
  const replaceFixture = await mkdtemp(join(tmpdir(), "core-git-replace-"));
  const raceFixture = await mkdtemp(join(tmpdir(), "core-git-race-"));
  const outputs = await mkdtemp(join(tmpdir(), "core-git-output-"));
  try {
    const commitA = await initializeGitFixture(replaceFixture);
    await writeFile(join(replaceFixture, "identity.txt"), "B\n");
    await git(replaceFixture, ["commit", "-am", "B"]);
    const commitB = (await git(replaceFixture, ["rev-parse", "HEAD"])).stdout.trim();
    await git(replaceFixture, ["checkout", "--detach", commitA]);
    await git(replaceFixture, ["replace", commitA, commitB]);
    const captured = await release.captureCleanGitSnapshot({ repository: replaceFixture, directory: join(outputs, "replace") });
    assert.equal(captured.commit, commitA);
    assert.equal(await readFile(join(captured.snapshot, "identity.txt"), "utf8"), "A\n");

    await initializeGitFixture(raceFixture);
    await assert.rejects(release.captureCleanGitSnapshot({
      repository: raceFixture,
      directory: join(outputs, "race"),
      afterCommitCaptured: async () => {
        await writeFile(join(raceFixture, "identity.txt"), "B\n");
        await git(raceFixture, ["commit", "-am", "B"]);
      },
    }), /changed during snapshot/u);
  } finally {
    await rm(replaceFixture, { recursive: true, force: true });
    await rm(raceFixture, { recursive: true, force: true });
    await rm(outputs, { recursive: true, force: true });
  }
});

test("child environments use an explicit allowlist and scoped release inputs", () => {
  const previous = { ...process.env };
  try {
    Object.assign(process.env, { TOKEN: "host-token", NPM_TOKEN: "npm-token", AWS_SECRET_ACCESS_KEY: "aws-secret", GOOGLE_APPLICATION_CREDENTIALS: "/secret/google.json", AZURE_CLIENT_SECRET: "azure-secret", DOCKER_CONFIG: "/controlled/docker" });
    const base = release.coreReleaseChildEnvironment("pnpm");
    for (const key of ["TOKEN", "NPM_TOKEN", "AWS_SECRET_ACCESS_KEY", "GOOGLE_APPLICATION_CREDENTIALS", "AZURE_CLIENT_SECRET", "DOCKER_CONFIG"]) assert.equal(base[key], undefined);
    assert.equal(base.CI, "1"); assert.equal(base.NEXT_TELEMETRY_DISABLED, "1");
    assert.equal(base.NPM_CONFIG_USERCONFIG, "/dev/null"); assert.equal(base.NPM_CONFIG_GLOBALCONFIG, "/dev/null"); assert.equal(base.COREPACK_ENABLE_PROJECT_SPEC, "0");
    const artifact = release.coreReleaseChildEnvironment("artifact-verify", { contractKeyringJson: "public-keyring" });
    assert.equal(artifact.KOKORO_CONTRACT_KEYRING_JSON, "public-keyring"); assert.equal(artifact.AUTH_SECRET, undefined);
    const build = release.coreReleaseChildEnvironment("next-build");
    assert.match(build.AUTH_SECRET, /core-release-build/u); assert.equal(build.KOKORO_CONTRACT_KEYRING_JSON, undefined);
    const docker = release.coreReleaseChildEnvironment("docker", { dockerConfig: "/controlled/docker" });
    assert.equal(docker.DOCKER_CONFIG, "/controlled/docker"); assert.equal(docker.NPM_TOKEN, undefined); assert.equal(docker.HOME, undefined);
    assert.throws(() => release.coreReleaseChildEnvironment("docker"), /dockerConfig/u);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
});

test("default core assembly is isolated: a clean archive supplies real scaffold, packages, verification, build, and manifest closure", { timeout: 180_000 }, async () => {
  const temporary = await mkdtemp(join(tmpdir(), "core-site-real-"));
  try {
    const signed = await createSignedContractFixture(temporary);
    const parsed = release.parseCoreSiteDefinition(JSON.stringify({ ...definition(), contractFloor: signed.contractFloor }));
    const assembled = await release.assembleCoreSite({ definition: parsed, directory: join(temporary, "site"), contractKeyringPath: signed.keyringPath });
    assert.equal(assembled.packageArtifacts.length, 11); assert.deepEqual(assembled.builtPackageNames, [...packageArtifacts.map(({ name }) => name), "@kokoro/site-scaffold"].sort()); assert.deepEqual(assembled.routes, exactRoutes); assert.match(assembled.finalSourceClosureSha256, /^[0-9a-f]{64}$/u);
    assert.match(await readFile(join(assembled.directory, "src/app/page.tsx"), "utf8"), /attachmentsEnabled=\{false\}/u);
    const metadataPath = join(assembled.directory, "src/app/api/release/metadata/route.ts");
    const metadata = await readFile(metadataPath, "utf8"); assert.doesNotMatch(metadata, /platform|session|credential/iu);
    const oldDigest = process.env.KOKORO_WEB_ARTIFACT_DIGEST; const oldDeployment = process.env.KOKORO_SITE_DEPLOYMENT_REF;
    try {
      process.env.KOKORO_WEB_ARTIFACT_DIGEST = "f".repeat(64); process.env.KOKORO_SITE_DEPLOYMENT_REF = "deployment:core:1";
      const response = await (await import(`${pathToFileURL(metadataPath).href}?test=${Date.now()}`)).GET();
      const body = await response.json();
      assert.deepEqual(Object.keys(body).sort(), ["deploymentRef", "observedAt", "readiness", "schemaVersion", "siteId", "siteReleaseRef", "webArtifactDigest"]);
      assert.deepEqual({ ...body, observedAt: "instant" }, { schemaVersion: 1, siteId: "site:core", siteReleaseRef: "core.2026.08.11.001", webArtifactDigest: "f".repeat(64), deploymentRef: "deployment:core:1", readiness: "ready", observedAt: "instant" });
      assert.match(body.observedAt, /^\d{4}-\d{2}-\d{2}T/u);
    } finally {
      if (oldDigest === undefined) delete process.env.KOKORO_WEB_ARTIFACT_DIGEST; else process.env.KOKORO_WEB_ARTIFACT_DIGEST = oldDigest;
      if (oldDeployment === undefined) delete process.env.KOKORO_SITE_DEPLOYMENT_REF; else process.env.KOKORO_SITE_DEPLOYMENT_REF = oldDeployment;
    }
    for (const relative of ["src/app/studio/page.tsx", "src/app/library/page.tsx", "src/app/api/media/[[...path]]/route.ts", "src/app/api/assets/[[...path]]/route.ts", "src/app/api/memory/[[...path]]/route.ts"]) await assert.rejects(readFile(join(assembled.directory, relative)));
    for (const manifest of [".next/server/app-paths-manifest.json", ".next/app-path-routes-manifest.json", ".next/server/middleware-manifest.json"]) await stat(join(assembled.directory, manifest));
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test("Buildx publication races safely into one same-directory hard-linked report with complete digest-bound fields", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "core-site-publish-")); const report = join(temporary, "report.json");
  const reportBody = { schemaVersion: 1, kind: "kokoro.core-site-release", platform: "linux/amd64", webCommit: "a".repeat(40), siteKey: "core-site", releaseId: "core.2026.08.11.001", finalSourceClosureSha256: "b".repeat(64), lockSha256: "c".repeat(64), packageArtifacts: Object.fromEntries(packageArtifacts.map(({ name, version, sha256 }) => [name, { version, sha256 }])), routes: exactRoutes };
  const invocations = [];
  const run = async (command, args, environment) => { invocations.push({ command, args, environment }); await writeFile(args[args.indexOf("--metadata-file") + 1], JSON.stringify({ "containerimage.digest": `sha256:${"e".repeat(64)}` })); };
  try {
    const settled = await Promise.allSettled([release.publishCoreSite({ directory: temporary, image: "registry.example/kokoro/core:build-1", platform: "linux/amd64", dockerConfig: "/controlled/docker", report, reportBody, run }), release.publishCoreSite({ directory: temporary, image: "registry.example/kokoro/core:build-1", platform: "linux/amd64", dockerConfig: "/controlled/docker", report, reportBody, run })]);
    assert.equal(settled.filter(({ status }) => status === "fulfilled").length, 1); assert.equal(settled.filter(({ status }) => status === "rejected").length, 1);
    const published = JSON.parse(await readFile(report, "utf8")); assert.equal(published.image, `registry.example/kokoro/core@sha256:${"e".repeat(64)}`); assert.equal(published.webArtifactDigest, "e".repeat(64)); assert.deepEqual(published.packageArtifacts, reportBody.packageArtifacts); assert.deepEqual(published.routes, exactRoutes); assert.equal((await stat(report)).mode & 0o777, 0o600); assert.deepEqual((await readdir(temporary)).filter((name) => name.startsWith(".report.json.")), []);
    for (const invocation of invocations) {
      assert.equal(invocation.command, "docker");
      assert.deepEqual(invocation.args, ["buildx", "build", "--push", "--platform", "linux/amd64", "--metadata-file", invocation.args[6], "--tag", "registry.example/kokoro/core:build-1", temporary]);
      assert.deepEqual(invocation.environment, release.coreReleaseChildEnvironment("docker", { dockerConfig: "/controlled/docker" }));
      for (const key of ["TOKEN", "NPM_TOKEN", "AWS_SECRET_ACCESS_KEY", "GOOGLE_APPLICATION_CREDENTIALS", "AZURE_CLIENT_SECRET", "HOME"]) assert.equal(invocation.environment[key], undefined);
    }
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test("Buildx platform is a closed Linux allowlist", async () => {
  await assert.rejects(release.publishCoreSite({ directory: tmpdir(), image: "registry.example/kokoro/core:tag", platform: "darwin/arm64", dockerConfig: "/controlled/docker", report: join(tmpdir(), `invalid-platform-${Date.now()}.json`), reportBody: {}, run: async () => assert.fail("Buildx must not run") }), /platform/u);
});

test("CLI keys are exact and Docker config is mandatory before publication", async () => {
  const valid = ["--definition", "/definition.json", "--contract-keyring", "/keyring.json", "--image", "registry.example/core:tag", "--platform", "linux/amd64", "--report", "/report.json", "--docker-config", "/docker", "--push"];
  assert.equal(release.parseCoreReleaseArguments(valid).get("--docker-config"), "/docker");
  assert.throws(() => release.parseCoreReleaseArguments([...valid, "--unknown", "value"]), /unknown/u);
  assert.throws(() => release.parseCoreReleaseArguments(valid.filter((value, index) => value !== "--docker-config" && valid[index - 1] !== "--docker-config")), /docker-config/u);
  await assert.rejects(release.publishCoreSite({ directory: tmpdir(), image: "registry.example/core:tag", platform: "linux/amd64", report: join(tmpdir(), `missing-docker-${Date.now()}.json`), reportBody: {}, run: async () => assert.fail("Buildx must not run") }), /dockerConfig/u);
});

test("focused release suite passes from a clean tracked archive without ignored dist", { skip: process.env.KOKORO_CORE_CLEAN_ARCHIVE_TEST === "1", timeout: 240_000 }, async () => {
  const temporary = await mkdtemp(join(tmpdir(), "core-clean-focused-")); const archive = join(temporary, "web.tar"); const cleanRoot = join(temporary, "web");
  try {
    const commit = (await git(webRoot, ["rev-parse", "HEAD"])).stdout.trim();
    const { stdout } = await execFileAsync("git", ["archive", "--format=tar", commit], { cwd: webRoot, env: { PATH: process.env.PATH, GIT_NO_REPLACE_OBJECTS: "1" }, encoding: "buffer", maxBuffer: 64 * 1024 * 1024 });
    await writeFile(archive, stdout); await mkdir(cleanRoot); await execFileAsync("tar", ["-xf", archive, "-C", cleanRoot]);
    await initializeGitFixture(cleanRoot); await git(cleanRoot, ["add", "--all"]); await git(cleanRoot, ["commit", "--amend", "--no-edit"]);
    await assert.rejects(stat(join(cleanRoot, "packages/site-client/dist")));
    const environment = { ...process.env, PATH: `${resolve(process.execPath, "..")}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`, KOKORO_CORE_CLEAN_ARCHIVE_TEST: "1" };
    await execFileAsync("corepack", ["pnpm", "install", "--offline", "--frozen-lockfile"], { cwd: cleanRoot, env: environment, maxBuffer: 64 * 1024 * 1024 });
    await execFileAsync("corepack", ["pnpm", "exec", "node", "--test", "test/repository/core-site-release.test.mjs"], { cwd: cleanRoot, env: environment, maxBuffer: 64 * 1024 * 1024 });
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
