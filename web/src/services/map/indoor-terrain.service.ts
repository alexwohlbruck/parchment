/** Levels the terrain under each indoor venue in view, so its floors, rooms and walls all stand at one height. */
import { standsOnGround, venueOutlines } from '@/lib/indoor/venue-outline'
import { terrainSampler, type TerrainSampler } from '@/lib/map-decks/ground'
import type { Point } from '@/lib/map-decks/decks'
import { TerrainCarver } from '@/lib/map-terrain/carver'
import { carvePads, pad, padHeight, padSamples, type Pad } from '@/lib/map-terrain/pad'
import type { FineTerrain } from '@/lib/map-style/fine-terrain'
import { INDOOR_FLOOR_LAYER, INDOOR_MINZOOM, INDOOR_SOURCE, INDOOR_VENUE_TILES } from '@/lib/map-style/indoor-layers'
import { TERRAIN_TILES } from '@/lib/map-style/terrain'

const LAYER_ID = 'indoor-terrain'
/** Venue heights remembered, so panning back to one does not sample it again. */
const REMEMBERED = 256

export function attachIndoorTerrain(map: any, terrain: FineTerrain) {
  let enabled = true
  let queued = 0
  let sampler: TerrainSampler | null = null
  const heights = new Map<string, number>()
  const carver = new TerrainCarver<Pad>(() => map, carvePads, areas => terrain.focus(areas, LAYER_ID))

  // Carves before the frame's terrain is drawn; it draws nothing itself.
  const layer = { id: LAYER_ID, type: 'custom', renderingMode: '3d', prerender: () => carver.carveTiles(), render: () => {} }

  function addLayer() {
    if (!map.getLayer(LAYER_ID) && map.getLayer(INDOOR_FLOOR_LAYER)) map.addLayer(layer, INDOOR_FLOOR_LAYER)
  }

  /** The height a venue's outline is levelled to: undefined while its ground loads, null where there is none. */
  function heightOf(key: string, ring: Point[], ground: TerrainSampler['ground']): number | null | undefined {
    if (heights.has(key)) return heights.get(key)
    const samples = padSamples(ring).map(p => ground.at(p))
    if (samples.includes(null)) return undefined
    const height = padHeight(samples as number[])
    if (height === null) return null
    heights.set(key, height)
    if (heights.size > REMEMBERED) heights.delete(heights.keys().next().value!)
    return height
  }

  function update() {
    queued = 0
    addLayer()
    const on = enabled && !!map.getTerrain?.() && map.getZoom() >= INDOOR_MINZOOM && !!map.getSource(INDOOR_SOURCE)
    const next = on ? terrainSampler(map, sampler, schedule, template => (template === TERRAIN_TILES ? (z, x, y) => terrain.heights(z, x, y) : undefined)) : sampler
    if (next !== sampler) heights.clear()
    sampler = next
    const pads = new Map<string, Pad>()
    if (on && sampler) {
      for (const [id, ring] of venueOutlines(map.querySourceFeatures(INDOOR_SOURCE, { sourceLayer: INDOOR_VENUE_TILES }).filter(standsOnGround))) {
        const key = `${id}|${ring.join(';')}`
        const height = heightOf(key, ring, sampler.ground)
        if (height != null) pads.set(key, pad(ring, height))
      }
    }
    carver.set(pads)
  }

  function schedule() {
    if (!queued) queued = window.setTimeout(update, 120)
  }

  const onSourceData = (e: any) => {
    if (!e.tile) return
    if (e.sourceId === INDOOR_SOURCE) schedule()
    else if (e.sourceId === map.getTerrain?.()?.source && carver.size) {
      carver.recarveAround(e.tile)
      map.triggerRepaint()
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
      carver.clear()
    },
  }
}
