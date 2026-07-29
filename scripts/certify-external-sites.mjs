#!/usr/bin/env node

import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);
const webRoot = resolve(import.meta.dirname, "..");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function digest(content) {
  return createHash("sha256").update(content).digest("hex");
}

async function run(command, args, cwd, extraEnv = {}) {
  const { stdout, stderr } = await execFileAsync(command, args, {
    cwd,
    env: { ...process.env, CI: "1", NEXT_TELEMETRY_DISABLED: "1", ...extraEnv },
    maxBuffer: 16 * 1024 * 1024,
  });
  return { stdout: stdout.trim(), stderr: stderr.trim() };
}

function outputArgument(argv) {
  const index = argv.indexOf("--output");
  if (index === -1) return resolve(webRoot, "test/reports/external-sites");
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) throw new TypeError("--output requires a directory");
  return resolve(process.cwd(), value);
}

async function pack(packageName, destination) {
  await run(pnpm, ["--filter", packageName, "pack", "--pack-destination", destination], webRoot);
  const archives = (await readdir(destination)).filter((name) => name.endsWith(".tgz"));
  const expected = packageName.slice("@kokoro/".length);
  const archiveName = archives.find((name) => name.includes(expected));
  if (archiveName === undefined) throw new Error(`pnpm pack produced no archive for ${packageName}`);
  const archivePath = join(destination, archiveName);
  const packageJson = JSON.parse(
    await readFile(resolve(webRoot, `packages/${expected}/package.json`), "utf8"),
  );
  return {
    name: packageName,
    version: packageJson.version,
    archivePath,
    sha256: digest(await readFile(archivePath)),
  };
}

async function initializeRepository(directory) {
  await run("git", ["init", "--initial-branch=main"], directory);
  await run("git", ["config", "user.name", "Kokoro Site Certifier"], directory);
  await run("git", ["config", "user.email", "site-certifier@invalid"], directory);
  await run("git", ["add", "--all"], directory);
  await run("git", ["commit", "-m", "chore: initialize independent site"], directory);
  return (await run("git", ["rev-parse", "HEAD"], directory)).stdout;
}

async function verifyProject(directory, keyringJson, publicOrigin) {
  await run(pnpm, ["install", "--offline"], directory);
  await run(pnpm, ["install", "--offline", "--frozen-lockfile"], directory);
  const commit = await initializeRepository(directory);
  await run(pnpm, ["lint"], directory);
  await run(pnpm, ["typecheck"], directory);
  await run(pnpm, ["test"], directory);
  await run(pnpm, ["artifact:verify"], directory, {
    KOKORO_CONTRACT_KEYRING_JSON: keyringJson,
  });
  await run(pnpm, ["build"], directory, {
    AUTH_SECRET: "offline-site-certifier-secret-not-for-production-2026",
    AUTH_URL: publicOrigin,
    KOKORO_SITE_PUBLIC_ORIGIN: publicOrigin,
  });
  const status = (await run("git", ["status", "--porcelain"], directory)).stdout;
  if (status !== "") throw new Error(`Site project is dirty after build: ${status}`);
  const lockSha256 = digest(await readFile(join(directory, "pnpm-lock.yaml")));
  const buildId = (await readFile(join(directory, ".next/BUILD_ID"), "utf8")).trim();
  const buildSha256 = digest(
    Buffer.concat([
      Buffer.from(buildId),
      await readFile(join(directory, ".next/required-server-files.json")),
    ]),
  );
  return { commit, lockSha256, buildId, buildSha256 };
}

function sourceArtifact(siteKey, releaseId, packageArtifacts) {
  return digest(JSON.stringify({ siteKey, releaseId, packageArtifacts }));
}

async function main() {
  const outputDirectory = outputArgument(process.argv.slice(2));
  const temporaryRoot = await mkdtemp(join(tmpdir(), "kokoro-external-sites-"));
  const packageDirectory = join(temporaryRoot, "packages");
  const projectsDirectory = join(temporaryRoot, "projects");
  await mkdir(packageDirectory, { recursive: true });
  await mkdir(projectsDirectory, { recursive: true });

  try {
    await run(pnpm, ["--filter", "@kokoro/site-app-kit", "build"], webRoot);
    await run(pnpm, ["--filter", "@kokoro/site-client", "build"], webRoot);
    await run(pnpm, ["--filter", "@kokoro/session-client", "build"], webRoot);
    await run(pnpm, ["--filter", "@kokoro/bff-runtime", "build"], webRoot);
    await run(pnpm, ["--filter", "@kokoro/site-runtime-node", "build"], webRoot);
    await run(pnpm, ["--filter", "@kokoro/chat-surface", "build"], webRoot);
    await run(pnpm, ["--filter", "@kokoro/chat-app", "build"], webRoot);
    await run(pnpm, ["--filter", "@kokoro/site-bff", "build"], webRoot);
    await run(pnpm, ["--filter", "@kokoro/site-scaffold", "build"], webRoot);
    const packages = await Promise.all([
      pack("@kokoro/site-app-kit", packageDirectory),
      pack("@kokoro/site-client", packageDirectory),
      pack("@kokoro/session-client", packageDirectory),
      pack("@kokoro/bff-runtime", packageDirectory),
      pack("@kokoro/site-runtime-node", packageDirectory),
      pack("@kokoro/chat-surface", packageDirectory),
      pack("@kokoro/chat-app", packageDirectory),
      pack("@kokoro/site-bff", packageDirectory),
    ]);
    const packageArtifacts = Object.fromEntries(packages.map((entry) => [entry.name, entry.sha256]));

    const metadataModule = await import(
      pathToFileURL(resolve(webRoot, "packages/site-client/dist/generated/platform-public/contract-metadata.js"))
    );
    const metadata = metadataModule.PLATFORM_PUBLIC_CONTRACT_METADATA;
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const publicKeyDer = publicKey.export({ type: "spki", format: "der" });
    const signingKeyId = `offline-fixture-${digest(publicKeyDer).slice(0, 16)}`;
    const floorPayload = `${metadata.schemaId}:${metadata.contractVersion}:${metadata.sourceDigestSha256}`;
    const contractFloor = {
      contract: metadata.schemaId,
      version: metadata.contractVersion,
      schemaSha256: metadata.sourceDigestSha256,
      signature: sign(null, Buffer.from(floorPayload), privateKey).toString("base64url"),
      signingKeyId,
    };
    const fixtureKeyringJson = JSON.stringify({
      schemaVersion: 1,
      trustMode: "ephemeral_self_signed_fixture_not_production",
      keys: [{
        keyId: signingKeyId,
        algorithm: "Ed25519",
        publicKeySpkiBase64url: publicKeyDer.toString("base64url"),
      }],
    });

    const definitions = [
      {
        reportName: "site-alpha.json",
        packageName: "@independent/site-alpha",
        siteKey: "site-alpha",
        displayName: "Aster Studio",
        releaseId: "alpha.2026.07.28.001",
        hostname: "alpha.external.invalid",
        projectRef: "external/site-alpha",
      },
      {
        reportName: "site-beta.json",
        packageName: "@independent/site-beta",
        siteKey: "site-beta",
        displayName: "Beryl Lab",
        releaseId: "beta.2026.07.28.001",
        hostname: "beta.external.invalid",
        projectRef: "external/site-beta",
      },
    ];

    const scaffoldModule = await import(
      pathToFileURL(resolve(webRoot, "packages/site-scaffold/dist/scaffold.js"))
    );
    const reports = [];
    for (const definition of definitions) {
      const directory = join(projectsDirectory, definition.siteKey);
      const artifactSha256 = sourceArtifact(
        definition.siteKey,
        definition.releaseId,
        packageArtifacts,
      );
      await scaffoldModule.createSiteProject({
        directory,
        packageName: definition.packageName,
        siteKey: definition.siteKey,
        displayName: definition.displayName,
        releaseId: definition.releaseId,
        artifactSha256,
        profileRevision: "launch-profile.v1",
        domains: [{ hostname: definition.hostname, environment: "production" }],
        deployment: { provider: "external", projectRef: definition.projectRef, region: "us-east" },
        contractFloor,
        packages,
      });
      const verification = await verifyProject(directory, fixtureKeyringJson, `https://${definition.hostname}`);
      reports.push({
        schemaVersion: 1,
        qualification: "phase_a_offline_non_qualifying",
        task18QualificationPassed: false,
        siteKey: definition.siteKey,
        packageName: definition.packageName,
        releaseId: definition.releaseId,
        domainBindings: [definition.hostname],
        contractFloor: {
          schemaSha256: contractFloor.schemaSha256,
          signingKeyId: contractFloor.signingKeyId,
          signaturePresent: true,
          trustMode: "ephemeral_self_signed_fixture_not_production",
        },
        packageArtifacts,
        sourceArtifactSha256: artifactSha256,
        sourceCommit: verification.commit,
        lockSha256: verification.lockSha256,
        buildId: verification.buildId,
        buildSha256: verification.buildSha256,
        ci: { present: true, independent: true },
        runtimeVerification: {
          targetNode: "24",
          executedNode: process.versions.node,
          targetNodeExecuted: Number.parseInt(process.versions.node, 10) >= 24,
        },
        deployment: {
          configPresent: true,
          status: "offline_build_only",
          platformActivation: "not_run_requires_live_platform",
        },
        authJourney: "not_run_requires_live_platform",
        rollback: "not_run_requires_live_deployment",
      });
    }

    if (reports[0].packageName === reports[1].packageName || reports[0].sourceCommit === reports[1].sourceCommit) {
      throw new Error("external Site projects did not produce independent identities");
    }
    await mkdir(outputDirectory, { recursive: true });
    for (const [index, report] of reports.entries()) {
      await writeFile(
        join(outputDirectory, definitions[index].reportName),
        `${JSON.stringify(report, null, 2)}\n`,
      );
    }
    const summary = {
      schemaVersion: 1,
      qualification: "phase_a_offline_non_qualifying",
      task18QualificationPassed: false,
      generatedInOsTemporaryDirectory: true,
      independentSiteCount: reports.length,
      allOfflineBuildsPassed: true,
      platformEndToEndActivationPassed: false,
      runtimeVerification: {
        targetNode: "24",
        executedNode: process.versions.node,
        targetNodeExecuted: Number.parseInt(process.versions.node, 10) >= 24,
      },
      remainingBlockers: [
        ...(Number.parseInt(process.versions.node, 10) >= 24 ? [] : ["Node 24 CI execution; local host is older"]),
        "live Platform Site/project/domain/release activation",
        "cross-Site cookie and account isolation against a live Platform",
        "independent deployment launch and rollback receipts",
      ],
      sites: reports.map((report) => ({
        siteKey: report.siteKey,
        packageName: report.packageName,
        releaseId: report.releaseId,
        sourceCommit: report.sourceCommit,
        lockSha256: report.lockSha256,
        buildSha256: report.buildSha256,
      })),
    };
    await writeFile(join(outputDirectory, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
    console.log(`external_sites_phase_a_offline_non_qualifying_ok:${reports.length}:${outputDirectory}`);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

await main();
