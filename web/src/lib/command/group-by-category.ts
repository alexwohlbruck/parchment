import { COMMAND_CATEGORIES, type CommandCategory } from '@/types/command.types'

export type CategoryGroup<T> = { category: CommandCategory; items: T[] }

/**
 * Splits items into category groups. With `byRelevance`, groups follow the
 * order of their best-ranked item, so the top search hit stays on top.
 */
export function groupByCategory<T extends { category?: CommandCategory }>(
  items: T[],
  byRelevance = false,
): CategoryGroup<T>[] {
  const categoryOf = (item: T) => item.category ?? 'general'
  const order = byRelevance
    ? [...new Set(items.map(categoryOf))]
    : COMMAND_CATEGORIES

  return order
    .map(category => ({
      category,
      items: items.filter(item => categoryOf(item) === category),
    }))
    .filter(group => group.items.length)
}
