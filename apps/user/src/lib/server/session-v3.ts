import "server-only"

import type { OpaqueAuthSession } from "@kokoro/bff-runtime"
import type { NodeSiteRuntimeProvider } from "@kokoro/site-runtime-node"

import { userSiteBff } from "./site-bff"

export class SessionV3AssemblyError extends Error {
  constructor(readonly code: "PLATFORM_UNAVAILABLE" | "SESSION_UNAVAILABLE" | "DEPLOYMENT_INVALID") {
    super(`Session browser v3 unavailable: ${code}`)
    this.name = "SessionV3AssemblyError"
  }
}

let registeredProvider: NodeSiteRuntimeProvider | undefined
let compositionInitialized = false

/** Instrumentation installs the immutable deployment provider once. */
export function registerSessionV3Provider(value: NodeSiteRuntimeProvider): void {
  if (registeredProvider !== undefined && registeredProvider !== value) throw new SessionV3AssemblyError("DEPLOYMENT_INVALID")
  registeredProvider = value
}

export function initializeSessionV3ProductionComposition(): void {
  compositionInitialized = true
}

export function issueSessionV3BrowserCsrf(): string | undefined {
  if (!compositionInitialized || registeredProvider === undefined) return undefined
  try {
    return userSiteBff().issueBrowserCsrf()
  } catch {
    return undefined
  }
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim()
  if (!value) throw new SessionV3AssemblyError("DEPLOYMENT_INVALID")
  return value
}

export function sessionV3PublicOrigin(env: NodeJS.ProcessEnv = process.env): string {
  const value = required(env, "KOKORO_SITE_PUBLIC_ORIGIN")
  try {
    const url = new URL(value)
    if (url.protocol !== "https:" || url.origin !== value || url.username !== "" || url.password !== "") {
      throw new Error("invalid")
    }
  } catch {
    throw new SessionV3AssemblyError("DEPLOYMENT_INVALID")
  }
  return value
}

export async function assembleSessionBrowserV3(input: Readonly<{ authSession: OpaqueAuthSession }>) {
  if (!compositionInitialized || registeredProvider === undefined) throw new SessionV3AssemblyError("PLATFORM_UNAVAILABLE")
  try {
    return await userSiteBff().assemble(input.authSession)
  } catch {
    throw new SessionV3AssemblyError("PLATFORM_UNAVAILABLE")
  }
}
