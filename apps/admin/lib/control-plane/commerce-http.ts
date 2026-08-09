import "server-only";

import { z } from "zod";

import { strictQuery } from "./strict-query";
import { commerceCursorSchema } from "../commerce-contract";

const siteId = z.string().min(1).max(128);
const resourceRef = z.string().min(1).max(256);
const batchRef = z.string().uuid();

export function commerceListQuery(request: Request): Readonly<{ siteId: string; pageToken?: string }> {
  return strictQuery(request, { siteId, pageToken: commerceCursorSchema.optional() },
    { maximumBytes: 4 * 1024, maximumParameters: 2 });
}

export function commerceDetailQuery(request: Request): Readonly<{ siteId: string }> {
  return strictQuery(request, { siteId }, { maximumBytes: 512, maximumParameters: 1 });
}

export function noCommerceQuery(request: Request): void {
  strictQuery(request, {}, { maximumBytes: 128, maximumParameters: 1 });
}

export function commerceResourceRef(value: string): string {
  return resourceRef.parse(value);
}

export function commerceBatchRef(value: string): string {
  return batchRef.parse(value);
}
