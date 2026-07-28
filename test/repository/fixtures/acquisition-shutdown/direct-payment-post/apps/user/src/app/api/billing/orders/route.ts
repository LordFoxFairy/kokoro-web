export async function POST(): Promise<Response> {
  return fetch("http://payment.test/orders", { method: "POST" });
}
