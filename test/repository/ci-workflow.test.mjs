import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");

test("web CI installs and verifies with its pinned pnpm lock", async () => {
  const workflow = await readFile(resolve(root, ".github/workflows/ci.yml"), "utf8");
  const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));

  assert.equal(packageJson.packageManager, "pnpm@11.2.2");
  assert.match(workflow, /node-version:\s*["']?22["']?/u);
  assert.match(workflow, /corepack enable/u);
  assert.match(workflow, /corepack prepare pnpm@11\.2\.2 --activate/u);
  assert.match(workflow, /pnpm install --frozen-lockfile/u);
  assert.match(workflow, /pnpm -r typecheck/u);
  assert.match(workflow, /pnpm -r lint/u);
  assert.match(workflow, /pnpm -r test/u);
  assert.match(workflow, /pnpm --filter @kokoro\/web-user build/u);
  assert.match(workflow, /pnpm --filter @kokoro\/admin-web build/u);
  assert.match(workflow, /AUTH_SECRET:\s*example-/u);
  assert.match(workflow, /DATABASE_URL_ADMIN:\s*mysql:\/\/example:/u);
  assert.match(workflow, /KOKORO_GATEWAY_URL:\s*http:\/\/127\.0\.0\.1:/u);
  assert.match(workflow, /KOKORO_ADMIN_PROXY_SECRET:\s*example-/u);
  assert.doesNotMatch(workflow, /npm ci/u);
});
