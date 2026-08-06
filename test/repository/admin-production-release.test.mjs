import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");
const source = (path) => readFile(resolve(root, path), "utf8");

test("Admin is a dedicated Next standalone image and never reuses the reference fixture", async () => {
  const [config, dockerfile, packageManifest, ci] = await Promise.all([
    source("apps/admin/next.config.ts"),
    source("apps/admin/Dockerfile"),
    source("package.json").then(JSON.parse),
    source(".github/workflows/ci.yml"),
  ]);

  assert.match(config, /output:\s*["']standalone["']/u);
  assert.match(config, /outputFileTracingRoot/u);
  assert.match(dockerfile, /^FROM node:24\.13\.0-alpine3\.23 AS dependencies$/mu);
  assert.match(dockerfile, /pnpm --filter @kokoro\/admin-web build/u);
  assert.match(dockerfile, /apps\/admin\/\.next\/standalone/u);
  assert.match(dockerfile, /apps\/admin\/\.next\/static/u);
  assert.match(dockerfile, /^USER 10001:10001$/mu);
  assert.match(dockerfile, /^CMD \["node", "apps\/admin\/server\.js"\]$/mu);
  assert.match(dockerfile, /\/api\/health\/live/u);
  assert.doesNotMatch(dockerfile, /reference-site|next start|AUTH_SECRET|KOKORO_ADMIN_TLS_/u);
  assert.equal(
    packageManifest.scripts["build:admin:image"],
    "docker build --file apps/admin/Dockerfile .",
  );
  assert.match(ci, /docker build --file apps\/admin\/Dockerfile/u);
  assert.doesNotMatch(ci, /docker build[^\n]*reference-site/u);
});

test("Admin owner inventory authorizes one digest-only, non-privileged read-only deployable", async () => {
  const inventory = await source("deployables.yaml");

  assert.match(inventory, /^schemaVersion: 1$/mu);
  assert.match(inventory, /^  dockerfile: apps\/admin\/Dockerfile$/mu);
  assert.match(inventory, /^  - id: admin-web$/mu);
  assert.match(inventory, /^    artifactReferencePolicy: oci-digest-only$/mu);
  assert.match(inventory, /^    activationAuthorized: true$/mu);
  assert.match(inventory, /^    runtimeTraffic: true$/mu);
  assert.match(inventory, /^    launchReadiness: ready$/mu);
  assert.match(inventory, /^      runAsUser: 10001$/mu);
  assert.match(inventory, /^      runAsGroup: 10001$/mu);
  assert.match(inventory, /^      readOnlyRootFilesystem: true$/mu);
  assert.match(inventory, /^      allowPrivilegeEscalation: false$/mu);
  assert.match(inventory, /^      dropCapabilities: \[ALL\]$/mu);
  assert.match(inventory, /^      writableTmpfs: \[\/tmp\]$/mu);
  assert.match(inventory, /liveness: \{ path: \/api\/health\/live, port: http, scheme: HTTP \}/u);
  assert.match(inventory, /readiness: \{ path: \/api\/health\/ready, port: http, scheme: HTTP \}/u);
  assert.match(inventory, /^  - id: independent-site-release$/mu);
  assert.match(inventory, /^    artifactSource: independent-site-project$/mu);
  assert.match(inventory, /^    activationAuthorized: false$/mu);
  assert.match(inventory, /^    runtimeTraffic: false$/mu);
  assert.match(inventory, /^    launchReadiness: blocked$/mu);
  assert.match(inventory, /^      - no-exact-site-release-selected$/mu);
  assert.doesNotMatch(inventory, /reference-site|latest|compatibility|fallback/iu);
});

test("Admin probes are exact unauthenticated routes and readiness checks the secure dependency", async () => {
  const [live, ready, health, dependencyReadiness, proxy] = await Promise.all([
    source("apps/admin/app/api/health/live/route.ts"),
    source("apps/admin/app/api/health/ready/route.ts"),
    source("apps/admin/lib/health.ts"),
    source("apps/admin/lib/control-plane/readiness.ts"),
    source("apps/admin/proxy.ts"),
  ]);

  for (const route of [live, ready]) {
    assert.match(route, /export const runtime = "nodejs"/u);
    assert.match(route, /export const dynamic = "force-dynamic"/u);
    assert.doesNotMatch(route, /process\.env|fetch\(|authority|cookie/iu);
  }
  assert.match(health, /adminControlPlaneReadiness/u);
  assert.doesNotMatch(health, /error\.message|String\(error\)|console\./u);
  assert.match(dependencyReadiness, /adminWorkloadConfig/u);
  assert.match(dependencyReadiness, /connect/u);
  assert.match(dependencyReadiness, /remoteSettings/u);
  assert.match(dependencyReadiness, /ALPNProtocols:\s*\["h2"\]/u);
  assert.doesNotMatch(dependencyReadiness, /\.request\(|authorization|cookie/iu);
  assert.match(proxy, /pathname === "\/api\/health\/live"/u);
  assert.match(proxy, /pathname === "\/api\/health\/ready"/u);
  assert.doesNotMatch(proxy, /pathname\.startsWith\("\/api\/health/u);
});

test("Admin release runbook promotes and rolls back immutable digests without rebuilding", async () => {
  const runbook = await source("apps/admin/deploy/README.md");

  assert.match(runbook, /registry\/repository@sha256:<64-hex>/u);
  assert.match(runbook, /--read-only/u);
  assert.match(runbook, /--tmpfs \/tmp/u);
  assert.match(runbook, /\/api\/health\/ready/u);
  assert.match(runbook, /rollback/iu);
  assert.doesNotMatch(runbook, /:latest|docker build.*rollback/iu);
});
