export default async function proxy(request: Request): Promise<Response> {
  return fetch(new URL(request.url).pathname, { headers: request.headers });
}
