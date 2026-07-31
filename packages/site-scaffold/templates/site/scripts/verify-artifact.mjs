import assert from "node:assert/strict";
import { createHash, createPublicKey, verify } from "node:crypto";
import { access, readFile } from "node:fs/promises";

import { verifySiteContractFloor } from "@kokoro/site-app-kit";
import { PLATFORM_PUBLIC_CONTRACT_METADATA } from "@kokoro/site-client";

const artifact = JSON.parse(await readFile("deploy/artifact-manifest.json", "utf8"));
const floor = JSON.parse(await readFile("deploy/contract-floor.json", "utf8"));
const projectPackage = JSON.parse(await readFile("package.json", "utf8"));
const nextConfig = await readFile("next.config.ts", "utf8");
const workspaceConfig = await readFile("pnpm-workspace.yaml", "utf8");
const lockfile = await readFile("pnpm-lock.yaml", "utf8");
assert.ok(Array.isArray(artifact.enabledProductIds));
assert.equal(new Set(artifact.enabledProductIds).size, artifact.enabledProductIds.length);
assert.ok(artifact.enabledProductIds.every((productId) => productId === "memory"));
const memoryEnabled = artifact.enabledProductIds.includes("memory");
assert.match(artifact.sourceArtifactSha256, /^[0-9a-f]{64}$/u);
assert.match(artifact.packages["@kokoro/site-app-kit"].sha256, /^[0-9a-f]{64}$/u);
assert.match(artifact.packages["@kokoro/site-client"].sha256, /^[0-9a-f]{64}$/u);
assert.match(artifact.packages["@kokoro/session-client"].sha256, /^[0-9a-f]{64}$/u);
assert.match(artifact.packages["@kokoro/bff-runtime"].sha256, /^[0-9a-f]{64}$/u);
assert.match(artifact.packages["@kokoro/site-runtime-node"].sha256, /^[0-9a-f]{64}$/u);
assert.match(artifact.packages["@kokoro/chat-surface"].sha256, /^[0-9a-f]{64}$/u);
assert.match(artifact.packages["@kokoro/asset-client"].sha256, /^[0-9a-f]{64}$/u);
assert.match(artifact.packages["@kokoro/chat-app"].sha256, /^[0-9a-f]{64}$/u);
assert.match(artifact.packages["@kokoro/site-bff"].sha256, /^[0-9a-f]{64}$/u);
assert.match(artifact.packages["@kokoro/account-app"].sha256, /^[0-9a-f]{64}$/u);
assert.match(artifact.packages["@kokoro/media-app"].sha256, /^[0-9a-f]{64}$/u);
if (memoryEnabled) assert.match(artifact.packages["@kokoro/memory-app"].sha256, /^[0-9a-f]{64}$/u);
else assert.equal(Object.hasOwn(artifact.packages, "@kokoro/memory-app"), false);
assert.equal(
  createHash("sha256").update(await readFile("vendor/site-app-kit.tgz")).digest("hex"),
  artifact.packages["@kokoro/site-app-kit"].sha256,
);
assert.equal(
  createHash("sha256").update(await readFile("vendor/site-client.tgz")).digest("hex"),
  artifact.packages["@kokoro/site-client"].sha256,
);
assert.equal(
  createHash("sha256").update(await readFile("vendor/session-client.tgz")).digest("hex"),
  artifact.packages["@kokoro/session-client"].sha256,
);
assert.equal(
  createHash("sha256").update(await readFile("vendor/bff-runtime.tgz")).digest("hex"),
  artifact.packages["@kokoro/bff-runtime"].sha256,
);
assert.equal(
  createHash("sha256").update(await readFile("vendor/site-runtime-node.tgz")).digest("hex"),
  artifact.packages["@kokoro/site-runtime-node"].sha256,
);
assert.equal(
  createHash("sha256").update(await readFile("vendor/chat-surface.tgz")).digest("hex"),
  artifact.packages["@kokoro/chat-surface"].sha256,
);
assert.equal(
  createHash("sha256").update(await readFile("vendor/asset-client.tgz")).digest("hex"),
  artifact.packages["@kokoro/asset-client"].sha256,
);
assert.equal(
  createHash("sha256").update(await readFile("vendor/chat-app.tgz")).digest("hex"),
  artifact.packages["@kokoro/chat-app"].sha256,
);
assert.equal(
  createHash("sha256").update(await readFile("vendor/site-bff.tgz")).digest("hex"),
  artifact.packages["@kokoro/site-bff"].sha256,
);
assert.equal(
  createHash("sha256").update(await readFile("vendor/account-app.tgz")).digest("hex"),
  artifact.packages["@kokoro/account-app"].sha256,
);
assert.equal(
  createHash("sha256").update(await readFile("vendor/media-app.tgz")).digest("hex"),
  artifact.packages["@kokoro/media-app"].sha256,
);
if (memoryEnabled) {
  assert.equal(projectPackage.dependencies["@kokoro/memory-app"], "file:vendor/memory-app.tgz");
  assert.equal(
    createHash("sha256").update(await readFile("vendor/memory-app.tgz")).digest("hex"),
    artifact.packages["@kokoro/memory-app"].sha256,
  );
  await access("src/app/memory/page.tsx");
  await access("src/app/api/memory/[[...path]]/route.ts");
  assert.match(await readFile("src/app/layout.tsx", "utf8"), /href="\/memory"/u);
  assert.match(await readFile("src/site-bootstrap.ts", "utf8"), /"memory"/u);
  assert.match(nextConfig, /@kokoro\/memory-app/u);
  assert.match(workspaceConfig, /@kokoro\/memory-app/u);
  assert.match(lockfile, /@kokoro\/memory-app/u);
} else {
  assert.equal(Object.hasOwn(projectPackage.dependencies, "@kokoro/memory-app"), false);
  await assert.rejects(access("vendor/memory-app.tgz"));
  await assert.rejects(access("src/app/memory/page.tsx"));
  await assert.rejects(access("src/app/api/memory/[[...path]]/route.ts"));
  assert.doesNotMatch(await readFile("src/app/layout.tsx", "utf8"), /href="\/memory"/u);
  assert.doesNotMatch(await readFile("src/site-bootstrap.ts", "utf8"), /"memory"/u);
  assert.doesNotMatch(nextConfig, /@kokoro\/memory-app/u);
  assert.doesNotMatch(workspaceConfig, /@kokoro\/memory-app/u);
  assert.doesNotMatch(lockfile, /@kokoro\/memory-app/u);
}
assert.equal(floor.contract, "platform-public-v1");
assert.equal(floor.version, "1");

const serializedKeyring = process.env.KOKORO_CONTRACT_KEYRING_JSON;
assert.ok(serializedKeyring, "KOKORO_CONTRACT_KEYRING_JSON is required from a trusted CI/deploy authority");
const keyringDocument = JSON.parse(serializedKeyring);
assert.equal(keyringDocument.schemaVersion, 1);
assert.ok(Array.isArray(keyringDocument.keys));
const trustedKeys = new Map(
  keyringDocument.keys.map((key) => {
    assert.equal(key.algorithm, "Ed25519");
    assert.match(key.keyId, /^[A-Za-z0-9._:-]{1,128}$/u);
    assert.match(key.publicKeySpkiBase64url, /^[A-Za-z0-9_-]+$/u);
    return [key.keyId, key];
  }),
);

await verifySiteContractFloor({
  floor,
  expected: {
    contract: "platform-public-v1",
    version: "1",
    schemaSha256: PLATFORM_PUBLIC_CONTRACT_METADATA.sourceDigestSha256,
  },
  keyring: { resolve: (signingKeyId) => trustedKeys.get(signingKeyId) },
  verification: {
    verify: ({ keyMaterial, payload, signature }) => verify(
      null,
      Buffer.from(payload),
      createPublicKey({
        key: Buffer.from(keyMaterial.publicKeySpkiBase64url, "base64url"),
        format: "der",
        type: "spki",
      }),
      Buffer.from(signature, "base64url"),
    ),
  },
});
console.log(`artifact_manifest_ok:${artifact.releaseId}`);
