/**
 * What `current` held for each field `updates` sets: the edit that undoes
 * `updates`. A field `current` never had comes back as null, which clears it.
 */
export function previousValues<T extends object>(
  current: object | undefined,
  updates: Partial<T>,
): Partial<T> {
  return Object.fromEntries(
    Object.keys(updates).map(key => [
      key,
      // A JSON copy, not structuredClone: that throws on a reactive proxy.
      JSON.parse(JSON.stringify((current as Record<string, unknown> | undefined)?.[key] ?? null)),
    ]),
  ) as Partial<T>
}
