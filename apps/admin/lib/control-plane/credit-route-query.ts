import { z, ZodError } from "zod";

import { creditSourceTypeSchema, pairedSourceFilter } from "@/lib/credit-contract";
import { strictQuery } from "./strict-query";

const siteId = z.string().min(1).max(128);
const reference = z.string().min(1).max(256);
const uuid = z.string().uuid();
const pageToken = z.string().min(1).max(512).optional();
const sourceType = creditSourceTypeSchema.optional();
const sourceRef = reference.optional();

export function parseCreditSummaryQuery(request: Request) {
  return strictQuery(request, { siteId });
}

export function parseCreditAccountListQuery(request: Request) {
  return strictQuery(request, { siteId, billingAccountRef: reference.optional(), pageToken });
}

export function parseCreditAccountDetailQuery(request: Request, accountRef: string) {
  const query = strictQuery(request, { siteId });
  return { ...query, accountRef: uuid.parse(accountRef) };
}

export function parseCreditGrantListQuery(request: Request) {
  const query = strictQuery(request, { siteId, creditAccountRef: uuid.optional(), creditGrantId: uuid.optional(),
    sourceType, sourceRef, executionRootRef: reference.optional(), pageToken }, { maximumParameters: 7 });
  return { ...defined(query, ["creditAccountRef", "creditGrantId", "executionRootRef", "pageToken"]),
    ...source(query.sourceType, query.sourceRef), siteId: query.siteId };
}

export function parseCreditHoldListQuery(request: Request) {
  const query = strictQuery(request, { siteId, creditAccountRef: uuid.optional(), creditGrantId: uuid.optional(),
    sourceType, sourceRef, executionRootRef: reference.optional(), pageToken }, { maximumParameters: 7 });
  return { ...defined(query, ["creditAccountRef", "creditGrantId", "executionRootRef", "pageToken"]),
    ...source(query.sourceType, query.sourceRef), siteId: query.siteId };
}

export function parseCreditHoldAllocationQuery(request: Request) {
  const query = strictQuery(request, { siteId, creditHoldRef: uuid.optional(), creditGrantId: uuid.optional(), pageToken });
  const trace = exactlyOne(query.creditHoldRef, query.creditGrantId,
    (ref) => ({ kind: "hold" as const, ref }), (ref) => ({ kind: "grant" as const, ref }));
  return { siteId: query.siteId, trace, ...defined(query, ["pageToken"]) };
}

export function parseCreditJournalTransactionQuery(request: Request) {
  const query = strictQuery(request, { siteId, creditAccountRef: uuid.optional(), creditGrantId: uuid.optional(),
    creditHoldRef: uuid.optional(), sourceType, sourceRef, executionRootRef: reference.optional(), pageToken },
  { maximumParameters: 8 });
  return { ...defined(query, ["creditAccountRef", "creditGrantId", "creditHoldRef", "executionRootRef", "pageToken"]),
    ...source(query.sourceType, query.sourceRef), siteId: query.siteId };
}

export function parseCreditJournalEntryQuery(request: Request) {
  return strictQuery(request, { siteId, journalTransactionRef: uuid, pageToken });
}

export function parseRatedUsageQuery(request: Request) {
  const query = strictQuery(request, { siteId, creditAccountRef: uuid.optional(), creditGrantId: uuid.optional(),
    creditHoldRef: uuid.optional(), sourceType, sourceRef, executionRootRef: reference.optional(),
    attemptRef: reference.optional(), pageToken }, { maximumParameters: 9 });
  return { ...defined(query, ["creditAccountRef", "creditGrantId", "creditHoldRef", "executionRootRef",
    "attemptRef", "pageToken"]), ...source(query.sourceType, query.sourceRef), siteId: query.siteId };
}

export function parseRatedUsageSourceAllocationQuery(request: Request) {
  const query = strictQuery(request, { siteId, ratedUsageRef: uuid.optional(), settlementRef: uuid.optional(), pageToken });
  const trace = exactlyOne(query.ratedUsageRef, query.settlementRef,
    (ref) => ({ kind: "usage" as const, ref }), (ref) => ({ kind: "settlement" as const, ref }));
  return { siteId: query.siteId, trace, ...defined(query, ["pageToken"]) };
}

function source(type: z.infer<typeof sourceType>, ref: string | undefined) {
  try { return pairedSourceFilter(type ?? "", ref ?? ""); }
  catch { throw new ZodError([]); }
}

function exactlyOne<Left, Right>(left: string | undefined, right: string | undefined,
  leftValue: (value: string) => Left, rightValue: (value: string) => Right): Left | Right {
  if ((left === undefined) === (right === undefined)) throw new ZodError([]);
  return left === undefined ? rightValue(right!) : leftValue(left);
}

function defined<Value extends Readonly<Record<string, unknown>>, Key extends keyof Value>(value: Value,
  keys: readonly Key[]): Partial<Pick<Value, Key>> {
  return Object.fromEntries(keys.flatMap((key) => value[key] === undefined ? [] : [[key, value[key]]])) as
    Partial<Pick<Value, Key>>;
}
