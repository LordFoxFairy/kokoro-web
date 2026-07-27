---
architectureIndex: 1
rootId: web.user.ui.composer
owners:
  - "@LordFoxFairy"
---

# ui/composer — 输入区

## 职责
消息输入框 + 发送/停止、模式切换、模型/agent 选择器、固定技能条、展开对话框。纯受控组件，状态由 shell 持有。

## 公开件
- `Composer`（`composer.tsx`）+ `MAX_INPUT_LENGTH`：受控输入区；draft/回调/候选全由 props 注入。
- `modePresentation` / mode 元数据（`mode-options.ts`）：模式 → 展示文案/提示。
- `ComposerMenu` / `ExpandDialog`：附属子件。

## 协作者
上游：`@/ui/shell`（draft、submit/keydown、selectors、pinnedSkills）。

## 陷阱
- Enter 发送 / Shift+Enter 换行；IME 合成期 Enter 只确认候选词不发送。
- 首条消息后模式/模型/agent 锁定（`modeLocked`）：由 shell 传入，组件不自持锁态。
