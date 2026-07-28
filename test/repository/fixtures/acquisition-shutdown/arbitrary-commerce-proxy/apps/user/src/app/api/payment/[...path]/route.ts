const paymentBaseUrl = "http://payment.test";
export async function GET(request: Request) {
  return fetch(`${paymentBaseUrl}/${new URL(request.url).pathname}`);
}
