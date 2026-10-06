/**
 * Draws POIs — dots and badges alike — at the height of the roof (or storey)
 * they belong to.
 *
 * The style's POI layers read the basemap's vector tiles, which carry no
 * height. Each is swapped for an identical layer over a GeoJSON source of the
 * same POIs, each stamped with `_elev` from `poiElevation`, and lifted with
 * MapLibre's `symbol-height-offset`. Re-hydrated when tiles settle, and only
 * when the set actually changed, so an idle map stays idle.
 */
import { layerGroups } from '@/lib/map-style'
import { footprintIndex, poiElevation, type BuildingFootprint } from '@/lib/map/poi-elevation'

const SOURCE = 'poi-dots-raised'
const KEEPER = 'poi-tiles-keeper'
const EMPTY = { type: 'FeatureCollection', features: [] }

type Ring = Array<[number, number]>

function footprints(map: any): BuildingFootprint[] {
  const layer = map.getLayer(layerGroups.building3d)
  if (!layer) return []
  const out: BuildingFootprint[] = []
  for (const f of map.querySourceFeatures(layer.source, { sourceLayer: layer.sourceLayer })) {
    const height = Number(f.properties?.render_height ?? f.properties?.height ?? 0)
    if (!(height > 0) || f.properties?.hide_3d) continue
    const g = f.geometry
    const polygons: Ring[][] = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []
    for (const rings of polygons) out.push({ rings, height })
  }
  return out
}

export function attachPoiElevation(map: any, raised: () => boolean) {
  let signature = ''
  let queued = 0

  /** The basemap source the POIs come from, once the layers are moved off it. */
  let tiles: string | null = null

  /**
   * Move every POI symbol layer — dots, badges and their labels — onto the
   * raised source, in place, so draw order and placement priority are kept.
   */
  function mount(): boolean {
    if (map.getSource(SOURCE)) return !!tiles
    const layers = (map.getStyle()?.layers ?? []).filter(
      (l: any) => l.type === 'symbol' && l['source-layer'] === 'poi',
    )
    if (!layers.length) return false
    tiles = layers[0].source
    map.addSource(SOURCE, { type: 'geojson', data: EMPTY })
    // MapLibre only parses a source-layer some layer reads, and hydration
    // queries the tiles: an invisible reader keeps the POIs in them.
    map.addLayer({
      id: KEEPER,
      type: 'circle',
      source: tiles,
      'source-layer': 'poi',
      minzoom: Math.min(...layers.map((l: any) => l.minzoom ?? 0)),
      paint: { 'circle-radius': 0, 'circle-opacity': 0, 'circle-stroke-width': 0 },
    }, layers[0].id)
    for (const layer of layers) {
      const order = map.getLayersOrder()
      const before = order[order.indexOf(layer.id) + 1]
      map.removeLayer(layer.id)
      const { 'source-layer': _, ...spec } = layer
      map.addLayer(
        {
          ...spec,
          source: SOURCE,
          layout: { ...layer.layout, 'symbol-height-offset': ['coalesce', ['get', '_elev'], 0] },
        },
        before,
      )
    }
    return true
  }

  function hydrate() {
    queued = 0
    if (!mount() || !tiles) return
    const lift = raised()
    const near = lift ? footprintIndex(footprints(map)) : () => []
    const seen = new Set<string>()
    const features: any[] = []
    for (const f of map.querySourceFeatures(tiles, { sourceLayer: 'poi' })) {
      const point = f.geometry?.coordinates as [number, number]
      if (!point) continue
      const key = `${point}|${f.properties?.name ?? ''}|${f.properties?.class ?? ''}`
      if (seen.has(key)) continue
      seen.add(key)
      const _elev = lift ? Math.round(poiElevation(point, f.properties?.level, near) * 2) / 2 : 0
      features.push({ type: 'Feature', id: f.id, properties: { ...f.properties, _elev }, geometry: f.geometry })
    }
    // setData re-tiles and repaints, which ends in another idle: an unchanged
    // set has to stop here or the map never rests.
    const next = `${lift}|${features.map(f => `${f.geometry.coordinates}:${f.properties._elev}`).sort().join(';')}`
    if (next === signature) return
    signature = next
    map.getSource(SOURCE)?.setData({ type: 'FeatureCollection', features })
  }

  const request = () => {
    if (!queued) queued = requestAnimationFrame(hydrate)
  }
  const onStyle = () => {
    signature = ''
    if (!map.getSource(SOURCE)) tiles = null
    request()
  }
  map.on('idle', request)
  map.on('style.load', onStyle)
  request()

  return {
    refresh: onStyle,
    detach() {
      map.off('idle', request)
      map.off('style.load', onStyle)
      if (queued) cancelAnimationFrame(queued)
    },
  }
}
