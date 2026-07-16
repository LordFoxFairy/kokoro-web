// locale → 增量覆盖 的数据驱动查表。解析层据此按当前 locale 取词(见 resolve.ts),
// 未译键回退 zh 源。新增一种语言 = 生成其 overlay + 在此挂一项 + 扩 Locale/LOCALES,解析层零改动。

import type { Locale, MessageKey } from "./messages"

import { en } from "./en"
import { ja } from "./ja"
import { ko } from "./ko"
import { es } from "./es"
import { fr } from "./fr"
import { de } from "./de"
import { pt } from "./pt"
import { ru } from "./ru"

// zh 是源字典(住 messages.ts),自身无 overlay;其余各挂 MT 生成(可人工精修)的增量覆盖。
export const OVERLAYS: Record<Locale, Partial<Record<MessageKey, string>>> = {
  zh: {},
  en,
  ja,
  ko,
  es,
  fr,
  de,
  pt,
  ru,
}
