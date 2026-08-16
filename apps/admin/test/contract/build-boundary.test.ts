import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { expectedAdminRoutes, scanProductionBundle } from "../../scripts/test/production-boundary";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Admin production build boundary", () => {
  it("WEB-CONTRACT-BUILD-001 accepts the exact route inventory and portable server bundle", async () => {
    const root = await fixture({ server: "portable server bundle", client: "browser client bundle" });

    const result = await scanProductionBundle(root, ["FIXTURE_SECRET"]);

    expect(result.routes).toEqual(expectedAdminRoutes);
    expect(result.violations).toEqual([]);
  });

  it("WEB-CONTRACT-BUILD-001 rejects old routes sibling paths database code and generated IAM in client chunks", async () => {
    const root = await fixture({
      routes: [...expectedAdminRoutes, "/teams"],
      server: "PrismaClient DATABASE_URL /Users/example/kokoro-iam/ FIXTURE_SECRET",
      client: "generated/iam KOKORO_IAM_ADMIN_WEB_TOKEN_FILE",
    });

    const result = await scanProductionBundle(root, ["FIXTURE_SECRET"]);

    expect(result.violations).toEqual(expect.arrayContaining([
      expect.stringContaining("unexpected route: /teams"),
      expect.stringContaining("database authority"),
      expect.stringContaining("sibling path"),
      expect.stringContaining("secret value"),
      expect.stringContaining("generated IAM client chunk"),
      expect.stringContaining("secret name in client chunk"),
    ]));
  });
});

async function fixture(input: Readonly<{
  routes?: readonly string[];
  server: string;
  client: string;
}>): Promise<string> {
  const root = await mkdtemp(join(await realpath(tmpdir()), "kokoro-admin-build-boundary-"));
  roots.push(root);
  await mkdir(join(root, ".next/server"), { recursive: true });
  await mkdir(join(root, ".next/static/chunks"), { recursive: true });
  const routes = input.routes ?? expectedAdminRoutes;
  await writeFile(
    join(root, ".next/app-path-routes-manifest.json"),
    JSON.stringify(Object.fromEntries(routes.map((route, index) => [`/fixture/${String(index)}`, route]))),
  );
  await writeFile(join(root, ".next/server/app.js"), input.server);
  await writeFile(join(root, ".next/static/chunks/app.js"), input.client);
  return root;
}
