import type { SavedPlacesLayerMeta } from '@/lib/saved-places-layers'

/**
 * A row in the map's layer selector.
 *
 * Deliberately not `Layer | LayerGroup`: the list also carries entries that
 * are neither (OSM notes lives in its own store, collections are projected
 * client-side), so the selector works off a flattened shape with the toggle
 * already bound.
 */
export interface SelectorNode {
  id: string
  name: string
  icon?: string | null
  visible: boolean
  /** Groups only. Absent or empty renders a plain leaf row. */
  children?: SelectorNode[]
  /** Shown to the right of the name when set and non-zero. */
  count?: number
  /** Sort position within its parent; lower first. */
  order?: number
  /** Collection icon pack / color, when this row is a saved-places entry. */
  meta?: SavedPlacesLayerMeta
  onToggle: (visible: boolean) => void
}
