/**
 * Shaping a flat layer + group list into the trees and orderings the layer
 * settings panel renders. All pure — the store supplies the two lists.
 */
import {
  buildGroupHierarchy,
  groupItemCounts,
  type GroupNode,
} from '@/lib/group-tree'
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
  const layersByGroup = new Map<string, Layer[]>()
  for (const layer of [...layers].sort(byOrder)) {
    if (!layer.groupId) continue
    const children = layersByGroup.get(layer.groupId) ?? []
    children.push(layer)
    layersByGroup.set(layer.groupId, children)
  }
  const node = (entry: GroupNode<LayerGroup>): GroupTreeNode => ({
    ...entry.value,
    layers: layersByGroup.get(entry.value.id) ?? [],
    children: entry.children.map(node),
  })
  return buildGroupHierarchy(
    [...groups].sort(byOrder),
    group => group.parentGroupId,
  ).map(node)
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

  return groupItemCounts(
    new Map(groups.map(group => [group.id, group.parentGroupId ?? null])),
    direct,
  )
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
