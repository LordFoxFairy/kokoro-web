import { headers } from "next/headers"
import { notFound, redirect } from "next/navigation"

import { auth } from "@/auth"
import { PasswordLogin } from "@/ui/auth/password-login"

export default async function LoginRoute() {
  const host = (await headers()).get("host")
  const configuredOrigin = process.env.KOKORO_SITE_PUBLIC_ORIGIN?.trim()
  const brandName = process.env.KOKORO_SITE_BRAND_NAME?.trim()
  let canonicalHost: string | undefined
  try {
    canonicalHost = configuredOrigin ? new URL(configuredOrigin).host : undefined
  } catch {
    canonicalHost = undefined
  }
  if (!brandName || canonicalHost === undefined || host !== canonicalHost) notFound()
  const session = await auth() as {
    expires: string
    authState?: "authenticated" | "mfa_required" | "anonymous"
    mfaTransactionRef?: string
  } | null
  if (session?.authState === "authenticated") {
    redirect("/")
  }
  return <PasswordLogin
    brandName={brandName}
    transactionRef={session?.authState === "mfa_required" ? session.mfaTransactionRef : undefined}
  />
}
