export async function POST() {
  return fetch("http://payment.test/payments/webhooks/mock", { method: "POST" });
}
