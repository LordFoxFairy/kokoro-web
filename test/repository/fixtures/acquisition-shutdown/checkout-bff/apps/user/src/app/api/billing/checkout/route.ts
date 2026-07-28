export async function POST() {
  return fetch("http://payment.test/orders/checkout", { method: "POST" });
}
