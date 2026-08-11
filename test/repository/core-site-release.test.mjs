import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const webRoot = resolve(import.meta.dirname, "../..");
const release = await import(new URL("../../scripts/release-core-site.mjs", import.meta.url));
const sha = (value) => createHash("sha256").update(value).digest("hex");
const signature = "a".repeat(86);
const packageArtifacts = [{ name: "@kokoro/chat-app", version: "1.0.0", sha256: "b".repeat(64) }, { name: "@kokoro/site-app-kit", version: "1.0.0", sha256: "c".repeat(64) }];
const definition = () => ({ schemaVersion: 1, site: { siteId: "site:core", siteKey: "core-site", packageName: "@kokoro/core-site", displayName: "Kokoro" }, release: { releaseId: "core.2026.08.11.001", profileRevision: "core.v1" }, domain: { hostname: "kokoro.example", environment: "production" }, deployment: { provider: "container-registry", projectRef: "kokoro/core", region: "us-east" }, contractFloor: { contract: "platform-public-v1", version: "1", schemaSha256: "a".repeat(64), signature, signingKeyId: "release-key-1" } });
const exactRoutes = ["/", "/_not-found", "/account", "/api/account/[action]", "/api/auth/[...nextauth]", "/api/auth/delivery-state", "/api/health/live", "/api/health/ready", "/api/release/metadata", "/api/session/[...path]", "/login", "/register", "/verify-email"];
const allowedManifests = () => ({ appPaths: Object.fromEntries(exactRoutes.map((route) => [`${route === "/" ? "" : route}/page`.replace("//", "/"), "app.js"])), appPathRoutes: Object.fromEntries(exactRoutes.map((route) => [`${route === "/" ? "/page" : `${route}/page`}`, route])), middleware: { version: 3, middleware: {}, functions: {}, sortedMiddleware: [] } });

async function createSignedContractFixture(directory) {
  const metadata = (await import(pathToFileURL(resolve(webRoot, "packages/site-client/dist/generated/contracts/openapi/platform-public/contract-metadata.js")))).PLATFORM_PUBLIC_CONTRACT_METADATA;
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const signingKeyId = "core-release-fixture-key";
  const floorSignature = sign(null, Buffer.from(`${metadata.schemaId}:${metadata.contractVersion}:${metadata.sourceDigestSha256}`), privateKey).toString("base64url");
  const keyringPath = join(directory, "keyring.json");
  await writeFile(keyringPath, JSON.stringify({ schemaVersion: 1, trustMode: "ephemeral_self_signed_fixture_not_production", keys: [{ keyId: signingKeyId, algorithm: "Ed25519", publicKeySpkiBase64url: publicKey.export({ type: "spki", format: "der" }).toString("base64url") }] }));
  return { keyringPath, contractFloor: { contract: metadata.schemaId, version: metadata.contractVersion, schemaSha256: metadata.sourceDigestSha256, signature: floorSignature, signingKeyId } };
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
  for (const image of ["core:tag", "registry.example/kokoro/core", "registry.example/kokoro/core:latest"]) assert.throws(() => release.exactImageReference(image, { "containerimage.digest": `sha256:${"d".repeat(64)}` }));
  for (const metadata of [{}, { digest: `sha256:${"d".repeat(64)}` }, { "containerimage.digest": `sha256:${"D".repeat(64)}` }]) assert.throws(() => release.exactImageReference("registry.example/kokoro/core:tag", metadata));
});

test("default core assembly is isolated: a clean archive supplies real scaffold, packages, verification, build, and manifest closure", { timeout: 180_000 }, async () => {
  const temporary = await mkdtemp(join(tmpdir(), "core-site-real-"));
  try {
    const signed = await createSignedContractFixture(temporary);
    const parsed = release.parseCoreSiteDefinition(JSON.stringify({ ...definition(), contractFloor: signed.contractFloor }));
    const assembled = await release.assembleCoreSite({ definition: parsed, directory: join(temporary, "site"), contractKeyringPath: signed.keyringPath });
    assert.equal(assembled.packageArtifacts.length, 11); assert.deepEqual(assembled.routes, exactRoutes); assert.equal(assembled.sourceClosureSha256, assembled.artifactSha256);
    assert.match(await readFile(join(assembled.directory, "src/app/page.tsx"), "utf8"), /attachmentsEnabled=\{false\}/u);
    for (const relative of ["src/app/studio/page.tsx", "src/app/library/page.tsx", "src/app/api/media/[[...path]]/route.ts", "src/app/api/assets/[[...path]]/route.ts", "src/app/api/memory/[[...path]]/route.ts"]) await assert.rejects(readFile(join(assembled.directory, relative)));
    for (const manifest of [".next/server/app-paths-manifest.json", ".next/app-path-routes-manifest.json", ".next/server/middleware-manifest.json"]) await stat(join(assembled.directory, manifest));
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test("Buildx publication races safely into one same-directory hard-linked report with complete digest-bound fields", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "core-site-publish-")); const report = join(temporary, "report.json");
  const reportBody = { schemaVersion: 1, kind: "kokoro.core-site-release", platform: "linux/amd64", webCommit: "a".repeat(40), siteKey: "core-site", releaseId: "core.2026.08.11.001", sourceClosureSha256: "b".repeat(64), artifactSha256: "b".repeat(64), lockSha256: "c".repeat(64), packageArtifacts: Object.fromEntries(packageArtifacts.map(({ name, version, sha256 }) => [name, { version, sha256 }])), routes: exactRoutes };
  const run = async (_command, args) => writeFile(args[args.indexOf("--metadata-file") + 1], JSON.stringify({ "containerimage.digest": `sha256:${"e".repeat(64)}` }));
  try {
    const settled = await Promise.allSettled([release.publishCoreSite({ directory: temporary, image: "registry.example/kokoro/core:build-1", platform: "linux/amd64", report, reportBody, run }), release.publishCoreSite({ directory: temporary, image: "registry.example/kokoro/core:build-1", platform: "linux/amd64", report, reportBody, run })]);
    assert.equal(settled.filter(({ status }) => status === "fulfilled").length, 1); assert.equal(settled.filter(({ status }) => status === "rejected").length, 1);
    const published = JSON.parse(await readFile(report, "utf8")); assert.equal(published.image, `registry.example/kokoro/core@sha256:${"e".repeat(64)}`); assert.equal(published.webArtifactDigest, "e".repeat(64)); assert.deepEqual(published.packageArtifacts, reportBody.packageArtifacts); assert.deepEqual(published.routes, exactRoutes); assert.equal((await stat(report)).mode & 0o777, 0o600); assert.deepEqual((await readdir(temporary)).filter((name) => name.startsWith(".report.json.")), []);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
