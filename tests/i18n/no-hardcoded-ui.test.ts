import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

// 防回归护栏：UI 组件里不得残留硬编码中文的用户可见文案（属性值 / JSX 文本 / 模板字符串）。
// 注释里的中文允许（不翻译）。此测试是 i18n 收编完整性的定论——新写硬编码中文即红。
const HERE = dirname(fileURLToPath(import.meta.url))
const UI_ROOT = join(HERE, "../../src/ui")
const HAN = /[一-鿿]/
// 品牌 logo 图形字（Kokoro=心）不是可翻译文案，是标志——白名单排除。
const BRAND_GLYPHS = new Set(["心"])
const ATTR = /(?:aria-label|placeholder|title|alt)="([^"{}]*[一-鿿][^"{}]*)"/g
// JSX 文本节点：可被 {expr} 插值打断，故文本段以 >、<、{、} 任一为界——
// `风险 {level}` 这类「文本+插值交错」必须落网，不能只认 >…< 的纯文本段。
const JSX_TEXT = /[>}]\s*([^<>{}]*[一-鿿][^<>{}]*?)\s*[<{]/g
const TEMPLATE = /`([^`]*[一-鿿][^`]*)`/g

function walkTsx(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return walkTsx(full)
    return full.endsWith(".tsx") && !full.endsWith(".test.tsx") ? [full] : []
  })
}

function stripComments(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => (line.trim().startsWith("//") ? "" : line.replace(/\/\/.*$/, "")))
    .join("\n")
}

function offendersIn(file: string): string[] {
  const src = stripComments(readFileSync(file, "utf-8"))
  const out: string[] = []
  for (const m of src.matchAll(ATTR)) out.push(`attr: ${m[1]}`)
  for (const m of src.matchAll(JSX_TEXT)) {
    const txt = (m[1] ?? "").trim()
    if (HAN.test(txt) && !BRAND_GLYPHS.has(txt)) out.push(`text: ${txt}`)
  }
  for (const m of src.matchAll(TEMPLATE)) {
    const txt = (m[1] ?? "").trim()
    // 模板字符串里的中文（如 `${verb}过程`）也算硬编码文案——须走 i18n 插值。
    if (HAN.test(txt)) out.push(`template: \`${txt}\``)
  }
  return out
}

describe("UI 无硬编码中文文案（i18n 收编完整性）", () => {
  it.each(walkTsx(UI_ROOT).map((f) => [f.slice(f.indexOf("src/ui")), f] as const))(
    "%s",
    (_label, file) => {
      expect(offendersIn(file), `${file} 残留硬编码中文文案`).toEqual([])
    },
  )
})
