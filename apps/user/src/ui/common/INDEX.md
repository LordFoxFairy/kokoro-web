---
architectureIndex: 1
rootId: web.user.ui.common
owners:
  - "@LordFoxFairy"
---

# ui/common — 跨面通用交互原语

## 职责
不绑定任何业务面的通用交互壳。当前只有一件：模态浮层（背幕 + 居中卡片），浮在当前工作区之上——打开不导航离开、语境原地保留。业务内容全部由 `children` 决定，本目录不含任何业务态。

## 公开件
- `Modal`（`modal.tsx`，`"use client"`）：props `onClose` / `ariaLabel`（`role="dialog"` 的无障碍名，无可视标题时的唯一来源）/ `children` / `testId?` / `size?: "standard" | "wide"`（`wide` 供双栏面板）。收口三件行为：Esc 关闭、打开期锁 `document.body` 滚动、Tab/Shift+Tab 焦点陷在卡内。关闭出口=背幕点击 / Esc / `children` 自带的关闭按钮。
- `modal.module.css`：`.overlay` / `.card`（`data-size` 分档），皮肤守 `--k-*` token 亮暗双态；`max-width:640px` 下卡片退化为近全屏 sheet；`prefers-reduced-motion` 下去动效。

## 协作者
上游：`@/ui/settings/settings-modal`（唯一 src 消费方，以 `size="wide"` 承载设置中心两栏布局）。下游：仅 React + 本目录 CSS module，不依赖 `@/engine`、`@/core`、`@/i18n`——文案由调用方传入。

## 扩展规则
新增浮层/抽屉/确认框等通用原语放这里，前提是**零业务依赖**；一旦需要 session client、i18n key 或业务态，就属于对应业务面目录（`@/ui/settings`、`@/ui/thread` 等），不要下沉到本目录。

## 陷阱
- `ariaLabel` 必填：卡内若无 `<h*>` 可关联，它是屏幕阅读器唯一可读名。
- 焦点陷阱按 `FOCUSABLE` 选择器在**渲染后**查询 DOM；`children` 内首个可聚焦元素会被自动 focus，若首元素是危险操作（删除等）应在其前放置无害控件。
- 背幕 `onClick` 即关闭，卡片 `onClick` 靠 `stopPropagation` 拦截——在卡内自绘 portal/浮层时需自行确保事件不冒泡到背幕。
- 副作用清理会还原 `body.style.overflow` 的**进入时快照**；同时挂两层 Modal 会互相覆盖该快照，当前不支持模态堆叠。
