import "server-only";

import type { Transport } from "@connectrpc/connect";
import type { Session } from "next-auth";

import type { AdminRuntimeConfig } from "../config/config";
import { createActorTransport } from "../iam/transport";
import type { IamSessionClient } from "../iam/session-client";
import { readSessionToken, type SessionCookieReader } from "./cookie";

export type AdminIamActor = Readonly<{
  session: Session;
  transport: Transport;
  expiresAt: Date;
}>;

export type AdminSessionBoundary = Readonly<{
  requireAdminSession(): Promise<Session>;
  requireIamActor(organizationId?: string): Promise<AdminIamActor>;
}>;

export type AdminSessionBoundaryDependencies = Readonly<{
  config: AdminRuntimeConfig;
  loadSession(): Promise<Session | null>;
  loadCookies(): Promise<SessionCookieReader>;
  sessionClient: IamSessionClient;
}>;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

function unauthenticated(): never {
  throw new Error("admin authentication required");
}

function validAdminSession(session: Session | null): session is Session {
  return session !== null
    && uuidPattern.test(session.user.id)
    && emailPattern.test(session.user.email)
    && session.user.platformRole === "admin"
    && session.user.status === "active";
}

export function createAdminSessionBoundary(
  dependencies: AdminSessionBoundaryDependencies,
): AdminSessionBoundary {
  async function requireAdminSession(): Promise<Session> {
    const session = await dependencies.loadSession();
    return validAdminSession(session) ? session : unauthenticated();
  }

  async function requireIamActor(organizationId?: string): Promise<AdminIamActor> {
    const session = await requireAdminSession();
    const token = readSessionToken(await dependencies.loadCookies(), dependencies.config.auth);
    if (token === null) return unauthenticated();
    const issued = await dependencies.sessionClient.issueAccessToken(token, organizationId);
    return Object.freeze({
      session,
      transport: createActorTransport(dependencies.config.iam, issued.accessToken),
      expiresAt: issued.expiresAt,
    });
  }

  return Object.freeze({ requireAdminSession, requireIamActor });
}
