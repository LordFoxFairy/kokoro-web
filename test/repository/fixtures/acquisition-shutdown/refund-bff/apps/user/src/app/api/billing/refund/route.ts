export async function POST() {
  return fetch("http://payment.test/refunds", { method: "POST" });
}
