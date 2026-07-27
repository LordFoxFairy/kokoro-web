---
architectureIndex: 1
rootId: web.i18n
owners:
  - "@LordFoxFairy"
---

# kokoro-i18n

## Responsibilities

共享 i18n 窄包引擎。framework-agnostic、无第三方依赖、无 DOM/React。

## Non-responsibilities

本包不拥有具体产品词典、React context、浏览器存储、路由 locale 或服务端用户偏好。

## Public boundary

`@kokoro/i18n` 单文件 barrel `src/index.ts`：

- `createI18n(config)` → `I18n`：注入 locale 全集、源语言完整词典 `source`、增量覆盖 `overrides`，得到 `{ locales, defaultLocale, negotiate, translate }`。
- `interpolate(template, vars)`：`{name}` 占位插值；缺失变量原样保留占位符。
- 类型：`I18nConfig` / `I18n` / `TranslateFn` / `InterpolationVars`。

## Idempotency, failure, and recovery

- 三层 fallback 恒不裸露 key：`overrides[locale][key]` → `source[key]`（源语言全量）→ `key` 本身。
- `negotiate(stored, navigatorLanguages)`：显式偏好优先 → 浏览器语言前缀匹配 → 源语言。非法值忽略。
- `source` 必须是 `defaultLocale` 的完整词典；`overrides` 为其它 locale 的 Partial 覆盖。

## Callers and dependencies

- `@kokoro/admin-web`：`lib/i18n/` 注入 zh 源 + en 覆盖 + React 绑定（`LocaleProvider`/`useT`）。
  admin manifest 的 `labelKey`（`admin.*`）即经本引擎解析成可读文案。

## Data ownership and events

本包只拥有纯函数和类型，不持有词典运行时状态、用户偏好或事件。

## Runtime and security

输入词典与插值变量均由消费方提供；引擎不执行模板代码、不访问 DOM、网络或存储。

## Extension rules and forbidden dependencies

- 新增消费方：各自建 `messages`（源）+ `overrides`（增量）+ 框架绑定，注入本引擎。引擎不持有任何具体词典。
- 引擎保持纯函数、零依赖；React/DOM/存储等副作用留在消费方绑定层。

## Current gotchas

User app 仍有自己的 `src/i18n` 绑定与词典；统一前不得把两套实现描述成已合并。

## Verification

- `pnpm --filter @kokoro/i18n lint`
- `pnpm --filter @kokoro/i18n typecheck`
- `pnpm --filter @kokoro/i18n test`

本包在 `node-linker=isolated` 下独立声明 TypeScript、Vitest 与 ESLint 工具链，不依赖其他 app 偶然
hoist 的二进制或配置。这里的“零依赖”指运行时公开引擎，开发工具仍由本包显式拥有。
