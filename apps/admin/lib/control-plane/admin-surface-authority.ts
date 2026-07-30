import "server-only";

import { Code } from "@connectrpc/connect";

import { canAccessAdminSurface, type AdminSurface } from "../admin-surface-permissions";
import { requireAuthoritySession, type AdminAuthoritySession } from "./authority-session";
import { AdminControlPlaneError } from "./client";

export async function requireAdminSurfaceSession(surface: AdminSurface): Promise<AdminAuthoritySession> {
  const session = await requireAuthoritySession();
  if (!canAccessAdminSurface(session.permissions, surface)) {
    throw new AdminControlPlaneError(Code.PermissionDenied, "admin.permission_denied");
  }
  return session;
}
