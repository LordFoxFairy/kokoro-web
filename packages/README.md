# packages/

Kokoro web monorepo 的共享包。共享能力只有在至少两个应用稳定消费后才进入这里。

## 现有

- **`@kokoro/tsconfig`** — 共享 TypeScript 基线（`base.json`）。app 各自 `extends`，只保留 app 专属
  （`paths` / Next `plugins` / test `types` / `include`）。已被 `apps/user` 消费。

## 规划

- **`@kokoro/web-i18n`** — 通用 i18n 引擎（`LocaleProvider` / `useT` / 协商 / 插值），泛型于各 app 的
  消息字典。收编现状"三套 i18n"（apps/user 自造 + admin 的 `@kokoro/i18n` + admin lib/i18n）。
  需泛型化引擎 + rewire ~42 处 `@/i18n` 引用，独立一 phase 做。
- **`@kokoro/web-ui`** — 仅在多个应用采用相同 shadcn/ui 契约后抽取稳定设计件。
- **`@kokoro/eslint-config`** — 共享 lint 规则。

## 边界

共享包只放**两 app 都用**的东西。app 专属数据（各自的消息字典、页面、业务组件）留在 `apps/*`。
