import { matchAdminRoute } from '../../config'

const FALLBACK_PATH = '/'

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 0x1f || code === 0x7f) return true
  }

  return false
}

function parseAppOrigin(appOrigin: string): URL | null {
  try {
    const url = new URL(appOrigin)

    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      url.username !== '' ||
      url.password !== ''
    ) {
      return null
    }

    return url
  } catch {
    return null
  }
}

/**
 * Reduces a callback URL to a same-origin application path.
 *
 * Returning only the path prevents callers from forwarding an origin that was
 * supplied through an authentication request.
 */
export function resolveSafeCallbackUrl(
  callbackUrl: string | null | undefined,
  appOrigin: string
): string {
  if (!callbackUrl || callbackUrl.trim() !== callbackUrl) return FALLBACK_PATH
  if (hasControlCharacter(callbackUrl)) return FALLBACK_PATH

  const origin = parseAppOrigin(appOrigin)
  if (!origin) return FALLBACK_PATH

  const isRootRelative = callbackUrl.startsWith('/')
  if (
    (isRootRelative &&
      (callbackUrl.startsWith('//') || callbackUrl.includes('\\'))) ||
    (!isRootRelative && callbackUrl.includes('\\'))
  ) {
    return FALLBACK_PATH
  }

  try {
    const url = isRootRelative
      ? new URL(callbackUrl, origin.origin)
      : new URL(callbackUrl)

    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      url.origin !== origin.origin ||
      url.username !== '' ||
      url.password !== ''
    ) {
      return FALLBACK_PATH
    }

    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return FALLBACK_PATH
  }
}

export function resolveSafeAdminCallbackUrl(
  callbackUrl: string | null | undefined,
  appOrigin: string
): string {
  const safePath = resolveSafeCallbackUrl(callbackUrl, appOrigin)

  try {
    const pathname = new URL(safePath, 'https://admin.invalid').pathname
    return matchAdminRoute(pathname) === null ? FALLBACK_PATH : safePath
  } catch {
    return FALLBACK_PATH
  }
}
