import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { expectedAdminRoutes, scanProductionBundle } from "../../scripts/test/production-boundary";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Admin production bundle secret boundary", () => {
  it("WEB-SEC-SECRET-001 finds exact generated secret values in server and browser artifacts", async () => {
    const root = await mkdtemp(join(await realpath(tmpdir()), "kokoro-admin-bundle-secret-"));
    roots.push(root);
    await mkdir(join(root, ".next/server"), { recursive: true });
    await mkdir(join(root, ".next/static/chunks"), { recursive: true });
    await writeFile(
      join(root, ".next/app-path-routes-manifest.json"),
      JSON.stringify(Object.fromEntries(expectedAdminRoutes.map((route, index) => [`/${String(index)}`, route]))),
    );
    await writeFile(join(root, ".next/server/app.js"), "AUTH_SECRET_MARKER");
    await writeFile(join(root, ".next/static/chunks/app.js"), "WORKLOAD_SECRET_MARKER");

    const result = await scanProductionBundle(root, ["AUTH_SECRET_MARKER", "WORKLOAD_SECRET_MARKER"]);

    expect(result.violations.filter((value) => value.includes("secret value"))).toHaveLength(2);
  });
});
