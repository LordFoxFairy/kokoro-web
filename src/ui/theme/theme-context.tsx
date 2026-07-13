"use client"

// 主题绑定（WEB-THEME）：ThemeProvider（系统/亮/暗三态 + localStorage 持久化）+ useTheme hook。
// 生效档以 .dark class 挂在 documentElement 上，驱动 globals.css 的暖色夜档 token。
// 首帧防闪由 layout 的内联脚本负责（水合前即定 class）；本 Provider 管运行期切换与系统联动。

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react"

import { useHydrated } from "@/lib/use-hydrated"

export type ThemeMode = "system" | "light" | "dark"

export const THEME_STORAGE_KEY = "kokoro.theme"
const DARK_QUERY = "(prefers-color-scheme: dark)"

export function isThemeMode(value: string | null): value is ThemeMode {
  return value === "system" || value === "light" || value === "dark"
}

export function resolveDark(mode: ThemeMode, systemDark: boolean): boolean {
  return mode === "dark" || (mode === "system" && systemDark)
}

// 系统色偏好订阅（useSyncExternalStore 惯用法）：避免 effect 内 setState，SSR 快照恒 false。
function subscribeSystemDark(onChange: () => void): () => void {
  const mq = window.matchMedia(DARK_QUERY)
  mq.addEventListener("change", onChange)
  return () => mq.removeEventListener("change", onChange)
}
function getSystemDark(): boolean {
  return window.matchMedia(DARK_QUERY).matches
}
function getServerSystemDark(): boolean {
  return false
}

type ThemeContextValue = {
  mode: ThemeMode
  // 生效档（system 解析后）：true=暗。UI 据此显激活态。
  isDark: boolean
  setMode: (next: ThemeMode) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const hydrated = useHydrated()
  // 用户本次挂载内的显式切换：优先于持久化值。
  const [override, setOverride] = useState<ThemeMode | null>(null)
  // 系统色偏好：订阅 matchMedia（system 档下随系统实时切换；SSR/首帧恒 false）。
  const systemDark = useSyncExternalStore(subscribeSystemDark, getSystemDark, getServerSystemDark)

  const stored = hydrated ? window.localStorage.getItem(THEME_STORAGE_KEY) : null
  const mode: ThemeMode = override ?? (isThemeMode(stored) ? stored : "system")
  const isDark = resolveDark(mode, systemDark)

  // 外部系统同步：生效档写到 documentElement 的 .dark class（与首帧内联脚本同键）。
  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark)
  }, [isDark])

  const setMode = useCallback((next: ThemeMode) => {
    setOverride(next)
    if (typeof window !== "undefined") window.localStorage.setItem(THEME_STORAGE_KEY, next)
  }, [])

  const value = useMemo<ThemeContextValue>(
    () => ({ mode, isDark, setMode }),
    [mode, isDark, setMode],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (ctx === null) throw new Error("useTheme must be used within ThemeProvider")
  return ctx
}
