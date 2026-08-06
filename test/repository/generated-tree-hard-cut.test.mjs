import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const webRoot = resolve(import.meta.dirname, "../..");

const retiredGeneratedPaths = [
  "apps/admin/lib/generated/admin-commerce",
  "apps/admin/lib/generated/admin-credit",
  "apps/admin/lib/generated/admin-identity",
  "apps/admin/lib/generated/admin-query-v2",
  "apps/admin/lib/generated/model-control",
  "apps/admin/lib/generated/site-provisioning",
  "packages/site-client/src/generated/asset-data-plane",
  "packages/site-client/src/generated/platform-public",
  "packages/session-client/src/generated/control.ts",
  "packages/session-client/src/generated/http.ts",
  "packages/session-client/src/generated/session-events.ts",
];

const canonicalGeneratedRoots = [
  "apps/admin/lib/generated/proto",
  "apps/admin/lib/generated/contracts",
  "packages/site-client/src/generated/schema",
  "packages/site-client/src/generated/contracts",
  "packages/session-client/src/generated/schema",
  "packages/session-client/src/generated/contracts",
];

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:mjs|ts|tsx)$/u.test(entry.name) ? [path] : [];
  });
}

test("Web keeps one canonical Root-generated tree per consumer surface", () => {
  for (const path of canonicalGeneratedRoots) {
    assert.equal(existsSync(resolve(webRoot, path)), true, `missing canonical generated root: ${path}`);
  }
  for (const path of retiredGeneratedPaths) {
    assert.equal(existsSync(resolve(webRoot, path)), false, `retired generated mirror still exists: ${path}`);
  }
  assert.equal(existsSync(resolve(webRoot,
    "apps/admin/lib/generated/proto/kokoro/platform/credit/v1/credit_catalog_pb.ts")), false,
  "Credit must not regain the Commerce-owned catalog mirror");
});

test("production and verification code import only canonical generated roots", () => {
  const roots = [
    "apps/admin/lib/control-plane",
    "packages/site-client/src",
    "packages/site-client/test",
    "packages/session-client/src",
    "scripts",
  ];
  const retiredReference = /generated\/(?:admin-commerce|admin-credit|admin-identity|admin-query-v2|model-control|site-provisioning|asset-data-plane|platform-public|control\.js|http\.js|session-events\.js)/u;
  const violations = roots.flatMap((root) => sourceFiles(resolve(webRoot, root)))
    .filter((path) => retiredReference.test(readFileSync(path, "utf8")))
    .map((path) => path.slice(webRoot.length + 1));
  assert.deepEqual(violations, []);

  const siteClientPackage = JSON.parse(readFileSync(resolve(webRoot, "packages/site-client/package.json"), "utf8"));
  assert.equal(siteClientPackage.exports["./asset-data-plane"].types,
    "./src/generated/contracts/openapi/asset-data-plane/index.ts");
  assert.equal(siteClientPackage.exports["./asset-data-plane"].import,
    "./dist/generated/contracts/openapi/asset-data-plane/index.js");
});

test("generated provenance owns only files below canonical roots", () => {
  const manifests = [
    "apps/admin/lib/generated/provenance.json",
    "packages/site-client/src/generated/provenance.json",
    "packages/session-client/src/generated/provenance.json",
  ];
  const allowedPrefixes = [
    "apps/admin/lib/generated/proto/",
    "apps/admin/lib/generated/contracts/",
    "packages/site-client/src/generated/schema/",
    "packages/site-client/src/generated/contracts/",
    "packages/session-client/src/generated/schema/",
    "packages/session-client/src/generated/contracts/",
  ];
  for (const manifestPath of manifests) {
    const manifest = JSON.parse(readFileSync(resolve(webRoot, manifestPath), "utf8"));
    for (const output of manifest.outputs) {
      assert.equal(allowedPrefixes.some((prefix) => output.path.startsWith(prefix)), true,
        `${manifestPath} owns an output outside canonical roots: ${output.path}`);
    }
  }
});
