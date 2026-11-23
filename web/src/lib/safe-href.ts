const LINK_PROTOCOLS: readonly string[] = ['http:', 'https:', 'mailto:', 'tel:']

/**
 * Returns `value` as a link target only when it is an absolute URL with a
 * known-safe scheme, so untrusted data can never produce a `javascript:` link.
 */
export function safeHref(
  value: string | null | undefined,
  extraProtocols: readonly string[] = [],
): string | undefined {
  if (!value) return undefined
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return undefined
  }
  const allowed =
    LINK_PROTOCOLS.includes(url.protocol) || extraProtocols.includes(url.protocol)
  return allowed ? url.href : undefined
}
