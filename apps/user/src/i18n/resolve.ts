// 解析层：委派共享引擎 @kokoro/i18n（泛型于本 app 的 Locale/MessageKey 与词典）。
// 公共面 negotiateLocale/resolveMessage 签名不变——42 处 useT/MessageKey 消费方零改动。
// 协商/三层 fallback/{插值} 逻辑收归 @kokoro/i18n 单一实现，供仓内应用复用。

import { createI18n } from "@kokoro/i18n"

import { DEFAULT_LOCALE, LOCALES, zh, type Locale, type MessageKey } from "./messages"
import { OVERLAYS } from "./overlays"

// zh 为源语言完整词典；OVERLAYS 为各 locale 增量覆盖（zh 自身无 overlay）。
const i18n = createI18n<Locale, MessageKey>({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  source: zh,
  overrides: OVERLAYS,
})

// 协商：显式偏好（存储值）优先 → 浏览器语言前缀 → 默认中文（非法值忽略）。
export function negotiateLocale(stored: string | null, navigatorLanguages: readonly string[]): Locale {
  return i18n.negotiate(stored, navigatorLanguages)
}

// 解析：当前 locale 覆盖 → 中文源 → key（三层 fallback，绝不裸露 key），带 {var} 插值。
export function resolveMessage(
  locale: Locale,
  key: MessageKey,
  vars?: Readonly<Record<string, string | number>>,
): string {
  return i18n.translate(locale, key, vars)
}
