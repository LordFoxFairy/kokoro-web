"use client";

import type { BaseRecord, DataProvider, GetListParams, GetListResponse, HttpError } from "@refinedev/core";
import { z } from "zod";

import { apiGet } from "@/lib/api";

const operatorScopeSchema = z.object({
  siteId: z.string().min(1).max(128),
  environment: z.string().min(1).max(64).optional(),
  region: z.string().min(1).max(64).optional(),
  scopeEpoch: z.string().regex(/^[0-9]{1,20}$/u).optional(),
  expiresAt: z.string().datetime().optional(),
}).strict();

export const operatorSchema = z.object({
  operatorRef: z.string().min(1).max(256),
  operatorGeneration: z.string().regex(/^[0-9]{1,20}$/u),
  state: z.enum(["active", "suspended", "revoked"]),
  effectivePermissions: z.array(z.string().min(1).max(256)).max(4096),
  effectiveSiteScopes: z.array(operatorScopeSchema).max(4096),
  operatorSecurityEpoch: z.string().regex(/^[0-9]{1,20}$/u).optional(),
  authorizationEpoch: z.string().regex(/^[0-9]{1,20}$/u).optional(),
  expiresAt: z.string().datetime(),
}).strict();

export type AdminOperator = z.output<typeof operatorSchema> & Readonly<{ id: string }>;

const operatorListSchema = z.object({
  items: z.array(operatorSchema).max(100),
  nextPageToken: z.string().min(1).max(256).nullable(),
}).strict();

async function listOperators(): Promise<AdminOperator[]> {
  const result = await apiGet("/api/control/operators", operatorListSchema);
  if (result.nextPageToken !== null) throw providerError("admin_resource_page_incomplete", 409);
  return result.items.map((operator) => ({ id: operator.operatorRef, ...operator }));
}

const LIST_LOADERS = Object.freeze({ operators: listOperators });

function providerError(message: string, statusCode: number): HttpError {
  return { message, statusCode };
}

const unsupported: DataProvider["create"] = async () => {
  throw providerError("admin_resource_operation_not_supported", 405);
};

async function getList<TData extends BaseRecord = BaseRecord>(
  { resource }: GetListParams,
): Promise<GetListResponse<TData>> {
  if (!(resource in LIST_LOADERS)) throw providerError("admin_resource_not_registered", 404);
  const loader = LIST_LOADERS[resource as keyof typeof LIST_LOADERS];
  const records = await loader();
  // Refine's provider contract is resource-dynamic. This is the sole narrowing point after strict Zod validation.
  return { data: records as unknown as TData[], total: records.length };
}

export const adminDataProvider: DataProvider = {
  getList,
  async getOne() {
    throw providerError("admin_resource_operation_not_supported", 405);
  },
  create: unsupported,
  async update() {
    throw providerError("admin_resource_operation_not_supported", 405);
  },
  async deleteOne() {
    throw providerError("admin_resource_operation_not_supported", 405);
  },
  getApiUrl: () => "/api/control",
};
