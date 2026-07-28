export async function GET(): Promise<Response> {
  return Response.json({ plans: [] });
}

export * from "./commerce-writes";
