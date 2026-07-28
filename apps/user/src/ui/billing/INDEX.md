---
architectureIndex: 1
rootId: web.user.ui.billing
owners:
  - "@LordFoxFairy"
---

# ui/billing — 余额与套餐目录

## 职责
只读余额卡 + 用量透视 + 流水列表（`BillingPanel`）；Site-scoped 只读套餐目录（`PricingPanel`）。Web acquisition 已关闭：不提供 checkout、mock-pay、支付跳转或兑换假能力。

## 公开件
- `BillingPanel` / `BillingContent`（`billing-panel.tsx`）：props `client: BillingClient` / `onClose`。
  余额卡（余额/冻结/**配额行**，配额设了才显）+ **只读低余额预警条**（余额<50 积分）+ **余额走势 sparkline**（≥2 笔流水，用入账后余额快照重建）+ **本月按模型消费**（B1d，有消费才渲染：模型名+积分+占比条+对话次数；名由 session 跨 model 解析）+ 流水**按天分组**（组头带当日净额）+ **消费/入账筛选** + 条目显示时间/run 标记。
- `PricingPanel` / `PricingContent`（`pricing-panel.tsx`）：props `client: PricingClient` / `onClose`；只读展示 Site 套餐目录。

## 协作者
- `@/billing/client`（session BFF 窄读）、`@/billing/pricing`（Site 套餐目录窄读）、`@/billing/format`（BigInt 金额换算）、`@/billing/rules`（`isCreditInsufficient` / `planIntervalKey`）。
- `@/lib/query`：余额卡 `useResource("billing/summary")`、按模型分解 `useResource("billing/by-model")`、目录 `useResource("billing/plans")`。

## 陷阱
- 金额全程 BigInt 十进制换算，绝不过 Number（余额可能超 2^53）。`format.creditsToNumber` 仅供 sparkline 几何（相对定位），绝不用于精算/展示金额。
- `created_at` 是 epoch **毫秒**（credit `getTime()` 直透）；日期/时间格式化直接按 ms，勿再 ×1000。
- 流水/目录中的分页列表是本地 accumulator（同 use-session-list 范式），不走 query 层。
- `paymentBaseUrl` 仅供 `/api/billing/plans` 目录读取；缺失时显式「目录不可用」。禁止恢复 checkout/mock-pay/refund BFF、provider secret 或 SDK 初始化。
- 低余额阈值 = 50 积分（`LOW_BALANCE_MICROS`）；配额进度未做（周期已用量需后端聚合，见 B1 挂点）。
