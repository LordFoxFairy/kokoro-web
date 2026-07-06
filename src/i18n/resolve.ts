// 纯解析层（无 DOM/React，可独立测试）：locale 协商 + 消息解析 + {插值}。

import { en } from "./en"
import { DEFAULT_LOCALE, LOCALES, zh, type Locale, type MessageKey } from "./messages"

// 协商：显式偏好（存储值）优先，其次浏览器语言前缀，最后默认中文。非法值忽略。
export function negotiateLocale(stored: string | null, navigatorLanguages: readonly string[]): Locale {
  if (stored !== null && (LOCALES as readonly string[]).includes(stored)) return stored as Locale
  for (const lang of navigatorLanguages) {
    const prefix = lang.toLowerCase().split("-")[0]
    if ((LOCALES as readonly string[]).includes(prefix ?? "")) return prefix as Locale
  }
  return DEFAULT_LOCALE
}

// 解析：当前 locale → 中文源 → key（三层 fallback，绝不裸露 key 给用户——中文源恒在）。
export function resolveMessage(
  locale: Locale,
  key: MessageKey,
  vars?: Readonly<Record<string, string | number>>,
): string {
  const raw = (locale === "en" ? en[key] : undefined) ?? zh[key] ?? key
  if (vars === undefined) return raw
  return raw.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  )
}
