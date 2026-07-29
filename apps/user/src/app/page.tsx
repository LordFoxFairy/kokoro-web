import { headers } from "next/headers"
import { notFound } from "next/navigation"

import { issueSessionV3BrowserCsrf } from "@/lib/server/session-v3"
import { ReferenceChat } from "@/reference/reference-chat"

export default async function Home(props: {
  readonly searchParams: Promise<{ readonly session?: string | string[] }>
}) {
  const host = (await headers()).get("host")
  const configuredOrigin = process.env.KOKORO_SITE_PUBLIC_ORIGIN?.trim()
  const brandName = process.env.KOKORO_SITE_BRAND_NAME?.trim()
  if (process.env.NODE_ENV === "production") {
    let canonicalHost: string | undefined
    try {
      canonicalHost = configuredOrigin ? new URL(configuredOrigin).host : undefined
    } catch {
      canonicalHost = undefined
    }
    if (!brandName || canonicalHost === undefined || host !== canonicalHost) notFound()
  }
  const rawSessionId = (await props.searchParams).session
  return (
    <ReferenceChat
      brandName={brandName || "Kokoro local unsafe"}
      csrfToken={issueSessionV3BrowserCsrf()}
      initialSessionId={typeof rawSessionId === "string" ? rawSessionId : undefined}
    />
  )
}
