/**
 * Where an overlay layer slots into the basemap's stack.
 *
 * Mapbox Standard has this natively: a layer names a slot and the engine puts
 * it in the right band. MapLibre has no such thing — every `addLayer` without a
 * `beforeId` goes on top of the whole style, which is how the cycling network
 * ended up drawn over the POI labels and over the transit ribbons that are
 * supposed to cross above it.
 *
 * So the same three names are honoured on both engines, with Standard's own
 * meanings:
 *
 *   bottom   above the polygons, BELOW the roads
 *   middle   above the roads, below the labels
 *   top      above the labels
 *
 * `tunnel` is ours, for the one thing the three cannot say: a way that runs
 * under the network rather than over or beside it. Standard has no slot for it,
 * so there it resolves to `bottom`, the nearest band it does have.
 *
 * `bottom` is the one that is easy to get wrong, and it is the one that
 * matters most: a translucent band belongs under the road network, not over
 * it. MapLibre blends each feature separately, so where two translucent
 * features touch — a corner, a junction, two routes sharing a street — the
 * alpha compounds and leaves a dark blot at every overlap. Nothing in the
 * paint properties can prevent that. An opaque fill under the roads has the
 * problem by construction: no alpha, no compounding, and the streets stay
 * crisp on top of it instead of being seen through it.
 */

import {
  aboveBridgesIndex,
  aboveTunnelsIndex,
  type BrunnelLayer,
} from '@/lib/map-style/brunnel'

type StyleLayer = BrunnelLayer

/** Anything the transit overlay draws, which is never basemap ground. */
const OVERLAY_PREFIX = 'portolan-'

const isOverlay = (l: StyleLayer) => l.id.startsWith(OVERLAY_PREFIX)

/**
 * The first stroke the basemap draws — rivers, then the road network.
 *
 * Everything before it is a polygon: the ground, the land cover, the water.
 * That boundary is what `bottom` means, and it is read off the style rather
 * than named, so a restyle that adds or renames a road layer cannot strand it.
 */
export function belowRoadsBeforeId(layers: readonly StyleLayer[]): string | undefined {
  return layers.find(l => !isOverlay(l) && (l.type === 'line' || l.type === 'symbol'))?.id
}

/**
 * The first thing that is no longer ground.
 *
 * The ground ends above the bridges, because a bridge deck is the network's
 * own top layer and the basemap draws it over every road — an overlay anchored
 * below it loses its mark at every bridge, which is not something a rider can
 * read as a bridge rather than as a gap. The basemap's own symbols do not end
 * the ground: the oneway arrows are drawn on the roads, under the decks.
 *
 * The transit network does end it, wherever it sits. Its ribbons take this same
 * slot, so anchoring past them would slot a bike lane above the train line it
 * runs under and leave the crossing reading backwards.
 */
export function belowLabelsBeforeId(layers: readonly StyleLayer[]): string | undefined {
  const groundTop =
    aboveBridgesIndex(layers) ??
    layers.findIndex(l => isOverlay(l) || l.type === 'symbol')
  const overlay = layers.findIndex(isOverlay)
  const anchor =
    overlay >= 0 && (groundTop < 0 || overlay < groundTop) ? overlay : groundTop
  return layers[anchor]?.id
}

/**
 * Just above the basemap's tunnels, so the surface network still draws over a
 * mark on one and the way visibly dips under where the two cross.
 */
export function inTunnelsBeforeId(layers: readonly StyleLayer[]): string | undefined {
  const at = aboveTunnelsIndex(layers)
  return at === undefined ? belowRoadsBeforeId(layers) : layers[at]?.id
}

/**
 * The `beforeId` a slot resolves to, or undefined to draw on top.
 *
 * `top` and an unnamed slot both mean the top of the stack, which is where an
 * unanchored `addLayer` already lands — so they resolve to nothing rather than
 * to an anchor that would move layers that are correct today.
 */
export function slotBeforeId(
  layers: readonly StyleLayer[],
  slot: string | undefined,
): string | undefined {
  if (slot === 'bottom') return belowRoadsBeforeId(layers)
  if (slot === 'middle') return belowLabelsBeforeId(layers)
  if (slot === 'tunnel') return inTunnelsBeforeId(layers)
  return undefined
}

/** The nearest slot Mapbox Standard has, for the one name it does not know. */
export const mapboxSlot = (slot: string | undefined) =>
  slot === 'tunnel' ? 'bottom' : slot
