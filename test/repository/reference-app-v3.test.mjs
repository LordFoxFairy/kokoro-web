import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

test("the formal workspace contains only Admin, the reference fixture, and shared packages", async () => {
  const workspace = await readFile(path.join(root, "pnpm-workspace.yaml"), "utf8")
  assert.match(workspace, /^packages:\n  - apps\/admin\n  - apps\/reference-site\n  - packages\/\*/u)
  assert.doesNotMatch(workspace, /apps\/\*/u)
})

test("the independently generated Site template owns the complete Browser v3 product composition", async () => {
  const [manifest, page] = await Promise.all([
    readFile(path.join(root, "packages/site-scaffold/templates/site/package.json"), "utf8"),
    readFile(path.join(root, "packages/site-scaffold/templates/site/src/app/page.tsx"), "utf8"),
  ])
  for (const packageName of [
    "@kokoro/site-bff",
    "@kokoro/session-client",
    "@kokoro/chat-surface",
    "@kokoro/chat-app",
    "@kokoro/account-app",
  ]) assert.match(manifest, new RegExp(packageName.replace("/", "\\/"), "u"))
  assert.match(page, /ChatProduct/u)
  assert.match(page, /readOpaqueAuthSession/u)
  assert.doesNotMatch(page, /apps\/user|HomeGate|SessionShell/u)
})
