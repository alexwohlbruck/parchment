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
import { sourceFeatures, sourceTileFeatures } from '@/lib/map/source-features'
import { frameTask } from '@/lib/map/rendering/frame-task'
import { layerGroups } from '@/lib/map-style'
import {
  COLLECTION_MARKERS_SOURCE_ID,
  RECENT_PLACES_SOURCE_ID,
  SEARCH_RESULTS_SOURCE_ID,
} from '@/constants/layers'
import { footprintIndex, poiElevation, raisedDiff, type BuildingFootprint } from '@/lib/map/poi-elevation'
import { RAISED_POI_SOURCE } from '@/lib/map/basemap-poi-look'

const SOURCE = RAISED_POI_SOURCE
const KEEPER = 'poi-tiles-keeper'
const EMPTY = { type: 'FeatureCollection', features: [] }

/**
 * The app's own point overlays that take the same lift: collection markers,
 * search results and recent places. Saved places are not here because their plate is a circle
 * layer, which cannot be lifted, and a floating glyph over a grounded plate
 * reads worse than both on the ground.
 */
const OVERLAY_SOURCES = [COLLECTION_MARKERS_SOURCE_ID, SEARCH_RESULTS_SOURCE_ID, RECENT_PLACES_SOURCE_ID]

const LIFT = ['coalesce', ['get', '_elev'], 0]

/** What an overlay source was last given, before `_elev` was stamped on. */
type Overlay = { raw: any; set: (data: any) => void; signature: string }

type Ring = Array<[number, number]>

/** A basemap POI with the keys a hydration compares by, and the raised copy it last made of it. */
type PoiEntry = {
  feature: any
  point: [number, number]
  at: string
  key: string
  heightKey: string
  raised: any | null
}

/** A tile's POIs read into entries once; the tile's feature array is kept until the tile reloads. */
const poiEntries = new WeakMap<any[], PoiEntry[]>()

function tilePois(features: any[]): PoiEntry[] {
  let entries = poiEntries.get(features)
  if (entries) return entries
  entries = []
  for (const feature of features) {
    const point = feature.geometry?.coordinates as [number, number]
    if (!point) continue
    const at = `${point}`
    const p = feature.properties
    entries.push({ feature, point, at, key: `${at}|${p?.name ?? ''}|${p?.class ?? ''}`, heightKey: `${at}|${p?.level ?? ''}`, raised: null })
  }
  poiEntries.set(features, entries)
  return entries
}

function raisedPoi(entry: PoiEntry, _elev: number) {
  if (entry.raised?.properties._elev !== _elev) {
    const f = entry.feature
    entry.raised = { type: 'Feature', id: f.id, properties: { ...f.properties, _elev }, geometry: f.geometry }
  }
  return entry.raised
}

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
    for (const f of sourceFeatures(map, layer.source, layer.sourceLayer)) {
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
  /** The height of each POI in the raised source, by id; null while it holds some that have none. */
  let shown: Map<string | number, number> | null = null

  function* hydrate(): Generator<void> {
    const mounted = mount()
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
    if (!mounted || !tiles || !refreshPois) return
    yield
    const seen = new Set<string>()
    const features: any[] = []
    const positions: string[] = []
    const nextElevations = new Map<string, number>()
    let read = 0
    for (const tile of sourceTileFeatures(map, tiles, 'poi')) {
      for (const entry of tilePois(tile)) {
        if (++read % 64 === 0) yield
        if (seen.has(entry.key)) continue
        seen.add(entry.key)
        const _elev = lift
          ? nextElevations.get(entry.heightKey) ?? elevations.get(entry.heightKey) ?? Math.round(poiElevation(entry.point, entry.feature.properties?.level, currentNear) * 2) / 2
          : 0
        nextElevations.set(entry.heightKey, _elev)
        positions.push(`${entry.at}:${_elev}`)
        features.push(raisedPoi(entry, _elev))
      }
    }
    elevations = nextElevations
    // setData re-tiles and repaints, which ends in another idle: an unchanged
    // set has to stop here or the map never rests.
    const next = `${lift}|${positions.sort().join(';')}`
    if (next === signature) return
    signature = next
    const source = map.getSource(SOURCE)
    // Only what changed, where the source can take it: writing every POI again re-tiles the whole view for a handful that arrived.
    const diff = shown && source?.updateData ? raisedDiff(shown, features) : null
    if (diff) source.updateData(diff)
    else source?.setData({ type: 'FeatureCollection', features })
    shown = raisedDiff(new Map(), features) ? new Map(features.map(f => [f.id, f.properties._elev])) : null
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
  /**
   * Move the layers now rather than on the hydration's first frame. By then
   * the basemap tiles have been sent to the workers with the POI layers still
   * on them, and laid out with their badges; MapLibre then lays every one of
   * them out again when those badges are drawn for the raised source.
   */
  const mountNow = () => {
    try {
      mount()
    } catch {
      // Style not parsed yet: the hydration mounts once it is.
    }
  }
  const onStyle = () => {
    signature = ''
    shown = null
    hydration.cancel()
    poiDirty = true
    buildingDirty = true
    footprints = footprintReader()
    currentBuildings = null
    currentNear = () => []
    elevations.clear()
    if (!map.getSource(SOURCE)) tiles = null
    mountNow()
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
  mountNow()
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
