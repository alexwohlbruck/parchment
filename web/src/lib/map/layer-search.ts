import type { Layer } from '@/types/map.types'

/**
 * Shared name matching for the layers library search box. Both the top-level
 * list (`components/map/Layers.vue`) and each group (`LayerGroupItem.vue`)
 * filter against the same rules, so the logic lives here rather than being
 * duplicated per component.
 *
 * Callers pass a query that is already trimmed and lower-cased.
 */

export function matchesQuery(name: string, query: string): boolean {
  return name.toLowerCase().includes(query)
}

export interface SearchableGroupNode {
  name: string
  layers?: Layer[]
  children?: SearchableGroupNode[]
}

/**
 * A group is a match when its own name matches, or when anything nested inside
 * it — a layer or a descendant group — matches.
 */
export function groupSubtreeMatches(
  node: SearchableGroupNode,
  query: string,
): boolean {
  if (matchesQuery(node.name, query)) return true
  if (node.layers?.some(layer => matchesQuery(layer.name, query))) return true
  return Boolean(node.children?.some(child => groupSubtreeMatches(child, query)))
}
