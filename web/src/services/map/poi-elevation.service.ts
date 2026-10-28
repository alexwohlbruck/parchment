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
import { frameTask } from '@/lib/map/frame-task'
import { layerGroups } from '@/lib/map-style'
import { COLLECTION_MARKERS_SOURCE_ID, SEARCH_RESULTS_SOURCE_ID } from '@/constants/layers'
import { footprintIndex, poiElevation, type BuildingFootprint } from '@/lib/map/poi-elevation'

const SOURCE = 'poi-dots-raised'
const KEEPER = 'poi-tiles-keeper'
const EMPTY = { type: 'FeatureCollection', features: [] }

/**
 * The app's own point overlays that take the same lift: collection markers and
 * search results. Saved places are not here because their plate is a circle
 * layer, which cannot be lifted, and a floating glyph over a grounded plate
 * reads worse than both on the ground.
 */
const OVERLAY_SOURCES = [COLLECTION_MARKERS_SOURCE_ID, SEARCH_RESULTS_SOURCE_ID]

const LIFT = ['coalesce', ['get', '_elev'], 0]

/** What an overlay source was last given, before `_elev` was stamped on. */
type Overlay = { raw: any; set: (data: any) => void; signature: string }

type Ring = Array<[number, number]>

/**
 * The loaded tiles' building footprints. A tile's buildings never change once
 * it has loaded, so each tile's geometry is read only on the first pass that
 * sees it.
 */
function footprintReader() {
  let byTile = new Map<string, BuildingFootprint[]>()
  let buildings: BuildingFootprint[] = []
  return function* (map: any): Generator<void, BuildingFootprint[]> {
    const layer = map.getLayer(layerGroups.building3d)
    if (!layer) return []
    const previous = byTile
    byTile = new Map()
    let read = 0
    for (const f of map.querySourceFeatures(layer.source, { sourceLayer: layer.sourceLayer })) {
      if (++read % 64 === 0) yield
      const tile = `${layer.source}/${layer.sourceLayer}/${f._z}/${f._x}/${f._y}`
      const known = previous.get(tile)
      if (known) {
        byTile.set(tile, known)
        continue
      }
      const out = byTile.get(tile) ?? []
      byTile.set(tile, out)
      const height = Number(f.properties?.render_height ?? f.properties?.height ?? 0)
      if (!(height > 0) || f.properties?.hide_3d) continue
      const g = f.geometry
      const polygons: Ring[][] = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []
      for (const rings of polygons) out.push({ rings, height })
    }
    if (byTile.size !== previous.size || [...byTile].some(([tile, value]) => previous.get(tile) !== value))
      buildings = [...byTile.values()].flat()
    return buildings
  }
}

export function attachPoiElevation(map: any, raised: () => boolean) {
  let signature = ''
  let footprints = footprintReader()
  let poiDirty = true
  let buildingDirty = true

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
          layout: { ...layer.layout, 'symbol-height-offset': LIFT },
        },
        before,
      )
    }
    return true
  }

  const overlays = new WeakMap<object, Overlay>()

  /** Stamp a point collection with `_elev`, leaving anything that is not a point alone. */
  function stamped(data: any, lift: boolean, near: (p: [number, number]) => BuildingFootprint[]) {
    if (!data || typeof data !== 'object' || !Array.isArray(data.features)) return data
    return {
      ...data,
      features: data.features.map((f: any) => {
        const point = f.geometry?.type === 'Point' ? (f.geometry.coordinates as [number, number]) : null
        if (!point) return f
        const _elev = lift ? Math.round(poiElevation(point, f.properties?.level, near) * 2) / 2 : 0
        return { ...f, properties: { ...f.properties, _elev } }
      }),
    }
  }

  const elevationSignature = (data: any) =>
    Array.isArray(data?.features) ? data.features.map((f: any) => f.properties?._elev ?? 0).join(',') : ''

  /**
   * Take over an overlay source's `setData`, so whatever the owning service
   * writes is stamped on the way in, and restamp what it last wrote when the
   * buildings under it change. Lift its symbol layers to match.
   */
  function elevateOverlays(lift: boolean, near: (p: [number, number]) => BuildingFootprint[]) {
    for (const id of OVERLAY_SOURCES) {
      const source = map.getSource(id)
      if (!source?.setData) continue
      let overlay = overlays.get(source)
      if (!overlay) {
        const set = source.setData.bind(source)
        const initial = source.serialize?.().data
        overlay = { raw: typeof initial === 'object' ? initial : EMPTY, set, signature: '' }
        overlays.set(source, overlay)
        const own = overlay
        source.setData = (data: any) => {
          own.raw = data
          const next = stamped(data, raised(), currentNear)
          own.signature = elevationSignature(next)
          return set(next)
        }
      }
      const next = stamped(overlay.raw, lift, near)
      const signature = elevationSignature(next)
      if (signature !== overlay.signature) {
        overlay.signature = signature
        overlay.set(next)
      }
    }
    for (const layerId of map.getLayersOrder()) {
      const layer = map.getLayer(layerId)
      if (layer?.type !== 'symbol' || !OVERLAY_SOURCES.includes(layer.source)) continue
      if (map.getLayoutProperty(layerId, 'symbol-height-offset') === undefined)
        map.setLayoutProperty(layerId, 'symbol-height-offset', LIFT)
    }
  }

  /** The building index the last hydration built, for overlay writes between hydrations. */
  let currentNear: (p: [number, number]) => BuildingFootprint[] = () => []

  let currentBuildings: BuildingFootprint[] | null = null
  let currentLift: boolean | null = null
  let elevations = new Map<string, number>()

  function* hydrate(): Generator<void> {
    const lift = raised()
    const refreshBuildings = buildingDirty || lift !== currentLift
    const refreshPois = poiDirty || refreshBuildings
    buildingDirty = false
    poiDirty = false
    currentLift = lift
    if (refreshBuildings) {
      const buildings = lift ? yield* footprints(map) : null
      if (buildings !== currentBuildings) {
        currentBuildings = buildings
        currentNear = buildings ? footprintIndex(buildings) : () => []
        elevations.clear()
      }
    }
    yield
    elevateOverlays(lift, currentNear)
    if (!mount() || !tiles || !refreshPois) return
    yield
    const seen = new Set<string>()
    const features: any[] = []
    const positions: string[] = []
    const nextElevations = new Map<string, number>()
    let read = 0
    for (const f of map.querySourceFeatures(tiles, { sourceLayer: 'poi' })) {
      if (++read % 32 === 0) yield
      const point = f.geometry?.coordinates as [number, number]
      if (!point) continue
      const key = `${point}|${f.properties?.name ?? ''}|${f.properties?.class ?? ''}`
      if (seen.has(key)) continue
      seen.add(key)
      const heightKey = `${point}|${f.properties?.level ?? ''}`
      const _elev = lift
        ? nextElevations.get(heightKey) ?? elevations.get(heightKey) ?? Math.round(poiElevation(point, f.properties?.level, currentNear) * 2) / 2
        : 0
      nextElevations.set(heightKey, _elev)
      positions.push(`${point}:${_elev}`)
      features.push({ type: 'Feature', id: f.id, properties: { ...f.properties, _elev }, geometry: f.geometry })
    }
    elevations = nextElevations
    // setData re-tiles and repaints, which ends in another idle: an unchanged
    // set has to stop here or the map never rests.
    const next = `${lift}|${positions.sort().join(';')}`
    if (next === signature) return
    signature = next
    map.getSource(SOURCE)?.setData({ type: 'FeatureCollection', features })
  }

  const hydration = frameTask(hydrate)
  const request = hydration.request

  // POIs arriving mid-gesture are hydrated as their tiles land, at most this
  // often, so a pan or zoom never shows a block with its POIs missing.
  const TILE_REFRESH_MS = 300
  let lastTileRefresh = 0
  let trailing = 0
  const onSourceData = (e: any) => {
    if (!e.tile) return
    const buildingSource = map.getLayer(layerGroups.building3d)?.source
    if (e.sourceId === buildingSource) buildingDirty = true
    if (e.sourceId === tiles) poiDirty = true
    if (e.sourceId !== tiles && e.sourceId !== buildingSource) return
    const wait = lastTileRefresh + TILE_REFRESH_MS - performance.now()
    if (wait <= 0) {
      lastTileRefresh = performance.now()
      request()
    } else if (!trailing) {
      trailing = window.setTimeout(() => {
        trailing = 0
        lastTileRefresh = performance.now()
        request()
      }, wait)
    }
  }
  const onStyle = () => {
    signature = ''
    hydration.cancel()
    poiDirty = true
    buildingDirty = true
    footprints = footprintReader()
    currentBuildings = null
    currentNear = () => []
    elevations.clear()
    if (!map.getSource(SOURCE)) tiles = null
    request()
  }
  const onMoveEnd = () => {
    poiDirty = true
    buildingDirty = true
    request()
  }
  map.on('idle', request)
  map.on('moveend', onMoveEnd)
  map.on('sourcedata', onSourceData)
  map.on('style.load', onStyle)
  request()

  return {
    refresh: onStyle,
    detach() {
      map.off('idle', request)
      map.off('moveend', onMoveEnd)
      map.off('sourcedata', onSourceData)
      map.off('style.load', onStyle)
      hydration.cancel()
      if (trailing) clearTimeout(trailing)
    },
  }
}
