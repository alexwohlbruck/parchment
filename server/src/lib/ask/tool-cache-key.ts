/** About a metre, so a map nudged by a pixel still hits the cache. */
const COORDINATE_DECIMALS = 5

function normalize(value: unknown): unknown {
  if (typeof value === 'string') return value.trim().replace(/\s+/g, ' ')
  if (typeof value === 'number') {
    return Number.isInteger(value) ? value : Number(value.toFixed(COORDINATE_DECIMALS))
  }
  if (Array.isArray(value)) return value.map(normalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, normalize(entry)]),
    )
  }
  return value
}

/**
 * Identifies one tool lookup. `userId` belongs in the scope whenever the
 * results carry per-user data such as bookmarks.
 */
export function toolCacheKey(
  tool: string,
  args: Record<string, unknown>,
  scope: { language: string; userId?: string },
): string {
  return JSON.stringify([tool, scope.language, scope.userId ?? null, normalize(args)])
}
