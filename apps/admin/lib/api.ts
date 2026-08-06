import { z } from "zod";

// Typed control BFF envelope: success {data}; failure
// {error:{code,message,details?,receiptRef?,recoveryRef?},requestId?}.
const errorEnvelope = z
  .object({
    error: z.object({ code: z.string(), message: z.string(), details: z.unknown(),
      receiptRef: z.string().nullable(), recoveryRef: z.string().nullable() }).partial().passthrough(),
    requestId: z.string().optional(),
  })
  .passthrough();

// 解析不出 error.code 时的兜底值。不假装有 code，调用方可据此判断“这不是一个 domain error”。
export const UNKNOWN_ERROR_CODE = "unknown";

/** Domain error codes stay open so a newer typed BFF response remains readable. */
export type DomainErrorCode = string;

export class ApiError extends Error {
  readonly status: number;
  readonly code: DomainErrorCode;
  /** 目前唯一实际形态是 zod 校验失败的 `{ issues: ZodIssue[] }`；无则 undefined。 */
  readonly details: unknown;
  /** Optional correlation reference returned by a typed control route. */
  readonly requestId: string | undefined;
  readonly receiptRef: string | null;
  /** Opaque、有限长的 Model 写结果恢复引用；浏览器只保存并原样交回 BFF。 */
  readonly recoveryRef: string | null;

  constructor(init: {
    status: number;
    code: DomainErrorCode;
    message: string;
    details?: unknown;
    requestId?: string;
    receiptRef?: string | null;
    recoveryRef?: string | null;
  }) {
    super(init.message);
    this.name = "ApiError";
    this.status = init.status;
    this.code = init.code;
    this.details = init.details;
    this.requestId = init.requestId;
    this.receiptRef = init.receiptRef ?? null;
    this.recoveryRef = init.recoveryRef ?? null;
  }
}

// 同源调网关；非 2xx 抛错。data 由调用方用 schema 洗净，绝不裸传。
async function request(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(path, { ...init, headers: { ...(init?.headers ?? {}) } });
  const raw: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const parsed = errorEnvelope.safeParse(raw);
    const envelope = parsed.success ? parsed.data : undefined;
    throw new ApiError({
      status: res.status,
      code: envelope?.error.code ?? UNKNOWN_ERROR_CODE,
      message: envelope?.error.message ?? `HTTP ${res.status}`,
      details: envelope?.error.details,
      requestId: envelope?.requestId,
      receiptRef: envelope?.error.receiptRef,
      recoveryRef: envelope?.error.recoveryRef,
    });
  }
  const envelope = z.object({ data: z.unknown() }).safeParse(raw);
  return envelope.success ? envelope.data.data : undefined;
}

export async function apiGet<T>(path: string, schema: z.ZodType<T>,
  options: Readonly<{ signal?: AbortSignal }> = {}): Promise<T> {
  return schema.parse(await request(path, options.signal ? { signal: options.signal } : undefined));
}

export async function apiPost<T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
  const data = await request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return schema.parse(data);
}

export function queryString(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}
