import type { LayerSpecification, Map as MaplibreMap } from 'maplibre-gl'
import { queryFeatures } from '@/lib/map-decks/map-query'
import { DECK_LABEL_SOURCE, DECK_LABEL_SUFFIX, deckLabelFeatures, deckLabelLayer, onDecks, type DeckHeightAt, type TileName } from '@/lib/map-decks/deck-labels'

const REFRESH_MS = 250

/**
 * Draws the basemap's road and path names that meet the decks again on them.
 * The strategy leaves those names out of the basemap and hands each layer's filter here.
 */
export class DeckLabels {
  private decks: { footprint: GeoJSON.MultiPolygon; heightAt: DeckHeightAt } | null = null
  private mirrored = new Map<string, unknown>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private drawn = ''

  constructor(private getMap: () => MaplibreMap) {}

  private get map() {
    return this.getMap()
  }

  /** The decks drawn, whose names are cut at their ends; null puts every name back on the ground. */
  setDecks(footprint: GeoJSON.MultiPolygon | null, heightAt: DeckHeightAt) {
    if (!footprint) return this.clear()
    if (!this.decks) this.map.on('sourcedata', this.tileLoaded)
    this.decks = { footprint, heightAt }
    this.schedule()
  }

  /** Draws a basemap name layer on the decks with `filter`, or, with `filter` null, stops. */
  mirror(id: string, filter: unknown | null) {
    const map = this.map
    const mirrorId = `${id}${DECK_LABEL_SUFFIX}`
    if (filter === null) {
      if (map.getLayer(mirrorId)) map.removeLayer(mirrorId)
      this.mirrored.delete(id)
      return
    }
    const layer = map.getStyle()?.layers?.find(l => l.id === id)
    if (!layer) return
    this.ensureSource()
    if (map.getLayer(mirrorId)) {
      if (JSON.stringify(this.mirrored.get(id)) === JSON.stringify(filter)) return
      map.setFilter(mirrorId, (deckLabelLayer(layer as LayerSpecification, filter) as { filter?: any }).filter ?? null, { validate: false })
    } else {
      const order = map.getLayersOrder()
      map.addLayer(deckLabelLayer(layer as LayerSpecification, filter), order[order.indexOf(id) + 1])
    }
    this.mirrored.set(id, filter)
    this.schedule()
  }

  /** A new style has none of the layers drawn for the old one. */
  forget() {
    this.mirrored.clear()
    this.drawn = ''
  }

  /** Stops listening, leaving the map's layers to go with it. */
  detach() {
    if (this.decks) this.map.off('sourcedata', this.tileLoaded)
    this.decks = null
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  clear() {
    this.detach()
    for (const id of [...this.mirrored.keys()]) this.mirror(id, null)
    if (this.map.getSource(DECK_LABEL_SOURCE)) this.map.removeSource(DECK_LABEL_SOURCE)
    this.drawn = ''
  }

  private ensureSource() {
    if (this.map.getSource(DECK_LABEL_SOURCE)) return
    this.drawn = ''
    this.map.addSource(DECK_LABEL_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  }

  private tileLoaded = (event: { sourceId?: string; tile?: unknown }) => {
    if (!event.tile || !event.sourceId || event.sourceId === DECK_LABEL_SOURCE) return
    if (this.sources().has(event.sourceId)) this.schedule()
  }

  private sources(): Set<string> {
    const sources = new Set<string>()
    for (const id of this.mirrored.keys()) {
      const source = this.map.getLayer(id)?.source
      if (source) sources.add(source)
    }
    return sources
  }

  private schedule() {
    if (this.timer || !this.decks) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.refresh()
    }, REFRESH_MS)
  }

  private refresh() {
    const source = this.map.getSource(DECK_LABEL_SOURCE) as { setData?: (data: GeoJSON.FeatureCollection) => void } | undefined
    if (!this.decks || !source?.setData) return
    const filter = onDecks(this.decks.footprint) as any[]
    const seen = new Set<string>()
    const names: TileName[] = []
    for (const id of this.sources()) {
      for (const feature of queryFeatures(this.map, id, 'transportation_name', filter)) {
        const tile: [number, number, number] | undefined = Number.isFinite(feature._z) ? [feature._z, feature._x, feature._y] : undefined
        const key = `${tile}|${JSON.stringify(feature.properties)}|${JSON.stringify(feature.geometry.coordinates)}`
        if (seen.has(key)) continue
        seen.add(key)
        // A tile's properties have no prototype, which the worker cannot be sent.
        names.push({ geometry: feature.geometry, properties: { ...feature.properties }, tile })
      }
    }
    const data = deckLabelFeatures(names, this.decks.heightAt)
    const key = JSON.stringify(data)
    if (key === this.drawn) return
    this.drawn = key
    source.setData(data)
  }
}
