# kokoro-i18n

共享 i18n 窄包引擎。framework-agnostic、无第三方依赖、无 DOM/React。

## 公开 API（`@kokoro/i18n`，单文件 barrel = `src/index.ts`）

- `createI18n(config)` → `I18n`：注入 locale 全集、源语言完整词典 `source`、增量覆盖 `overrides`，得到 `{ locales, defaultLocale, negotiate, translate }`。
- `interpolate(template, vars)`：`{name}` 占位插值；缺失变量原样保留占位符。
- 类型：`I18nConfig` / `I18n` / `TranslateFn` / `InterpolationVars`。

## 契约

- 三层 fallback 恒不裸露 key：`overrides[locale][key]` → `source[key]`（源语言全量）→ `key` 本身。
- `negotiate(stored, navigatorLanguages)`：显式偏好优先 → 浏览器语言前缀匹配 → 源语言。非法值忽略。
- `source` 必须是 `defaultLocale` 的完整词典；`overrides` 为其它 locale 的 Partial 覆盖。

## 消费方

当前消费方由各应用清单记录。新应用接入时必须在自己的边界内提供词典和框架绑定。

## 扩展规则

- 新增消费方：各自建 `messages`（源）+ `overrides`（增量）+ 框架绑定，注入本引擎。引擎不持有任何具体词典。
- 引擎保持纯函数、零依赖；React/DOM/存储等副作用留在消费方绑定层。
- 包内 ESLint flat config、测试和精确工具依赖自行维护；isolated linker 下不依赖应用或
  根目录的幽灵工具依赖。
