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
    | "@kokoro/account-app"
    | "@kokoro/media-app"
    | "@kokoro/memory-app",
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
    const basePackages = [
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
      await createPackageArtifact(root, "media-app", "@kokoro/media-app"),
    ] as const;
    const memoryPackage = await createPackageArtifact(root, "memory-app", "@kokoro/memory-app");
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
      enabledProductIds: ["memory"],
      packages: [...basePackages, memoryPackage],
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
      enabledProductIds: [],
      packages: basePackages,
    });
    const core = await createSiteProject({
      directory: join(root, "core"),
      packageName: "@independent/site-core",
      siteKey: "site-core",
      displayName: "Core Site",
      releaseId: "core.2026.08.11.001",
      artifactSha256: "d".repeat(64),
      profileRevision: "core.v1",
      domains: [{ hostname: "core.external.invalid", environment: "production" }],
      deployment: { provider: "external", projectRef: "external/core", region: "us-east" },
      contractFloor: floor,
      enabledProductIds: [],
      allowedLaunchOperations: [
        "identity.revoke-sessions",
        "identity.enroll-totp",
        "identity.disable-totp",
        "identity.regenerate-recovery-codes",
        "redemption.preview",
        "redemption.confirm",
      ],
      packages: basePackages,
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
    expect(alpha.generatedFiles).toContain(".env.example");
    expect(alpha.generatedFiles).toContain("Dockerfile");
    expect(alpha.generatedFiles).toContain("src/app/api/health/live/route.ts");
    expect(alpha.generatedFiles).toContain("src/app/api/health/ready/route.ts");
    expect(alpha.generatedFiles).toContain("src/app/api/media/[[...path]]/route.ts");
    expect(alpha.generatedFiles).toContain("src/app/studio/page.tsx");
    expect(alpha.generatedFiles).toContain("src/app/library/page.tsx");
    expect(alpha.generatedFiles).toContain("vendor/media-app.tgz");
    expect(alpha.generatedFiles).toContain("vendor/memory-app.tgz");
    expect(alpha.generatedFiles).toContain("src/app/memory/page.tsx");
    expect(alpha.generatedFiles).toContain("src/app/api/memory/[[...path]]/route.ts");
    expect(beta.generatedFiles).not.toContain("vendor/memory-app.tgz");
    expect(beta.generatedFiles).not.toContain("src/app/memory/page.tsx");
    expect(beta.generatedFiles).not.toContain("src/app/api/memory/[[...path]]/route.ts");
    expect(beta.generatedFiles).toContain("deploy/artifact-manifest.json");
    expect(beta.generatedFiles).toContain("src/app/register/page.tsx");
    expect(beta.generatedFiles).toContain("src/app/verify-email/page.tsx");
    expect(await readFile(join(beta.directory, "src/app/login/page.tsx"), "utf8")).toContain("Create an account");
    expect(core.generatedFiles).not.toContain("src/app/register/page.tsx");
    expect(core.generatedFiles).not.toContain("src/app/verify-email/page.tsx");
    await expect(readFile(join(core.directory, "src/app/register/page.tsx"))).rejects.toThrow();
    await expect(readFile(join(core.directory, "src/app/verify-email/page.tsx"))).rejects.toThrow();
    expect(await readFile(join(core.directory, "src/app/login/page.tsx"), "utf8")).not.toContain("Create an account");
    const coreLaunchApi = await readFile(join(core.directory, "src/launch-api.ts"), "utf8");
    expect(coreLaunchApi).toContain("allowedOperations");
    expect(coreLaunchApi).not.toContain("identity.register");
    expect(coreLaunchApi).not.toContain("identity.verify-email");
    expect(coreLaunchApi).not.toContain("identity.resend-verification");

    const alphaManifest = JSON.parse(await readFile(join(alpha.directory, "deploy/artifact-manifest.json"), "utf8"));
    const betaManifest = JSON.parse(await readFile(join(beta.directory, "deploy/artifact-manifest.json"), "utf8"));
    const alphaSite = await readFile(join(alpha.directory, "src/site-bootstrap.ts"), "utf8");
    const betaSite = await readFile(join(beta.directory, "src/site-bootstrap.ts"), "utf8");
    const alphaLayout = await readFile(join(alpha.directory, "src/app/layout.tsx"), "utf8");
    const betaLayout = await readFile(join(beta.directory, "src/app/layout.tsx"), "utf8");
    const alphaNextConfig = await readFile(join(alpha.directory, "next.config.ts"), "utf8");
    const betaNextConfig = await readFile(join(beta.directory, "next.config.ts"), "utf8");
    const alphaWorkspace = await readFile(join(alpha.directory, "pnpm-workspace.yaml"), "utf8");
    const betaWorkspace = await readFile(join(beta.directory, "pnpm-workspace.yaml"), "utf8");
    expect(alphaManifest.enabledProductIds).toEqual(["memory"]);
    expect(alphaManifest.packages).toHaveProperty("@kokoro/memory-app");
    expect(alphaSite).toContain('enabledProductIds: [\n  "memory"\n]');
    expect(alphaLayout).toContain('href="/memory"');
    expect(alphaNextConfig).toContain("@kokoro/memory-app");
    expect(alphaWorkspace).toContain("@kokoro/memory-app");
    expect(betaManifest.enabledProductIds).toEqual([]);
    expect(betaManifest.packages).not.toHaveProperty("@kokoro/memory-app");
    expect(betaSite).not.toContain('"memory"');
    expect(betaLayout).not.toContain('href="/memory"');
    expect(betaNextConfig).not.toContain("@kokoro/memory-app");
    expect(betaWorkspace).not.toContain("@kokoro/memory-app");
    await expect(readFile(join(beta.directory, "vendor/memory-app.tgz"))).rejects.toThrow();
    await expect(readFile(join(beta.directory, "src/app/memory/page.tsx"))).rejects.toThrow();
    await expect(readFile(join(beta.directory, "src/app/api/memory/[[...path]]/route.ts"))).rejects.toThrow();
    const betaPackage = JSON.parse(await readFile(join(beta.directory, "package.json"), "utf8"));
    expect(betaPackage.dependencies).not.toHaveProperty("@kokoro/memory-app");

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
      enabledProductIds: [],
      packages: basePackages,
    })).rejects.toThrow("refusing to overwrite existing Site target");
    expect(await readFile(join(occupied, "owner.txt"), "utf8")).toBe("existing owner\n");

    const generatedSource = await readFile(join(alpha.directory, "src/site-bootstrap.ts"), "utf8");
    expect(generatedSource).not.toMatch(/request\.headers\.host|PLATFORM_URL|DATABASE_URL|@kokoro\/admin|prisma/iu);
  });
});
