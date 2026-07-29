import assert from "node:assert/strict"
import { readFile, readdir } from "node:fs/promises"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const user = path.join(root, "apps/user")

test("the user root page is a Browser v3 reference harness", async () => {
  const [page, manifest] = await Promise.all([
    readFile(path.join(user, "src/app/page.tsx"), "utf8"),
    readFile(path.join(user, "package.json"), "utf8").then(JSON.parse),
  ])
  assert.match(page, /ChatProduct/u)
  assert.doesNotMatch(page, /HomeGate|SessionShell/u)
  assert.equal(manifest.dependencies["@kokoro/session-client"], "workspace:*")
  assert.equal(manifest.dependencies["@kokoro/chat-surface"], "workspace:*")
  assert.equal(manifest.dependencies["@kokoro/chat-app"], "workspace:*")
})

test("legacy user code is quarantined rather than made contract-compatible", async () => {
  const [tsconfig, vitest, legacyReducer] = await Promise.all([
    readFile(path.join(user, "tsconfig.json"), "utf8").then(JSON.parse),
    readFile(path.join(user, "vitest.config.ts"), "utf8"),
    readFile(path.join(user, "src/core/reducer.ts"), "utf8"),
  ])
  assert.ok(tsconfig.exclude.includes("src/core/**"))
  assert.ok(tsconfig.exclude.includes("src/billing/**"))
  assert.match(vitest, /tests\/reference/u)
  assert.match(legacyReducer, /message\.delta/u)
})

test("active reference modules cannot import legacy application domains", async () => {
  const referenceRoot = path.join(user, "src/reference")
  const files = (await readdir(referenceRoot)).filter((name) => /\.(?:ts|tsx)$/u.test(name))
  const forbidden = /(?:@\/|\.\.\/)(?:billing|core|dev|engine|hub|team|ui\/)/u
  for (const file of files) {
    const source = await readFile(path.join(referenceRoot, file), "utf8")
    assert.doesNotMatch(source, forbidden, file)
  }
})
