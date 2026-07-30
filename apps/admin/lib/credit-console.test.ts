import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const source = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("Admin Credit trace console", () => {
  it("replaces the legacy generic resource table with the typed trace console", () => {
    const page = source("app/credit/page.tsx");
    expect(page).toContain("CreditConsole");
    expect(page).not.toContain("ResourceTable");
  });

  it("covers every Credit fact plane through reviewed BFF routes", () => {
    const console = source("components/credit/credit-console.tsx");
    for (const endpoint of ["summary", "accounts", "grants", "holds", "hold-allocations",
      "journal-transactions", "journal-entries", "rated-usage", "rated-usage-source-allocations"]) {
      expect(console).toContain(`/api/control/credit/${endpoint}`);
    }
    expect(console).not.toContain("/api/resource");
    expect(console).not.toContain("ResourceTable");
  });

  it("bounds cursor windows, discards stale responses and shows observation semantics", () => {
    const console = source("components/credit/credit-console.tsx");
    expect(console).toContain("appendCursorPage");
    expect(console).toContain("clearNextPageToken");
    expect(console).toContain("LatestRequest");
    expect(console).toContain("maxItems: 1000");
    expect(console).toContain("maxPages: 20");
    expect(console).toContain("membershipWatermark");
    expect(console).toContain("observedAt");
  });

  it("keeps raw evidence and provider payloads outside the browser UI", () => {
    const console = source("components/credit/credit-console.tsx");
    expect(console).not.toContain("evidenceRef");
    expect(console).not.toContain("providerPayload");
    expect(console).not.toContain("ratedUsageDigest");
  });
});
