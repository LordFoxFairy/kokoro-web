"use client"

// React 绑定：LocaleProvider（协商初值 + 持久化切换）+ useT 取词 hook。

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"

import { LOCALE_STORAGE_KEY, type Locale, type MessageKey } from "./messages"
import { negotiateLocale, resolveMessage } from "./resolve"

type TranslateFn = (key: MessageKey, vars?: Readonly<Record<string, string | number>>) => string

type LocaleContextValue = {
  locale: Locale
  setLocale: (next: Locale) => void
  t: TranslateFn
}

const LocaleContext = createContext<LocaleContextValue | null>(null)

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  // SSR 与首帧保持默认（协商在 mount 后进行，避免注水不一致）。
  const [locale, setLocaleState] = useState<Locale>("zh")

  useEffect(() => {
    const stored =
      typeof window === "undefined" ? null : window.localStorage.getItem(LOCALE_STORAGE_KEY)
    const langs = typeof navigator === "undefined" ? [] : navigator.languages
    const negotiated = negotiateLocale(stored, langs)
    setLocaleState(negotiated)
    if (typeof document !== "undefined") document.documentElement.lang = negotiated
  }, [])

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next)
    if (typeof window !== "undefined") window.localStorage.setItem(LOCALE_STORAGE_KEY, next)
    if (typeof document !== "undefined") document.documentElement.lang = next
  }, [])

  const value = useMemo<LocaleContextValue>(
    () => ({ locale, setLocale, t: (key, vars) => resolveMessage(locale, key, vars) }),
    [locale, setLocale],
  )

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext)
  if (ctx === null) throw new Error("useLocale must be used within LocaleProvider")
  return ctx
}

export function useT(): TranslateFn {
  return useLocale().t
}
