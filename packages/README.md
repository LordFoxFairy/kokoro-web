# packages/

Kokoro Web 的共享包。生产 Site 由 `site-scaffold` 生成独立项目，Admin 仍是本仓独立 app。

## 现有

- **`@kokoro/tsconfig`** — 共享 TypeScript 基线（`base.json`）。app 各自 `extends`，只保留 app 专属
  （`paths` / Next `plugins` / test `types` / `include`）。
- **`@kokoro/memory-app`** — 独立 Site 可选装的 Product Memory M0.1 产品包；只经同源 `/api/memory`
  消费 generated Platform Public contract，负责显式保存、修订历史、优先级、命令恢复、导入/导出与 purge 状态。

## 边界

共享包只放多个独立 Site 或 Admin 真正复用的稳定能力。产品 copy、页面与业务组合分别留在生成 Site 和 `apps/admin`。
