"use client";

import type {
  BaseRecord,
  DataProvider,
  GetListParams,
  GetListResponse,
  GetOneParams,
  GetOneResponse,
  HttpError,
} from "@refinedev/core";
import { z } from "zod";

import { ApiError, apiGet } from "@/lib/api";
import {
  codeBatchListSchema,
  codeBatchSchema,
  commerceCursorSchema,
  creditProgramListSchema,
  creditProgramSchema,
  entitlementTemplateListSchema,
  entitlementTemplateSchema,
  offerListSchema,
  offerSchema,
  redemptionProgramListSchema,
  redemptionProgramSchema,
  type AdminCodeBatch,
  type AdminCreditProgram,
  type AdminEntitlementTemplate,
  type AdminOffer,
  type AdminRedemptionProgram,
} from "@/lib/commerce-contract";

const ADMIN_PAGE_SIZE = 100;
const UINT64_MAXIMUM = 18_446_744_073_709_551_615n;
const UINT64_PATTERN = /^(?:0|[1-9][0-9]{0,19})$/u;
const adminQueryPageTokenSchema = z.string().min(1).max(1024);
const pageTokenSchema = commerceCursorSchema;
const cursorTokenSchema = adminQueryPageTokenSchema.nullable();
const uint64Schema = z.string().refine((value) =>
  UINT64_PATTERN.test(value) && BigInt(value) <= UINT64_MAXIMUM);
const positiveUint64Schema = uint64Schema.refine((value) => value !== "0");
const ADMIN_INFINITE_LIMITS = Object.freeze({ maxItems: 1000, maxPages: 20 });

const operatorScopeSchema = z.object({
  siteId: z.string().min(1).max(128),
  environment: z.string().min(1).max(64),
  region: z.string().min(1).max(64),
  scopeEpoch: positiveUint64Schema,
  expiresAt: z.string().datetime(),
}).strict();

export const operatorSchema = z.object({
  operatorRef: z.string().min(1).max(128),
  operatorGeneration: positiveUint64Schema,
  state: z.enum(["active", "suspended", "revoked"]),
  effectivePermissions: z.array(z.string().min(1).max(128)).max(256),
  effectiveSiteScopes: z.array(operatorScopeSchema).max(1000),
  operatorSecurityEpoch: positiveUint64Schema,
  authorizationEpoch: positiveUint64Schema,
  expiresAt: z.string().datetime(),
}).strict();

export const adminSiteSchema = z.object({
  siteRef: z.string().min(1).max(128),
  status: z.string().min(1).max(64),
  securityEpoch: uint64Schema,
}).strict();

export const approvalSchema = z.object({
  owner: z.enum(["generic_admin", "site_lifecycle"]),
  approvalRef: z.string().uuid(),
  operation: z.string().min(1).max(128),
  makerRef: z.string().min(1).max(128),
  targetSiteRef: z.string().min(1).max(128).nullable(),
  environment: z.string().min(1).max(64),
  region: z.string().min(1).max(64),
  operatorReason: z.string().min(1).max(1000),
  admittedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
}).strict();

export const auditSchema = z.object({
  auditRef: z.string().min(1).max(128),
  actionCode: z.string().min(1).max(128),
  occurredAt: z.string().datetime(),
}).strict();

export type AdminOperator = z.output<typeof operatorSchema> & Readonly<{ id: string }>;
export type AdminSite = z.output<typeof adminSiteSchema> & Readonly<{ id: string }>;
export type AdminApproval = z.output<typeof approvalSchema> & Readonly<{ id: string }>;
export type AdminAudit = z.output<typeof auditSchema> & Readonly<{ id: string }>;

const operatorListSchema = cursorListSchema(operatorSchema);
export const adminSiteListSchema = cursorListSchema(adminSiteSchema);
const approvalListSchema = cursorListSchema(approvalSchema);
const auditListSchema = cursorListSchema(auditSchema);

type AdminRecord = AdminOperator | AdminSite | AdminApproval | AdminAudit | AdminCreditProgram |
  AdminEntitlementTemplate | AdminOffer | AdminRedemptionProgram | AdminCodeBatch;
type ResourceFilters = GetListParams["filters"];
interface ResourcePage {
  readonly records: AdminRecord[];
  readonly nextPageToken: string | null;
}
type ListLoader = (
  filters: ResourceFilters,
  pageToken: string | undefined,
  signal: AbortSignal | undefined,
) => Promise<ResourcePage>;

const LIST_LOADERS = Object.freeze({
  operators: async (filters: ResourceFilters, pageToken: string | undefined, signal: AbortSignal | undefined) => {
    requireNoFilters(filters);
    const page = await apiGet(resourcePath("/api/control/operators", undefined, pageToken), operatorListSchema,
      { signal });
    return { records: page.items.map((item) => ({ id: item.operatorRef, ...item })),
      nextPageToken: page.nextPageToken };
  },
  sites: async (filters: ResourceFilters, pageToken: string | undefined, signal: AbortSignal | undefined) => {
    requireNoFilters(filters);
    const page = await apiGet(resourcePath("/api/control/sites", undefined, pageToken), adminSiteListSchema,
      { signal });
    return { records: page.items.map((item) => ({ id: item.siteRef, ...item })),
      nextPageToken: page.nextPageToken };
  },
  approvals: async (filters: ResourceFilters, pageToken: string | undefined, signal: AbortSignal | undefined) => {
    const siteId = optionalSiteId(filters);
    const page = await apiGet(resourcePath("/api/control/approvals", siteId, pageToken), approvalListSchema,
      { signal });
    return { records: page.items.map((item) => ({ id: `${item.owner}:${item.approvalRef}`, ...item })),
      nextPageToken: page.nextPageToken };
  },
  audit: async (filters: ResourceFilters, pageToken: string | undefined, signal: AbortSignal | undefined) => {
    const siteId = optionalSiteId(filters);
    const page = await apiGet(resourcePath("/api/control/audit", siteId, pageToken), auditListSchema, { signal });
    return { records: page.items.map((item) => ({ id: item.auditRef, ...item })),
      nextPageToken: page.nextPageToken };
  },
  "credit-programs": async (filters: ResourceFilters, pageToken: string | undefined,
    signal: AbortSignal | undefined) => {
    const siteId = requiredSiteId(filters);
    const page = await apiGet(resourcePath("/api/control/commerce/credit-programs", siteId, pageToken),
      creditProgramListSchema, { signal });
    return { records: page.items, nextPageToken: page.nextPageToken };
  },
  "entitlement-templates": async (filters: ResourceFilters, pageToken: string | undefined,
    signal: AbortSignal | undefined) => {
    const siteId = requiredSiteId(filters);
    const page = await apiGet(resourcePath("/api/control/commerce/entitlement-templates", siteId, pageToken),
      entitlementTemplateListSchema, { signal });
    return { records: page.items, nextPageToken: page.nextPageToken };
  },
  offers: async (filters: ResourceFilters, pageToken: string | undefined, signal: AbortSignal | undefined) => {
    const siteId = requiredSiteId(filters);
    const page = await apiGet(resourcePath("/api/control/commerce/offers", siteId, pageToken), offerListSchema,
      { signal });
    return { records: page.items, nextPageToken: page.nextPageToken };
  },
  "redemption-programs": async (filters: ResourceFilters, pageToken: string | undefined,
    signal: AbortSignal | undefined) => {
    const siteId = requiredSiteId(filters);
    const page = await apiGet(resourcePath("/api/control/commerce/redemption-programs", siteId, pageToken),
      redemptionProgramListSchema, { signal });
    return { records: page.items, nextPageToken: page.nextPageToken };
  },
  "code-batches": async (filters: ResourceFilters, pageToken: string | undefined,
    signal: AbortSignal | undefined) => {
    const siteId = requiredSiteId(filters);
    const page = await apiGet(resourcePath("/api/control/commerce/code-batches", siteId, pageToken),
      codeBatchListSchema, { signal });
    return { records: page.items, nextPageToken: page.nextPageToken };
  },
}) satisfies Readonly<Record<string, ListLoader>>;

type CommerceDetailRecord = BaseRecord & Readonly<{ id: string; siteId: string }>;
type CommerceDetailLoader = (id: string, siteId: string) => Promise<CommerceDetailRecord>;

function detailPath(base: string, id: string, siteId: string): string {
  return resourcePath(`${base}/${encodeURIComponent(id)}`, siteId, undefined);
}

const COMMERCE_DETAIL_LOADERS = Object.freeze({
  "credit-programs": ((id, siteId) => apiGet(
    detailPath("/api/control/commerce/credit-programs", id, siteId), creditProgramSchema,
  )) satisfies CommerceDetailLoader,
  "entitlement-templates": ((id, siteId) => apiGet(
    detailPath("/api/control/commerce/entitlement-templates", id, siteId), entitlementTemplateSchema,
  )) satisfies CommerceDetailLoader,
  offers: ((id, siteId) => apiGet(
    detailPath("/api/control/commerce/offers", id, siteId), offerSchema,
  )) satisfies CommerceDetailLoader,
  "redemption-programs": ((id, siteId) => apiGet(
    detailPath("/api/control/commerce/redemption-programs", id, siteId), redemptionProgramSchema,
  )) satisfies CommerceDetailLoader,
  "code-batches": ((id, siteId) => apiGet(
    detailPath("/api/control/commerce/code-batches", id, siteId), codeBatchSchema,
  )) satisfies CommerceDetailLoader,
});

const COMMERCE_RESOURCES = new Set(Object.keys(COMMERCE_DETAIL_LOADERS));

function cursorListSchema<ItemSchema extends z.ZodTypeAny>(itemSchema: ItemSchema) {
  return z.object({ items: z.array(itemSchema).max(ADMIN_PAGE_SIZE), nextPageToken: cursorTokenSchema }).strict();
}

interface AdminInfiniteData<TData extends BaseRecord> {
  readonly pages: readonly GetListResponse<TData>[];
  readonly pageParams: readonly unknown[];
}

interface AdminInfiniteAnalysis<TData extends BaseRecord> {
  readonly records: TData[];
  readonly nextPageParam: string | undefined;
  readonly error: HttpError | null;
}

export function adminNextPageParam<TData extends BaseRecord>(
  lastPage: GetListResponse<TData>,
  allPages: readonly GetListResponse<TData>[] = [lastPage],
  lastPageParam: unknown = 1,
  allPageParams: readonly unknown[] = [lastPageParam],
): string | undefined {
  return analyzeAdminInfiniteData({ pages: allPages, pageParams: allPageParams }).nextPageParam;
}

export function adminInfiniteResult<TData extends BaseRecord>(
  data: AdminInfiniteData<TData> | undefined,
): Readonly<{ records: TData[]; error: HttpError | null }> {
  if (data === undefined) return { records: [], error: null };
  const { records, error } = analyzeAdminInfiniteData(data);
  return error === null ? { records, error: null } : { records: [], error };
}

function analyzeAdminInfiniteData<TData extends BaseRecord>(
  data: AdminInfiniteData<TData>,
): AdminInfiniteAnalysis<TData> {
  const fail = (message: string): AdminInfiniteAnalysis<TData> => ({
    records: [],
    nextPageParam: undefined,
    error: providerError(message, 502),
  });
  if (data.pages.length !== data.pageParams.length) return fail("admin_resource_pagination_state_invalid");
  if (data.pages.length > ADMIN_INFINITE_LIMITS.maxPages) return fail("admin_resource_page_limit");

  const seenPageParams = new Set<string>();
  for (const pageParam of data.pageParams) {
    if (pageParam === 1) continue;
    const parsed = pageTokenSchema.safeParse(pageParam);
    if (!parsed.success) return fail("admin_resource_pagination_state_invalid");
    if (seenPageParams.has(parsed.data)) return fail("admin_resource_cursor_loop");
    seenPageParams.add(parsed.data);
  }

  const records: TData[] = [];
  const seenRecordIds = new Set<string>();
  for (const page of data.pages) {
    for (const record of page.data) {
      if (typeof record.id !== "string" || record.id.length === 0) {
        return fail("admin_resource_record_invalid");
      }
      if (seenRecordIds.has(record.id)) return fail("admin_resource_duplicate_item");
      seenRecordIds.add(record.id);
      records.push(record);
      if (records.length > ADMIN_INFINITE_LIMITS.maxItems) return fail("admin_resource_item_limit");
    }
  }

  const rawNextPageParam: unknown = data.pages.at(-1)?.cursor?.next;
  if (rawNextPageParam === undefined) return { records, nextPageParam: undefined, error: null };
  const nextPageParam = pageTokenSchema.safeParse(rawNextPageParam);
  if (!nextPageParam.success) return fail("admin_resource_cursor_invalid");
  if (seenPageParams.has(nextPageParam.data)) return fail("admin_resource_cursor_loop");
  if (data.pages.length >= ADMIN_INFINITE_LIMITS.maxPages) return fail("admin_resource_page_limit");
  if (records.length >= ADMIN_INFINITE_LIMITS.maxItems) return fail("admin_resource_item_limit");
  return { records, nextPageParam: nextPageParam.data, error: null };
}

function providerError(message: string, statusCode: number): HttpError {
  return { message, statusCode };
}

function resourcePath(base: string, siteId: string | undefined, pageToken: string | undefined): string {
  const query = new URLSearchParams();
  if (siteId !== undefined) query.set("siteId", siteId);
  if (pageToken !== undefined) query.set("pageToken", pageToken);
  const encoded = query.toString();
  return encoded.length === 0 ? base : `${base}?${encoded}`;
}

function requireNoFilters(filters: ResourceFilters): void {
  if ((filters?.length ?? 0) !== 0) throw providerError("admin_resource_filter_not_supported", 400);
}

function optionalSiteId(filters: ResourceFilters): string | undefined {
  if (filters === undefined || filters.length === 0) return undefined;
  if (filters.length !== 1) throw providerError("admin_resource_filter_not_supported", 400);
  const filter = filters[0];
  if (!("field" in filter) || filter.field !== "siteId" || filter.operator !== "eq") {
    throw providerError("admin_resource_filter_not_supported", 400);
  }
  const result = z.string().min(1).max(128).safeParse(filter.value);
  if (!result.success) throw providerError("admin_resource_filter_not_supported", 400);
  return result.data;
}

function requiredSiteId(filters: ResourceFilters): string {
  const selected = optionalSiteId(filters);
  if (selected === undefined) throw providerError("admin_resource_site_filter_required", 400);
  return selected;
}

/** Refine 5 passes cursor.next back through currentPage at runtime despite its numeric public type. */
function pageTokenFromPagination(pagination: GetListParams["pagination"], resource: string): string | undefined {
  if (pagination?.mode !== "server" || pagination.pageSize !== ADMIN_PAGE_SIZE) {
    throw providerError("admin_resource_pagination_not_supported", 400);
  }
  const currentPage: unknown = pagination.currentPage;
  if (currentPage === 1) return undefined;
  const parsed = (COMMERCE_RESOURCES.has(resource) ? commerceCursorSchema : adminQueryPageTokenSchema)
    .safeParse(currentPage);
  if (!parsed.success) throw providerError("admin_resource_pagination_not_supported", 400);
  return parsed.data;
}

function signalFromMeta(meta: GetListParams["meta"]): AbortSignal | undefined {
  const signal: unknown = meta?.signal;
  return typeof AbortSignal !== "undefined" && signal instanceof AbortSignal ? signal : undefined;
}

function isHttpError(error: unknown): error is HttpError {
  return typeof error === "object" && error !== null &&
    typeof (error as Readonly<{ message?: unknown }>).message === "string" &&
    typeof (error as Readonly<{ statusCode?: unknown }>).statusCode === "number";
}

function normalizedProviderError(error: unknown): never {
  if (isHttpError(error)) throw error;
  if (error instanceof ApiError) {
    throw { message: error.message, statusCode: error.status, code: error.code, details: error.details,
      requestId: error.requestId, receiptRef: error.receiptRef, recoveryRef: error.recoveryRef } satisfies HttpError;
  }
  if (error instanceof z.ZodError) throw providerError("admin_resource_response_invalid", 502);
  if (error instanceof DOMException && error.name === "AbortError") throw error;
  throw providerError("admin_resource_request_failed", 503);
}

const unsupported: DataProvider["create"] = async () => {
  throw providerError("admin_resource_operation_not_supported", 405);
};

async function getList<TData extends BaseRecord = BaseRecord>(
  { resource, filters, sorters, pagination, meta }: GetListParams,
): Promise<GetListResponse<TData>> {
  if (!Object.hasOwn(LIST_LOADERS, resource)) throw providerError("admin_resource_not_registered", 404);
  if ((sorters?.length ?? 0) !== 0) throw providerError("admin_resource_sort_not_supported", 400);
  const loader = LIST_LOADERS[resource as keyof typeof LIST_LOADERS];
  const pageToken = pageTokenFromPagination(pagination, resource);
  try {
    const page = await loader(filters, pageToken, signalFromMeta(meta));
    if (page.nextPageToken !== null && page.nextPageToken === pageToken) {
      throw providerError("admin_resource_cursor_loop", 502);
    }
    return {
      data: page.records as unknown as TData[],
      total: page.records.length,
      ...(page.nextPageToken === null ? {} : { cursor: { next: page.nextPageToken } }),
    };
  } catch (error) {
    normalizedProviderError(error);
  }
}

async function getOne<TData extends BaseRecord = BaseRecord>(
  { resource, id, meta }: GetOneParams,
): Promise<GetOneResponse<TData>> {
  if (!Object.hasOwn(LIST_LOADERS, resource)) throw providerError("admin_resource_not_registered", 404);
  const commerce = Object.hasOwn(COMMERCE_DETAIL_LOADERS, resource);
  if (resource !== "sites" && !commerce) throw providerError("admin_resource_operation_not_supported", 405);
  const parsedId = z.string().min(1).max(commerce ? 256 : 128).safeParse(String(id));
  if (!parsedId.success) throw providerError("admin_resource_id_invalid", 400);
  try {
    if (commerce) {
      const siteId = metaSiteId(meta);
      const loader = COMMERCE_DETAIL_LOADERS[resource as keyof typeof COMMERCE_DETAIL_LOADERS];
      const record = await loader(parsedId.data, siteId);
      if (record.id !== parsedId.data || record.siteId !== siteId) {
        throw providerError("admin_resource_response_invalid", 502);
      }
      return { data: record as unknown as TData };
    }
    const site = await apiGet(`/api/control/sites/${encodeURIComponent(parsedId.data)}`, adminSiteSchema);
    return { data: { id: site.siteRef, ...site } as unknown as TData };
  } catch (error) {
    normalizedProviderError(error);
  }
}

function metaSiteId(meta: GetOneParams["meta"]): string {
  const value: unknown = meta?.siteId;
  const parsed = z.string().min(1).max(128).safeParse(value);
  if (!parsed.success) throw providerError("admin_resource_site_meta_required", 400);
  return parsed.data;
}

export const adminDataProvider: DataProvider = {
  getList,
  getOne,
  create: unsupported,
  async update() {
    throw providerError("admin_resource_operation_not_supported", 405);
  },
  async deleteOne() {
    throw providerError("admin_resource_operation_not_supported", 405);
  },
  getApiUrl: () => "/api/control",
};
