import assert from "node:assert/strict"
import { access, readFile } from "node:fs/promises"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

test("the formal workspace contains only Admin, the reference fixture, and shared packages", async () => {
  const workspace = await readFile(path.join(root, "pnpm-workspace.yaml"), "utf8")
  assert.match(workspace, /^packages:\n  - apps\/admin\n  - apps\/reference-site\n  - packages\/\*/u)
  assert.doesNotMatch(workspace, /apps\/\*/u)
})

test("fresh-only Web exposes no retired universal Site runtime", async () => {
  await assert.rejects(access(path.join(root, "apps/user/package.json")))
  const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"))
  assert.equal(manifest.scripts.start, undefined)
  assert.equal(manifest.scripts.dev, undefined)
  assert.equal(manifest.scripts["dev:reference"], "pnpm --filter @kokoro/reference-site dev")
})

test("the independently generated Site template owns the complete Browser v3 product composition", async () => {
  const [manifest, page, studio, library, mediaApi] = await Promise.all([
    readFile(path.join(root, "packages/site-scaffold/templates/site/package.json"), "utf8"),
    readFile(path.join(root, "packages/site-scaffold/templates/site/src/app/page.tsx"), "utf8"),
    readFile(path.join(root, "packages/site-scaffold/templates/site/src/app/studio/page.tsx"), "utf8"),
    readFile(path.join(root, "packages/site-scaffold/templates/site/src/app/library/page.tsx"), "utf8"),
    readFile(path.join(root, "packages/site-scaffold/templates/site/src/app/api/media/[[...path]]/route.ts"), "utf8"),
  ])
  for (const packageName of [
    "@kokoro/site-bff",
    "@kokoro/session-client",
    "@kokoro/chat-surface",
    "@kokoro/asset-client",
    "@kokoro/chat-app",
    "@kokoro/account-app",
    "@kokoro/media-app",
  ]) assert.match(manifest, new RegExp(packageName.replace("/", "\\/"), "u"))
  assert.match(page, /ChatProduct/u)
  assert.match(page, /readOpaqueAuthSession/u)
  assert.match(studio, /StudioProduct/u)
  assert.match(studio, /enabledSurfaceIds\.includes\("image"\)/u)
  assert.match(library, /LibraryProduct/u)
  assert.match(mediaApi, /createSiteMediaApi/u)
  assert.doesNotMatch(page, /apps\/user|HomeGate|SessionShell/u)
})

test("the generated Site is a production artifact with fail-fast config and health probes", async () => {
  const [environment, dockerfile, deployment, instrumentation, page] = await Promise.all([
    readFile(path.join(root, "packages/site-scaffold/templates/site/.env.example"), "utf8"),
    readFile(path.join(root, "packages/site-scaffold/templates/site/Dockerfile"), "utf8"),
    readFile(path.join(root, "packages/site-scaffold/templates/site/deploy/site-deployment.json"), "utf8"),
    readFile(path.join(root, "packages/site-scaffold/templates/site/src/instrumentation.ts"), "utf8"),
    readFile(path.join(root, "packages/site-scaffold/templates/site/src/app/page.tsx"), "utf8"),
  ])
  assert.match(environment, /KOKORO_SITE_RUNTIME_PLATFORM_ORIGIN/u)
  assert.match(environment, /KOKORO_SITE_RUNTIME_SESSION_ORIGIN/u)
  assert.match(dockerfile, /\.next\/standalone/u)
  assert.match(deployment, /\/api\/health\/live/u)
  assert.match(deployment, /\/api\/health\/ready/u)
  assert.match(instrumentation, /validateSiteRuntimeConfiguration/u)
  assert.match(page, /browserRuntimeScope/u)
})
