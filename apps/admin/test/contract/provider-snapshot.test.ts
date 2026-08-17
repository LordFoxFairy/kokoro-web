import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

const appRoot = resolve(import.meta.dirname, "../..");
const contractRoot = resolve(appRoot, "contracts/iam");

const providerSchema = z.object({
  repository: z.literal("kokoro-iam"),
  commit: z.literal("fc88313bba9201b88af6d4fc623fcf42a7e8b0eb"),
  tree: z.literal("948f39850d6afda4adac3856864dc07a53f6822f"),
  protoSha256: z.literal("5db88198319f5e623ebaa87884f27a9a550a1cee902cac8d74b1d5f9092e191f"),
  migrationSha256: z.literal("f9f2c8e79a332492b638287ae201fb8d96f3ae22bbc3e5e52a4b7535073c7ceb"),
  catalogSha256: z.literal("729276477a79bdb2ed606eff420ee62b0855191470d93b9ac96214741448b784"),
  acceptedRunId: z.literal("iam-20260817T152719515Z-fc88313bba92"),
  files: z.array(z.object({
    path: z.string().regex(/^proto\/kokoro\/(?:common|iam)\/v1\/[a-z_]+\.proto$/u),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  }).strict()).length(10),
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
      "proto/kokoro/iam/v1/development_fixture.proto",
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
