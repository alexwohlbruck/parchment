/** How many things a tool's result holds, for "6 found" beside its step. */
export function foundCount(result: unknown): number | undefined {
  if (Array.isArray(result)) return result.length
  if (result && typeof result === 'object') {
    const { count, trips } = result as { count?: unknown; trips?: unknown }
    if (typeof count === 'number') return count
    if (Array.isArray(trips)) return trips.length
  }
  return undefined
}
