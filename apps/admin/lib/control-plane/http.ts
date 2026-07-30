import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { Code } from "@connectrpc/connect";

import { AdminControlPlaneError } from "./client";

export const NO_STORE = { "cache-control": "no-store, private, max-age=0", pragma: "no-cache",
  "x-content-type-options": "nosniff" } as const;

export class PayloadTooLargeError extends Error {
  constructor() { super("request_payload_too_large"); this.name = "PayloadTooLargeError"; }
}

export function controlJson(value: unknown, init: ResponseInit = {}): NextResponse {
  return NextResponse.json({ data: value }, { ...init, headers: { ...NO_STORE, ...init.headers } });
}

export function controlError(reason: unknown): NextResponse {
  if (reason instanceof PayloadTooLargeError) return errorJson("request.payload_too_large", 413);
  if (reason instanceof ZodError) return errorJson("request.invalid", 400);
  if (reason instanceof AdminControlPlaneError) {
    const status = reason.connectCode === Code.Unauthenticated ? 401 : reason.connectCode === Code.PermissionDenied ? 403 :
      reason.connectCode === Code.NotFound ? 404 : reason.connectCode === Code.InvalidArgument ? 400 :
        reason.connectCode === Code.AlreadyExists || reason.connectCode === Code.FailedPrecondition ? 409 :
          reason.connectCode === Code.ResourceExhausted ? 429 : 503;
    return NextResponse.json({ error: { code: reason.domainCode, receiptRef: reason.receiptRef,
      recoveryRef: reason.recoveryRef } }, { status, headers: NO_STORE });
  }
  return errorJson("admin_control_plane.unavailable", 503);
}

function errorJson(code: string, status: number): NextResponse {
  return NextResponse.json({ error: { code } }, { status, headers: NO_STORE });
}

export async function boundedJson(request: Request, maximum = 64 * 1024): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    throw new ZodError([]);
  }
  const rawLength = request.headers.get("content-length");
  if (rawLength !== null && !/^\d+$/u.test(rawLength)) throw new ZodError([]);
  const declared = rawLength === null ? null : Number(rawLength);
  if (declared !== null && (!Number.isSafeInteger(declared) || declared < 0)) throw new ZodError([]);
  if (declared !== null && declared > maximum) {
    await request.body?.cancel().catch(() => undefined);
    throw new PayloadTooLargeError();
  }
  const text = await boundedText(request, maximum);
  try { return JSON.parse(text) as unknown; } catch { throw new ZodError([]); }
}

async function boundedText(request: Request, maximum: number): Promise<string> {
  if (request.body === null) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let total = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    total += chunk.value.byteLength;
    if (total > maximum) {
      await reader.cancel().catch(() => undefined);
      throw new PayloadTooLargeError();
    }
    text += decoder.decode(chunk.value, { stream: true });
  }
  return text + decoder.decode();
}
