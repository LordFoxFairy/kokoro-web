import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

const appRoot = resolve(import.meta.dirname, "../..");
const contractRoot = resolve(appRoot, "contracts/iam");

const providerSchema = z.object({
  repository: z.literal("kokoro-iam"),
  commit: z.literal("ee61ed002101d38f8061aa29c0f89fbb48bdd6be"),
  tree: z.literal("b551807b4a77b3c450ba7572e3fc01c9e447a970"),
  protoSha256: z.literal("6c0e590a6474aa31e4f418805e36fb92e92a4c91fb3a3909aed09bb8e7f19538"),
  migrationSha256: z.literal("f9f2c8e79a332492b638287ae201fb8d96f3ae22bbc3e5e52a4b7535073c7ceb"),
  catalogSha256: z.literal("57746098d3a1a905154e5a257facd02c9ec800f028fc3e3d71f7d6ca78f04caf"),
  acceptedRunId: z.literal("iam-20260817T125825922Z-ee61ed002101"),
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
