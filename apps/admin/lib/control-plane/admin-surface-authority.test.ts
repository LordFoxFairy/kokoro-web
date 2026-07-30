import { Code } from "@connectrpc/connect";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAuthoritySession = vi.hoisted(() => vi.fn());
vi.mock("./authority-session", () => ({ requireAuthoritySession }));

describe("server Admin surface authority", () => {
  beforeEach(() => { requireAuthoritySession.mockReset(); });

  it("authorizes from the verified server session rather than request input", async () => {
    const session = { permissions: ["credit.summary.read"] };
    requireAuthoritySession.mockResolvedValue(session);
    const { requireAdminSurfaceSession } = await import("./admin-surface-authority");
    await expect(requireAdminSurfaceSession("creditSummary")).resolves.toBe(session);
    expect(requireAuthoritySession).toHaveBeenCalledOnce();
  });

  it("fails closed before a control-plane request when the signed session lacks permission", async () => {
    requireAuthoritySession.mockResolvedValue({ permissions: ["credit.account.read"] });
    const { requireAdminSurfaceSession } = await import("./admin-surface-authority");
    await expect(requireAdminSurfaceSession("creditSummary")).rejects.toMatchObject({
      connectCode: Code.PermissionDenied,
      domainCode: "admin.permission_denied",
    });
  });

  it("uses the same matrix for typed Users", async () => {
    const session = { permissions: ["admin.user.read"] };
    requireAuthoritySession.mockResolvedValue(session);
    const { requireAdminSurfaceSession } = await import("./admin-surface-authority");
    await expect(requireAdminSurfaceSession("users")).resolves.toBe(session);
  });
});
