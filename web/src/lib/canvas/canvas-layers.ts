/**
 * Projects the user's canvases into the layer selector as a "Canvases" group
 * with one toggle per canvas.
 *
 * Like saved places, these are deliberately NOT `layers` rows. A `user-e2ee`
 * canvas keeps its name in an envelope only the owner's devices can open, and a
 * `layers` row would store that name in cleartext — handing the server exactly
 * what the encryption exists to withhold. So the group and its children are
 * rebuilt client-side on every read.
 *
 * Where they differ from saved places: a canvas's toggle does NOT ride the
 * layer store's override maps. Which canvases are drawn is already answered by
 * `canvases.store`'s `activeCanvasIds`, which the map reads and the library's
 * Canvases tab writes. Projecting a second copy into the override map would
 * make the selector and the library two sources of truth for one switch, and
 * they would drift the first time either was changed alone. The group's own
 * master switch is the exception — it is a property of the selector, not of any
 * canvas, so it rides `groupOverrides` like every other group.
 *
 * Consequence: everything here carries `origin: 'virtual'`, and the store's
 * mutation paths (update / delete / reorder) skip those ids rather than PATCH a
 * row that does not exist.
 */

import {
  LayerType,
  MapEngine,
  MapboxLayerType,
  type Layer,
  type LayerGroup,
} from '@/types/map.types'
import type { Canvas } from '@/types/canvas.types'

export const CANVASES_GROUP_ID = 'virtual:canvases'
export const CANVAS_LAYER_PREFIX = 'virtual:canvas:'

/**
 * Sorts above every real group but below saved places. Real orders are
 * non-negative, so a negative order pins both to the top of the selector
 * without renumbering anything the user owns.
 */
const CANVASES_ORDER = -1

/** Matches the layer store's placeholder for projected (non-DB) rows. */
const PLACEHOLDER_TIMESTAMP = '1970-01-01T00:00:00.000Z'

export function canvasLayerId(canvasId: string): string {
  return `${CANVAS_LAYER_PREFIX}${canvasId}`
}

/** The canvas behind a virtual layer id, or null if it isn't one. */
export function canvasIdFromLayerId(id: string): string | null {
  if (!id.startsWith(CANVAS_LAYER_PREFIX)) return null
  return id.slice(CANVAS_LAYER_PREFIX.length) || null
}

/**
 * Presentation extras the selector needs but `Layer` has no room for — the
 * canvas's own icon pack and colour, and how much sits behind the toggle.
 */
export interface CanvasLayerMeta {
  iconPack: 'lucide' | 'maki'
  iconColor?: string
  count: number
}

export interface CanvasesProjection {
  group: LayerGroup | null
  layers: Layer[]
  /**
   * The canvases that should actually draw, bottom first — activation order,
   * because the last one switched on draws on top. The group's master switch
   * is already applied. The map renders exactly this, in this order.
   */
  visibleIds: string[]
  meta: Map<string, CanvasLayerMeta>
}

export const EMPTY_CANVASES_PROJECTION: CanvasesProjection = {
  group: null,
  layers: [],
  visibleIds: [],
  meta: new Map(),
}

/**
 * A group the user has not touched is on, so a canvas switched on in the
 * library appears on the map without hunting for a second toggle first.
 */
const DEFAULT_GROUP_VISIBLE = true

interface BuildParams {
  /** Every canvas the user has, for the rows. */
  canvases: Canvas[]
  /** From `canvases.store` — the canonical answer to what is switched on. */
  activeCanvasIds: string[]
  /**
   * The store's `activeCanvases`: switched on, still existing, and with the
   * one open in the editor already dropped, in activation order. Taken as
   * given rather than recomputed here — that ordering is the store's job and
   * is tested there, and a second copy of it would be a second answer to which
   * canvas draws on top.
   */
  activeCanvases: Canvas[]
  /** localStorage override map from the layer store; absent = default. */
  groupOverrides: Record<string, boolean>
  /** Localized label for the group itself. */
  groupLabel: string
  /** Localized label for a canvas whose metadata won't decrypt here. */
  lockedLabel: string
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
    icon: params.icon ?? 'Shapes',
    order: params.order,
    groupId: CANVASES_GROUP_ID,
    origin: 'virtual',
    // A canvas has no single map layer — it renders a whole stack through
    // `useCanvasRendering`. This points at nothing real, and exists only so
    // anything walking layers for a configuration id finds a shape it expects.
    configuration: {
      id: canvasIdFromLayerId(params.id) ?? params.id,
      type: MapboxLayerType.CIRCLE,
      source: '',
    },
  } as Layer
}

/** How much is behind a canvas's toggle: its layers plus its marks. */
function canvasSize(canvas: Canvas): number {
  const body = canvas.body
  if (!body) return 0
  return (body.layers?.length ?? 0) + (body.annotations?.length ?? 0)
}

/**
 * Build the group, its per-canvas layers, and the set the map should draw.
 *
 * Returns a null group when the user has no canvases; an empty folder is worse
 * than no folder.
 */
export function buildCanvasesProjection(
  params: BuildParams,
): CanvasesProjection {
  const {
    canvases,
    activeCanvasIds,
    activeCanvases,
    groupOverrides,
    groupLabel,
    lockedLabel,
  } = params

  if (!canvases.length) return EMPTY_CANVASES_PROJECTION

  const groupVisible = groupOverrides[CANVASES_GROUP_ID] ?? DEFAULT_GROUP_VISIBLE
  const active = new Set(activeCanvasIds)

  const layers: Layer[] = []
  const meta = new Map<string, CanvasLayerMeta>()

  // Most recently updated first, which is the order the library lists them in.
  const ordered = [...canvases].sort((a, b) =>
    (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''),
  )

  ordered.forEach((canvas, index) => {
    const id = canvasLayerId(canvas.id)

    // The row shows what the user asked for, so a canvas switched on still
    // reads as on while the whole group is off — the group is the thing that
    // is off. Only `visibleIds` applies the master switch.
    layers.push(
      virtualLayer({
        id,
        // A canvas whose metadata won't decrypt on this device (no recovery
        // key imported yet, revoked device) has no name, and gets its own
        // label rather than an empty row.
        name: canvas.name || lockedLabel,
        icon: canvas.icon,
        order: index,
        visible: active.has(canvas.id),
      }),
    )

    meta.set(id, {
      iconPack: canvas.iconPack ?? 'lucide',
      iconColor: canvas.iconColor ?? undefined,
      count: canvasSize(canvas),
    })
  })

  const visibleIds = groupVisible ? activeCanvases.map(c => c.id) : []

  const group: LayerGroup = {
    id: CANVASES_GROUP_ID,
    name: groupLabel,
    showInLayerSelector: true,
    visible: groupVisible,
    icon: 'Shapes',
    order: CANVASES_ORDER,
    parentGroupId: null,
    origin: 'virtual',
    userId: '',
    // Fixed, not `new Date()`: this projection re-runs on every read, and a
    // fresh timestamp each time would break downstream shallow-equality checks
    // and churn every watcher on the group tree.
    createdAt: PLACEHOLDER_TIMESTAMP,
    updatedAt: PLACEHOLDER_TIMESTAMP,
  }

  return { group, layers, visibleIds, meta }
}
