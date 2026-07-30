import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { Code } from "@connectrpc/connect";

import { AdminControlPlaneError } from "./client";

export const NO_STORE = { "cache-control": "no-store, private, max-age=0", pragma: "no-cache",
  "x-content-type-options": "nosniff" } as const;

export function controlJson(value: unknown, init: ResponseInit = {}): NextResponse {
  return NextResponse.json({ data: value }, { ...init, headers: { ...NO_STORE, ...init.headers } });
}

export function controlError(reason: unknown): NextResponse {
  if (reason instanceof ZodError) return errorJson("request.invalid", 400);
  if (reason instanceof AdminControlPlaneError) {
    const status = reason.connectCode === Code.Unauthenticated ? 401 : reason.connectCode === Code.PermissionDenied ? 403 :
      reason.connectCode === Code.NotFound ? 404 : reason.connectCode === Code.InvalidArgument ? 400 :
        reason.connectCode === Code.FailedPrecondition ? 409 : reason.connectCode === Code.ResourceExhausted ? 429 : 503;
    return NextResponse.json({ error: { code: reason.domainCode, receiptRef: reason.receiptRef } }, { status, headers: NO_STORE });
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
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isSafeInteger(declared) || declared < 0 || declared > maximum) throw new ZodError([]);
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > maximum) throw new ZodError([]);
  try { return JSON.parse(text) as unknown; } catch { throw new ZodError([]); }
}
