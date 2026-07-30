import "server-only";

import type { Client } from "@connectrpc/connect";
import { Code, ConnectError, createClient } from "@connectrpc/connect";

import type { AdminSurface } from "../admin-surface-permissions";
import { requireAdminSurfaceSession } from "./admin-surface-authority";
import { AdminControlPlaneError, authHeaders, queryContext } from "./client";
import { adminControlPlaneTransport } from "./transport";
import { KokoroErrorDetailSchema } from
  "@/lib/generated/admin-query-v2/kokoro/common/v1/error_pb";
import { AdminQueryService } from
  "@/lib/generated/admin-query-v2/kokoro/platform/admin/v2/admin_query_pb";

type UserRpc = Client<typeof AdminQueryService>;
type UserRuntime = Readonly<{ rpc: UserRpc;
  context: Parameters<UserRpc["getUserWithinSite"]>[0]["context"]; headers: Headers }>;
type RuntimeResolver = (siteId: string, surface: AdminSurface) => Promise<UserRuntime>;

export class AdminUserInvalidResponseError extends AdminControlPlaneError {
  constructor() {
    super(Code.Internal, "admin_user.invalid_response");
    this.name = "AdminUserInvalidResponseError";
  }
}

export function createAdminUserReader(runtime: RuntimeResolver) {
  return Object.freeze({
    async getUserWithinSite(siteId: string, userRef: string) {
      const { rpc, context, headers } = await runtime(siteId, "users");
      const selectedScope = context?.scope?.kind;
      if (selectedScope?.case !== "site") throw invalidResponse();
      const selectedSiteIds = selectedScope.value.siteIds ?? [];
      if (selectedSiteIds.length !== 1 || selectedSiteIds[0] !== siteId) throw invalidResponse();
      const response = await call(() => rpc.getUserWithinSite({ context, siteId, userRef }, { headers }));
      if (response.user === undefined || response.user.userRef !== userRef) throw invalidResponse();
      return { siteId, userRef: response.user.userRef, status: response.user.status,
        securityEpoch: response.user.securityEpoch.toString() };
    },
  });
}

async function liveRuntime(siteId: string): Promise<UserRuntime> {
  const session = await requireAdminSurfaceSession("users");
  return { rpc: createClient(AdminQueryService, await adminControlPlaneTransport()),
    context: queryContext(session, { kind: "site", siteId }), headers: authHeaders(session) };
}

export const adminUserReader = createAdminUserReader(liveRuntime);

async function call<Value>(invoke: () => Promise<Value>): Promise<Value> {
  try { return await invoke(); }
  catch (reason) {
    if (reason instanceof AdminControlPlaneError) throw reason;
    const error = ConnectError.from(reason); const detail = error.findDetails(KokoroErrorDetailSchema)[0];
    throw new AdminControlPlaneError(error.code, detail?.domainCode || "admin_user.unavailable",
      detail?.receiptRef || null);
  }
}

function invalidResponse() { return new AdminUserInvalidResponseError(); }
