export type ContextGroup<T> = { context: string; items: T[] }

export function groupByContext<T extends { context?: string }>(
  items: T[],
): ContextGroup<T>[] {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    if (!item.context) continue
    groups.set(item.context, [...(groups.get(item.context) ?? []), item])
  }
  return [...groups].map(([context, items]) => ({ context, items }))
}
