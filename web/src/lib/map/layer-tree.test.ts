import { describe, test, expect } from 'vitest'
import {
  buildGroupTree,
  buildGroupLayerCounts,
  groupsWithLayers,
  mainReorderableItems,
  ungroupedLayers,
} from '@/lib/map/layer-tree'
import type { Layer, LayerGroup } from '@/types/map.types'

const layer = (id: string, order: number, groupId?: string, isSubLayer = false) =>
  ({ id, order, groupId, isSubLayer, configuration: { id } }) as unknown as Layer

const group = (id: string, order: number, parentGroupId?: string) =>
  ({ id, order, parentGroupId }) as unknown as LayerGroup

// transit ─ bus
//         └ rail
// plus one ungrouped layer and one sub-layer that never lists on its own.
const groups = [group('rail', 1, 'transit'), group('transit', 0), group('bus', 0, 'transit')]
const layers = [
  layer('l-ungrouped', 1),
  layer('l-bus-2', 1, 'bus'),
  layer('l-bus-1', 0, 'bus'),
  layer('l-rail', 0, 'rail'),
  layer('l-sub', 0, undefined, true),
]

describe('buildGroupTree', () => {
  test('nests children under their parent and orders both levels', () => {
    const tree = buildGroupTree(layers, groups)
    expect(tree.map(g => g.id)).toEqual(['transit'])
    expect(tree[0].children.map(g => g.id)).toEqual(['bus', 'rail'])
  })

  test('sorts each group\'s own layers by order', () => {
    const tree = buildGroupTree(layers, groups)
    expect(tree[0].children[0].layers.map(l => l.id)).toEqual(['l-bus-1', 'l-bus-2'])
  })

  test('leaves ungrouped layers out of the tree', () => {
    const ids = JSON.stringify(buildGroupTree(layers, groups))
    expect(ids).not.toContain('l-ungrouped')
  })
})

describe('buildGroupLayerCounts', () => {
  test('rolls descendant counts up into the parent', () => {
    const counts = buildGroupLayerCounts(layers, groups)
    expect(counts.get('bus')).toBe(2)
    expect(counts.get('rail')).toBe(1)
    expect(counts.get('transit')).toBe(3)
  })

  test('terminates on cyclic parentage without double counting', () => {
    const cyclic = [group('a', 0, 'b'), group('b', 0, 'a')]
    const counts = buildGroupLayerCounts([layer('x', 0, 'a')], cyclic)
    // The cycle is cut at the group already being computed, so the single
    // layer is counted once rather than recursed into forever.
    expect(counts.get('a')).toBe(1)
    expect(counts.get('b')).toBe(0)
  })
})

describe('ungroupedLayers', () => {
  test('excludes grouped layers and sub-layers', () => {
    expect(ungroupedLayers(layers).map(l => l.id)).toEqual(['l-ungrouped'])
  })
})

describe('groupsWithLayers', () => {
  test('lists every group in order with its own layers', () => {
    const result = groupsWithLayers(layers, groups)
    expect(result.map(g => g.id)).toEqual(['transit', 'bus', 'rail'])
    expect(result.find(g => g.id === 'transit')!.layers).toEqual([])
  })
})

describe('mainReorderableItems', () => {
  test('interleaves top-level layers and groups by order', () => {
    expect(mainReorderableItems(layers, groups).map(i => i.id)).toEqual([
      'transit',
      'l-ungrouped',
    ])
  })

  test('omits sub-layers and nested groups', () => {
    const ids = mainReorderableItems(layers, groups).map(i => i.id)
    expect(ids).not.toContain('l-sub')
    expect(ids).not.toContain('bus')
  })
})
