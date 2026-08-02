import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import { rolldown } from "rolldown";

const root = resolve(import.meta.dirname, "../..");
const productionEntries = [
  resolve(root, "packages/session-client/src/index.ts"),
  resolve(root, "packages/chat-surface/src/index.ts"),
];

test("Node 24 production main entries include the reviewed AG-UI core without stock transport", async () => {
  assert.ok(Number.parseInt(process.versions.node, 10) >= 24, "repository bundle gate requires Node 24");
  const bundle = await rolldown({ input: productionEntries });
  try {
    const generated = await bundle.generate({ format: "esm" });
    const chunks = generated.output.filter((output) => output.type === "chunk");
    const moduleIds = chunks.flatMap((chunk) => chunk.moduleIds);
    assert.ok(moduleIds.length > 0, "real Rolldown graph must contain production modules");
    for (const entry of productionEntries) {
      assert.ok(moduleIds.includes(entry), `real Rolldown graph must include ${entry}`);
    }
    assert.ok(
      moduleIds.some((moduleId) => /(?:^|\/)node_modules\/@ag-ui\/core(?:\/|$)/u.test(moduleId)),
      "the active Session presentation entry must use the reviewed @ag-ui/core protocol package",
    );
    assert.ok(
      moduleIds.some((moduleId) => moduleId.endsWith("/session-client/src/agui-presentation-state-machine.internal.ts")),
      "the active Session presentation state machine must be part of the production graph",
    );
    for (const moduleId of moduleIds) {
      assert.doesNotMatch(moduleId, /@ag-ui\/client/u);
      assert.doesNotMatch(moduleId, /useAgUiRuntime/u);
    }
    const emitted = chunks.map((chunk) => chunk.code).join("\n");
    assert.doesNotMatch(emitted, /@ag-ui\/client/u);
    assert.doesNotMatch(emitted, /useAgUiRuntime/u);
  } finally {
    await bundle.close();
  }
});
