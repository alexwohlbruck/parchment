/**
 * Raises the basemap's road names and one-way arrows onto the 3D bridge
 * decks. The flat labels are clipped out of the decks' footprints and from
 * under each raised stretch; copies of their layers draw those stretches at
 * the deck's height.
 */
import { sourceTileFeatures } from '@/lib/map/source-features'
import { SOURCE } from '@/lib/map-style'
import { RAISED_SOURCE_LAYERS, deckBoxes, raisedLabelLayer, raisedLayerId, raisedSource, raisedTileLabels, stretchFootprints, type RaisedLabels, type SurfaceAt } from '@/lib/map-decks/bridge-labels'
import { isFlatBridgeLabel } from '@/lib/map-decks/flat-bridges'

export type LabelDecks = { surfaceAt: SurfaceAt; footprints: () => GeoJSON.MultiPolygon | null; version: number }

/** Milliseconds basemap tiles are let settle before the labels over the decks are read again. */
const TILE_SETTLE_MS = 300

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }

/** What one deck version raises: the decks' ground, and each basemap tile's labels, read once per tile. */
type Raised = { version: number; footprints: GeoJSON.MultiPolygon; boxes: ReturnType<typeof deckBoxes>; tiles: WeakMap<object, RaisedLabels> }

export function attachBridgeLabels(map: any, decks: () => LabelDecks | null) {
  let raised: Raised | null = null
  /** The tiles whose labels the sources hold, so an unchanged set is not re-tiled. */
  let written: Set<RaisedLabels> | null = null
  let clipped: GeoJSON.MultiPolygon | null = null
  let timer = 0

  const originals = (): any[] =>
    map.getLayersOrder()
      .map((id: string) => map.getLayer(id))
      .filter((l: any) => l?.type === 'symbol' && l.source === SOURCE && (RAISED_SOURCE_LAYERS as readonly string[]).includes(l.sourceLayer))

  /** Leave the flat labels out of `area`, or put them all back. */
  function clip(area: GeoJSON.MultiPolygon | null) {
    if (area === clipped) return
    clipped = area
    const ids = map.getLayersOrder().map((id: string) => map.getLayer(id)).filter((l: any) => l && isFlatBridgeLabel({ id: l.id, type: l.type, 'source-layer': l.sourceLayer })).map((l: any) => l.id)
    map.setSymbolClip(ids, area)
  }

  function clear() {
    clip(null)
    for (const layer of originals()) if (map.getLayer(raisedLayerId(layer.id))) map.removeLayer(raisedLayerId(layer.id))
    for (const sourceLayer of RAISED_SOURCE_LAYERS) if (map.getSource(raisedSource(sourceLayer))) map.removeSource(raisedSource(sourceLayer))
    written = null
    raised = null
  }

  function mount(layers: any[]) {
    for (const sourceLayer of RAISED_SOURCE_LAYERS)
      if (!map.getSource(raisedSource(sourceLayer))) map.addSource(raisedSource(sourceLayer), { type: 'geojson', data: EMPTY })
    const order: string[] = map.getLayersOrder()
    for (const layer of layers) {
      const id = raisedLayerId(layer.id)
      const visibility = map.getLayoutProperty(layer.id, 'visibility') ?? 'visible'
      if (map.getLayer(id)) {
        if ((map.getLayoutProperty(id, 'visibility') ?? 'visible') !== visibility) map.setLayoutProperty(id, 'visibility', visibility)
        continue
      }
      map.addLayer(raisedLabelLayer(layer.serialize()), order[order.indexOf(layer.id) + 1])
    }
  }

  function update() {
    clearTimeout(timer)
    timer = 0
    const current = decks()
    if (!current) return clear()
    if (raised?.version !== current.version) {
      const footprints = current.footprints()
      raised = footprints?.coordinates.length ? { version: current.version, footprints, boxes: deckBoxes(footprints), tiles: new WeakMap() } : null
      written = null
    }
    if (!raised) return clear()
    const layers = originals()
    if (!layers.length) return
    mount(layers)
    const { boxes, tiles } = raised
    const names = sourceTileFeatures(map, SOURCE, 'transportation_name')
    const labels = sourceTileFeatures(map, SOURCE, 'transportation').map((roads, i) => {
      let tile = tiles.get(roads)
      if (!tile) tiles.set(roads, (tile = raisedTileLabels(roads, names[i] ?? [], boxes, current.surfaceAt)))
      return tile
    })
    if (labels.length === written?.size && labels.every(tile => written!.has(tile))) return
    written = new Set(labels)
    for (const sourceLayer of RAISED_SOURCE_LAYERS)
      map.getSource(raisedSource(sourceLayer))?.setData({ type: 'FeatureCollection', features: labels.flatMap(tile => tile[sourceLayer]) })
    clip({ type: 'MultiPolygon', coordinates: [...raised.footprints.coordinates, ...stretchFootprints(labels.flatMap(tile => [...tile.transportation, ...tile.transportation_name])).coordinates] })
  }

  const onSourceData = (e: any) => {
    if (e.sourceId !== SOURCE || !e.tile || timer) return
    timer = window.setTimeout(update, TILE_SETTLE_MS)
  }
  const onStyle = () => {
    written = null
    clipped = null
  }

  map.on('sourcedata', onSourceData)
  map.on('style.load', onStyle)

  return {
    update,
    detach() {
      clearTimeout(timer)
      map.off('sourcedata', onSourceData)
      map.off('style.load', onStyle)
    },
  }
}
