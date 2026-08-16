import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

const appRoot = resolve(import.meta.dirname, "../..");
const contractRoot = resolve(appRoot, "contracts/iam");

const providerSchema = z.object({
  repository: z.literal("kokoro-iam"),
  commit: z.literal("16afccdbec9c22176f9fd493feeb0ed0d7fe3445"),
  tree: z.literal("a72b870c8e890eb63176ddb80cc34df3658a474f"),
  protoSha256: z.literal("4daad8affaa7eb36e8f587dca3a016dd080b3ca4f3e36f08a19963133a27e38a"),
  migrationSha256: z.literal("846491c5a72331a8d7aa1a2b51a153165dc636957ac1edf867e3836405f358c2"),
  catalogSha256: z.literal("e388f4a865fa98744989f3e7a6d41d2bf8e6367ae51b8eeee804c763b4bc8552"),
  acceptedRunId: z.literal("iam-20260816T111434155Z-16afccdbec9c"),
  files: z.array(z.object({
    path: z.string().regex(/^proto\/kokoro\/(?:common|iam)\/v1\/[a-z_]+\.proto$/u),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  }).strict()).length(7),
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
      "proto/kokoro/iam/v1/organization.proto",
      "proto/kokoro/iam/v1/session.proto",
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
