# ui/canvas — 工作区第三栏

## 职责
产物/文件/工具快照的第三栏展示（全屏切换、文件/投递切换、拖拽改宽）。内容按会话隔离。

## 公开件
- `CanvasPanel`（`canvas-panel.tsx`）+ `formatDeliveryTime`：第三栏组件。
- `canvas-store.ts`：事件总线 store——按会话键各存一槽（内容+开合+全屏）；`openCanvas`/`closeCanvas`/`reopenCanvas`/`toggleCanvasFullscreen`/`canvasSlot`/`resolveCanvasContent`/`subscribe`/`read`/`serverState`/`resetCanvasStore`(test)。
- `useCanvasResize`：main/canvas 宽度拖拽。

## 协作者
上游：`@/ui/shell` 的 `useCanvasWorkspace`（订阅 store、绑定 activeId、暴露打开/关闭回调）。

## 陷阱
- 槽按会话键隔离：切会话即读回各自的槽，无需 effect 清理。
- 「closed」只由用户手动关闭记账；重开入口读残留内容。
