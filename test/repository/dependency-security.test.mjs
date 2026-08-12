import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");

async function readPackage(path) {
  return JSON.parse(await readFile(resolve(root, path, "package.json"), "utf8"));
}

const rootPackage = await readPackage(".");
const adminPackage = await readPackage("apps/admin");
const i18nPackage = await readPackage("packages/i18n");
const siteAppKitPackage = await readPackage("packages/site-app-kit");
const siteClientPackage = await readPackage("packages/site-client");
const siteScaffoldPackage = await readPackage("packages/site-scaffold");
const sessionClientPackage = await readPackage("packages/session-client");
const bffRuntimePackage = await readPackage("packages/bff-runtime");
const siteRuntimeNodePackage = await readPackage("packages/site-runtime-node");
const chatSurfacePackage = await readPackage("packages/chat-surface");
const assetClientPackage = await readPackage("packages/asset-client");
const chatAppPackage = await readPackage("packages/chat-app");
const siteBffPackage = await readPackage("packages/site-bff");
const referenceSitePackage = await readPackage("apps/reference-site");
const workspace = await readFile(resolve(root, "pnpm-workspace.yaml"), "utf8");
const lockfile = await readFile(resolve(root, "pnpm-lock.yaml"), "utf8");
const sessionClientMain = await readFile(resolve(root, "packages/session-client/src/index.ts"), "utf8");
const chatSurfaceMain = await readFile(resolve(root, "packages/chat-surface/src/index.ts"), "utf8");

function parseSemver(value) {
  const match = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u.exec(value);
  assert.ok(match, `invalid semantic version in pnpm lock: ${value}`);
  const prerelease = match[4]?.split(".") ?? [];
  for (const identifier of prerelease) {
    assert.ok(!/^[0-9]+$/u.test(identifier) || identifier === "0" || !identifier.startsWith("0"));
  }
  return {
    core: match.slice(1, 4).map((part) => BigInt(part)),
    prerelease,
  };
}

function compareSemver(leftValue, rightValue) {
  const left = parseSemver(leftValue);
  const right = parseSemver(rightValue);
  for (let index = 0; index < left.core.length; index += 1) {
    if (left.core[index] < right.core[index]) return -1;
    if (left.core[index] > right.core[index]) return 1;
  }
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    return left.prerelease.length === right.prerelease.length ? 0 : left.prerelease.length === 0 ? 1 : -1;
  }
  for (let index = 0; index < Math.max(left.prerelease.length, right.prerelease.length); index += 1) {
    const leftIdentifier = left.prerelease[index];
    const rightIdentifier = right.prerelease[index];
    if (leftIdentifier === undefined || rightIdentifier === undefined) {
      return leftIdentifier === rightIdentifier ? 0 : leftIdentifier === undefined ? -1 : 1;
    }
    if (leftIdentifier === rightIdentifier) continue;
    const leftNumeric = /^[0-9]+$/u.test(leftIdentifier);
    const rightNumeric = /^[0-9]+$/u.test(rightIdentifier);
    if (leftNumeric && rightNumeric) return BigInt(leftIdentifier) < BigInt(rightIdentifier) ? -1 : 1;
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftIdentifier < rightIdentifier ? -1 : 1;
  }
  return 0;
}

function nanoidAffectedByCve202667213(version) {
  return compareSemver(version, "3.3.17") < 0 || (
    compareSemver(version, "4.0.0") >= 0 && compareSemver(version, "5.1.6") < 0
  );
}

test("deployable apps pin the reviewed security patch line", () => {
  for (const app of [adminPackage, referenceSitePackage]) {
    assert.equal(app.dependencies.next, "16.2.12");
    assert.equal(app.dependencies.react, "19.2.8");
    assert.equal(app.dependencies["react-dom"], "19.2.8");
    assert.equal(app.devDependencies["eslint-config-next"], "16.2.12");
    assert.equal(app.devDependencies.eslint, "9.39.5");
    assert.equal(app.devDependencies.vitest, "4.1.10");
  }
  assert.equal(adminPackage.dependencies["next-auth"], undefined);
  assert.equal(adminPackage.dependencies.nodemailer, undefined);
  assert.equal(adminPackage.dependencies.jose, "6.1.3");
  assert.equal(adminPackage.dependencies["@bufbuild/protobuf"], "2.13.0");
  assert.equal(adminPackage.dependencies["@connectrpc/connect"], "2.1.2");
  assert.equal(adminPackage.dependencies["@connectrpc/connect-node"], "2.1.2");
  assert.equal(adminPackage.dependencies["server-only"], "0.0.1");
  assert.equal(adminPackage.dependencies["@ant-design/pro-components"], "2.8.10");
});

test("workspace overrides close transitive production advisories", () => {
  assert.equal(rootPackage.pnpm, undefined);
  assert.match(workspace, /^overrides:\n  "@auth\/core@0\.41\.3>nodemailer": 9\.0\.3\n  "next-auth@5\.0\.0-beta\.32>nodemailer": 9\.0\.3\n  brace-expansion@<1\.1\.16: 1\.1\.16\n  "brace-expansion@>=5\.0\.0 <5\.0\.8": 5\.0\.8\n  "nanoid@3\.3\.16": 3\.3\.17\n  postcss: 8\.5\.23\n  path-to-regexp: 8\.4\.2\n  sharp: 0\.35\.3$/mu);
});

test("the pnpm lock excludes every nanoid version affected by CVE-2026-67213", () => {
  const versions = [...new Set(
    [...lockfile.matchAll(/^  nanoid@([^:\s]+):$/gmu)].map((match) => match[1]),
  )].sort(compareSemver);
  assert.ok(versions.length > 0, "pnpm lock must expose its nanoid resolutions");
  assert.deepEqual(
    versions.filter(nanoidAffectedByCve202667213),
    [],
    `affected nanoid resolutions: ${versions.filter(nanoidAffectedByCve202667213).join(", ")}`,
  );
});

test("the nanoid advisory guard follows both official semantic-version ranges", () => {
  assert.deepEqual([
    "3.3.16", "3.3.17-0", "3.3.17", "4.0.0", "5.1.5", "5.1.6-rc.0", "5.1.6", "6.0.0",
  ].map((version) => [version, nanoidAffectedByCve202667213(version)]), [
    ["3.3.16", true],
    ["3.3.17-0", true],
    ["3.3.17", false],
    ["4.0.0", true],
    ["5.1.5", true],
    ["5.1.6-rc.0", true],
    ["5.1.6", false],
    ["6.0.0", false],
  ]);
});

test("the reviewed Next security patch has narrow release-age exceptions", () => {
  const expected = [
    "@next/env@16.2.12",
    "@next/eslint-plugin-next@16.2.12",
    "@next/swc-darwin-arm64@16.2.12",
    "@next/swc-darwin-x64@16.2.12",
    "@next/swc-linux-arm64-gnu@16.2.12",
    "@next/swc-linux-arm64-musl@16.2.12",
    "@next/swc-linux-x64-gnu@16.2.12",
    "@next/swc-linux-x64-musl@16.2.12",
    "@next/swc-win32-arm64-msvc@16.2.12",
    "@next/swc-win32-x64-msvc@16.2.12",
    "eslint-config-next@16.2.12",
    "next@16.2.12",
  ];

  const configured = workspace.match(/^minimumReleaseAgeExclude:\n((?:  - .+\n?)+)/mu);
  assert.ok(configured, "minimumReleaseAgeExclude must be explicit");
  assert.deepEqual(
    configured[1].trim().split("\n").map((line) => line.trim().replace(/^- ["']?|["']$/gu, "")),
    expected,
  );
});

test("the shared i18n package uses the same supported test and lint majors", () => {
  assert.equal(i18nPackage.devDependencies.eslint, "9.39.5");
  assert.equal(i18nPackage.devDependencies["@eslint/js"], "9.39.5");
  assert.equal(i18nPackage.devDependencies["typescript-eslint"], "8.65.0");
  assert.equal(i18nPackage.devDependencies.vitest, "4.1.10");
});

test("new Site packages use one Node 24 toolchain and the generated client owns Zod 4", () => {
  for (const packageJson of [
    siteAppKitPackage,
    siteClientPackage,
    siteScaffoldPackage,
    sessionClientPackage,
    bffRuntimePackage,
    siteRuntimeNodePackage,
    chatSurfacePackage,
    assetClientPackage,
    chatAppPackage,
    siteBffPackage,
  ]) {
    assert.equal(packageJson.engines.node, ">=24.0.0");
    assert.equal(packageJson.devDependencies.typescript, "5.9.3");
    assert.equal(packageJson.devDependencies.eslint, "9.39.5");
    assert.equal(packageJson.devDependencies.vitest, "4.1.10");
  }
  assert.equal(siteClientPackage.dependencies.zod, "4.4.3");
  assert.equal(siteClientPackage.dependencies["server-only"], "0.0.1");
  assert.equal(siteScaffoldPackage.dependencies.tar, "7.5.21");
  assert.equal(siteBffPackage.dependencies["server-only"], "0.0.1");
  assert.equal(chatAppPackage.dependencies["@kokoro/chat-surface"], "workspace:*");
  assert.equal(chatAppPackage.dependencies["@kokoro/asset-client"], "workspace:*");
  assert.equal(assetClientPackage.dependencies["@kokoro/site-client"], "workspace:*");
  assert.equal(chatSurfacePackage.exports["."].development, "./src/index.ts");
  assert.equal(chatSurfacePackage.exports["."].import, "./dist/index.js");
  assert.equal(chatSurfacePackage.dependencies["@ag-ui/core"], "0.0.57");
  assert.equal(sessionClientPackage.dependencies["@ag-ui/core"], "0.0.57");
  assert.deepEqual(chatSurfacePackage.exports["./agui-presentation"], {
    types: "./src/runtime/agui-presentation-adapter.ts",
    development: "./src/runtime/agui-presentation-adapter.ts",
    import: "./dist/runtime/agui-presentation-adapter.js",
  });
  assert.deepEqual(sessionClientPackage.exports["./agui-presentation"], {
    types: "./src/agui-presentation.ts",
    development: "./src/agui-presentation.ts",
    import: "./dist/agui-presentation.js",
  });
  assert.equal(chatSurfacePackage.exports["./agui-presentation-dormant"], undefined);
  assert.equal(sessionClientPackage.exports["./agui-presentation-dormant"], undefined);
  assert.doesNotMatch(chatSurfaceMain, /agui-presentation/u);
  assert.doesNotMatch(sessionClientMain, /agui-presentation/u);
  assert.equal(bffRuntimePackage.exports["."].development, "./src/index.ts");
  assert.equal(bffRuntimePackage.exports["."].import, "./dist/index.js");
  assert.equal(siteClientPackage.exports["./server"].development, "./src/server.ts");
  assert.equal(siteClientPackage.exports["./server"].import, "./dist/server.js");
  assert.equal(referenceSitePackage.engines.node, ">=24.0.0");
  assert.equal(referenceSitePackage.dependencies.next, "16.2.12");
  assert.equal(referenceSitePackage.dependencies.react, "19.2.8");
  assert.equal(referenceSitePackage.dependencies["react-dom"], "19.2.8");
});

test("the normal root test command executes repository contracts", () => {
  assert.equal(rootPackage.scripts["test:repository"], "node --test test/repository/*.test.mjs");
  assert.equal(rootPackage.scripts.test, "pnpm run test:repository && pnpm -r test");
});
