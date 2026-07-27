---
architectureIndex: 1
rootId: web.user.i18n
owners:
  - "@LordFoxFairy"
---

# src/i18n — Web 界面静态 i18n

## 职责
Web UI 的多语言:**中文(zh)是唯一源字典**,其余语言是增量覆盖,未译键在解析层回退中文源(绝不裸露 key、绝不半中半英崩溃)。9 种上线语言:zh/en/ja/ko/es/fr/de/pt/ru。

## 公开件 / 数据流
- `messages.ts` — **源真相**:`zh = {...} as const`(全量键),`MessageKey = keyof typeof zh`;`Locale` 联合、`LOCALES`、`DEFAULT_LOCALE="zh"`、`LOCALE_STORAGE_KEY`、`LOCALE_NAMES`(母语显示名)。
- `<locale>.ts`(en 手维,其余 MT 生成)— 各语言 `Partial<Record<MessageKey, string>>` 增量覆盖。
- `overlays.ts` — `OVERLAYS: Record<Locale, Partial<...>>` 数据驱动查表(解析层据此按 locale 取词)。
- `resolve.ts` — 纯解析层(无 DOM/React):`negotiateLocale`(存储偏好 > 浏览器语言前缀 > 默认 zh)+ `resolveMessage`(OVERLAYS[locale] → zh → key 三层 fallback + `{var}` 插值)。两者是薄封装,协商/fallback/插值实现在共享窄包 `@kokoro/i18n` 的 `createI18n<Locale, MessageKey>`(与 admin-web 同引擎);改解析行为改那里,改本 app 的绑定改这里。
- `context.tsx` — React 绑定:`LocaleProvider`(SSR/水合首帧用默认、挂载后协商,避免注水不一致)、`useLocale`、`useT`。

## MT 翻译管线
`../scripts/i18n-translate.ts`(`npx tsx scripts/i18n-translate.ts [locale...]`):zh 源 → 各 locale 增量,经 **Google 免费翻译端点**(非官方 gtx,零 key、零费用)。纪律:
- **幂等**:默认只翻覆盖里尚缺的键——人工精修过的译文不被覆盖(`FORCE=1` 才全译)。
- **占位保护**:`{var}` 先换全大写哨兵 `KVARn`(翻译不动),译后还原——变量名绝不被翻译。
- 免费端点限流:并发受控 + 退避重试;失败键跳过并汇报,不阻断。是**构建期/CI 一次性产物 + 人工可精修**,不放运行时。

## 新增一种语言(全流程)
1. `messages.ts`:`Locale` 与 `LOCALES` 加语言码 + `LOCALE_NAMES` 加母语名。
2. `npx tsx scripts/i18n-translate.ts <code>`(脚本 `GT` 映射里加该码 → gtx 语言码)生成 `<code>.ts`。
3. `overlays.ts` 挂上该 overlay。
**解析层零改动**;语言切换器(`@/ui/settings/settings-sections` AppearanceCard)从 `LOCALES` 动态列出,零改动。

## 陷阱
- 新文案只在 `zh` 加一行 key;译文交 MT 管线补(别手写各语言)。en 是手维基线(可留精修),其余重跑 MT 幂等补缺。
- 硬编码护栏 `tests/i18n/no-hardcoded-ui.test.ts` **只查中文字符**——英文字面量是护栏盲区,不会触发失败。凡 UI 文案(含纯英文,如 `ui/composer/mode-options.ts` 的 mode 标签走 `mode.labelFast`/`mode.labelThinking`)一律走 key,英文硬编码只能靠评审人工把关。
- overlay 完整性由 `tests/i18n/resolve.test.ts` 守:每 overlay 的 key ⊆ zh 源、各语言覆盖率 ≥95%、`LOCALE_NAMES` 覆盖全 `LOCALES`。
