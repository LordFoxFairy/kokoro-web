import type { PublicSiteBootstrap } from "@kokoro/bff-runtime"
import { ChatProduct } from "@kokoro/chat-app"
import { headers } from "next/headers"
import { notFound } from "next/navigation"

import { readOpaqueAuthSession } from "@/auth"
import {
  assembleSessionBrowserV3,
  issueSessionV3BrowserCsrf,
} from "@/lib/server/session-v3"

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
  let bootstrap: PublicSiteBootstrap | null = null
  try {
    const authSession = await readOpaqueAuthSession()
    if (authSession !== null) {
      bootstrap = (await assembleSessionBrowserV3({ authSession })).publicBootstrap
    }
  } catch {
    // Registered Platform/Session provider absence and invalid authority both fail closed in UI.
    bootstrap = null
  }
  return (
    <ChatProduct
      bootstrap={bootstrap}
      brandName={brandName || "Kokoro local unsafe"}
      csrfToken={issueSessionV3BrowserCsrf()}
      initialSessionId={typeof rawSessionId === "string" ? rawSessionId : undefined}
    />
  )
}
