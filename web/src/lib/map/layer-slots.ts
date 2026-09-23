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
 * `grade`, `bridge` and `tunnel` are ours, for the thing the three cannot say:
 * which brunnel a way has. The basemap draws its bridges over the whole network
 * and its tunnels under it, so a mark lands in the band of the way it marks or
 * the basemap simply redraws that way on top of the paint — and a mark on a way
 * at grade has to stay under the decks crossing over it, which `middle` does
 * not, since a bridge deck is drawn after everything at grade. Standard has
 * none of the three; there they resolve to the nearest band it does have.
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
  bridgeBandIndex,
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
 * Two things end the ground and it has to be whichever comes first. Labels are
 * the obvious one — a POI name is above everything the map draws flat. The
 * transit network is the other: its ribbons are inserted *below* the labels,
 * so anchoring on labels alone would slot a bike lane above the train line it
 * runs under and leave the crossing reading backwards.
 */
export function belowLabelsBeforeId(layers: readonly StyleLayer[]): string | undefined {
  return layers.find(l => isOverlay(l) || l.type === 'symbol')?.id
}

/**
 * Just under the basemap's bridges, where a mark on a way at grade belongs: a
 * deck crossing over that way covers its mark exactly as it covers the way.
 */
export function atGradeBeforeId(layers: readonly StyleLayer[]): string | undefined {
  const at = bridgeBandIndex(layers)
  return at === undefined ? belowLabelsBeforeId(layers) : layers[at]?.id
}

/**
 * Just above the basemap's bridge decks, where a mark on a bridge belongs: the
 * deck is drawn first and the mark runs along it, so the crossing still reads
 * as a bridge. A mark in this band carries no casing of its own — the deck is
 * the casing, and a second one would rub it out.
 */
export function onBridgesBeforeId(layers: readonly StyleLayer[]): string | undefined {
  const at = aboveBridgesIndex(layers)
  return at === undefined ? belowLabelsBeforeId(layers) : layers[at]?.id
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
  if (slot === 'grade') return atGradeBeforeId(layers)
  if (slot === 'bridge') return onBridgesBeforeId(layers)
  return undefined
}

/** The nearest slot Mapbox Standard has, for the names it does not know. */
export const mapboxSlot = (slot: string | undefined) =>
  slot === 'tunnel' ? 'bottom' : slot === 'bridge' || slot === 'grade' ? 'middle' : slot
