import { retiredApi } from "@/lib/server/retired-api"

export const dynamic = "force-dynamic"
export const GET = (): Response => retiredApi("hub")
export const POST = GET
export const PUT = GET
export const PATCH = GET
export const DELETE = GET
