import { MockPayPanel } from "@/ui/billing/mock-pay-panel"

// DEV 模拟收银台页：startCheckout(mock) 返回的 checkoutUrl 落点（/billing/pay/<orderId>）。
// 用户「确认支付」→ /api/billing/mock-pay 签发 mock webhook → 到账。真网关档不经此页（provider 托管收银台）。
export default async function MockPayRoute({
  params,
}: {
  params: Promise<{ orderId: string }>
}) {
  const { orderId } = await params
  return <MockPayPanel orderId={orderId} />
}
