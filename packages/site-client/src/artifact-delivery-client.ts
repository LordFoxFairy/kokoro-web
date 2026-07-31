import {
  ARTIFACT_DELIVERY_MAX_RANGE_BYTES,
  artifactDeliveryCall,
  type ArtifactDeliveryByteRange,
} from "./generated/platform-public/artifact-delivery.js";
import { PLATFORM_PUBLIC_CONTRACT_METADATA } from "./generated/platform-public/contract-metadata.js";

const REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,255}$/u;
const CAPABILITY_MINIMUM = 32;
const CAPABILITY_MAXIMUM = 4_096;

export type ArtifactDeliveryResponseHeader =
  | "accept-ranges"
  | "content-disposition"
  | "content-length"
  | "content-range"
  | "content-type"
  | "etag"
  | "last-modified";

export type ArtifactDeliveryMediaType = "image/png" | "image/jpeg" | "image/webp";

export type ArtifactDeliveryTransportRequest = Readonly<{
  method: "GET";
  path: string;
  headers: Readonly<Record<string, string>>;
  signal: AbortSignal;
  security: Readonly<{ deliveryCapability: string }>;
}>;

export type ArtifactDeliveryTransportResponse = Readonly<{
  status: number;
  headers: Headers;
  body: ReadableStream<Uint8Array>;
}>;

export interface ArtifactDeliveryTransport {
  redeem(request: ArtifactDeliveryTransportRequest): Promise<ArtifactDeliveryTransportResponse>;
}

export type ArtifactDeliveryResponse = Readonly<{
  status: 200 | 206;
  headers: Readonly<Partial<Record<ArtifactDeliveryResponseHeader, string>>>;
  body: ReadableStream<Uint8Array>;
}>;

export class ArtifactDeliveryInputError extends TypeError {
  readonly code = "ARTIFACT_DELIVERY_INPUT_INVALID" as const;
  constructor(readonly component: "authorizationRef" | "deliveryCapability") {
    super(`Artifact delivery input is invalid: ${component}`);
    this.name = "ArtifactDeliveryInputError";
  }
}

export class ArtifactDeliveryProtocolError extends Error {
  readonly code = "ARTIFACT_DELIVERY_PROTOCOL_INVALID" as const;
  constructor() {
    super("Artifact delivery response violated the registered contract");
    this.name = "ArtifactDeliveryProtocolError";
  }
}

const HEADER_LIMITS: Readonly<Record<ArtifactDeliveryResponseHeader, number>> = Object.freeze({
  "accept-ranges": 16,
  "content-disposition": 4_096,
  "content-length": 32,
  "content-range": 128,
  "content-type": 256,
  etag: 1_024,
  "last-modified": 128,
});

function invalidProtocol(): never {
  throw new ArtifactDeliveryProtocolError();
}

function safeHeaderValue(value: string, maximum: number): boolean {
  return value.length > 0 && value.length <= maximum && Array.from(value).every((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code === 9 || (code >= 32 && code !== 127);
  });
}

function filteredHeaders(input: Headers): Partial<Record<ArtifactDeliveryResponseHeader, string>> {
  const result: Partial<Record<ArtifactDeliveryResponseHeader, string>> = {};
  for (const [name, maximum] of Object.entries(HEADER_LIMITS) as [ArtifactDeliveryResponseHeader, number][]) {
    const value = input.get(name);
    if (value === null) continue;
    if (!safeHeaderValue(value, maximum)) invalidProtocol();
    result[name] = value;
  }
  return result;
}

function decimal(value: string | undefined): bigint | undefined {
  if (value === undefined || !/^(?:0|[1-9][0-9]*)$/u.test(value)) return undefined;
  try {
    return BigInt(value);
  } catch {
    return undefined;
  }
}

function normalizedRange(range: ArtifactDeliveryByteRange, total: bigint): Readonly<{ start: bigint; end: bigint }> {
  if ("suffixLength" in range) {
    const span = range.suffixLength > total ? total : range.suffixLength;
    return { start: total - span, end: total - 1n };
  }
  if (range.start >= total) invalidProtocol();
  return { start: range.start, end: range.endInclusive >= total ? total - 1n : range.endInclusive };
}

function validateResponse(
  status: number,
  headers: Readonly<Partial<Record<ArtifactDeliveryResponseHeader, string>>>,
  range: ArtifactDeliveryByteRange | undefined,
  expectedByteSize: bigint,
  expectedMediaType: ArtifactDeliveryMediaType,
): Readonly<{ status: 200 | 206; expectedBodyBytes: bigint }> {
  if (status !== 200 && status !== 206) invalidProtocol();
  if (expectedByteSize < 1n) invalidProtocol();
  if (headers["content-type"]?.toLowerCase() !== expectedMediaType) invalidProtocol();
  const length = headers["content-length"] === undefined ? undefined : decimal(headers["content-length"]);
  if (headers["content-length"] !== undefined && length === undefined) invalidProtocol();
  if (headers["accept-ranges"] !== undefined && headers["accept-ranges"] !== "bytes") invalidProtocol();
  if (headers["last-modified"] !== undefined && Number.isNaN(Date.parse(headers["last-modified"]))) invalidProtocol();
  if (status === 200) {
    if (range !== undefined || headers["content-range"] !== undefined) invalidProtocol();
    if (length !== undefined && length !== expectedByteSize) invalidProtocol();
    return { status, expectedBodyBytes: expectedByteSize };
  }
  if (range === undefined) invalidProtocol();
  const match = /^bytes ([0-9]+)-([0-9]+)\/([0-9]+)$/u.exec(headers["content-range"] ?? "");
  if (match === null || BigInt(match[3] ?? "0") !== expectedByteSize) invalidProtocol();
  const start = BigInt(match[1] ?? "0");
  const end = BigInt(match[2] ?? "0");
  const span = end - start + 1n;
  if (end < start || span < 1n || span > ARTIFACT_DELIVERY_MAX_RANGE_BYTES) invalidProtocol();
  const expected = normalizedRange(range, expectedByteSize);
  if (start !== expected.start || end !== expected.end) invalidProtocol();
  if (length !== undefined && length !== span) invalidProtocol();
  return { status, expectedBodyBytes: span };
}

function capability(value: string): string {
  if (
    value.length < CAPABILITY_MINIMUM || value.length > CAPABILITY_MAXIMUM ||
    Array.from(value).some((character) => (character.codePointAt(0) ?? 0) <= 32 || character.codePointAt(0) === 127)
  ) throw new ArtifactDeliveryInputError("deliveryCapability");
  return value;
}

function exactLengthBody(body: ReadableStream<Uint8Array>, expected: bigint): ReadableStream<Uint8Array> {
  let observed = 0n;
  return body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      if (!(chunk instanceof Uint8Array)) invalidProtocol();
      observed += BigInt(chunk.byteLength);
      if (observed > expected) invalidProtocol();
      controller.enqueue(chunk);
    },
    flush() {
      if (observed !== expected) invalidProtocol();
    },
  }));
}

export function createArtifactDeliveryClient(input: Readonly<{ transport: ArtifactDeliveryTransport }>) {
  return Object.freeze({
    async redeem(options: Readonly<{
      authorizationRef: string;
      deliveryCapability: string;
      signal: AbortSignal;
      deadlineMs: number;
      expectedByteSize: bigint;
      expectedMediaType: ArtifactDeliveryMediaType;
      range?: ArtifactDeliveryByteRange;
    }>): Promise<ArtifactDeliveryResponse> {
      if (!REFERENCE.test(options.authorizationRef)) throw new ArtifactDeliveryInputError("authorizationRef");
      const call = artifactDeliveryCall({
        signal: options.signal,
        deadlineMs: options.deadlineMs,
        ...(options.range === undefined ? {} : { range: options.range }),
      });
      const response = await input.transport.redeem({
        method: "GET",
        path: `/v1/artifact-delivery-authorizations/${encodeURIComponent(options.authorizationRef)}/content`,
        headers: Object.freeze({
          "Kokoro-Contract-Version": PLATFORM_PUBLIC_CONTRACT_METADATA.contractVersion,
          ...call.headers,
        }),
        signal: call.signal,
        security: Object.freeze({ deliveryCapability: capability(options.deliveryCapability) }),
      });
      try {
        if (!(response.body instanceof ReadableStream)) invalidProtocol();
        const headers = Object.freeze(filteredHeaders(response.headers));
        const validated = validateResponse(
          response.status,
          headers,
          options.range,
          options.expectedByteSize,
          options.expectedMediaType,
        );
        return Object.freeze({
          status: validated.status,
          headers,
          body: exactLengthBody(response.body, validated.expectedBodyBytes),
        });
      } catch (error) {
        await response.body.cancel(error).catch(() => undefined);
        throw error;
      }
    },
  });
}
