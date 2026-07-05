import { I18nWorkbench, type I18nWorkbenchPayload } from "./i18n-workbench"

type AdminI18nPageProps = {
  readonly searchParams?: Promise<{
    readonly locale?: string | readonly string[]
  }>
}

export default async function AdminI18nPage({ searchParams }: AdminI18nPageProps) {
  const params = await searchParams
  const locale = normalizeLocale(params?.locale)
  const payload = await loadI18nPayload(locale)

  return <I18nWorkbench payload={payload} />
}

async function loadI18nPayload(locale: string): Promise<I18nWorkbenchPayload> {
  const apiBase = process.env.KOKORO_I18N_API_BASE ?? "http://127.0.0.1:5179"
  const url = new URL("/api/i18n/preview", apiBase)
  url.searchParams.set("locale", locale)

  try {
    const response = await fetch(url, { cache: "no-store" })

    if (!response.ok) {
      throw new Error(`i18n API returned ${response.status}`)
    }

    return (await response.json()) as I18nWorkbenchPayload
  } catch (error) {
    return {
      locale,
      locales: ["zh-CN", "en-US"],
      entries: [],
      filters: {
        contexts: [],
        sources: [],
      },
      summary: {
        total: 0,
        ready: 0,
        ambiguous: 0,
      },
      loadError: error instanceof Error ? error.message : String(error),
    }
  }
}

function normalizeLocale(locale: string | readonly string[] | undefined): string {
  if (typeof locale === "string") {
    return locale
  }

  return locale?.[0] ?? "zh-CN"
}
