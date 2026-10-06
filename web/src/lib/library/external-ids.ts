export type ExternalIds = Record<string, string>

/** Two records name the same place when any provider gives them the same id. */
export function isSamePlace(a: ExternalIds, b: ExternalIds): boolean {
  return Object.entries(a).some(([provider, id]) => b[provider] === id)
}
