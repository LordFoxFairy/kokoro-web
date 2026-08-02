import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { aguiBindingAuthorityContractMetadata } from "../src/generated/agui-binding-authority.js";

const federatedRoot = new URL("../../../../", import.meta.url);

function sha256(path: URL): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

describe("Root-generated AG-UI binding runtime mirror", () => {
  it("records all reviewed Root JSON Schema sources", () => {
    expect(aguiBindingAuthorityContractMetadata).toMatchObject({
      profileRevision: "kokoro-agui-presentation.v1",
      sources: {
        "contract/spec/presentation-run-binding-v1.yaml": expect.stringMatching(/^[0-9a-f]{64}$/u),
        "contract/spec/presentation-message-binding-v1.yaml": expect.stringMatching(/^[0-9a-f]{64}$/u),
        "contract/spec/presentation-owner-binding-v1.yaml": expect.stringMatching(/^[0-9a-f]{64}$/u),
        "contract/spec/presentation-binding-authority-delta-v1.yaml": expect.stringMatching(/^[0-9a-f]{64}$/u),
      },
    });
    expect(Object.keys(aguiBindingAuthorityContractMetadata.sources)).toHaveLength(4);
  });

  it("fails on Root source drift when executed from the federated checkout", () => {
    const federatedContractPresent = existsSync(new URL("contract/INDEX.md", federatedRoot));
    let checkedSources = 0;
    for (const [relativePath, expectedDigest] of Object.entries(
      aguiBindingAuthorityContractMetadata.sources,
    )) {
      const source = new URL(relativePath, federatedRoot);
      if (!existsSync(source)) continue;
      checkedSources += 1;
      expect(sha256(source), relativePath).toBe(expectedDigest);
    }
    expect(checkedSources).toBe(federatedContractPresent ? 4 : 0);
  });
});
