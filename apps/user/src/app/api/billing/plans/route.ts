import { retiredApi } from "@/lib/server/retired-api"

export const dynamic = "force-dynamic"
export async function GET(): Promise<Response> {
  return retiredApi("billing")
}
