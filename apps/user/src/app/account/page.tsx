import { AccountProduct } from "@kokoro/account-app"
import { notFound, redirect } from "next/navigation"

import { readOpaqueAuthSession } from "@/auth"
import { issueSessionV3BrowserCsrf } from "@/lib/server/session-v3"

export default async function AccountPage() {
  const auth = await readOpaqueAuthSession()
  if (auth === null) redirect("/login")
  const csrf = issueSessionV3BrowserCsrf()
  const brandName = process.env.KOKORO_SITE_BRAND_NAME?.trim()
  if (!csrf || !brandName) notFound()
  return <AccountProduct brandName={brandName} csrfToken={csrf} />
}
