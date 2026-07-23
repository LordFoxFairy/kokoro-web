# ui/billing — 计费与价格面板

## 职责
余额卡 + 用量透视 + 流水列表（`BillingPanel`）；套餐目录 + 购买（`PricingPanel`）；DEV 模拟收银台（`MockPayPanel`）。诚实态优先，不放假按钮。

## 公开件
- `BillingPanel` / `BillingContent`（`billing-panel.tsx`）：props `client: BillingClient` / `onClose` / `onOpenPricing?`。
  余额卡（余额/冻结/**配额行**，配额设了才显）+ **低余额预警条**（余额<50 积分引导充值，有 onOpenPricing 才给按钮）+ **余额走势 sparkline**（≥2 笔流水，用入账后余额快照重建）+ **本月按模型消费**（B1d，有消费才渲染：模型名+积分+占比条+对话次数；名由 session 跨 model 解析）+ 流水**按天分组**（组头带当日净额）+ **消费/入账筛选** + 条目显示时间/run 标记。
- `PricingPanel`（`pricing-panel.tsx`）：props `client: PricingClient` / `onClose`。
- `MockPayPanel`（`mock-pay-panel.tsx`）：DEV 收银台，`orderId` prop → POST `/api/billing/mock-pay` 驱动到账；仅 dev。

## 协作者
- `@/billing/client`（session BFF 窄读）、`@/billing/pricing`（storefront）、`@/billing/format`（BigInt 金额换算）、`@/billing/rules`（`isCreditInsufficient` / `planIntervalKey`）。
- `@/lib/query`：余额卡 `useResource("billing/summary")`、按模型分解 `useResource("billing/by-model")`、目录 `useResource("billing/plans")`。

## 陷阱
- 金额全程 BigInt 十进制换算，绝不过 Number（余额可能超 2^53）。`format.creditsToNumber` 仅供 sparkline 几何（相对定位），绝不用于精算/展示金额。
- `created_at` 是 epoch **毫秒**（credit `getTime()` 直透）；日期/时间格式化直接按 ms，勿再 ×1000。
- 流水/目录中的分页列表是本地 accumulator（同 use-session-list 范式），不走 query 层。
- payment 未配置 / checkout 501 → 显式「暂未开通」+ 禁用购买；状态真来自后端。
- 低余额阈值 = 50 积分（`LOW_BALANCE_MICROS`）；配额进度未做（周期已用量需后端聚合，见 B1 挂点）。
