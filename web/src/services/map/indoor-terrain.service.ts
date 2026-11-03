/** Levels the terrain under each indoor venue in view, so its floors, rooms and walls all stand at one height. */
import { grownOutline, standsOnGround, venueOutlines } from '@/lib/indoor/venue-outline'
import { terrainSampler, type TerrainSampler } from '@/lib/map-decks/ground'
import type { Point } from '@/lib/map-decks/decks'
import type { Carving, TerrainCarver } from '@/lib/map-terrain/carver'
import { carvePads, pad, padHeight, padSamples, type Pad } from '@/lib/map-terrain/pad'
import type { FineTerrain } from '@/lib/map-style/fine-terrain'
import { INDOOR_FLOOR_LAYER, INDOOR_MINZOOM, INDOOR_SOURCE, INDOOR_VENUE_TILES } from '@/lib/map-style/indoor-layers'
import { TERRAIN_TILES } from '@/lib/map-style/terrain'

const LAYER_ID = 'indoor-terrain'
/** Venues remembered, so panning back to one does not sample it again. */
const REMEMBERED = 256

const padCarving = (p: Pad): Carving => ({ bounds: p.bounds, carve: (tile, at) => carvePads(tile, at, [p]) })

export function attachIndoorTerrain(map: any, terrain: FineTerrain, carver: TerrainCarver) {
  let enabled = true
  let queued = 0
  let sampler: TerrainSampler | null = null
  /** Each venue's outline, only ever grown, and its height once sampled: a pad that changes reloads the terrain under it. */
  const venues = new Map<number, { ring: Point[]; height?: number }>()

  // Carves before the frame's terrain is drawn; it draws nothing itself.
  const layer = { id: LAYER_ID, type: 'custom', renderingMode: '3d', prerender: () => carver.carveTiles(), render: () => {} }

  function addLayer() {
    if (!map.getLayer(LAYER_ID) && map.getLayer(INDOOR_FLOOR_LAYER)) map.addLayer(layer, INDOOR_FLOOR_LAYER)
  }

  /** The height an outline is levelled to: undefined while its ground loads, null where there is none. */
  function heightOf(ring: Point[], ground: TerrainSampler['ground']): number | null | undefined {
    const samples = padSamples(ring).map(p => ground.at(p))
    return samples.includes(null) ? undefined : padHeight(samples as number[])
  }

  function update() {
    queued = 0
    addLayer()
    const on = enabled && !!map.getTerrain?.() && map.getZoom() >= INDOOR_MINZOOM && !!map.getSource(INDOOR_SOURCE)
    const next = on ? terrainSampler(map, sampler, schedule, template => (template === TERRAIN_TILES ? (z, x, y) => terrain.heights(z, x, y) : undefined)) : sampler
    if (next !== sampler) venues.clear()
    sampler = next
    const pads = new Map<string, Carving>()
    if (on && sampler) {
      for (const [id, pieces] of venueOutlines(map.querySourceFeatures(INDOOR_SOURCE, { sourceLayer: INDOOR_VENUE_TILES }).filter(standsOnGround))) {
        const known = venues.get(id)
        const ring = grownOutline(known?.ring, pieces)
        const height = known?.height ?? heightOf(ring, sampler.ground)
        venues.set(id, { ring, height: height ?? undefined })
        if (venues.size > REMEMBERED) venues.delete(venues.keys().next().value!)
        if (height != null) pads.set(`${id}|${ring.join(';')}`, padCarving(pad(ring, height)))
      }
    }
    carver.set(LAYER_ID, pads, { focus: true, widens: true })
  }

  function schedule() {
    if (!queued) queued = window.setTimeout(update, 120)
  }

  const onSourceData = (e: any) => {
    if (!e.tile) return
    if (e.sourceId === INDOOR_SOURCE) schedule()
    else if (e.sourceId === map.getTerrain?.()?.source && carver.size) {
      // Carved now, before the next frame draws the tile's raw ground under the floors.
      carver.recarveAround(e.tile)
      carver.carveTiles()
    }
  }
  const onStyleLoad = () => {
    addLayer()
    schedule()
  }

  map.on('sourcedata', onSourceData)
  map.on('style.load', onStyleLoad)
  map.on('moveend', schedule)
  map.on('terrain', schedule)
  if (map.isStyleLoaded?.()) onStyleLoad()

  return {
    setEnabled(value: boolean) {
      enabled = value
      schedule()
    },
    detach() {
      map.off('sourcedata', onSourceData)
      map.off('style.load', onStyleLoad)
      map.off('moveend', schedule)
      map.off('terrain', schedule)
      if (queued) clearTimeout(queued)
      if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID)
      carver.clear(LAYER_ID)
    },
  }
}
