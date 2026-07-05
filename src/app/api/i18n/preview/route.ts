import { createI18nWorkbenchPayload } from "@/app/admin/i18n/i18n-data"

export function GET(request: Request): Response {
  const url = new URL(request.url)
  const locale = url.searchParams.get("locale") ?? "zh-CN"

  return Response.json(createI18nWorkbenchPayload(locale))
}
