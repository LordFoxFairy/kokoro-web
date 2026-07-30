# packages/

Kokoro Web 的共享包。生产 Site 由 `site-scaffold` 生成独立项目，Admin 仍是本仓独立 app。

## 现有

- **`@kokoro/tsconfig`** — 共享 TypeScript 基线（`base.json`）。app 各自 `extends`，只保留 app 专属
  （`paths` / Next `plugins` / test `types` / `include`）。

## 边界

共享包只放多个独立 Site 或 Admin 真正复用的稳定能力。产品 copy、页面与业务组合分别留在生成 Site 和 `apps/admin`。
