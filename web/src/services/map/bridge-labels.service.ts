/**
 * Raises the basemap's road names and one-way arrows onto the 3D bridge
 * decks. The flat labels are clipped out of the decks' footprints and from
 * under each raised stretch; copies of their layers draw those stretches at
 * the deck's height.
 */
import { sourceFeatures } from '@/lib/map/source-features'
import { SOURCE } from '@/lib/map-style'
import { RAISED_SOURCE_LAYERS, deckBoxes, lines, raisedLabelFeatures, raisedLabelLayer, raisedLayerId, raisedSource, ridesBridges, stretchFootprints, type SurfaceAt } from '@/lib/map-decks/bridge-labels'
import { isFlatBridgeLabel } from '@/lib/map-decks/flat-bridges'

export type LabelDecks = { surfaceAt: SurfaceAt; footprints: () => GeoJSON.MultiPolygon | null }

/** Milliseconds basemap tiles are let settle before the labels over the decks are read again. */
const TILE_SETTLE_MS = 300

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }

export function attachBridgeLabels(map: any, decks: () => LabelDecks | null) {
  /** The labels last written to each source, so an unchanged set is not re-tiled. */
  const written = new Map<string, string>()
  let clipped = ''
  let timer = 0

  const originals = (): any[] =>
    map.getLayersOrder()
      .map((id: string) => map.getLayer(id))
      .filter((l: any) => l?.type === 'symbol' && l.source === SOURCE && (RAISED_SOURCE_LAYERS as readonly string[]).includes(l.sourceLayer))

  /** Leave the flat labels out of `area`, or put them all back. */
  function clip(area: GeoJSON.MultiPolygon | null) {
    const signature = area ? JSON.stringify(area.coordinates) : ''
    if (signature === clipped) return
    clipped = signature
    const ids = map.getLayersOrder().map((id: string) => map.getLayer(id)).filter((l: any) => l && isFlatBridgeLabel({ id: l.id, type: l.type, 'source-layer': l.sourceLayer })).map((l: any) => l.id)
    map.setSymbolClip(ids, area)
  }

  function clear() {
    clip(null)
    for (const layer of originals()) if (map.getLayer(raisedLayerId(layer.id))) map.removeLayer(raisedLayerId(layer.id))
    for (const sourceLayer of RAISED_SOURCE_LAYERS) if (map.getSource(raisedSource(sourceLayer))) map.removeSource(raisedSource(sourceLayer))
    written.clear()
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
    const footprints = current?.footprints()
    if (!current || !footprints?.coordinates.length) return clear()
    const layers = originals()
    if (!layers.length) return
    mount(layers)
    const boxes = deckBoxes(footprints)
    // Names carry no bridge tag: a name is raised only where it runs along a bridge's road, not where it passes beneath a deck.
    const bridges = sourceFeatures(map, SOURCE, 'transportation').filter(f => f.properties?.brunnel === 'bridge')
    const read = { transportation: () => raisedLabelFeatures(bridges, boxes, current.surfaceAt), transportation_name: () => raisedLabelFeatures(sourceFeatures(map, SOURCE, 'transportation_name'), boxes, current.surfaceAt, ridesBridges(bridges.flatMap(f => lines(f.geometry)))) }
    const raised = RAISED_SOURCE_LAYERS.map(sourceLayer => {
      const features = read[sourceLayer]()
      const signature = features.map(f => f.properties!.elevation).join(';')
      if (written.get(sourceLayer) !== signature) {
        written.set(sourceLayer, signature)
        map.getSource(raisedSource(sourceLayer))?.setData({ type: 'FeatureCollection', features })
      }
      return features
    })
    clip({ type: 'MultiPolygon', coordinates: [...footprints.coordinates, ...stretchFootprints(raised.flat()).coordinates] })
  }

  const onSourceData = (e: any) => {
    if (e.sourceId !== SOURCE || !e.tile || timer) return
    timer = window.setTimeout(update, TILE_SETTLE_MS)
  }
  const onStyle = () => {
    written.clear()
    clipped = ''
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
