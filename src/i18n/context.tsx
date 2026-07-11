"use client"

// React 绑定：LocaleProvider（协商初值 + 持久化切换）+ useT 取词 hook。

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"

import { DEFAULT_LOCALE, LOCALE_STORAGE_KEY, type Locale, type MessageKey } from "./messages"
import { useHydrated } from "@/lib/use-hydrated"
import { negotiateLocale, resolveMessage } from "./resolve"

type TranslateFn = (key: MessageKey, vars?: Readonly<Record<string, string | number>>) => string

type LocaleContextValue = {
  locale: Locale
  setLocale: (next: Locale) => void
  t: TranslateFn
}

const LocaleContext = createContext<LocaleContextValue | null>(null)

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  // SSR 与水合首帧保持默认，挂载后按持久化偏好/浏览器语言协商（避免注水不一致）——
  // hydrated 探针驱动的键控派生，替代 effect 同步 setState。
  const hydrated = useHydrated()
  // 用户在本次挂载内的显式切换：优先于协商结果。
  const [override, setOverride] = useState<Locale | null>(null)
  const negotiated = hydrated
    ? negotiateLocale(window.localStorage.getItem(LOCALE_STORAGE_KEY), navigator.languages)
    : DEFAULT_LOCALE
  const locale = override ?? negotiated

  // 外部系统同步：<html lang> 跟随生效语言（含协商与显式切换）。
  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  const setLocale = useCallback((next: Locale) => {
    setOverride(next)
    if (typeof window !== "undefined") window.localStorage.setItem(LOCALE_STORAGE_KEY, next)
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
