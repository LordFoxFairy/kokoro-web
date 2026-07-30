import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const source = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("Admin typed control-plane boundary", () => {
  it("binds Commerce routes to the operator-selected Site and never a deployment default", () => {
    for (const path of ["app/api/control/offers/route.ts", "app/api/control/code-batches/route.ts",
      "app/api/control/redemption-programs/route.ts", "app/api/control/code-batches/[batchRef]/[action]/route.ts"]) {
      const value = source(path);
      expect(value).toContain("siteId");
      expect(value).not.toContain("adminWorkloadConfig");
    }
    expect(source("lib/env.ts")).not.toContain("KOKORO_ADMIN_SITE_ID");
    expect(source("lib/control-plane/config.ts")).not.toMatch(/readonly siteId: string/u);
    const session = source("lib/control-plane/authority-session.ts");
    expect(session).toContain("matchingSites");
    expect(session).not.toContain("scope.site_id === config.siteId");
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

  it("uses typed Site and Audit control planes without a generic gateway fallback", () => {
    const client = source("lib/control-plane/client.ts");
    const sites = source("app/sites/page.tsx");
    const audit = source("app/audit/page.tsx");
    const shell = source("components/shell/app-shell.tsx");
    expect(client).toContain("listSites");
    expect(client).toContain("getSite");
    expect(client).toContain("registerSiteRequestDigest");
    expect(client).toContain("publishSiteReleaseRequestDigest");
    expect(client).toContain("getAuditWithinScope");
    expect(sites).toContain("/api/control/sites");
    expect(sites).toContain("/api/control/sites/releases");
    expect(sites).not.toContain("ResourceTable");
    expect(sites).not.toContain("/api/resource");
    expect(audit).toContain("/api/control/audit");
    expect(audit).not.toContain("EndpointTable");
    expect(audit).not.toContain("/api/audit");
    expect(shell).toContain("/api/control/sites");
  });

  it("retains global authority for Site registration and narrows Site release authority", () => {
    const client = source("lib/control-plane/client.ts");
    const session = source("lib/control-plane/authority-session.ts");
    expect(session).toContain("globalScope");
    expect(client).toContain('commandContext(session, { kind: "global" })');
    expect(client).toContain('commandContext(session, { kind: "site", siteId: input.siteId })');
    expect(client).toContain("certification.signatureBase64");
    expect(client).toContain("canonicalSignature(input.certification.signatureBase64)");
    expect(client).toContain('Buffer.from(value, "base64")');
  });
});
