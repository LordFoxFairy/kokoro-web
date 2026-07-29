import { IdentityLaunch } from "@kokoro/account-app"
import { notFound } from "next/navigation"

import { issueSessionV3BrowserCsrf } from "@/lib/server/session-v3"
import { userSiteBff } from "@/lib/server/site-bff"

export const dynamic = "force-dynamic"

export default async function VerifyEmailPage(props: { readonly searchParams: Promise<{ readonly transaction?: string | string[] }> }) {
  const csrf = issueSessionV3BrowserCsrf()
  const brandName = process.env.KOKORO_SITE_BRAND_NAME?.trim()
  if (!csrf || !brandName) notFound()
  const capabilities = await userSiteBff().publicCapabilities()
  if (!capabilities.enabledSurfaceIds.some((surface) => surface === "account" || surface === "identity")) notFound()
  const transaction = (await props.searchParams).transaction
  return <IdentityLaunch brandName={brandName} csrfToken={csrf} mode="verify" transactionRef={typeof transaction === "string" ? transaction : undefined} />
}
