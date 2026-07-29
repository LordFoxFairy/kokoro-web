import { retiredApi } from "@/lib/server/retired-api"

export const dynamic = "force-dynamic"
export const GET = (): Response => retiredApi("team")
