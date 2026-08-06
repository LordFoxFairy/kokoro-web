import {
  PLATFORM_PUBLIC_CONTRACT_METADATA,
  PLATFORM_PUBLIC_OPERATIONS,
  type PlatformPublicOperationId,
  type PlatformPublicOperationDataMap,
  type PlatformPublicOperationResponseMap,
} from "./generated/contracts/openapi/platform-public/index.js";
import { zErrorResponse } from "./generated/contracts/openapi/platform-public/zod.gen.js";
import type { ErrorResponse } from "./generated/contracts/openapi/platform-public/types.gen.js";

export type PlatformPublicOperationInput<Operation extends PlatformPublicOperationId> = Omit<
  PlatformPublicOperationDataMap[Operation],
  "headers" | "url"
>;

type PlatformPublicOperationRegistry = typeof PLATFORM_PUBLIC_OPERATIONS;
export type PlatformPublicOperationMethod = PlatformPublicOperationRegistry[PlatformPublicOperationId]["method"];

export interface PublicCommandContext {
  readonly commandId: string;
  readonly idempotencyKey: string;
}

export interface SecretPublicCommandContext extends PublicCommandContext {
  readonly receiptRecoveryCapability: string;
}

export interface PlatformPublicRequest<Operation extends PlatformPublicOperationId> {
  readonly operationId: Operation;
  readonly method: PlatformPublicOperationRegistry[Operation]["method"];
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: PlatformPublicOperationDataMap[Operation] extends { readonly body: infer Body }
    ? Body
    : undefined;
  readonly query: PlatformPublicOperationDataMap[Operation] extends { readonly query: infer Query }
    ? Query
    : undefined;
  /** Security material stays explicit so the transport can map it to its registered binding. */
  readonly security: Readonly<{
    readonly receiptRecoveryCapability?: string;
  }>;
  /** Caller-owned cancellation; transports must terminate in-flight upstream I/O. */
  readonly signal?: AbortSignal;
  /** Relative upper bound for this call. The transport may apply a stricter configured limit. */
  readonly deadlineMs?: number;
}

/** Site-server transport that resolves a registered binding; it never accepts a raw Platform URL. */
export interface PlatformPublicTransport {
  execute<Operation extends PlatformPublicOperationId>(request: PlatformPublicRequest<Operation>): Promise<{
    readonly status: number;
    readonly body: unknown;
  }>;
}

export class PlatformPublicError extends Error {
  constructor(
    readonly status: number,
    readonly detail: ErrorResponse,
  ) {
    super(detail.safeMessage);
    this.name = "PlatformPublicError";
  }
}

export class PlatformPublicInputError extends TypeError {
  readonly code = "PLATFORM_PUBLIC_INPUT_INVALID" as const;

  constructor(
    readonly operationId: PlatformPublicOperationId,
    readonly component: "data" | "body" | "deadline" | "headers" | "path" | "query" | "security" | "signal",
  ) {
    super(`Platform Public request is invalid for ${operationId}:${component}`);
    this.name = "PlatformPublicInputError";
  }
}

export class PlatformPublicProtocolError extends Error {
  readonly code = "PLATFORM_PUBLIC_PROTOCOL_ERROR" as const;

  constructor(
    readonly operationId: PlatformPublicOperationId,
    readonly phase: "transport_status" | "error_response" | "success_response",
    readonly status: number,
  ) {
    super("Platform Public response violated the registered contract");
    this.name = "PlatformPublicProtocolError";
  }
}

export interface PlatformPublicClientOptions {
  readonly transport: PlatformPublicTransport;
  readonly csrfToken: () => string;
  readonly randomBytes?: (length: number) => Uint8Array;
}

function defaultRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  if (globalThis.crypto === undefined) throw new Error("Web Crypto is required to create command identities");
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function renderPath(template: string, parameters: unknown): string {
  const values = parameters !== null && typeof parameters === "object"
    ? (parameters as Readonly<Record<string, string>>)
    : {};
  const rendered = template.replaceAll(/\{([^}]+)\}/gu, (_, name: string) => {
    const value = values[name];
    if (value === undefined || value.length === 0 || value.length > 128) {
      throw new TypeError(`missing or invalid path parameter: ${name}`);
    }
    return encodeURIComponent(value);
  });
  if (rendered.includes("{")) throw new TypeError("unresolved Platform contract path parameter");
  return rendered;
}

interface RuntimeSchema {
  safeParse(input: unknown):
    | { readonly success: true; readonly data: unknown }
    | { readonly success: false };
}

function parseRequestComponent(
  operationId: PlatformPublicOperationId,
  component: "body" | "headers" | "path" | "query",
  schema: RuntimeSchema | null,
  value: unknown,
): unknown {
  if (schema === null) {
    if (value !== undefined) throw new PlatformPublicInputError(operationId, component);
    return undefined;
  }
  const result = schema.safeParse(value);
  if (!result.success) throw new PlatformPublicInputError(operationId, component);
  return result.data;
}

function parseResponse(
  operationId: PlatformPublicOperationId,
  phase: "error_response" | "success_response",
  status: number,
  schema: RuntimeSchema,
  body: unknown,
): unknown {
  const result = schema.safeParse(body);
  if (!result.success) throw new PlatformPublicProtocolError(operationId, phase, status);
  return result.data;
}

function assertDataShape(operationId: PlatformPublicOperationId, data: unknown): void {
  if (data === null || typeof data !== "object") throw new PlatformPublicInputError(operationId, "data");
  const allowed = new Set(["body", "path", "query"]);
  if (Object.keys(data).some((key) => !allowed.has(key))) {
    throw new PlatformPublicInputError(operationId, "data");
  }
}

function validateReceiptRecoveryCapability(
  operationId: PlatformPublicOperationId,
  value: string | undefined,
): string | undefined {
  if (
    value !== undefined &&
    (value.length < 43 || value.length > 512 || Array.from(value).some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 32 || code === 127;
    }))
  ) {
    throw new PlatformPublicInputError(operationId, "security");
  }
  return value;
}

function field(value: unknown, name: "body" | "path" | "query"): unknown {
  return value !== null && typeof value === "object" && name in value
    ? (value as Record<string, unknown>)[name]
    : undefined;
}

export function createPlatformPublicClient(options: PlatformPublicClientOptions) {
  const randomBytes = options.randomBytes ?? defaultRandomBytes;

  function createCommand(): PublicCommandContext {
    return Object.freeze({ commandId: hex(randomBytes(16)), idempotencyKey: hex(randomBytes(24)) });
  }

  function createSecretCommand(): SecretPublicCommandContext {
    return Object.freeze({ ...createCommand(), receiptRecoveryCapability: hex(randomBytes(32)) });
  }

  async function execute<Operation extends PlatformPublicOperationId>(input: {
    readonly operationId: Operation;
    readonly data: PlatformPublicOperationInput<Operation>;
    readonly command?: PublicCommandContext | SecretPublicCommandContext;
    /** Exact reconciliation key for read-only recovery operations that require Idempotency-Key. */
    readonly idempotencyKey?: string;
    /** Used only for the capability alternative on anonymous receipt lookup. */
    readonly receiptRecoveryCapability?: string;
    /** Generated canonical caller-intent digest, accepted only by media submission. */
    readonly callerRequestFingerprint?: string;
    readonly signal?: AbortSignal;
    readonly deadlineMs?: number;
  }): Promise<PlatformPublicOperationResponseMap[Operation]> {
    const definition = PLATFORM_PUBLIC_OPERATIONS[input.operationId];
    assertDataShape(input.operationId, input.data);
    if (input.callerRequestFingerprint !== undefined && input.operationId !== "submitMediaOperation") {
      throw new PlatformPublicInputError(input.operationId, "headers");
    }
    if (input.signal !== undefined && !(input.signal instanceof AbortSignal)) {
      throw new PlatformPublicInputError(input.operationId, "signal");
    }
    if (input.deadlineMs !== undefined && (!Number.isInteger(input.deadlineMs) || input.deadlineMs < 1 || input.deadlineMs > 300_000)) {
      throw new PlatformPublicInputError(input.operationId, "deadline");
    }
    const headers: Record<string, string> = {
      "Kokoro-Contract-Version": PLATFORM_PUBLIC_CONTRACT_METADATA.contractVersion,
      ...(input.idempotencyKey === undefined ? {} : { "Idempotency-Key": input.idempotencyKey }),
      ...(input.callerRequestFingerprint === undefined ? {} : {
        "X-Kokoro-Caller-Request-Fingerprint": input.callerRequestFingerprint,
      }),
    };
    if (definition.mutation) {
      headers["X-CSRF-Token"] = options.csrfToken();
      // The generated header schema is authoritative: some effectful endpoints (for example,
      // short-lived grant issuance) are intentionally non-command mutations.
      if (input.command !== undefined) {
        headers["X-Kokoro-Command-Id"] = input.command.commandId;
        headers["Idempotency-Key"] = input.command.idempotencyKey;
      }
    }

    const commandCapability = input.command !== undefined && "receiptRecoveryCapability" in input.command
      ? input.command.receiptRecoveryCapability
      : undefined;
    const capability = validateReceiptRecoveryCapability(
      input.operationId,
      commandCapability ?? input.receiptRecoveryCapability,
    );
    if (definition.receiptRecovery === "required" && capability === undefined) {
      throw new TypeError("operation requires caller-held receipt recovery capability");
    }
    if (definition.receiptRecovery === "none" && capability !== undefined) {
      throw new TypeError("operation does not accept a receipt recovery capability");
    }

    const body = parseRequestComponent(
      input.operationId,
      "body",
      definition.requestSchemas.body,
      field(input.data, "body"),
    );
    const pathParameters = parseRequestComponent(
      input.operationId,
      "path",
      definition.requestSchemas.path,
      field(input.data, "path"),
    );
    const query = parseRequestComponent(
      input.operationId,
      "query",
      definition.requestSchemas.query,
      field(input.data, "query"),
    );
    const parsedHeaders = parseRequestComponent(
      input.operationId,
      "headers",
      definition.requestSchemas.headers,
      headers,
    ) as Readonly<Record<string, string>>;

    const response = await options.transport.execute({
      operationId: input.operationId,
      method: definition.method,
      path: renderPath(definition.path, pathParameters),
      headers: parsedHeaders,
      body: body as PlatformPublicRequest<Operation>["body"],
      query: query as PlatformPublicRequest<Operation>["query"],
      security: Object.freeze({
        ...(capability === undefined ? {} : { receiptRecoveryCapability: capability }),
      }),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      ...(input.deadlineMs === undefined ? {} : { deadlineMs: input.deadlineMs }),
    });
    if (!Number.isInteger(response.status) || response.status < 100 || response.status > 599) {
      throw new PlatformPublicProtocolError(input.operationId, "transport_status", response.status);
    }
    if (!(definition.successStatuses as readonly number[]).includes(response.status)) {
      const detail = parseResponse(
        input.operationId,
        "error_response",
        response.status,
        zErrorResponse,
        response.body,
      ) as ErrorResponse;
      throw new PlatformPublicError(response.status, detail);
    }
    const parsed = parseResponse(
      input.operationId,
      "success_response",
      response.status,
      definition.responseSchema,
      response.body,
    );
    return parsed as PlatformPublicOperationResponseMap[Operation];
  }

  return Object.freeze({
    contract: PLATFORM_PUBLIC_CONTRACT_METADATA,
    operations: PLATFORM_PUBLIC_OPERATIONS,
    createCommand,
    createSecretCommand,
    execute,
  });
}
