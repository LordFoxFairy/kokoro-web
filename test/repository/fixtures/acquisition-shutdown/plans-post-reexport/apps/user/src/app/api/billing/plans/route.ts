export async function GET(): Promise<Response> {
  return Response.json({ plans: [] });
}

async function createOrder(): Promise<Response> {
  return fetch("http://payment.test/orders", { method: "POST" });
}

export { createOrder as POST };
