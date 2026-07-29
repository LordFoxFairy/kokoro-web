import { AccountProduct } from "@kokoro/account-app"
import { cookies } from "next/headers"
import { notFound, redirect } from "next/navigation"

import { SESSION_COOKIE } from "@/lib/server/auth"
import { issueSessionV3BrowserCsrf, platformAuthSessionFromSealedCookie } from "@/lib/server/session-v3"

export default async function AccountPage() {
  const auth = platformAuthSessionFromSealedCookie((await cookies()).get(SESSION_COOKIE)?.value)
  if (auth === null) redirect("/login")
  const csrf = issueSessionV3BrowserCsrf()
  const brandName = process.env.KOKORO_SITE_BRAND_NAME?.trim()
  if (!csrf || !brandName) notFound()
  return <AccountProduct brandName={brandName} csrfToken={csrf} />
}
