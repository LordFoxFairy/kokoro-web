export async function POST(request: Request): Promise<Response> {
  const body = (await request.json()) as { moduleId?: string };
  return fetch("http://gateway.test/api/action", { method: "POST", body: JSON.stringify(body) });
}
