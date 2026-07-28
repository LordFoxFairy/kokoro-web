const INTERNAL_HEADER_PREFIX = "x-kokoro-";

// Browser headers are untrusted. Drop the complete internal namespace first, then inject only
// the Auth.js identity and secret read by the server. Returning null makes missing authority explicit.
export function trustedAdminHeaders(
  incoming: Headers,
  operatorEmail: string | null | undefined,
  proxySecret: string | null | undefined,
): Headers | null {
  const headers = new Headers(incoming);
  for (const name of [...headers.keys()]) {
    if (name.toLowerCase().startsWith(INTERNAL_HEADER_PREFIX)) headers.delete(name);
  }

  const email = operatorEmail?.trim() ?? "";
  const secret = proxySecret?.trim() ?? "";
  if (email.length === 0 || secret.length === 0) return null;

  headers.set("x-kokoro-operator", email);
  headers.set("x-kokoro-proxy-secret", secret);
  return headers;
}
