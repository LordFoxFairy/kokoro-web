import { IdentityLaunch } from "@kokoro/account-app"
import { parseSiteLegalDocuments, publicLegalDocuments } from "@kokoro/site-bff/site-legal-documents"
import { notFound } from "next/navigation"

import { issueSessionV3BrowserCsrf } from "@/lib/server/session-v3"
import { userSiteBff } from "@/lib/server/site-bff"

export const dynamic = "force-dynamic"

export default async function RegisterPage() {
  const csrf = issueSessionV3BrowserCsrf()
  const brandName = process.env.KOKORO_SITE_BRAND_NAME?.trim()
  if (!csrf || !brandName) notFound()
  const capabilities = await userSiteBff().publicCapabilities()
  if (!capabilities.enabledSurfaceIds.some((surface) => surface === "account" || surface === "identity")) notFound()
  const legalDocuments = parseSiteLegalDocuments(process.env.KOKORO_SITE_REGISTRATION_LEGAL_DOCUMENTS)
  return <IdentityLaunch brandName={brandName} csrfToken={csrf} legalDocuments={publicLegalDocuments(legalDocuments)} mode="register" />
}
