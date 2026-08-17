import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

const appRoot = resolve(import.meta.dirname, "../..");
const contractRoot = resolve(appRoot, "contracts/iam");

const providerSchema = z.object({
  repository: z.literal("kokoro-iam"),
  commit: z.literal("1a78a61af19e8e8dee4dcc64f8405625f8cc561e"),
  tree: z.literal("935926ed3c1380ce55d9ec5f053c99f7fcea1a65"),
  protoSha256: z.literal("6c0e590a6474aa31e4f418805e36fb92e92a4c91fb3a3909aed09bb8e7f19538"),
  migrationSha256: z.literal("ee19a70a54dac67c4b2f17bd94b76d29ae737a1d455f6a83cf6c5b5df0b72dc1"),
  catalogSha256: z.literal("4c16742a4bcbb9731177613706507b9ae3e255b528f883dca7860504075ed4b8"),
  acceptedRunId: z.literal("iam-20260817T123842963Z-1a78a61af19e"),
  files: z.array(z.object({
    path: z.string().regex(/^proto\/kokoro\/(?:common|iam)\/v1\/[a-z_]+\.proto$/u),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  }).strict()).length(9),
}).strict();

describe("frozen IAM provider snapshot", () => {
  it("WEB-CONTRACT-PROTO-001 records the exact accepted IAM candidate without a sibling path", async () => {
    const source = await readFile(resolve(contractRoot, "provider.json"), "utf8");
    const provider = providerSchema.parse(JSON.parse(source) as unknown);

    expect(source).not.toContain("/Users/");
    expect(source).not.toContain("../kokoro-iam");
    expect(provider.files.map((entry) => entry.path)).toEqual([
      "proto/kokoro/common/v1/error.proto",
      "proto/kokoro/iam/v1/administration.proto",
      "proto/kokoro/iam/v1/auth_adapter.proto",
      "proto/kokoro/iam/v1/authorization.proto",
      "proto/kokoro/iam/v1/credential.proto",
      "proto/kokoro/iam/v1/organization.proto",
      "proto/kokoro/iam/v1/session.proto",
      "proto/kokoro/iam/v1/site.proto",
      "proto/kokoro/iam/v1/types.proto",
    ]);
  });

  it("WEB-CONTRACT-PROTO-001 verifies every vendored descriptor byte", async () => {
    const provider = providerSchema.parse(
      JSON.parse(await readFile(resolve(contractRoot, "provider.json"), "utf8")) as unknown,
    );
    const actualProtoFiles = (await filesBelow(resolve(contractRoot, "proto")))
      .map((path) => path.slice(`${resolve(contractRoot, "proto")}/`.length))
      .map((path) => `proto/${path}`)
      .sort();

    expect(actualProtoFiles).toEqual(provider.files.map((entry) => entry.path));
    for (const entry of provider.files) {
      const bytes = await readFile(resolve(contractRoot, entry.path));
      expect(createHash("sha256").update(bytes).digest("hex"), entry.path).toBe(entry.sha256);
    }
  });
});

async function filesBelow(root: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const pathname = resolve(root, entry.name);
    if (entry.isDirectory()) files.push(...await filesBelow(pathname));
    else files.push(pathname);
  }
  return files.sort();
}
