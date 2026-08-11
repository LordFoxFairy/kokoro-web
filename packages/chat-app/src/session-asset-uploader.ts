"use client"

import {
  createAssetUploader,
  createLocalAssetRecoveryStore,
} from "@kokoro/asset-client"
import { useEffect, useState } from "react"

import { createEphemeralAssetRecoveryStore, type SessionContextPolicy } from "./session-context-policy"

export type SessionAssetUploader = ReturnType<typeof createAssetUploader>

export function createSessionAssetUploader(input: Readonly<{
  csrfToken: string
  contextPolicy: SessionContextPolicy
  recoveryScope: string
  localStorage: Storage
  sessionStorage: Storage
}>): SessionAssetUploader | null {
  if (input.contextPolicy === "temporary") {
    try {
      return createAssetUploader({
        csrfToken: input.csrfToken,
        store: createEphemeralAssetRecoveryStore(),
      })
    } catch {
      return null
    }
  }

  try {
    return createAssetUploader({
      csrfToken: input.csrfToken,
      store: createLocalAssetRecoveryStore({
        storage: input.localStorage,
        scope: input.recoveryScope,
        pruneOtherScopes: true,
      }),
    })
  } catch {
    try {
      return createAssetUploader({
        csrfToken: input.csrfToken,
        store: createLocalAssetRecoveryStore({
          storage: input.sessionStorage,
          scope: input.recoveryScope,
          pruneOtherScopes: true,
        }),
      })
    } catch {
      return null
    }
  }
}

/** Owns uploader lifetime and recovery-store selection for one verified Session policy. */
export function useSessionAssetUploader(input: Readonly<{
  enabled?: boolean
  csrfToken?: string
  projectRef?: string
  sessionId: string | null
  contextPolicy: SessionContextPolicy | null
  browserRuntimeScope: string
}>): SessionAssetUploader | null {
  const [uploader, setUploader] = useState<SessionAssetUploader | null>(null)

  useEffect(() => {
    if (
      input.enabled === false ||
      typeof window === "undefined" ||
      input.csrfToken === undefined ||
      input.projectRef === undefined ||
      input.sessionId === null ||
      input.contextPolicy === null
    ) {
      setUploader(null)
      return
    }

    const next = createSessionAssetUploader({
      csrfToken: input.csrfToken,
      contextPolicy: input.contextPolicy,
      recoveryScope: `${input.browserRuntimeScope}:${input.projectRef}`,
      localStorage: window.localStorage,
      sessionStorage: window.sessionStorage,
    })
    setUploader(next)
    return () => {
      next?.dispose()
      setUploader((current) => current === next ? null : current)
    }
  }, [
    input.browserRuntimeScope,
    input.contextPolicy,
    input.csrfToken,
    input.enabled,
    input.projectRef,
    input.sessionId,
  ])

  return uploader
}
