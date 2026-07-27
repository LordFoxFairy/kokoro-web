import { z } from "zod";

// 网关统一信封：成功 {data}，失败 {error:{code,message,details?},requestId?}。
// 信封真源是 kokoro-platform/kokoro-platform-kit/src/http/responses.ts 的 sendData / sendError。
// 注意：网关未挂 registerErrorHandler，未捕获异常走 Fastify 默认形状 {statusCode,error,message}
// （error 是字符串而非对象），解析不中，因此落到下面的兜底 code/message。
const errorEnvelope = z
  .object({
    error: z.object({ code: z.string(), message: z.string(), details: z.unknown() }).partial().passthrough(),
    requestId: z.string().optional(),
  })
  .passthrough();

// 解析不出 error.code 时的兜底值。不假装有 code，调用方可据此判断“这不是一个 domain error”。
export const UNKNOWN_ERROR_CODE = "unknown";

/**
 * domain error code。用 string 承载而不收窄成联合类型：后端新增 code 时前端不该崩。
 *
 * 事实源是根仓 `contract/openapi/admin-web-v1.yaml` 的 `DomainErrorCode`。截至该契约，
 * 网关在浏览器面发出的全集只有 4 个：
 *   operator.auth / request.invalid / gateway.error / approval.error
 * 另有 `auth.unauthenticated` 由本 app 自己的 BFF middleware（proxy.ts）在未登录时直接产生，
 * 不来自网关，故不在契约的枚举里。
 */
export type DomainErrorCode = string;

export class ApiError extends Error {
  readonly status: number;
  readonly code: DomainErrorCode;
  /** 目前唯一实际形态是 zod 校验失败的 `{ issues: ZodIssue[] }`；无则 undefined。 */
  readonly details: unknown;
  /** 链路 id，只有 POST /api/action 会回显；排障时把它带给后端。 */
  readonly requestId: string | undefined;

  constructor(init: {
    status: number;
    code: DomainErrorCode;
    message: string;
    details?: unknown;
    requestId?: string;
  }) {
    super(init.message);
    this.name = "ApiError";
    this.status = init.status;
    this.code = init.code;
    this.details = init.details;
    this.requestId = init.requestId;
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
    });
  }
  const envelope = z.object({ data: z.unknown() }).safeParse(raw);
  return envelope.success ? envelope.data.data : undefined;
}

export async function apiGet<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  return schema.parse(await request(path));
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
