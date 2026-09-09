/**
 * Shaping a flat layer + group list into the trees and orderings the layer
 * settings panel renders. All pure — the store supplies the two lists.
 */
import type { Layer, LayerGroup } from '@/types/map.types'

export interface GroupTreeNode extends LayerGroup {
  layers: Layer[]
  children: GroupTreeNode[]
}

export interface LayerGroupWithLayers extends LayerGroup {
  layers: Layer[]
}

const byOrder = <T extends { order: number }>(a: T, b: T) => a.order - b.order

function layersIn(layers: Layer[], groupId: string): Layer[] {
  return layers.filter(l => l.groupId === groupId).sort(byOrder)
}

export function buildGroupTree(
  layers: Layer[],
  groups: LayerGroup[],
): GroupTreeNode[] {
  const node = (group: LayerGroup): GroupTreeNode => ({
    ...group,
    layers: layersIn(layers, group.id),
    children: groups
      .filter(g => g.parentGroupId === group.id)
      .sort(byOrder)
      .map(node),
  })

  return groups
    .filter(g => !g.parentGroupId)
    .sort(byOrder)
    .map(node)
}

/**
 * Total layers per group including descendants, in one pass — walking the tree
 * per lookup was O(groups² · layers) on every render. Cyclic parentage
 * contributes zero rather than recursing forever.
 */
export function buildGroupLayerCounts(
  layers: Layer[],
  groups: LayerGroup[],
): Map<string, number> {
  const direct = new Map<string, number>()
  for (const layer of layers) {
    if (!layer.groupId) continue
    direct.set(layer.groupId, (direct.get(layer.groupId) ?? 0) + 1)
  }

  const childrenByParent = new Map<string, string[]>()
  for (const group of groups) {
    if (!group.parentGroupId) continue
    const list = childrenByParent.get(group.parentGroupId) ?? []
    list.push(group.id)
    childrenByParent.set(group.parentGroupId, list)
  }

  const totals = new Map<string, number>()
  const inProgress = new Set<string>()

  function total(groupId: string): number {
    const cached = totals.get(groupId)
    if (cached !== undefined) return cached
    if (inProgress.has(groupId)) return 0
    inProgress.add(groupId)
    let sum = direct.get(groupId) ?? 0
    for (const childId of childrenByParent.get(groupId) ?? []) {
      sum += total(childId)
    }
    inProgress.delete(groupId)
    totals.set(groupId, sum)
    return sum
  }

  for (const group of groups) total(group.id)
  return totals
}

export function ungroupedLayers(layers: Layer[]): Layer[] {
  return layers.filter(l => !l.groupId && !l.isSubLayer).sort(byOrder)
}

export function groupsWithLayers(
  layers: Layer[],
  groups: LayerGroup[],
): LayerGroupWithLayers[] {
  return groups
    .slice()
    .sort(byOrder)
    .map(group => ({ ...group, layers: layersIn(layers, group.id) }))
}

/** Top-level layers and groups interleaved, as the panel reorders them. */
export function mainReorderableItems(
  layers: Layer[],
  groups: LayerGroup[],
): (Layer | LayerGroup)[] {
  return [
    ...layers.filter(l => !l.groupId && !l.isSubLayer),
    ...groups.filter(g => !g.parentGroupId),
  ].sort(byOrder)
}
