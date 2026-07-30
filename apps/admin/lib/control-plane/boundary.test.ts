import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const source = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("Admin typed control-plane boundary", () => {
  it("binds Commerce routes to the deployment Site instead of browser site claims", () => {
    for (const path of ["app/api/control/offers/route.ts", "app/api/control/code-batches/route.ts",
      "app/api/control/redemption-programs/route.ts", "app/api/control/code-batches/[batchRef]/[action]/route.ts"]) {
      const value = source(path);
      expect(value).toContain("adminWorkloadConfig");
      expect(value).not.toMatch(/z\.object\(\{\s*siteId:/u);
    }
  });

  it("never persists or automatically replays a raw card-code export", () => {
    const client = source("lib/control-plane/client.ts");
    const page = source("app/code-batches/page.tsx");
    expect(client).toContain("commerce.code_batch.delivery_outcome_unknown");
    expect(client).not.toContain("localStorage");
    expect(`${client}\n${page}`).not.toContain("sessionStorage");
    expect(page).toContain("setSecretExport(null)");
  });

  it("replaces the rotated session epoch and attestation after step-up", () => {
    const identity = source("lib/control-plane/identity-client.ts");
    const session = source("lib/control-plane/authority-session.ts");
    expect(identity).toContain("BigInt(session.sessionEpoch) + 1n");
    expect(identity).toContain("operatorAttestationDigest");
    expect(session).toContain("sessionEpoch: input.sessionEpoch");
  });
});
