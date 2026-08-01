import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const rootPackageUrl = new URL("../../package.json", import.meta.url)
const chatPackageUrl = new URL("../../packages/chat-surface/package.json", import.meta.url)
const cliUrl = new URL("../../packages/chat-surface/scripts/agui-compatibility-consumer.mjs", import.meta.url)
const consumerUrl = new URL(
  "../../packages/chat-surface/src/runtime/agui-compatibility-consumer.ts",
  import.meta.url,
)

test("the AG-UI consumer CLI enters only through the public compatibility export", async () => {
  const [rootPackage, chatPackage, cli, consumer] = await Promise.all([
    readFile(rootPackageUrl, "utf8").then(JSON.parse),
    readFile(chatPackageUrl, "utf8").then(JSON.parse),
    readFile(cliUrl, "utf8"),
    readFile(consumerUrl, "utf8"),
  ])

  assert.equal(
    rootPackage.scripts["compat:agui-consumer"],
    "pnpm --filter @kokoro/chat-surface compat:agui-consumer",
  )
  assert.equal(
    chatPackage.scripts["compat:agui-consumer"],
    "node scripts/agui-compatibility-consumer.mjs --input",
  )
  assert.equal(
    chatPackage.scripts["precompat:agui-consumer"],
    "pnpm --filter @kokoro/session-client build && pnpm run build",
  )
  assert.deepEqual(chatPackage.exports["./agui-compatibility-consumer"], {
    types: "./src/runtime/agui-compatibility-consumer.ts",
    development: "./src/runtime/agui-compatibility-consumer.ts",
    import: "./dist/runtime/agui-compatibility-consumer.js",
  })
  assert.match(cli, /from "@kokoro\/chat-surface\/agui-compatibility-consumer"/u)
  assert.match(cli, /O_NOFOLLOW/u)
  assert.match(cli, /AGUI_COMPATIBILITY_INPUT_FILE_CHANGED/u)
  assert.doesNotMatch(cli, /\.\.\/src|\.\.\/dist|internal/u)
  assert.doesNotMatch(consumer, /state-machine\.internal|ForTesting|fixtures/u)
})
