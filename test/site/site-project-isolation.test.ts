import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { create as createTar } from "tar";

import { createSiteProject } from "../../packages/site-scaffold/src/scaffold.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function createPackageArtifact(
  root: string,
  archiveName: string,
  name:
    | "@kokoro/site-app-kit"
    | "@kokoro/site-client"
    | "@kokoro/session-client"
    | "@kokoro/bff-runtime"
    | "@kokoro/site-runtime-node"
    | "@kokoro/chat-surface"
    | "@kokoro/asset-client"
    | "@kokoro/chat-app"
    | "@kokoro/site-bff"
    | "@kokoro/account-app",
) {
  const source = join(root, `${archiveName}-source`);
  await mkdir(join(source, "package"), { recursive: true });
  await writeFile(
    join(source, "package/package.json"),
    `${JSON.stringify({ name, version: "0.1.0" })}\n`,
  );
  const archivePath = join(root, `${archiveName}.tgz`);
  await createTar({ cwd: source, file: archivePath, gzip: true }, ["package"]);
  return {
    name,
    version: "0.1.0",
    archivePath,
    sha256: createHash("sha256").update(await readFile(archivePath)).digest("hex"),
  } as const;
}

describe("independent Site project scaffold", () => {
  it("materializes product-named projects with separate release, domain, CI and deploy authority", async () => {
    const root = await mkdtemp(join(tmpdir(), "site-scaffold-test-"));
    temporaryDirectories.push(root);
    const packages = [
      await createPackageArtifact(root, "app-kit", "@kokoro/site-app-kit"),
      await createPackageArtifact(root, "client", "@kokoro/site-client"),
      await createPackageArtifact(root, "session-client", "@kokoro/session-client"),
      await createPackageArtifact(root, "bff-runtime", "@kokoro/bff-runtime"),
      await createPackageArtifact(root, "site-runtime-node", "@kokoro/site-runtime-node"),
      await createPackageArtifact(root, "chat-surface", "@kokoro/chat-surface"),
      await createPackageArtifact(root, "asset-client", "@kokoro/asset-client"),
      await createPackageArtifact(root, "chat-app", "@kokoro/chat-app"),
      await createPackageArtifact(root, "site-bff", "@kokoro/site-bff"),
      await createPackageArtifact(root, "account-app", "@kokoro/account-app"),
    ] as const;
    const floor = {
      contract: "platform-public-v1" as const,
      version: "1" as const,
      schemaSha256: "a".repeat(64),
      signature: "signed-fixture",
      signingKeyId: "fixture-key",
    };

    const alpha = await createSiteProject({
      directory: join(root, "alpha"),
      packageName: "@independent/site-alpha",
      siteKey: "site-alpha",
      displayName: "Aster Studio",
      releaseId: "alpha.2026.07.28.001",
      artifactSha256: "b".repeat(64),
      profileRevision: "launch.v1",
      domains: [{ hostname: "alpha.external.invalid", environment: "production" }],
      deployment: { provider: "external", projectRef: "external/alpha", region: "us-east" },
      contractFloor: floor,
      packages,
    });
    const beta = await createSiteProject({
      directory: join(root, "beta"),
      packageName: "@independent/site-beta",
      siteKey: "site-beta",
      displayName: "Beryl Lab",
      releaseId: "beta.2026.07.28.001",
      artifactSha256: "c".repeat(64),
      profileRevision: "launch.v1",
      domains: [{ hostname: "beta.external.invalid", environment: "production" }],
      deployment: { provider: "external", projectRef: "external/beta", region: "us-west" },
      contractFloor: floor,
      packages,
    });

    expect(alpha.directory).not.toBe(beta.directory);
    expect(alpha.packageName).not.toBe(beta.packageName);
    expect(alpha.releaseId).not.toBe(beta.releaseId);
    const alphaPackage = JSON.parse(await readFile(join(alpha.directory, "package.json"), "utf8"));
    const betaDeployment = JSON.parse(
      await readFile(join(beta.directory, "deploy/site-deployment.json"), "utf8"),
    );
    expect(alphaPackage.name).toBe("@independent/site-alpha");
    expect(betaDeployment.target.projectRef).toBe("external/beta");
    expect(betaDeployment.domains).toEqual([
      { hostname: "beta.external.invalid", environment: "production" },
    ]);
    expect(alpha.generatedFiles).toContain(".github/workflows/site-ci.yml");
    expect(beta.generatedFiles).toContain("deploy/artifact-manifest.json");

    const occupied = join(root, "occupied");
    await mkdir(occupied);
    await writeFile(join(occupied, "owner.txt"), "existing owner\n");
    await expect(createSiteProject({
      directory: occupied,
      packageName: "@independent/site-occupied",
      siteKey: "site-occupied",
      displayName: "Occupied Site",
      releaseId: "occupied.2026.07.28.001",
      artifactSha256: "d".repeat(64),
      profileRevision: "launch.v1",
      domains: [{ hostname: "occupied.external.invalid", environment: "production" }],
      deployment: { provider: "external", projectRef: "external/occupied", region: "us-east" },
      contractFloor: floor,
      packages,
    })).rejects.toThrow("refusing to overwrite existing Site target");
    expect(await readFile(join(occupied, "owner.txt"), "utf8")).toBe("existing owner\n");

    const generatedSource = await readFile(join(alpha.directory, "src/site-bootstrap.ts"), "utf8");
    expect(generatedSource).not.toMatch(/request\.headers\.host|PLATFORM_URL|DATABASE_URL|@kokoro\/admin|prisma/iu);
  });
});
