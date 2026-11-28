const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])
const UNSAFE_SCHEMES = new Set(['javascript:', 'data:', 'file:', 'vbscript:', 'blob:'])

function parse(uri: string): URL | null {
  try {
    return new URL(uri)
  } catch {
    return null
  }
}

function isLoopback(url: URL) {
  return url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)
}

/** HTTPS, loopback HTTP for native apps, or an app's own scheme; never with a fragment. */
export function isAllowedRedirectUri(uri: string): boolean {
  const url = parse(uri)
  if (!url || url.hash || UNSAFE_SCHEMES.has(url.protocol)) return false
  if (url.protocol === 'https:') return true
  if (url.protocol === 'http:') return isLoopback(url)
  return true
}

/** Exact match, except a loopback URI may use any port (RFC 8252 §7.3). */
export function redirectUriMatches(registered: string, given: string): boolean {
  if (registered === given) return true
  const a = parse(registered)
  const b = parse(given)
  if (!a || !b || !isLoopback(a) || !isLoopback(b)) return false
  return a.hostname === b.hostname && a.pathname === b.pathname && a.search === b.search
}

export function withQuery(uri: string, params: Record<string, string | undefined>): string {
  const url = new URL(uri)
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, value)
  }
  return url.toString()
}
