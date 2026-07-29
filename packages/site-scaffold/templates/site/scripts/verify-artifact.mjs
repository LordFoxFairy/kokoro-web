import assert from "node:assert/strict";
import { createHash, createPublicKey, verify } from "node:crypto";
import { readFile } from "node:fs/promises";

import { verifySiteContractFloor } from "@kokoro/site-app-kit";
import { PLATFORM_PUBLIC_CONTRACT_METADATA } from "@kokoro/site-client";

const artifact = JSON.parse(await readFile("deploy/artifact-manifest.json", "utf8"));
const floor = JSON.parse(await readFile("deploy/contract-floor.json", "utf8"));
assert.match(artifact.sourceArtifactSha256, /^[0-9a-f]{64}$/u);
assert.match(artifact.packages["@kokoro/site-app-kit"].sha256, /^[0-9a-f]{64}$/u);
assert.match(artifact.packages["@kokoro/site-client"].sha256, /^[0-9a-f]{64}$/u);
assert.equal(
  createHash("sha256").update(await readFile("vendor/site-app-kit.tgz")).digest("hex"),
  artifact.packages["@kokoro/site-app-kit"].sha256,
);
assert.equal(
  createHash("sha256").update(await readFile("vendor/site-client.tgz")).digest("hex"),
  artifact.packages["@kokoro/site-client"].sha256,
);
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
