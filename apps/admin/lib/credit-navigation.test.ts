import { describe, expect, it } from "vitest";

import { creditQuery, grantToHolds, holdToUsage, openUsageSourceTrace,
  sourceAllocationToGrant } from "./credit-navigation";

describe("Admin Credit trace navigation", () => {
  it("moves from Grant to the exact related Hold set", () => {
    expect(grantToHolds("grant-one")).toEqual({ view: "holds", filters: { creditGrantId: "grant-one" } });
  });

  it("moves from Hold to the exact RatedUsage set", () => {
    expect(holdToUsage("hold-one")).toEqual({ view: "usage", filters: { creditHoldRef: "hold-one" } });
  });

  it("moves from a Usage source allocation back to its Grant", () => {
    expect(sourceAllocationToGrant("grant-one")).toEqual({ view: "grants", filters: { creditGrantId: "grant-one" } });
  });

  it("opens the exact Settlement allocation trace before drilling into its Grant", () => {
    expect(openUsageSourceTrace("settlement", "settlement-one"))
      .toEqual({ kind: "settlement", ref: "settlement-one" });
    expect(sourceAllocationToGrant("grant-from-settlement"))
      .toEqual({ view: "grants", filters: { creditGrantId: "grant-from-settlement" } });
  });

  it("builds a bounded query without undefined or half-source filters", () => {
    expect(creditQuery("site one", { creditAccountRef: "account/one", sourceType: "redemption",
      sourceRef: "redeem:one", ignored: undefined }, "opaque+cursor")).toBe(
      "siteId=site+one&creditAccountRef=account%2Fone&sourceType=redemption&sourceRef=redeem%3Aone&pageToken=opaque%2Bcursor",
    );
    expect(() => creditQuery("site-one", { sourceType: "redemption" })).toThrow(
      "admin_credit_source_filter_incomplete",
    );
  });
});
