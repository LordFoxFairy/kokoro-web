import "server-only"

export function retiredApi(surface: "billing" | "hub" | "shared" | "team"): Response {
  return new Response(JSON.stringify({
    error: {
      code: "surface_retired",
      message: `${surface} is not exposed by the Session browser v3 reference Site`,
    },
  }), {
    status: 410,
    headers: { "cache-control": "no-store", "content-type": "application/problem+json" },
  })
}
