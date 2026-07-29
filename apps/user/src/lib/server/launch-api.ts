import "server-only"

import { createSiteLaunchApi } from "@kokoro/site-bff"
import { parseSiteLegalDocuments } from "@kokoro/site-bff/site-legal-documents"

import { platformAuthSessionFromRequest } from "./session-v3"
import { userSiteBff } from "./site-bff"

let api: ReturnType<typeof createSiteLaunchApi> | undefined

export function userLaunchApi() {
  if (api !== undefined) return api
  const secret = process.env.KOKORO_WEB_SESSION_SECRET?.split(",", 1)[0]?.trim()
  if (!secret || secret.length < 32) throw new Error("KOKORO_WEB_SESSION_SECRET is unavailable")
  const legalDocuments = parseSiteLegalDocuments(process.env.KOKORO_SITE_REGISTRATION_LEGAL_DOCUMENTS)
  api = createSiteLaunchApi({
    runtime: userSiteBff(),
    stateSecret: secret,
    readAuthSession: (request) => platformAuthSessionFromRequest(request),
    legalDocuments,
  })
  return api
}
