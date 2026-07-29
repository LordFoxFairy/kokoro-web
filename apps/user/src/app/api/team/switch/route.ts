import { retiredApi } from "@/lib/server/retired-api"

export const dynamic = "force-dynamic"
export const POST = (): Response => retiredApi("team")
