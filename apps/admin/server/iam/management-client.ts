import "server-only";

import { createClient, type Transport } from "@connectrpc/connect";

import { IamAdministrationService } from "../../generated/iam/proto/kokoro/iam/v1/administration_pb";
import { IamSessionService } from "../../generated/iam/proto/kokoro/iam/v1/session_pb";
import {
  securityEventFromRecord,
  sessionFromRecord,
  userFromRecord,
  type AdminSecurityEvent,
  type AdminSession,
  type AdminUser,
} from "./records";

export type PageResult<T> = Readonly<{ items: readonly T[]; nextCursor: string | null }>;
export type ManagementCommand = Readonly<{
  requestId: string;
  commandId: string;
  reason: string;
  expectedVersion?: bigint;
}>;
export type UserListInput = Readonly<{
  requestId: string;
  query: string;
  status?: AdminUser["status"];
  includeDeleted: boolean;
  cursor?: string;
  limit: number;
}>;
export type SessionListInput = Readonly<{
  requestId: string;
  userId?: string;
  cursor?: string;
  limit: number;
}>;
export type SecurityEventListInput = Readonly<{
  requestId: string;
  targetUserId?: string;
  cursor?: string;
  limit: number;
}>;
export type MutationResult<T> = Readonly<{ value: T; replayed: boolean }>;

export interface IamManagementClient {
  listUsers(input: UserListInput): Promise<PageResult<AdminUser>>;
  getUser(input: Readonly<{ requestId: string; userId: string; includeDeleted: boolean }>): Promise<AdminUser | null>;
  suspendUser(command: ManagementCommand, userId: string): Promise<MutationResult<AdminUser>>;
  reactivateUser(command: ManagementCommand, userId: string): Promise<MutationResult<AdminUser>>;
  deleteUser(command: ManagementCommand, userId: string): Promise<MutationResult<AdminUser>>;
  restoreUser(command: ManagementCommand, userId: string): Promise<MutationResult<AdminUser>>;
  listSessions(input: SessionListInput): Promise<PageResult<AdminSession>>;
  revokeSession(command: ManagementCommand, sessionId: string): Promise<Readonly<{ revoked: boolean; replayed: boolean }>>;
  revokeAllSessions(command: ManagementCommand, userId: string): Promise<Readonly<{ revokedCount: number; replayed: boolean }>>;
  listSecurityEvents(input: SecurityEventListInput): Promise<PageResult<AdminSecurityEvent>>;
}

function nextCursor(value: string | undefined): string | null {
  if (value === undefined || value.length === 0) return null;
  if (value.length > 512) throw new Error("invalid IAM PageOutput");
  return value;
}

function commandValue(value: ManagementCommand) {
  return {
    requestId: value.requestId,
    commandId: value.commandId,
    reason: value.reason,
    ...(value.expectedVersion === undefined ? {} : { expectedVersion: value.expectedVersion }),
  };
}

export function createIamManagementClient(transport: Transport): IamManagementClient {
  const administration = createClient(IamAdministrationService, transport);
  const sessions = createClient(IamSessionService, transport);

  const client: IamManagementClient = {
    async listUsers(input) {
      const response = await administration.listUsers({
        requestId: input.requestId,
        query: input.query,
        status: input.status ?? "",
        includeDeleted: input.includeDeleted,
        page: { limit: input.limit, cursor: input.cursor ?? "" },
      });
      return Object.freeze({
        items: Object.freeze(response.users.map(userFromRecord)),
        nextCursor: nextCursor(response.page?.nextCursor),
      });
    },
    async getUser(input) {
      const response = await administration.getUser({
        requestId: input.requestId,
        userId: input.userId,
        includeDeleted: input.includeDeleted,
      });
      return response.user === undefined ? null : userFromRecord(response.user);
    },
    async suspendUser(command, userId) {
      const response = await administration.suspendUser({ command: commandValue(command), userId });
      return Object.freeze({ value: userFromRecord(response.user), replayed: response.replayed });
    },
    async reactivateUser(command, userId) {
      const response = await administration.reactivateUser({ command: commandValue(command), userId });
      return Object.freeze({ value: userFromRecord(response.user), replayed: response.replayed });
    },
    async deleteUser(command, userId) {
      const response = await administration.deleteUser({ command: commandValue(command), userId });
      return Object.freeze({ value: userFromRecord(response.user), replayed: response.replayed });
    },
    async restoreUser(command, userId) {
      const response = await administration.restoreUser({ command: commandValue(command), userId });
      return Object.freeze({ value: userFromRecord(response.user), replayed: response.replayed });
    },
    async listSessions(input) {
      const response = await sessions.listSessions({
        requestId: input.requestId,
        ...(input.userId === undefined ? {} : { userId: input.userId }),
        page: { limit: input.limit, cursor: input.cursor ?? "" },
      });
      return Object.freeze({
        items: Object.freeze(response.sessions.map(sessionFromRecord)),
        nextCursor: nextCursor(response.page?.nextCursor),
      });
    },
    async revokeSession(command, sessionId) {
      const response = await sessions.revokeSession({ command: commandValue(command), sessionId });
      return Object.freeze({ revoked: response.revoked, replayed: response.replayed });
    },
    async revokeAllSessions(command, userId) {
      const response = await sessions.revokeAllSessions({ command: commandValue(command), userId });
      return Object.freeze({ revokedCount: response.revokedCount, replayed: response.replayed });
    },
    async listSecurityEvents(input) {
      const response = await administration.listSecurityEvents({
        requestId: input.requestId,
        ...(input.targetUserId === undefined ? {} : { targetUserId: input.targetUserId }),
        page: { limit: input.limit, cursor: input.cursor ?? "" },
      });
      return Object.freeze({
        items: Object.freeze(response.events.map(securityEventFromRecord)),
        nextCursor: nextCursor(response.page?.nextCursor),
      });
    },
  };
  return Object.freeze(client);
}
