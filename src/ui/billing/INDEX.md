# ui/billing — 计费与价格面板

## 职责
余额卡 + 流水列表（`BillingPanel`）；套餐目录 + 购买（`PricingPanel`）。诚实态优先，不放假按钮。

## 公开件
- `BillingPanel`（`billing-panel.tsx`）：props `client: BillingClient` / `onClose` / `onOpenPricing?`。
- `PricingPanel`（`pricing-panel.tsx`）：props `client: PricingClient` / `onClose`。

## 协作者
- `@/billing/client`（session BFF 窄读）、`@/billing/pricing`（storefront）、`@/billing/format`（BigInt 金额换算）、`@/billing/rules`（`isCreditInsufficient` / `planIntervalKey`）。
- `@/lib/query`：余额卡 `useResource("billing/summary")`、目录 `useResource("billing/plans")`。

## 陷阱
- 金额全程 BigInt 十进制换算，绝不过 Number（余额可能超 2^53）。
- 流水/目录中的分页列表是本地 accumulator（同 use-session-list 范式），不走 query 层。
- payment 未配置 / checkout 501 → 显式「暂未开通」+ 禁用购买；状态真来自后端。
