# kokoro-web 文档

这个目录只放 web 子仓自己的长期文档。

## 放这里

- web UI、浏览器状态、session client、auth facade、canvas、HITL、i18n 的子仓内方案。
- 只影响 `kokoro-web` 的实现计划、验收清单和运行说明。
- 对根仓总体方案的 web 侧摘录，但不能复制根仓 handbook 的全部内容。

## 不放这里

- 跨仓架构总方案、ADR、产品 handbook、平台模块职责图。
- 其他子仓的实现细节和 API 主权文档。
- 临时调研材料、外部参考来源路径、截图裁剪、探索草稿。

这些内容分别属于根仓 `../docs/`、对应子仓的 `docs/`，或本仓被忽略的 `tmp/`。

## 当前文档

- [namespace、auth 与 capability UI 接入方案](./web/2026-07-07-namespace-auth-capability-ui-plan.md)
