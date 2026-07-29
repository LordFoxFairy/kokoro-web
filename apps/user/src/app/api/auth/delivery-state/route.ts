import {
  authRouteAllowed,
  prepareAuthDelivery,
  type AuthDeliveryPreparation,
} from "@/auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAXIMUM_BODY_BYTES = 4_096

async function boundedBody(request: Request): Promise<unknown> {
  const declared = request.headers.get("content-length")
  if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > MAXIMUM_BODY_BYTES)) throw new Error("invalid")
  const bytes = new Uint8Array(await request.arrayBuffer())
  if (bytes.byteLength > MAXIMUM_BODY_BYTES) throw new Error("invalid")
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
}

function preparation(value: unknown): Readonly<{ input: AuthDeliveryPreparation; advance: boolean }> | null {
  if (value === null || typeof value !== "object") return null
  const item = value as Record<string, unknown>
  if (
    item.flow === "login" && typeof item.email === "string" && item.email.length <= 320 &&
    typeof item.password === "string" && item.password.length <= 1024
  ) return { input: { flow: "login", email: item.email, password: item.password }, advance: item.advance === true }
  if (
    item.flow === "mfa" && typeof item.transactionRef === "string" && item.transactionRef.length <= 256 &&
    typeof item.code === "string" && item.code.length <= 64
  ) return { input: { flow: "mfa", transactionRef: item.transactionRef, code: item.code }, advance: item.advance === true }
  return null
}

export async function POST(request: Request): Promise<Response> {
  if (!authRouteAllowed(request)) return new Response(null, { status: 403 })
  try {
    const prepared = preparation(await boundedBody(request))
    if (prepared === null) return Response.json({ error: "request_invalid" }, { status: 400 })
    await prepareAuthDelivery(prepared.input, prepared.advance)
    return new Response(null, { status: 204, headers: { "cache-control": "no-store" } })
  } catch {
    return Response.json({ error: "request_invalid" }, { status: 400 })
  }
}
