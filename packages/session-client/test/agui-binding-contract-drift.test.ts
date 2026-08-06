import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { z } from "zod";

const federatedRoot = new URL("../../../../", import.meta.url);
const generatedRoot = new URL("../src/generated/", import.meta.url);
const provenanceSchema = z.object({
  sourceRootCommit: z.string().regex(/^[0-9a-f]{40}$/u),
  sourceFiles: z.array(z.object({
    path: z.string().min(1),
    sha256: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
  })),
  outputs: z.array(z.object({
    path: z.string().min(1),
    sha256: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
  })),
});
const presentationSchemas = Object.freeze([
  ["binding-v1", "https://contracts.kokoro.invalid/presentation/binding-v1.schema.json"],
  ["binding-update-v1", "https://contracts.kokoro.invalid/presentation/binding-update-v1.schema.json"],
  ["owner-state-v1", "https://contracts.kokoro.invalid/presentation/owner-state-v1.schema.json"],
  ["snapshot-v1", "https://contracts.kokoro.invalid/presentation/snapshot-v1.schema.json"],
] as const);
const retiredRootPresentationSchemas = Object.freeze([
  "contract/spec/presentation-run-binding-v1.yaml",
  "contract/spec/presentation-message-binding-v1.yaml",
  "contract/spec/presentation-owner-binding-v1.yaml",
  "contract/spec/presentation-binding-authority-delta-v1.yaml",
]);

function sha256(path: URL): string {
  return `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
}

function schemaId(path: URL): unknown {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  return parsed !== null && typeof parsed === "object"
    ? Reflect.get(parsed, "$id")
    : undefined;
}

describe("Root-generated Presentation schema mirrors", () => {
  it("binds every hard-cut source to the committed runtime mirror", () => {
    const provenance = provenanceSchema.parse(JSON.parse(
      readFileSync(new URL("provenance.json", generatedRoot), "utf8"),
    ));
    const sourceDigests = new Map(provenance.sourceFiles.map(({ path, sha256: digest }) => [path, digest]));
    const outputDigests = new Map(provenance.outputs.map(({ path, sha256: digest }) => [path, digest]));
    const federatedContractPresent = existsSync(new URL("contract/INDEX.md", federatedRoot));

    for (const [name, expectedSchemaId] of presentationSchemas) {
      const sourcePath = `contract/spec/presentation/${name}.yaml`;
      const outputPath = `packages/session-client/src/generated/schema/presentation/${name}.schema.json`;
      const sourceDigest = sourceDigests.get(sourcePath);
      const outputDigest = outputDigests.get(outputPath);
      const mirror = new URL(`schema/presentation/${name}.schema.json`, generatedRoot);

      expect(sourceDigest, sourcePath).toMatch(/^sha256:[0-9a-f]{64}$/u);
      expect(outputDigest, outputPath).toBe(sourceDigest);
      expect(sha256(mirror), outputPath).toBe(outputDigest);
      expect(schemaId(mirror), outputPath).toBe(expectedSchemaId);

      if (federatedContractPresent) {
        const source = new URL(sourcePath, federatedRoot);
        expect(sha256(source), sourcePath).toBe(sourceDigest);
        expect(schemaId(source), sourcePath).toBe(expectedSchemaId);
      }
    }

    if (federatedContractPresent) {
      for (const relativePath of retiredRootPresentationSchemas) {
        expect(existsSync(new URL(relativePath, federatedRoot)), relativePath).toBe(false);
      }
    }
  });
});
