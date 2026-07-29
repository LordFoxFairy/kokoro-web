# packages/

Kokoro Web 的共享包。生产 Site 由 `site-scaffold` 生成独立项目，Admin 仍是本仓独立 app；
收敛两 app 的重复实现，是"一个 web 子仓、方便管理"的落点。

## 现有

- **`@kokoro/tsconfig`** — 共享 TypeScript 基线（`base.json`）。app 各自 `extends`，只保留 app 专属
  （`paths` / Next `plugins` / test `types` / `include`）。

## 规划（随 admin 迁入 apps/admin 时落地——届时两个消费者都在，共享才有意义）

- **`@kokoro/web-i18n`** — 通用 i18n 引擎（`LocaleProvider` / `useT` / 协商 / 插值），泛型于各 app 的
  消息字典。收编现状"三套 i18n"（apps/user 自造 + admin 的 `@kokoro/i18n` + admin lib/i18n）。
  需泛型化引擎 + rewire ~42 处 `@/i18n` 引用，独立一 phase 做。
- **`@kokoro/web-ui`** — 共享设计件（两 app 均用 antd：user antd6 / admin antd5，先对齐版本再抽）。
- **`@kokoro/eslint-config`** — 共享 lint 规则。

## 边界

共享包只放**两 app 都用**的东西。app 专属数据（各自的消息字典、页面、业务组件）留在 `apps/*`。
