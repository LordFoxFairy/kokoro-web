export async function POST(request: Request): Promise<Response> {
  const path = new URL(request.url).pathname.replace("/api/platform/", "");
  return fetch(`${process.env.KOKORO_PLATFORM_BASE_URL}/${path}`, { method: "POST", body: request.body });
}
