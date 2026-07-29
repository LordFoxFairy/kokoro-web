import "server-only"

import { createSiteLaunchApi } from "@kokoro/site-bff"

import { platformAuthSessionFromRequest } from "./session-v3"
import { userSiteBff } from "./site-bff"

let api: ReturnType<typeof createSiteLaunchApi> | undefined

export function userLaunchApi() {
  if (api !== undefined) return api
  const secret = process.env.KOKORO_WEB_SESSION_SECRET?.split(",", 1)[0]?.trim()
  if (!secret || secret.length < 32) throw new Error("KOKORO_WEB_SESSION_SECRET is unavailable")
  const legalAcceptanceRefs = (process.env.KOKORO_SITE_REGISTRATION_LEGAL_REFS ?? "")
    .split(",").map((value) => value.trim()).filter((value) => value.length > 0 && value.length <= 128).slice(0, 16)
  api = createSiteLaunchApi({
    runtime: userSiteBff(),
    stateSecret: secret,
    readAuthSession: (request) => platformAuthSessionFromRequest(request),
    registrationLegalAcceptanceRefs: legalAcceptanceRefs,
  })
  return api
}
