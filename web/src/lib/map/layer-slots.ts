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
 * `bottom` is the one that is easy to get wrong, and it is the one that
 * matters most: a translucent band belongs under the road network, not over
 * it. MapLibre blends each feature separately, so where two translucent
 * features touch — a corner, a junction, two routes sharing a street — the
 * alpha compounds and leaves a dark blot at every overlap. Nothing in the
 * paint properties can prevent that. An opaque fill under the roads has the
 * problem by construction: no alpha, no compounding, and the streets stay
 * crisp on top of it instead of being seen through it.
 */

type StyleLayer = { id: string; type: string }

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
  return undefined
}
