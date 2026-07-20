/**
 * i18n MT 管线:zh 源字典 → 各 locale 增量覆盖,经 Google 免费翻译端点(非官方 gtx,零 key、零费用)生成。
 *
 *   npx tsx scripts/i18n-translate.ts            # 翻 TARGET_LOCALES 全部
 *   npx tsx scripts/i18n-translate.ts ja ko      # 只翻指定 locale
 *   FORCE=1 npx tsx scripts/i18n-translate.ts fr # 重译(含已存在键;默认只补缺失)
 *
 * 纪律:
 * - 幂等:默认只翻「locale 覆盖里尚缺」的键——人工精修过的译文不被覆盖(FORCE=1 才全译)。
 * - 占位保护:{var} 先换全大写哨兵 KVARn(实测存活),翻译后还原——绝不让变量名被翻译。
 * - 免费端点有限流:并发受控 + 退避重试;失败键跳过并汇报,不阻断其它键。
 */
import { promises as fs } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { zh } from "../src/i18n/messages"

const DIR = path.dirname(fileURLToPath(import.meta.url))
const I18N = path.join(DIR, "../src/i18n")

// locale → gtx 目标语言码(多数同名;巴葡等在此映射)。新增语言:加一行即可。
const GT: Record<string, string> = {
  en: "en",
  ja: "ja",
  ko: "ko",
  es: "es",
  fr: "fr",
  de: "de",
  pt: "pt",
  ru: "ru",
}
// en 必须在列:覆盖率闸(resolve.test ≥95%)对每种上线语言都查,漏掉 en 就会静默漂移到红。
const TARGET_LOCALES = ["en", "ja", "ko", "es", "fr", "de", "pt", "ru"]

const CONCURRENCY = 5
const RETRY = 4

type Overlay = Partial<Record<string, string>>

// {name} → 无字母符号哨兵 %%n%% ;同名复用同哨兵。返回还原映射 + 期望占位集合。
// 为何不用字母哨兵(旧 KVARn):拉丁字母词会被 ru 音译成 КВАР0、被 ja/ko 拆成「KVAR は 0」,
// 精确串还原随即失配,坏译文("KVAR" 字样 + 游离数字)直接进 UI。符号型无字母可音译。
function protect(text: string): {
  masked: string
  restore: (s: string) => string
  expected: readonly string[]
} {
  const nameToSentinel = new Map<string, string>()
  const sentinelToOriginal: Array<[string, string]> = []
  let i = 0
  const masked = text.replace(/\{(\w+)\}/g, (whole, name: string) => {
    let sentinel = nameToSentinel.get(name)
    if (sentinel === undefined) {
      sentinel = `%%${i++}%%`
      nameToSentinel.set(name, sentinel)
      sentinelToOriginal.push([sentinel, whole])
    }
    return sentinel
  })
  const restore = (translated: string): string => {
    let out = translated
    for (const [sentinel, original] of sentinelToOriginal) {
      const idx = sentinel.slice(2, -2)
      // 容错:允许译文在符号与序号之间插入空白(部分语言会加空格/断词)。
      out = out.replace(new RegExp(`%\\s*%\\s*${idx}\\s*%\\s*%`, "g"), original)
    }
    return out
  }
  return { masked, restore, expected: sentinelToOriginal.map(([, original]) => original) }
}

async function translateOne(text: string, tl: string): Promise<string> {
  if (text.trim() === "") return text
  const { masked, restore, expected } = protect(text)
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=zh-CN&tl=${tl}&dt=t&q=${encodeURIComponent(masked)}`
  let lastErr: unknown
  for (let attempt = 0; attempt < RETRY; attempt++) {
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as [Array<[string]>, ...unknown[]]
      const translated = data[0].map((seg) => seg[0]).join("")
      const out = restore(translated)
      // 占位符校验闸:哨兵没原样还原(被拆词/音译/吞掉)即判该键失败——宁可缺译回退中文源,
      // 也绝不写出丢了 {var} 的坏译文（那会让 UI 露出裸文案/游离数字）。
      const lost = expected.filter((placeholder) => !out.includes(placeholder))
      if (lost.length > 0) {
        throw new Error(`placeholder lost after restore: ${lost.join(",")} in ${JSON.stringify(out)}`)
      }
      return out
    } catch (err) {
      lastErr = err
      await new Promise((r) => setTimeout(r, 700 * (attempt + 1)))
    }
  }
  throw lastErr
}

async function loadExisting(locale: string): Promise<Overlay> {
  try {
    const mod = (await import(path.join(I18N, `${locale}.ts`))) as Record<string, Overlay>
    return { ...(mod[locale] ?? {}) }
  } catch {
    return {}
  }
}

async function mapPool<T, R>(items: readonly T[], n: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let cursor = 0
  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const idx = cursor++
      out[idx] = await fn(items[idx]!, idx)
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker))
  return out
}

function serialize(locale: string, keys: readonly string[], merged: Overlay): string {
  const lines = keys
    .filter((k) => typeof merged[k] === "string")
    .map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(merged[k])},`)
    .join("\n")
  return (
    `// ${locale} 覆盖(MT 生成,可人工精修;\`npx tsx scripts/i18n-translate.ts ${locale}\` 只补缺失键)。\n` +
    `// 未译键在解析层回退中文源——绝不裸露 key。\n\n` +
    `import type { MessageKey } from "./messages"\n\n` +
    `export const ${locale}: Partial<Record<MessageKey, string>> = {\n${lines}\n}\n`
  )
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const force = process.env.FORCE === "1"
  const targets = args.length > 0 ? args : TARGET_LOCALES
  const keys = Object.keys(zh)
  for (const locale of targets) {
    const tl = GT[locale]
    if (tl === undefined) {
      console.error(`[${locale}] 未在 GT 映射中,跳过(先在脚本 GT 里加一行)`)
      continue
    }
    const existing = await loadExisting(locale)
    const pending = keys.filter((k) => force || typeof existing[k] !== "string")
    console.log(`[${locale}] 待翻 ${pending.length} / 共 ${keys.length}(已有 ${keys.length - pending.length})`)
    let done = 0
    let failed = 0
    const merged: Overlay = { ...existing }
    const results = await mapPool(pending, CONCURRENCY, async (k) => {
      try {
        const v = await translateOne((zh as Record<string, string>)[k]!, tl)
        done++
        if (done % 50 === 0) console.log(`[${locale}]   …${done}/${pending.length}`)
        return [k, v] as const
      } catch {
        failed++
        return [k, null] as const
      }
    })
    for (const [k, v] of results) if (v !== null) merged[k] = v
    await fs.writeFile(path.join(I18N, `${locale}.ts`), serialize(locale, keys, merged), "utf8")
    console.log(`[${locale}] 写入 ${keys.filter((k) => typeof merged[k] === "string").length} 键(本轮成功 ${done}, 失败 ${failed})`)
  }
}

void main()
