/**
 * Where an overlay layer slots into the basemap's stack.
 *
 * Mapbox Standard has this natively: a layer names a slot and the engine puts
 * it in the right band of the style. MapLibre has no such thing — every
 * `addLayer` without a `beforeId` goes on top of everything, which is how the
 * cycling network ended up drawn over the POI labels and over the transit
 * ribbons that are supposed to cross above it.
 *
 * So the same vocabulary is honoured on both engines: a layer that says
 * `slot: 'bottom'` is ground, and gets a `beforeId` that keeps it there.
 */

type StyleLayer = { id: string; type: string }

/** Anything the transit overlay draws, which is never basemap ground. */
const OVERLAY_PREFIX = 'portolan-'

/**
 * The first layer that is no longer part of the ground.
 *
 * Two things end the ground, and it has to be whichever comes first. Labels
 * are the obvious one — a POI name is above everything the map draws flat.
 * The transit network is the other: its ribbons are inserted *below* the
 * labels, so anchoring on labels alone would slot a bike lane above the train
 * line it runs under and leave the crossing reading backwards.
 */
export function groundBeforeId(layers: readonly StyleLayer[]): string | undefined {
  return layers.find(
    l => l.id.startsWith(OVERLAY_PREFIX) || (l.type === 'symbol' && !l.id.startsWith(OVERLAY_PREFIX)),
  )?.id
}

/**
 * The `beforeId` a slot resolves to, or undefined to draw on top.
 *
 * Only `bottom` is emulated. `middle` and `top` already mean "above the
 * basemap" on MapLibre, which is where an unanchored layer lands anyway, and
 * inventing an anchor for them would move layers that are correct today.
 */
export function slotBeforeId(
  layers: readonly StyleLayer[],
  slot: string | undefined,
): string | undefined {
  return slot === 'bottom' ? groundBeforeId(layers) : undefined
}
