import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");
const release = await import(new URL("../../scripts/release-core-site.mjs", import.meta.url));

const sha = (value) => createHash("sha256").update(value).digest("hex");
const signature = "a".repeat(86);
const definition = () => ({
  schemaVersion: 1,
  site: { siteKey: "core-site", packageName: "@kokoro/core-site", displayName: "Kokoro" },
  release: { releaseId: "core.2026.08.11.001", profileRevision: "core.v1" },
  domain: { hostname: "kokoro.example", environment: "production" },
  deployment: { provider: "container-registry", projectRef: "kokoro/core", region: "us-east" },
  contractFloor: {
    contract: "platform-public-v1", version: "1", schemaSha256: "a".repeat(64), signature, signingKeyId: "release-key-1",
  },
  packages: [
    { name: "@kokoro/chat-app", version: "1.0.0", archivePath: "/tmp/chat.tgz", sha256: "b".repeat(64) },
    { name: "@kokoro/site-app-kit", version: "1.0.0", archivePath: "/tmp/kit.tgz", sha256: "c".repeat(64) },
  ],
});

const allowedManifests = () => ({
  appPaths: {
    "/page": "app/page.js",
    "/account/page": "app/account/page.js",
    "/login/page": "app/login/page.js",
    "/api/account/[action]/route": "app/api/account/[action]/route.js",
    "/api/auth/[...nextauth]/route": "app/api/auth/[...nextauth]/route.js",
    "/api/health/live/route": "app/api/health/live/route.js",
    "/api/health/ready/route": "app/api/health/ready/route.js",
    "/api/session/[...path]/route": "app/api/session/[...path]/route.js",
  },
  appPathRoutes: {
    "/page": "/", "/account/page": "/account", "/login/page": "/login",
    "/api/account/[action]/route": "/api/account/[action]",
    "/api/auth/[...nextauth]/route": "/api/auth/[...nextauth]",
    "/api/health/live/route": "/api/health/live", "/api/health/ready/route": "/api/health/ready",
    "/api/session/[...path]/route": "/api/session/[...path]",
  },
  middleware: { version: 3, middleware: {} },
});

test("core definition is strict and canonical source closure ignores archive locations", () => {
  const parsed = release.parseCoreSiteDefinition(Buffer.from(JSON.stringify(definition())));
  assert.equal(parsed.site.siteKey, "core-site");
  const moved = definition();
  moved.packages[0].archivePath = "/different/archive.tgz";
  assert.deepEqual(release.coreSiteSourceClosure(parsed), release.coreSiteSourceClosure(release.parseCoreSiteDefinition(JSON.stringify(moved))));
  assert.equal(release.coreSiteSourceClosure(parsed).sha256, sha(release.coreSiteSourceClosure(parsed).canonical));

  for (const mutate of [
    (value) => { value.unexpected = true; },
    (value) => { value.domain.environment = "preview"; },
    (value) => { value.domain.hostname = "https://kokoro.example"; },
    (value) => { value.sites = [value.site]; },
    (value) => { value.deployment.provider = "direct"; },
    (value) => { value.media = {}; },
    (value) => { value.memory = {}; },
    (value) => { value.contractFloor.signature = "not-a-signature"; },
  ]) {
    const invalid = definition();
    mutate(invalid);
    assert.throws(() => release.parseCoreSiteDefinition(JSON.stringify(invalid)));
  }
});

test("core route closure accepts the exact required surface and rejects off-profile routes", () => {
  assert.deepEqual(release.assertCoreSiteRoutes(allowedManifests()), [
    "/", "/account", "/api/account/[action]", "/api/auth/[...nextauth]", "/api/health/live", "/api/health/ready", "/api/session/[...path]", "/login",
  ]);
  for (const route of ["/studio", "/library", "/memory", "/api/media/[...path]", "/api/assets/[...path]", "/api/payment/checkout"]) {
    const manifests = allowedManifests();
    manifests.appPathRoutes[`/bad${route}/page`] = route;
    assert.throws(() => release.assertCoreSiteRoutes(manifests), new RegExp(route.replace(/[\[\]]/gu, "\\$&")));
  }
});

test("exact OCI reference binds a repository to only a lowercase Buildx digest", () => {
  assert.equal(release.exactImageReference("registry.example/kokoro/core:mutable", { "containerimage.digest": `sha256:${"d".repeat(64)}` }), `registry.example/kokoro/core@sha256:${"d".repeat(64)}`);
  for (const metadata of [
    {},
    { "containerimage.digest": `sha256:${"D".repeat(64)}` },
    { digest: `sha256:${"d".repeat(64)}` },
  ]) assert.throws(() => release.exactImageReference("registry.example/kokoro/core:tag", metadata));
  for (const image of ["core:tag", "registry.example/kokoro/core", "registry.example/kokoro/core@sha256:abc", "registry.example/kokoro/core:latest"]) {
    assert.throws(() => release.exactImageReference(image, { "containerimage.digest": `sha256:${"d".repeat(64)}` }));
  }
});

test("assembly prunes only the core-off routes and cleans up an injected failed target", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "core-site-test-"));
  const target = join(temporary, "core-site");
  try {
    const parsed = release.parseCoreSiteDefinition(JSON.stringify(definition()));
    const created = await release.assembleCoreSite({
      definition: parsed,
      directory: target,
      createSiteProject: async ({ directory }) => {
        await writeFile(join(temporary, "marker"), directory);
        await (await import("node:fs/promises")).mkdir(join(directory, "src/app"), { recursive: true });
        await writeFile(join(directory, "src/app/page.tsx"), "<ChatProduct\n />");
        for (const relative of [
          "src/app/studio/page.tsx", "src/app/library/page.tsx", "src/app/api/media/[[...path]]/route.ts", "src/app/api/assets/[[...path]]/route.ts",
        ]) {
          const file = join(directory, relative);
          await (await import("node:fs/promises")).mkdir(file.slice(0, file.lastIndexOf("/")), { recursive: true });
          await writeFile(file, "off profile");
        }
      },
      verify: async () => {},
    });
    assert.equal(created.directory, target);
    assert.match(await readFile(join(target, "src/app/page.tsx"), "utf8"), /attachmentsEnabled=\{false\}/u);
    for (const relative of ["src/app/studio/page.tsx", "src/app/library/page.tsx", "src/app/api/media/[[...path]]/route.ts", "src/app/api/assets/[[...path]]/route.ts"]) {
      await assert.rejects(readFile(join(target, relative)));
    }
    await assert.rejects(release.assembleCoreSite({ definition: parsed, directory: join(temporary, "failed"), createSiteProject: async () => { throw new Error("injected"); }, verify: async () => {} }));
    await assert.rejects(readFile(join(temporary, "failed")));
    await assert.rejects(release.assembleCoreSite({ definition: parsed, directory: join(temporary, "failed-verify"), createSiteProject: async ({ directory }) => { await (await import("node:fs/promises")).mkdir(join(directory, "src/app"), { recursive: true }); await writeFile(join(directory, "src/app/page.tsx"), "<ChatProduct\n />"); }, verify: async () => { throw new Error("verify failed"); } }));
    await assert.rejects(readFile(join(temporary, "failed-verify")));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("publication uses exact Buildx argv and atomically writes a new safe report", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "core-site-publish-"));
  const report = join(temporary, "report.json");
  const invocations = [];
  try {
    const result = await release.publishCoreSite({
      directory: temporary,
      image: "registry.example/kokoro/core:build-1",
      platform: "linux/amd64",
      report,
      reportBody: { schemaVersion: 1, siteKey: "core-site" },
      run: async (command, args) => {
        invocations.push([command, args]);
        const metadataPath = args[args.indexOf("--metadata-file") + 1];
        await writeFile(metadataPath, JSON.stringify({ "containerimage.digest": `sha256:${"e".repeat(64)}` }));
      },
    });
    assert.equal(result.image, `registry.example/kokoro/core@sha256:${"e".repeat(64)}`);
    assert.deepEqual(invocations[0], ["docker", ["buildx", "build", "--push", "--platform", "linux/amd64", "--metadata-file", invocations[0][1][6], "--tag", "registry.example/kokoro/core:build-1", temporary]]);
    assert.equal(JSON.parse(await readFile(report, "utf8")).image, result.image);
    await assert.rejects(release.publishCoreSite({ directory: temporary, image: "registry.example/kokoro/core:again", platform: "linux/amd64", report, reportBody: {}, run: async () => {} }));
    const failedReport = join(temporary, "failed-report.json");
    await assert.rejects(release.publishCoreSite({ directory: temporary, image: "registry.example/kokoro/core:build-2", platform: "linux/amd64", report: failedReport, reportBody: {}, run: async () => { throw new Error("buildx failed"); } }));
    await assert.rejects(readFile(failedReport));
    await assert.rejects(release.publishCoreSite({ directory: temporary, image: "registry.example/kokoro/core:build-3", platform: "linux/amd64", report: failedReport, reportBody: {}, run: async () => {} }));
    await assert.rejects(readFile(failedReport));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
