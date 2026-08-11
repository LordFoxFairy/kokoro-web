import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const webRoot = new URL("../../", import.meta.url);
const federatedRoot = new URL("../", webRoot);
const expectedMappings = Object.freeze([
  {
    source: "spec/presentation/binding-update-v1.yaml",
    output: "packages/session-client/src/generated/schema/presentation/binding-update-v1.schema.json",
  },
  {
    source: "spec/presentation/binding-v1.yaml",
    output: "packages/session-client/src/generated/schema/presentation/binding-v1.schema.json",
  },
  {
    source: "spec/presentation/owner-state-v1.yaml",
    output: "packages/session-client/src/generated/schema/presentation/owner-state-v1.schema.json",
  },
  {
    source: "spec/presentation/snapshot-v1.yaml",
    output: "packages/session-client/src/generated/schema/presentation/snapshot-v1.schema.json",
  },
]);
const retiredSourceNames = Object.freeze([
  "presentation-run-binding-v1.yaml",
  "presentation-message-binding-v1.yaml",
  "presentation-owner-binding-v1.yaml",
  "presentation-binding-authority-delta-v1.yaml",
]);

test("the active AG-UI compatibility validator is Web-owned source, not an untracked generated root", () => {
  const packageJson = JSON.parse(readFileSync(new URL("package.json", webRoot), "utf8"));
  const productionSource = readFileSync(new URL(
    "packages/session-client/src/agui-presentation-state-machine.internal.ts",
    webRoot,
  ), "utf8");

  assert.equal(packageJson.scripts["generate:agui-binding-authority"], undefined);
  assert.equal(packageJson.scripts["verify:agui-binding-authority"], undefined);
  assert.equal(existsSync(new URL("scripts/generate-agui-binding-authority.mjs", webRoot)), false);
  assert.equal(existsSync(new URL(
    "packages/session-client/src/generated/agui-binding-authority.ts",
    webRoot,
  )), false);
  assert.equal(existsSync(new URL(
    "packages/session-client/src/agui-binding-authority.compat.ts",
    webRoot,
  )), true);
  const compatibilitySource = readFileSync(new URL(
    "packages/session-client/src/agui-binding-authority.compat.ts",
    webRoot,
  ), "utf8");
  assert.match(productionSource, /from "\.\/agui-binding-authority\.compat\.js"/u);
  assert.doesNotMatch(productionSource, /generated\/agui-binding-authority/u);
  assert.match(compatibilitySource, /owner: "kokoro-web"/u);
  assert.match(compatibilitySource, /activeLane: "session-browser-v3"/u);
  assert.doesNotMatch(
    compatibilitySource,
    /GENERATED|DO NOT EDIT|Generation authority: Kokoro Root|contract\/spec\/presentation-(?:run|message|owner|binding-authority)/u,
  );
});

function fileDigest(path) {
  return `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
}

test("Root generation owns the hard-cut Presentation schema mirrors", async (context) => {
  if (!existsSync(new URL("contract/INDEX.md", federatedRoot))) {
    context.skip("standalone Web checkout has no federated Root contract authority");
    return;
  }

  const { parseConsumerManifestBytes } = await import(
    new URL("contract/lib/generation/consumer-manifest.mjs", federatedRoot)
  );
  const manifest = parseConsumerManifestBytes(
    readFileSync(new URL("contract/registry/generated-consumers.yaml", federatedRoot)),
  );
  const webConsumer = manifest.consumers.find(
    ({ consumerRepository }) => consumerRepository === "kokoro-web",
  );
  assert.ok(webConsumer, "Root consumer registry must declare kokoro-web");
  const governedSources = new Set(expectedMappings.map(({ source }) => source));
  const actualMappings = webConsumer.schema
    .filter(({ source }) => governedSources.has(source))
    .map(({ source, output }) => ({ source, output }));

  assert.deepEqual(actualMappings, expectedMappings);
  const serializedConsumer = JSON.stringify(webConsumer);
  for (const retired of retiredSourceNames) {
    assert.equal(
      serializedConsumer.includes(retired),
      false,
      `retired Presentation schema remains in Root Web generation: ${retired}`,
    );
  }
  assert.deepEqual(
    webConsumer.outputRoots.filter((root) => root.startsWith("packages/session-client/src/generated/")),
    [
      "packages/session-client/src/generated/schema",
      "packages/session-client/src/generated/contracts",
    ],
  );

  const index = JSON.parse(readFileSync(new URL("generated/provenance-index.json", webRoot), "utf8"));
  assert.equal(index.consumerRepository, "kokoro-web");
  assert.deepEqual(index.packages.map(({ packagePath }) => packagePath), [
    "apps/admin",
    "packages/session-client",
    "packages/site-client",
  ]);
  for (const entry of index.packages) {
    const manifestPath = new URL(entry.manifestPath, webRoot);
    assert(existsSync(manifestPath), entry.manifestPath);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    assert.equal(manifest.manifestDigest, entry.manifestDigest);
    assert.equal(manifest.consumerRepository, "kokoro-web");
    for (const output of manifest.outputs) {
      const outputPath = new URL(output.path, webRoot);
      assert(existsSync(outputPath), output.path);
      assert.equal(fileDigest(outputPath), output.sha256, output.path);
    }
  }
});
