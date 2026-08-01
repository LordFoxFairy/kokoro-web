import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import {
  aguiBindingAuthoritySources,
  generateAguiBindingAuthority,
} from "../../scripts/generate-agui-binding-authority.mjs";

const webRoot = new URL("../../", import.meta.url);
const federatedRoot = new URL("../", webRoot);
const generatedArtifact = new URL(
  "packages/session-client/src/generated/agui-binding-authority.ts",
  webRoot,
);

test("the committed AG-UI authority mirror is byte-identical to its Root contracts", (context) => {
  if (!existsSync(new URL("contract/INDEX.md", federatedRoot))) {
    context.skip("standalone Web checkout has no federated Root contract authority");
    return;
  }

  const sources = Object.fromEntries(
    aguiBindingAuthoritySources.map((relativePath) => [
      relativePath,
      readFileSync(new URL(relativePath, federatedRoot), "utf8"),
    ]),
  );
  const expected = generateAguiBindingAuthority(sources);
  const committed = readFileSync(generatedArtifact, "utf8");

  assert.equal(
    committed,
    expected,
    "Root AG-UI binding contracts changed without regenerating the Web authority mirror",
  );
});
