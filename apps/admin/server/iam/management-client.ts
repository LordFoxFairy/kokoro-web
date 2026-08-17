import "server-only";

import { createClient, type Transport } from "@connectrpc/connect";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";

import { IamAdministrationService } from "../../generated/iam/proto/kokoro/iam/v1/administration_pb";
import { IamAuthorizationService } from "../../generated/iam/proto/kokoro/iam/v1/authorization_pb";
import { IamOrganizationService } from "../../generated/iam/proto/kokoro/iam/v1/organization_pb";
import { IamSessionService } from "../../generated/iam/proto/kokoro/iam/v1/session_pb";
import { IamSiteService } from "../../generated/iam/proto/kokoro/iam/v1/site_pb";
import {
  authorizationFromResponse,
  authorizationInspectionFromResponse,
  memberFromRecord,
  organizationFromRecord,
  permissionFromRecord,
  roleFromRecord,
  securityEventFromRecord,
  sessionFromRecord,
  siteAuthorizationFromResponse,
  siteAuthorizationInspectionFromResponse,
  siteFromRecord,
  siteMemberFromRecord,
  siteRoleFromRecord,
  userFromRecord,
  type AdminAuthorizationDecision,
  type AdminAuthorizationInspection,
  type AdminMember,
  type AdminOrganization,
  type AdminPermission,
  type AdminRole,
  type AdminSecurityEvent,
  type AdminSession,
  type AdminSite,
  type AdminSiteAuthorizationDecision,
  type AdminSiteAuthorizationInspection,
  type AdminSiteMember,
  type AdminSiteRole,
  type AdminUser,
} from "./records";

export type PageResult<T> = Readonly<{ items: readonly T[]; nextCursor: string | null }>;
export type SecurityEventStatistics = Readonly<{
  total: bigint;
  byKind: readonly Readonly<{ kind: string; count: bigint }>[];
}>;
export type SecurityEventPageResult = PageResult<AdminSecurityEvent> & Readonly<{
  statistics: SecurityEventStatistics;
}>;
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
  platformRole?: AdminUser["platformRole"];
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
export type OrganizationListInput = Readonly<{
  requestId: string;
  query: string;
  status?: AdminOrganization["status"];
  includeDeleted: boolean;
  cursor?: string;
  limit: number;
}>;
export type SiteListInput = Readonly<{
  requestId: string;
  query: string;
  status?: AdminSite["status"];
  includeDeleted: boolean;
  cursor?: string;
  limit: number;
}>;
export type SiteMemberListInput = Readonly<{
  requestId: string;
  siteId: string;
  includeDeleted: boolean;
  cursor?: string;
  limit: number;
}>;
export type SiteAuthorizationInput = Readonly<{
  requestId: string;
  siteId: string;
  permissionKey: string;
  resourceRef?: string;
}>;
export type InspectUserSiteAuthorizationInput = SiteAuthorizationInput & Readonly<{ userId: string }>;
export type MemberListInput = Readonly<{
  requestId: string;
  organizationId: string;
  includeDeleted: boolean;
  cursor?: string;
  limit: number;
}>;
export type AuthorizeInput = Readonly<{
  requestId: string;
  organizationId: string;
  permissionKey: string;
  resourceRef?: string;
}>;
export type InspectUserAuthorizationInput = Readonly<{
  requestId: string;
  organizationId: string;
  userId: string;
  permissionKey: string;
  resourceRef?: string;
}>;
export type SecurityEventListInput = Readonly<{
  requestId: string;
  kind?: string;
  actorUserId?: string;
  targetUserId?: string;
  organizationId?: string;
  siteId?: string;
  commandId?: string;
  createdAfter?: Date;
  createdBefore?: Date;
  cursor?: string;
  limit: number;
}>;
export type MutationResult<T> = Readonly<{ value: T; replayed: boolean }>;

export interface IamManagementClient {
  listUsers(input: UserListInput): Promise<PageResult<AdminUser>>;
  getUser(input: Readonly<{ requestId: string; userId: string; includeDeleted: boolean }>): Promise<AdminUser | null>;
  createUser(command: ManagementCommand, email: string, name: string, image?: string): Promise<MutationResult<AdminUser>>;
  updateUser(command: ManagementCommand, userId: string, email: string, name: string, image?: string): Promise<MutationResult<AdminUser>>;
  suspendUser(command: ManagementCommand, userId: string): Promise<MutationResult<AdminUser>>;
  reactivateUser(command: ManagementCommand, userId: string): Promise<MutationResult<AdminUser>>;
  deleteUser(command: ManagementCommand, userId: string): Promise<MutationResult<AdminUser>>;
  restoreUser(command: ManagementCommand, userId: string): Promise<MutationResult<AdminUser>>;
  listSites(input: SiteListInput): Promise<PageResult<AdminSite>>;
  getSite(input: Readonly<{ requestId: string; siteId: string; includeDeleted: boolean }>): Promise<AdminSite | null>;
  createSite(command: ManagementCommand, code: string, name: string): Promise<MutationResult<AdminSite> & Readonly<{ owner: AdminSiteMember }>>;
  updateSite(command: ManagementCommand, siteId: string, name: string): Promise<MutationResult<AdminSite>>;
  suspendSite(command: ManagementCommand, siteId: string): Promise<MutationResult<AdminSite>>;
  reactivateSite(command: ManagementCommand, siteId: string): Promise<MutationResult<AdminSite>>;
  deleteSite(command: ManagementCommand, siteId: string): Promise<MutationResult<AdminSite>>;
  restoreSite(command: ManagementCommand, siteId: string): Promise<MutationResult<AdminSite>>;
  listSiteMembers(input: SiteMemberListInput): Promise<PageResult<AdminSiteMember>>;
  addSiteMember(command: ManagementCommand, siteId: string, userId: string, roleKey: string): Promise<MutationResult<AdminSiteMember>>;
  changeSiteMemberRole(command: ManagementCommand, siteId: string, memberId: string, roleKey: string): Promise<MutationResult<AdminSiteMember>>;
  suspendSiteMember(command: ManagementCommand, siteId: string, memberId: string): Promise<MutationResult<AdminSiteMember>>;
  reactivateSiteMember(command: ManagementCommand, siteId: string, memberId: string): Promise<MutationResult<AdminSiteMember>>;
  removeSiteMember(command: ManagementCommand, siteId: string, memberId: string): Promise<MutationResult<AdminSiteMember>>;
  restoreSiteMember(command: ManagementCommand, siteId: string, memberId: string): Promise<MutationResult<AdminSiteMember>>;
  listSiteRoles(input: Readonly<{ requestId: string; siteId: string; includeDeleted: boolean }>): Promise<readonly AdminSiteRole[]>;
  createSiteRole(command: ManagementCommand, siteId: string, key: string, name: string, description: string, permissionKeys: readonly string[]): Promise<MutationResult<AdminSiteRole>>;
  updateSiteRole(command: ManagementCommand, siteId: string, roleId: string, name: string, description: string): Promise<MutationResult<AdminSiteRole>>;
  deleteSiteRole(command: ManagementCommand, siteId: string, roleId: string): Promise<MutationResult<AdminSiteRole>>;
  restoreSiteRole(command: ManagementCommand, siteId: string, roleId: string): Promise<MutationResult<AdminSiteRole>>;
  setSiteRolePermissions(command: ManagementCommand, siteId: string, roleId: string, permissionKeys: readonly string[]): Promise<MutationResult<AdminSiteRole>>;
  selectSite(command: ManagementCommand, siteId: string): Promise<AdminSite>;
  authorizeSite(input: SiteAuthorizationInput): Promise<AdminSiteAuthorizationDecision>;
  inspectUserSiteAuthorization(input: InspectUserSiteAuthorizationInput): Promise<AdminSiteAuthorizationInspection>;
  listOrganizations(input: OrganizationListInput): Promise<PageResult<AdminOrganization>>;
  getOrganization(input: Readonly<{ requestId: string; organizationId: string; includeDeleted: boolean }>): Promise<AdminOrganization | null>;
  createOrganization(command: ManagementCommand, slug: string, name: string): Promise<MutationResult<AdminOrganization>>;
  updateOrganization(command: ManagementCommand, organizationId: string, name: string): Promise<MutationResult<AdminOrganization>>;
  deleteOrganization(command: ManagementCommand, organizationId: string): Promise<MutationResult<AdminOrganization>>;
  restoreOrganization(command: ManagementCommand, organizationId: string): Promise<MutationResult<AdminOrganization>>;
  listMembers(input: MemberListInput): Promise<PageResult<AdminMember>>;
  addMember(command: ManagementCommand, organizationId: string, userId: string, roleKey: string): Promise<MutationResult<AdminMember>>;
  changeMemberRole(command: ManagementCommand, organizationId: string, memberId: string, roleKey: string): Promise<MutationResult<AdminMember>>;
  suspendMember(command: ManagementCommand, organizationId: string, memberId: string): Promise<MutationResult<AdminMember>>;
  reactivateMember(command: ManagementCommand, organizationId: string, memberId: string): Promise<MutationResult<AdminMember>>;
  removeMember(command: ManagementCommand, organizationId: string, memberId: string): Promise<MutationResult<AdminMember>>;
  restoreMember(command: ManagementCommand, organizationId: string, memberId: string): Promise<MutationResult<AdminMember>>;
  listOrganizationRoles(input: Readonly<{ requestId: string; organizationId: string; includeDeleted: boolean }>): Promise<readonly AdminRole[]>;
  createOrganizationRole(command: ManagementCommand, organizationId: string, key: string, name: string, description: string, permissionKeys: readonly string[]): Promise<MutationResult<AdminRole>>;
  updateOrganizationRole(command: ManagementCommand, organizationId: string, roleId: string, name: string, description: string): Promise<MutationResult<AdminRole>>;
  deleteOrganizationRole(command: ManagementCommand, organizationId: string, roleId: string): Promise<MutationResult<AdminRole>>;
  restoreOrganizationRole(command: ManagementCommand, organizationId: string, roleId: string): Promise<MutationResult<AdminRole>>;
  setOrganizationRolePermissions(command: ManagementCommand, organizationId: string, roleId: string, permissionKeys: readonly string[]): Promise<MutationResult<AdminRole>>;
  listRoleCatalog(input: Readonly<{ requestId: string; organizationId: string }>): Promise<readonly AdminRole[]>;
  listPermissionCatalog(input: Readonly<{ requestId: string }>): Promise<readonly AdminPermission[]>;
  authorize(input: AuthorizeInput): Promise<AdminAuthorizationDecision>;
  inspectUserAuthorization(input: InspectUserAuthorizationInput): Promise<AdminAuthorizationInspection>;
  listSessions(input: SessionListInput): Promise<PageResult<AdminSession>>;
  revokeSession(command: ManagementCommand, sessionId: string): Promise<Readonly<{ revoked: boolean; replayed: boolean }>>;
  revokeAllSessions(command: ManagementCommand, userId: string): Promise<Readonly<{ revokedCount: number; replayed: boolean }>>;
  listSecurityEvents(input: SecurityEventListInput): Promise<SecurityEventPageResult>;
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
  const authorization = createClient(IamAuthorizationService, transport);
  const organizations = createClient(IamOrganizationService, transport);
  const sessions = createClient(IamSessionService, transport);
  const sites = createClient(IamSiteService, transport);

  const client: IamManagementClient = {
    async listUsers(input) {
      const response = await administration.listUsers({
        requestId: input.requestId,
        query: input.query,
        status: input.status ?? "",
        platformRole: input.platformRole ?? "",
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
    async createUser(command, email, name, image) {
      const response = await administration.createUser({ command: commandValue(command), email, name, ...(image === undefined ? {} : { image }) });
      return Object.freeze({ value: userFromRecord(response.user), replayed: response.replayed });
    },
    async updateUser(command, userId, email, name, image) {
      const response = await administration.updateUser({ command: commandValue(command), userId, email, name, ...(image === undefined ? {} : { image }) });
      return Object.freeze({ value: userFromRecord(response.user), replayed: response.replayed });
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
    async listSites(input) {
      const response = await sites.listSites({
        requestId: input.requestId,
        query: input.query,
        status: input.status ?? "",
        includeDeleted: input.includeDeleted,
        page: { limit: input.limit, cursor: input.cursor ?? "" },
      });
      return Object.freeze({
        items: Object.freeze(response.sites.map(siteFromRecord)),
        nextCursor: nextCursor(response.page?.nextCursor),
      });
    },
    async getSite(input) {
      const response = await sites.getSite(input);
      return response.site === undefined ? null : siteFromRecord(response.site);
    },
    async createSite(command, code, name) {
      const response = await sites.createSite({ command: commandValue(command), code, name });
      const site = siteFromRecord(response.site);
      return Object.freeze({ value: site, owner: siteMemberFromRecord(response.owner, site.id), replayed: response.replayed });
    },
    async updateSite(command, siteId, name) {
      const response = await sites.updateSite({ command: commandValue(command), siteId, name });
      return Object.freeze({ value: siteFromRecord(response.site), replayed: response.replayed });
    },
    async suspendSite(command, siteId) {
      const response = await sites.suspendSite({ command: commandValue(command), siteId });
      return Object.freeze({ value: siteFromRecord(response.site), replayed: response.replayed });
    },
    async reactivateSite(command, siteId) {
      const response = await sites.reactivateSite({ command: commandValue(command), siteId });
      return Object.freeze({ value: siteFromRecord(response.site), replayed: response.replayed });
    },
    async deleteSite(command, siteId) {
      const response = await sites.deleteSite({ command: commandValue(command), siteId });
      return Object.freeze({ value: siteFromRecord(response.site), replayed: response.replayed });
    },
    async restoreSite(command, siteId) {
      const response = await sites.restoreSite({ command: commandValue(command), siteId });
      return Object.freeze({ value: siteFromRecord(response.site), replayed: response.replayed });
    },
    async listSiteMembers(input) {
      const response = await sites.listSiteMembers({
        requestId: input.requestId,
        siteId: input.siteId,
        includeDeleted: input.includeDeleted,
        page: { limit: input.limit, cursor: input.cursor ?? "" },
      });
      return Object.freeze({
        items: Object.freeze(response.members.map((record) => siteMemberFromRecord(record, input.siteId))),
        nextCursor: nextCursor(response.page?.nextCursor),
      });
    },
    async addSiteMember(command, siteId, userId, roleKey) {
      const response = await sites.addSiteMember({ command: commandValue(command), siteId, userId, roleKey });
      return Object.freeze({ value: siteMemberFromRecord(response.member, siteId), replayed: response.replayed });
    },
    async changeSiteMemberRole(command, siteId, memberId, roleKey) {
      const response = await sites.changeSiteMemberRole({ command: commandValue(command), siteId, memberId, roleKey });
      return Object.freeze({ value: siteMemberFromRecord(response.member, siteId), replayed: response.replayed });
    },
    async suspendSiteMember(command, siteId, memberId) {
      const response = await sites.suspendSiteMember({ command: commandValue(command), siteId, memberId });
      return Object.freeze({ value: siteMemberFromRecord(response.member, siteId), replayed: response.replayed });
    },
    async reactivateSiteMember(command, siteId, memberId) {
      const response = await sites.reactivateSiteMember({ command: commandValue(command), siteId, memberId });
      return Object.freeze({ value: siteMemberFromRecord(response.member, siteId), replayed: response.replayed });
    },
    async removeSiteMember(command, siteId, memberId) {
      const response = await sites.removeSiteMember({ command: commandValue(command), siteId, memberId });
      return Object.freeze({ value: siteMemberFromRecord(response.member, siteId), replayed: response.replayed });
    },
    async restoreSiteMember(command, siteId, memberId) {
      const response = await sites.restoreSiteMember({ command: commandValue(command), siteId, memberId });
      return Object.freeze({ value: siteMemberFromRecord(response.member, siteId), replayed: response.replayed });
    },
    async listSiteRoles(input) {
      const response = await sites.listSiteRoles(input);
      return Object.freeze(response.roles.map((record) => siteRoleFromRecord(record, input.siteId)));
    },
    async createSiteRole(command, siteId, key, name, description, permissionKeys) {
      const response = await sites.createSiteRole({ command: commandValue(command), siteId, key, name, description, permissionKeys: [...permissionKeys] });
      return Object.freeze({ value: siteRoleFromRecord(response.role, siteId), replayed: response.replayed });
    },
    async updateSiteRole(command, siteId, roleId, name, description) {
      const response = await sites.updateSiteRole({ command: commandValue(command), siteId, roleId, name, description });
      return Object.freeze({ value: siteRoleFromRecord(response.role, siteId), replayed: response.replayed });
    },
    async deleteSiteRole(command, siteId, roleId) {
      const response = await sites.deleteSiteRole({ command: commandValue(command), siteId, roleId });
      return Object.freeze({ value: siteRoleFromRecord(response.role, siteId), replayed: response.replayed });
    },
    async restoreSiteRole(command, siteId, roleId) {
      const response = await sites.restoreSiteRole({ command: commandValue(command), siteId, roleId });
      return Object.freeze({ value: siteRoleFromRecord(response.role, siteId), replayed: response.replayed });
    },
    async setSiteRolePermissions(command, siteId, roleId, permissionKeys) {
      const response = await sites.setSiteRolePermissions({ command: commandValue(command), siteId, roleId, permissionKeys: [...permissionKeys] });
      return Object.freeze({ value: siteRoleFromRecord(response.role, siteId), replayed: response.replayed });
    },
    async selectSite(command, siteId) {
      const response = await sites.selectSite({ command: commandValue(command), siteId });
      return siteFromRecord(response.site);
    },
    async authorizeSite(input) {
      return siteAuthorizationFromResponse(await authorization.authorizeSite({
        requestId: input.requestId,
        siteId: input.siteId,
        permissionKey: input.permissionKey,
        ...(input.resourceRef === undefined ? {} : { resourceRef: input.resourceRef }),
      }));
    },
    async inspectUserSiteAuthorization(input) {
      return siteAuthorizationInspectionFromResponse(await authorization.inspectUserSiteAuthorization({
        requestId: input.requestId,
        siteId: input.siteId,
        userId: input.userId,
        permissionKey: input.permissionKey,
        ...(input.resourceRef === undefined ? {} : { resourceRef: input.resourceRef }),
      }));
    },
    async listOrganizations(input) {
      const response = await administration.listOrganizations({
        requestId: input.requestId,
        query: input.query,
        status: input.status ?? "",
        includeDeleted: input.includeDeleted,
        page: { limit: input.limit, cursor: input.cursor ?? "" },
      });
      return Object.freeze({
        items: Object.freeze(response.organizations.map(organizationFromRecord)),
        nextCursor: nextCursor(response.page?.nextCursor),
      });
    },
    async getOrganization(input) {
      const response = await organizations.getOrganization({
        requestId: input.requestId,
        organizationId: input.organizationId,
        includeDeleted: input.includeDeleted,
      });
      return response.organization === undefined ? null : organizationFromRecord(response.organization);
    },
    async createOrganization(command, slug, name) {
      const response = await organizations.createOrganization({ command: commandValue(command), slug, name });
      return Object.freeze({ value: organizationFromRecord(response.organization), replayed: response.replayed });
    },
    async updateOrganization(command, organizationId, name) {
      const response = await organizations.updateOrganization({ command: commandValue(command), organizationId, name });
      return Object.freeze({ value: organizationFromRecord(response.organization), replayed: response.replayed });
    },
    async deleteOrganization(command, organizationId) {
      const response = await organizations.deleteOrganization({ command: commandValue(command), organizationId });
      return Object.freeze({ value: organizationFromRecord(response.organization), replayed: response.replayed });
    },
    async restoreOrganization(command, organizationId) {
      const response = await organizations.restoreOrganization({ command: commandValue(command), organizationId });
      return Object.freeze({ value: organizationFromRecord(response.organization), replayed: response.replayed });
    },
    async listMembers(input) {
      const response = await organizations.listMembers({
        requestId: input.requestId,
        organizationId: input.organizationId,
        includeDeleted: input.includeDeleted,
        page: { limit: input.limit, cursor: input.cursor ?? "" },
      });
      return Object.freeze({
        items: Object.freeze(response.members.map((record) => memberFromRecord(record, input.organizationId))),
        nextCursor: nextCursor(response.page?.nextCursor),
      });
    },
    async addMember(command, organizationId, userId, roleKey) {
      const response = await organizations.addMember({
        command: commandValue(command),
        organizationId,
        userId,
        roleKey,
      });
      return Object.freeze({ value: memberFromRecord(response.member, organizationId), replayed: response.replayed });
    },
    async changeMemberRole(command, organizationId, memberId, roleKey) {
      const response = await organizations.changeMemberRole({ command: commandValue(command), memberId, roleKey, organizationId });
      return Object.freeze({ value: memberFromRecord(response.member, organizationId), replayed: response.replayed });
    },
    async suspendMember(command, organizationId, memberId) {
      const response = await organizations.suspendMember({ command: commandValue(command), memberId, organizationId });
      return Object.freeze({ value: memberFromRecord(response.member, organizationId), replayed: response.replayed });
    },
    async reactivateMember(command, organizationId, memberId) {
      const response = await organizations.reactivateMember({ command: commandValue(command), memberId, organizationId });
      return Object.freeze({ value: memberFromRecord(response.member, organizationId), replayed: response.replayed });
    },
    async removeMember(command, organizationId, memberId) {
      const response = await organizations.removeMember({ command: commandValue(command), memberId, organizationId });
      return Object.freeze({ value: memberFromRecord(response.member, organizationId), replayed: response.replayed });
    },
    async restoreMember(command, organizationId, memberId) {
      const response = await organizations.restoreMember({ command: commandValue(command), memberId, organizationId });
      return Object.freeze({ value: memberFromRecord(response.member, organizationId), replayed: response.replayed });
    },
    async listOrganizationRoles(input) {
      const response = await organizations.listOrganizationRoles(input);
      return Object.freeze(response.roles.map((record) => roleFromRecord(record, input.organizationId)));
    },
    async createOrganizationRole(command, organizationId, key, name, description, permissionKeys) {
      const response = await organizations.createOrganizationRole({ command: commandValue(command), organizationId, key, name, description, permissionKeys: [...permissionKeys] });
      return Object.freeze({ value: roleFromRecord(response.role, organizationId), replayed: response.replayed });
    },
    async updateOrganizationRole(command, organizationId, roleId, name, description) {
      const response = await organizations.updateOrganizationRole({ command: commandValue(command), organizationId, roleId, name, description });
      return Object.freeze({ value: roleFromRecord(response.role, organizationId), replayed: response.replayed });
    },
    async deleteOrganizationRole(command, organizationId, roleId) {
      const response = await organizations.deleteOrganizationRole({ command: commandValue(command), organizationId, roleId });
      return Object.freeze({ value: roleFromRecord(response.role, organizationId), replayed: response.replayed });
    },
    async restoreOrganizationRole(command, organizationId, roleId) {
      const response = await organizations.restoreOrganizationRole({ command: commandValue(command), organizationId, roleId });
      return Object.freeze({ value: roleFromRecord(response.role, organizationId), replayed: response.replayed });
    },
    async setOrganizationRolePermissions(command, organizationId, roleId, permissionKeys) {
      const response = await organizations.setOrganizationRolePermissions({ command: commandValue(command), organizationId, roleId, permissionKeys: [...permissionKeys] });
      return Object.freeze({ value: roleFromRecord(response.role, organizationId), replayed: response.replayed });
    },
    async listRoleCatalog(input) {
      const response = await authorization.listRoleCatalog(input);
      return Object.freeze(response.roles.map((record) => roleFromRecord(record)));
    },
    async listPermissionCatalog(input) {
      const response = await authorization.listPermissionCatalog(input);
      return Object.freeze(response.permissions.map(permissionFromRecord));
    },
    async authorize(input) {
      const response = await authorization.authorize({
        requestId: input.requestId,
        organizationId: input.organizationId,
        permissionKey: input.permissionKey,
        ...(input.resourceRef === undefined ? {} : { resourceRef: input.resourceRef }),
      });
      return authorizationFromResponse(response);
    },
    async inspectUserAuthorization(input) {
      const response = await authorization.inspectUserAuthorization({
        requestId: input.requestId,
        organizationId: input.organizationId,
        userId: input.userId,
        permissionKey: input.permissionKey,
        ...(input.resourceRef === undefined ? {} : { resourceRef: input.resourceRef }),
      });
      return authorizationInspectionFromResponse(response);
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
        ...(input.kind === undefined ? {} : { kind: input.kind }),
        ...(input.actorUserId === undefined ? {} : { actorUserId: input.actorUserId }),
        ...(input.targetUserId === undefined ? {} : { targetUserId: input.targetUserId }),
        ...(input.organizationId === undefined ? {} : { organizationId: input.organizationId }),
        ...(input.siteId === undefined ? {} : { siteId: input.siteId }),
        ...(input.commandId === undefined ? {} : { commandId: input.commandId }),
        ...(input.createdAfter === undefined ? {} : { createdAfter: timestampFromDate(input.createdAfter) }),
        ...(input.createdBefore === undefined ? {} : { createdBefore: timestampFromDate(input.createdBefore) }),
        page: { limit: input.limit, cursor: input.cursor ?? "" },
      });
      if (response.statistics === undefined) throw new Error("invalid IAM SecurityEventStatistics");
      return Object.freeze({
        items: Object.freeze(response.events.map(securityEventFromRecord)),
        nextCursor: nextCursor(response.page?.nextCursor),
        statistics: Object.freeze({
          total: response.statistics.total,
          byKind: Object.freeze(response.statistics.byKind.map((item) => Object.freeze({
            kind: item.kind,
            count: item.count,
          }))),
        }),
      });
    },
  };
  return Object.freeze(client);
}
