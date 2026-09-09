/**
 * Projects the user's collections into the layer selector as a "Saved places"
 * group with one toggle per collection.
 *
 * These are deliberately NOT `layers` rows. Collection names live in an E2EE
 * metadata envelope; a `layers` row would store that name in cleartext and
 * hand the server exactly what the encryption exists to withhold. So the group
 * and its children are rebuilt client-side on every read, and their visibility
 * rides the layer store's localStorage override maps — which are already
 * device-local by design.
 *
 * Consequence: everything here carries `origin: 'virtual'`, and the store's
 * mutation paths (update / delete / reorder) must skip those ids rather than
 * PATCH a row that does not exist.
 */

import {
  LayerType,
  MapEngine,
  MapboxLayerType,
  type Layer,
  type LayerGroup,
} from '@/types/map.types'
import type { Bookmark, Collection } from '@/types/library.types'
import { BOOKMARKS_SOURCE_ID, BOOKMARKS_CIRCLES_LAYER_ID } from '@/constants/layers'

export const SAVED_PLACES_GROUP_ID = 'virtual:saved-places'
export const COLLECTION_LAYER_PREFIX = 'virtual:collection:'
/**
 * Frequents (Home / Work / School / a named one) are standalone bookmarks in
 * no collection, so they get their own bucket rather than being lumped in
 * with unfiled places — they aren't unfiled, they're a different kind of
 * thing, with their own fixed markers.
 */
export const FREQUENTS_LAYER_ID = `${COLLECTION_LAYER_PREFIX}frequents`
/**
 * Bookmarks that are in no collection AND aren't frequents. Saving always
 * files a place somewhere, so this bucket only appears if such a row exists —
 * legacy data, or a collection deleted out from under it.
 */
export const UNCATEGORIZED_LAYER_ID = `${COLLECTION_LAYER_PREFIX}uncategorized`

/**
 * Sorts above every real group, and above canvases. Real orders are
 * non-negative, so a negative order pins saved places to the top of the
 * selector without renumbering anything the user owns.
 */
const SAVED_PLACES_ORDER = -2

/** Matches the layer store's placeholder for projected (non-DB) rows. */
const PLACEHOLDER_TIMESTAMP = '1970-01-01T00:00:00.000Z'

export function collectionLayerId(collectionId: string): string {
  return `${COLLECTION_LAYER_PREFIX}${collectionId}`
}

export function isVirtualLayerId(id: string): boolean {
  return typeof id === 'string' && id.startsWith('virtual:')
}

/** The collection behind a virtual layer id, or null for uncategorized. */
export function collectionIdFromLayerId(id: string): string | null {
  if (!id.startsWith(COLLECTION_LAYER_PREFIX)) return null
  const collectionId = id.slice(COLLECTION_LAYER_PREFIX.length)
  return collectionId === 'uncategorized' ? null : collectionId
}

/** What the saved-places map layer needs in order to filter its source. */
export interface SavedPlacesVisibility {
  /** The group toggle. When off, nothing draws regardless of the children. */
  enabled: boolean
  /** Collections whose places should draw. */
  collectionIds: Set<string>
  /** Whether frequents (Home/Work/School/custom) draw. */
  frequents: boolean
  /** Whether bookmarks in no collection and not frequents draw. */
  uncategorized: boolean
}

export const EMPTY_SAVED_PLACES_VISIBILITY: SavedPlacesVisibility = {
  enabled: false,
  collectionIds: new Set(),
  frequents: false,
  uncategorized: false,
}

/**
 * Saved places are on unless the user has said otherwise — someone who saved
 * a place expects to find it on the map without hunting for a toggle first.
 */
const DEFAULT_VISIBLE = true

interface BuildParams {
  collections: Collection[]
  bookmarks: Bookmark[]
  /** localStorage override maps from the layer store; absent = default. */
  layerOverrides: Record<string, boolean>
  groupOverrides: Record<string, boolean>
  /** Localized label for the frequents bucket. */
  frequentsLabel: string
  /** Localized label for the bucket of bookmarks in no collection. */
  uncategorizedLabel: string
  /** Localized label for the group itself. */
  groupLabel: string
  /** Localized label for a collection whose metadata won't decrypt here. */
  lockedLabel: string
}

/**
 * Presentation extras the selector needs but `Layer` has no room for — the
 * collection's own icon pack and color, and how much sits behind the toggle.
 * Kept beside the layers rather than bolted onto the shared `Layer` type.
 */
export interface SavedPlacesLayerMeta {
  iconPack: 'lucide' | 'maki'
  iconColor?: string
  count: number
}

export interface SavedPlacesProjection {
  group: LayerGroup | null
  layers: Layer[]
  visibility: SavedPlacesVisibility
  meta: Map<string, SavedPlacesLayerMeta>
}

function virtualLayer(params: {
  id: string
  name: string
  icon?: string | null
  order: number
  visible: boolean
}): Layer {
  return {
    id: params.id,
    name: params.name,
    type: LayerType.CUSTOM,
    engine: [MapEngine.MAPBOX, MapEngine.MAPLIBRE],
    showInLayerSelector: true,
    visible: params.visible,
    icon: params.icon ?? 'Bookmark',
    order: params.order,
    groupId: SAVED_PLACES_GROUP_ID,
    origin: 'virtual',
    // Points at the real saved-places source so anything walking layers to
    // find a source resolves to something valid. The circle layer is shared
    // by every collection — per-collection filtering happens in the source
    // data, not by giving each collection its own map layer.
    configuration: {
      id: BOOKMARKS_CIRCLES_LAYER_ID,
      type: MapboxLayerType.CIRCLE,
      source: BOOKMARKS_SOURCE_ID,
    },
  }
}

/**
 * Build the group, its per-collection layers, and the visibility summary the
 * map layer consumes — all from the same override maps, so the selector and
 * the map can never disagree about what is switched on.
 *
 * Returns a null group when the user has nothing saved; an empty folder is
 * worse than no folder.
 */
export function buildSavedPlacesProjection(
  params: BuildParams,
): SavedPlacesProjection {
  const {
    collections,
    bookmarks,
    layerOverrides,
    groupOverrides,
    frequentsLabel,
    uncategorizedLabel,
    groupLabel,
    lockedLabel,
  } = params

  // A `user-e2ee` collection holds no bookmark rows at all — its places live
  // in `encrypted_points`, which only decrypt once the collection is switched
  // on. Counting bookmarks alone would drop it from the selector, leaving no
  // toggle to switch on, so it can never load: the encrypted path would be
  // permanently unreachable. Include it on scheme instead.
  const encrypted = collections.filter(c => c.scheme === 'user-e2ee')

  if (bookmarks.length === 0 && encrypted.length === 0) {
    return {
      group: null,
      layers: [],
      visibility: EMPTY_SAVED_PLACES_VISIBILITY,
      meta: new Map(),
    }
  }

  const groupVisible = groupOverrides[SAVED_PLACES_GROUP_ID] ?? DEFAULT_VISIBLE

  // Count per collection so the selector can show how much is behind each
  // toggle, and so empty collections don't clutter the list.
  const counts = new Map<string, number>()
  let frequentsCount = 0
  let uncategorizedCount = 0
  for (const bookmark of bookmarks) {
    // Frequents are standalone by design, so they're bucketed by being
    // frequents rather than by having no collection.
    if (bookmark.frequentType) {
      frequentsCount++
      continue
    }
    const memberships = bookmark.collectionIds ?? []
    if (memberships.length === 0) {
      uncategorizedCount++
      continue
    }
    for (const id of memberships) {
      counts.set(id, (counts.get(id) ?? 0) + 1)
    }
  }

  const named = collections
    .filter(c => counts.has(c.id) || c.scheme === 'user-e2ee')
    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))

  const layers: Layer[] = []
  const meta = new Map<string, SavedPlacesLayerMeta>()
  const visibleCollectionIds = new Set<string>()

  let frequentsVisible = false
  if (frequentsCount > 0) {
    const visible = layerOverrides[FREQUENTS_LAYER_ID] ?? DEFAULT_VISIBLE
    frequentsVisible = visible && groupVisible
    layers.push(
      virtualLayer({
        id: FREQUENTS_LAYER_ID,
        name: frequentsLabel,
        icon: 'Star',
        // Above the collections: these are the places the user reaches for.
        order: -1,
        visible,
      }),
    )
    meta.set(FREQUENTS_LAYER_ID, { iconPack: 'lucide', count: frequentsCount })
  }

  named.forEach((collection, index) => {
    const id = collectionLayerId(collection.id)
    const visible = layerOverrides[id] ?? DEFAULT_VISIBLE
    if (visible && groupVisible) visibleCollectionIds.add(collection.id)
    layers.push(
      virtualLayer({
        id,
        // A collection whose metadata won't decrypt on this device (no
        // recovery key imported yet, revoked device) has no name. It gets its
        // own label rather than borrowing the unfiled one — two rows reading
        // "Unfiled" is worse than admitting the collection is locked.
        name: collection.name || lockedLabel,
        icon: collection.icon,
        order: index,
        visible,
      }),
    )
    meta.set(id, {
      iconPack: collection.iconPack ?? 'lucide',
      iconColor: collection.iconColor,
      // An encrypted collection's size isn't knowable without decrypting it,
      // so it shows no count rather than a misleading zero.
      count: counts.get(collection.id) ?? 0,
    })
  })

  let uncategorizedVisible = false
  if (uncategorizedCount > 0) {
    const visible = layerOverrides[UNCATEGORIZED_LAYER_ID] ?? DEFAULT_VISIBLE
    uncategorizedVisible = visible && groupVisible
    layers.push(
      virtualLayer({
        id: UNCATEGORIZED_LAYER_ID,
        name: uncategorizedLabel,
        icon: 'Bookmark',
        // Always last, however many collections there are.
        order: named.length,
        visible,
      }),
    )
    meta.set(UNCATEGORIZED_LAYER_ID, {
      iconPack: 'lucide',
      count: uncategorizedCount,
    })
  }

  const group: LayerGroup = {
    id: SAVED_PLACES_GROUP_ID,
    name: groupLabel,
    showInLayerSelector: true,
    visible: groupVisible,
    icon: 'Bookmark',
    order: SAVED_PLACES_ORDER,
    parentGroupId: null,
    origin: 'virtual',
    userId: '',
    // Fixed, not `new Date()`: this projection re-runs on every read, and a
    // fresh timestamp each time would break downstream shallow-equality
    // checks and churn every watcher on the group tree.
    createdAt: PLACEHOLDER_TIMESTAMP,
    updatedAt: PLACEHOLDER_TIMESTAMP,
  }

  return {
    group,
    layers,
    visibility: {
      enabled: groupVisible,
      collectionIds: visibleCollectionIds,
      frequents: frequentsVisible,
      uncategorized: uncategorizedVisible,
    },
    meta,
  }
}
