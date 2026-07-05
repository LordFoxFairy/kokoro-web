import { I18nWorkbench, type I18nWorkbenchPayload } from "./i18n-workbench"
import { createI18nWorkbenchPayload } from "./i18n-data"

type AdminI18nPageProps = {
  readonly searchParams?: Promise<{
    readonly locale?: string | readonly string[]
  }>
}

export default async function AdminI18nPage({ searchParams }: AdminI18nPageProps) {
  const params = await searchParams
  const locale = normalizeLocale(params?.locale)
  const payload = loadI18nPayload(locale)

  return <I18nWorkbench payload={payload} />
}

function loadI18nPayload(locale: string): I18nWorkbenchPayload {
  return createI18nWorkbenchPayload(locale)
}

function normalizeLocale(locale: string | readonly string[] | undefined): string {
  if (typeof locale === "string") {
    return locale
  }

  return locale?.[0] ?? "zh-CN"
}
