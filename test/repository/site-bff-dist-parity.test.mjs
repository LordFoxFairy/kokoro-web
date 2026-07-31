import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const packageJson = JSON.parse(await readFile(new URL("../../packages/site-bff/package.json", import.meta.url), "utf8"))
const ci = await readFile(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8")

test("the tracked Site BFF import artifact must match its TypeScript source", () => {
  assert.equal(packageJson.exports["."].import, "./dist/index.js")
  assert.equal(packageJson.scripts["verify:dist"], "pnpm run build && git diff --exit-code -- dist")
  assert.match(ci, /pnpm --filter @kokoro\/site-bff verify:dist/u)
})
