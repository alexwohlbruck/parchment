import { describe, it, expect } from 'vitest'
import { partitionArchived } from './layer-archive'
import type { Layer, LayerGroup } from '@/types/map.types'

const ARCHIVED = '2026-11-01T00:00:00.000Z'

function layer(id: string, groupId: string | null = null, archivedAt?: string): Layer {
  return { id, name: id, groupId, archivedAt } as Layer
}

function group(id: string, parentGroupId: string | null = null, archivedAt?: string): LayerGroup {
  return { id, name: id, parentGroupId, archivedAt } as LayerGroup
}

const ids = (items: { id: string }[]) => items.map(i => i.id)

describe('partitionArchived', () => {
  it('keeps everything when nothing is archived', () => {
    const result = partitionArchived([layer('a'), layer('b', 'g')], [group('g')])

    expect(ids(result.layers)).toEqual(['a', 'b'])
    expect(ids(result.groups)).toEqual(['g'])
    expect(result.archived).toEqual([])
  })

  it('takes an archived group’s nested groups and layers with it', () => {
    const result = partitionArchived(
      [layer('top'), layer('inner', 'g'), layer('deep', 'child')],
      [group('g', null, ARCHIVED), group('child', 'g')],
    )

    expect(ids(result.layers)).toEqual(['top'])
    expect(result.groups).toEqual([])
    expect(ids(result.archived)).toEqual(['g'])
  })

  it('lists only the outermost archived item', () => {
    const result = partitionArchived(
      [layer('inner', 'g', ARCHIVED)],
      [group('g', null, ARCHIVED)],
    )

    expect(ids(result.archived)).toEqual(['g'])
  })

  it('archives a single layer inside a live group', () => {
    const result = partitionArchived(
      [layer('kept', 'g'), layer('gone', 'g', ARCHIVED)],
      [group('g')],
    )

    expect(ids(result.layers)).toEqual(['kept'])
    expect(ids(result.groups)).toEqual(['g'])
    expect(ids(result.archived)).toEqual(['gone'])
  })

  it('survives a parent cycle', () => {
    const result = partitionArchived([], [group('a', 'b'), group('b', 'a')])

    expect(ids(result.groups)).toEqual(['a', 'b'])
  })
})
