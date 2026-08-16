import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const provider = {
  repository: "kokoro-iam",
  commit: "16afccdbec9c22176f9fd493feeb0ed0d7fe3445",
  tree: "a72b870c8e890eb63176ddb80cc34df3658a474f",
  protoSha256: "4daad8affaa7eb36e8f587dca3a016dd080b3ca4f3e36f08a19963133a27e38a",
  migrationSha256: "846491c5a72331a8d7aa1a2b51a153165dc636957ac1edf867e3836405f358c2",
  catalogSha256: "e388f4a865fa98744989f3e7a6d41d2bf8e6367ae51b8eeee804c763b4bc8552",
  acceptedRunId: "iam-20260816T111434155Z-16afccdbec9c",
} as const;

const vendoredProtoPaths = [
  "proto/kokoro/common/v1/error.proto",
  "proto/kokoro/iam/v1/administration.proto",
  "proto/kokoro/iam/v1/auth_adapter.proto",
  "proto/kokoro/iam/v1/authorization.proto",
  "proto/kokoro/iam/v1/organization.proto",
  "proto/kokoro/iam/v1/session.proto",
  "proto/kokoro/iam/v1/types.proto",
] as const;

const providerProtoPaths = [
  "proto/buf.gen.yaml",
  "proto/buf.lock",
  "proto/buf.yaml",
  ...vendoredProtoPaths,
] as const;

function gitText(repository: string, args: readonly string[]): string {
  return execFileSync("git", ["-C", repository, ...args], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  }).trim();
}

function gitFile(repository: string, path: string): Buffer {
  return execFileSync("git", ["-C", repository, "show", `${provider.commit}:${path}`], {
    encoding: "buffer",
    maxBuffer: 16 * 1024 * 1024,
  });
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function sha256Files(files: ReadonlyMap<string, Buffer>): string {
  const digest = createHash("sha256");
  for (const [path, bytes] of [...files.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    digest.update(path);
    digest.update("\0");
    digest.update(bytes);
    digest.update("\0");
  }
  return digest.digest("hex");
}

function requireDigest(name: string, actual: string, expected: string): void {
  if (actual !== expected) throw new Error(`${name} SHA-256 mismatch: expected ${expected}, received ${actual}`);
}

async function main(): Promise<void> {
  const input = process.argv[2];
  if (!input) throw new Error("usage: tsx scripts/contracts/import-iam.ts <iam-repository>");

  const repository = resolve(input);
  const commit = gitText(repository, ["rev-parse", `${provider.commit}^{commit}`]);
  const tree = gitText(repository, ["rev-parse", `${provider.commit}^{tree}`]);
  if (commit !== provider.commit) throw new Error(`IAM commit mismatch: received ${commit}`);
  if (tree !== provider.tree) throw new Error(`IAM tree mismatch: expected ${provider.tree}, received ${tree}`);

  execFileSync("git", ["-C", repository, "archive", "--format=tar", provider.commit, ...vendoredProtoPaths], {
    stdio: "ignore",
  });

  const providerProtoFiles = new Map(providerProtoPaths.map((path) => [path, gitFile(repository, path)]));
  requireDigest("Proto", sha256Files(providerProtoFiles), provider.protoSha256);

  const migrationPaths = gitText(repository, [
    "ls-tree",
    "-r",
    "--name-only",
    provider.commit,
    "prisma/migrations",
  ]).split("\n").filter((path) => path.endsWith(".sql"));
  const migrationFiles = new Map(migrationPaths.map((path) => [path, gitFile(repository, path)]));
  requireDigest("migration", sha256Files(migrationFiles), provider.migrationSha256);
  requireDigest("catalog", sha256(gitFile(repository, "test/catalog/p0.yaml")), provider.catalogSha256);

  const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const contractRoot = resolve(appRoot, "contracts/iam");
  const protoRoot = resolve(contractRoot, "proto");
  const temporaryRoot = resolve(contractRoot, `.proto-import-${String(process.pid)}`);
  await rm(temporaryRoot, { recursive: true, force: true });

  const fileEntries = [];
  for (const path of vendoredProtoPaths) {
    const bytes = providerProtoFiles.get(path);
    if (!bytes) throw new Error(`verified Proto file missing from import set: ${path}`);
    const destination = resolve(temporaryRoot, path.slice("proto/".length));
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, bytes, { mode: 0o644 });
    fileEntries.push({ path, sha256: sha256(bytes) });
  }

  await rm(protoRoot, { recursive: true, force: true });
  await rename(temporaryRoot, protoRoot);
  await writeFile(
    resolve(contractRoot, "provider.json"),
    `${JSON.stringify({ ...provider, files: fileEntries }, null, 2)}\n`,
    { encoding: "utf8", mode: 0o644 },
  );
  process.stdout.write(`Imported ${String(fileEntries.length)} IAM Proto files from ${provider.commit}.\n`);
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
