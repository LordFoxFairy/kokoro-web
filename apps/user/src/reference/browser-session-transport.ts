import type {
  SessionRequest,
  SessionResponse,
  SessionStreamResponse,
  SessionTransport,
} from "@kokoro/session-client"

const MAXIMUM_JSON_BYTES = 2_097_152

export type BrowserFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

function assertContractRelativePath(path: string): void {
  if (
    !path.startsWith("/v1/") ||
    path.includes("://") ||
    path.includes("\\") ||
    Array.from(path).some((character) => {
      const code = character.codePointAt(0) ?? 0
      return code < 32 || code === 127
    })
  ) {
    throw new Error("Session path must be a contract-relative /v1 path")
  }
  const pathname = path.split("?", 1)[0] ?? ""
  for (const rawSegment of pathname.split("/")) {
    let segment: string
    try {
      segment = decodeURIComponent(rawSegment)
    } catch {
      throw new Error("Session path must be a contract-relative /v1 path")
    }
    if (segment === "." || segment === "..") {
      throw new Error("Session path must be a contract-relative /v1 path")
    }
  }
}

function browserHeaders(request: SessionRequest, csrfToken?: string): Record<string, string> {
  const headers: Record<string, string> = { accept: "application/json" }
  for (const [name, value] of Object.entries(request.headers ?? {})) {
    const normalized = name.toLowerCase()
    if (!["accept", "content-type", "last-event-id"].includes(normalized)) {
      throw new Error(`Session browser header is not allowed: ${normalized}`)
    }
    headers[normalized] = value
  }
  if (request.method !== "GET" && csrfToken !== undefined) headers["x-csrf-token"] = csrfToken
  return headers
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const declared = response.headers.get("content-length")
  if (declared !== null) {
    const length = Number(declared)
    if (!Number.isSafeInteger(length) || length < 0 || length > MAXIMUM_JSON_BYTES) {
      throw new Error("Session response exceeds the browser JSON limit")
    }
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > MAXIMUM_JSON_BYTES) {
    throw new Error("Session response exceeds the browser JSON limit")
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown
  } catch (error) {
    throw new Error("Session response is not valid UTF-8 JSON", { cause: error })
  }
}

function requestInit(request: SessionRequest, csrfToken?: string): RequestInit {
  return {
    method: request.method,
    headers: browserHeaders(request, csrfToken),
    ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
    ...(request.signal === undefined ? {} : { signal: request.signal }),
    credentials: "same-origin",
    cache: "no-store",
  }
}

/** Browser-only adapter. Authority remains in the same-origin BFF cookie/grant exchange. */
export function createBrowserSessionTransport(options: {
  readonly fetcher?: BrowserFetch
  readonly bffPrefix?: string
  readonly csrfToken?: string
} = {}): SessionTransport {
  const fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis)
  const bffPrefix = options.bffPrefix ?? "/api/session"
  if (!bffPrefix.startsWith("/") || bffPrefix.endsWith("/") || bffPrefix.includes("://")) {
    throw new Error("Session BFF prefix must be same-origin relative")
  }

  const execute = async (request: SessionRequest): Promise<Response> => {
    assertContractRelativePath(request.path)
    return fetcher(`${bffPrefix}${request.path}`, requestInit(request, options.csrfToken))
  }

  return Object.freeze({
    async request(request): Promise<SessionResponse> {
      const response = await execute(request)
      return {
        status: response.status,
        headers: new Headers(response.headers),
        body: await readBoundedJson(response),
      }
    },
    async stream(request): Promise<SessionStreamResponse> {
      const response = await execute(request)
      return {
        status: response.status,
        headers: new Headers(response.headers),
        body: response.body,
      }
    },
  })
}
