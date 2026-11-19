import { describe, expect, it } from 'vitest'
import { groupByCategory } from './group-by-category'

const items = [
  { id: 'engine', category: 'map' as const },
  { id: 'search' },
  { id: 'theme', category: 'appearance' as const },
  { id: 'projection', category: 'map' as const },
]

const shape = (groups: ReturnType<typeof groupByCategory>) =>
  groups.map(g => [g.category, g.items.map(i => (i as { id: string }).id)])

describe('groupByCategory', () => {
  it('orders groups by category and defaults to general', () => {
    expect(shape(groupByCategory(items))).toEqual([
      ['general', ['search']],
      ['appearance', ['theme']],
      ['map', ['engine', 'projection']],
    ])
  })

  it('orders groups by their best-ranked item when searching', () => {
    expect(shape(groupByCategory(items, true))).toEqual([
      ['map', ['engine', 'projection']],
      ['general', ['search']],
      ['appearance', ['theme']],
    ])
  })
})
