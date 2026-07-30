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

test("deployable apps pin the reviewed security patch line", () => {
  for (const app of [adminPackage, referenceSitePackage]) {
    assert.equal(app.dependencies.next, "16.2.12");
    assert.equal(app.dependencies.react, "19.2.8");
    assert.equal(app.dependencies["react-dom"], "19.2.8");
    assert.equal(app.devDependencies["eslint-config-next"], "16.2.12");
    assert.equal(app.devDependencies.eslint, "9.39.5");
    assert.equal(app.devDependencies.vitest, "4.1.10");
  }
  assert.equal(adminPackage.dependencies["next-auth"], "5.0.0-beta.32");
  assert.equal(adminPackage.dependencies["@ant-design/pro-components"], "3.1.14-5");
  assert.equal(adminPackage.dependencies.nodemailer, "9.0.3");
});

test("workspace overrides close transitive production advisories", () => {
  assert.equal(rootPackage.pnpm, undefined);
  assert.match(workspace, /^overrides:\n  "@auth\/core@0\.41\.3>nodemailer": 9\.0\.3\n  "next-auth@5\.0\.0-beta\.32>nodemailer": 9\.0\.3\n  brace-expansion@<1\.1\.16: 1\.1\.16\n  "brace-expansion@>=5\.0\.0 <5\.0\.8": 5\.0\.8\n  postcss: 8\.5\.23\n  path-to-regexp: 8\.4\.2\n  sharp: 0\.35\.3$/mu);
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
  assert.equal(siteScaffoldPackage.dependencies.tar, "7.5.19");
  assert.equal(siteBffPackage.dependencies["server-only"], "0.0.1");
  assert.equal(chatAppPackage.dependencies["@kokoro/chat-surface"], "workspace:*");
  assert.equal(chatAppPackage.dependencies["@kokoro/asset-client"], "workspace:*");
  assert.equal(assetClientPackage.dependencies["@kokoro/site-client"], "workspace:*");
  assert.equal(chatSurfacePackage.exports["."].development, "./src/index.ts");
  assert.equal(chatSurfacePackage.exports["."].import, "./dist/index.js");
  assert.equal(referenceSitePackage.engines.node, ">=24.0.0");
  assert.equal(referenceSitePackage.dependencies.next, "16.2.12");
  assert.equal(referenceSitePackage.dependencies.react, "19.2.8");
  assert.equal(referenceSitePackage.dependencies["react-dom"], "19.2.8");
});

test("the normal root test command executes repository contracts", () => {
  assert.equal(rootPackage.scripts["test:repository"], "node --test test/repository/*.test.mjs");
  assert.equal(rootPackage.scripts.test, "pnpm run test:repository && pnpm -r test");
});
