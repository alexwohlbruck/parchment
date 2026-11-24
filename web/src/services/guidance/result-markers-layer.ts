// Places a guidance panel offers, drawn as basemap POIs numbered in list order, and tappable.

import type { GeoJSONSource, Map as MaplibreMap, MapLayerMouseEvent } from 'maplibre-gl'
import type { PoiBadgeColors } from '@/lib/map-style/build'
import { ensurePoiBadge, spriteLoaded } from '@/lib/map-style/badge-art'
import { basemapPoiLook } from '@/lib/map/basemap-poi-look'
import type { MapStrategy } from '@/services/map/providers/map.strategy'
import type { LngLat } from '@/types/map.types'

const SOURCE = 'guidance-results'
const LAYER = `${SOURCE}-badge`

export interface ResultMarker {
  location: LngLat
  name: string
  colors: PoiBadgeColors
}

export class ResultMarkersLayer {
  private generation = 0
  private readonly map: MaplibreMap

  constructor(
    private readonly strategy: MapStrategy,
    private readonly onPick: (index: number) => void,
  ) {
    this.map = strategy.mapInstance as MaplibreMap
    const look = basemapPoiLook(this.map.getStyle()?.layers ?? [])
    this.map.addSource(SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    this.map.addLayer({
      id: LAYER,
      type: 'symbol',
      source: SOURCE,
      layout: {
        ...(look?.layout as object),
        'icon-image': ['get', 'image'],
        'text-field': ['get', 'name'],
        'text-optional': true,
        'icon-allow-overlap': true,
        'symbol-sort-key': ['get', 'n'],
      },
      paint: { ...(look?.paint as object), 'text-color': ['get', 'ink'] },
    })
    this.map.on('click', LAYER, this.click)
    this.map.on('mouseenter', LAYER, this.enter)
    this.map.on('mouseleave', LAYER, this.leave)
  }

  private click = (e: MapLayerMouseEvent) => {
    const n = e.features?.[0]?.properties?.n
    if (typeof n !== 'number') return
    if (this.strategy.dispatchPoiClick(e, () => this.onPick(n - 1))) e.originalEvent?.stopPropagation?.()
  }

  private enter = () => (this.map.getCanvas().style.cursor = 'pointer')
  private leave = () => (this.map.getCanvas().style.cursor = '')

  async setMarkers(markers: ResultMarker[]): Promise<void> {
    const generation = ++this.generation
    if (markers.length && !spriteLoaded(this.map)) await new Promise(resolve => this.map.once('idle', resolve))
    // A badge has to be registered before the data names it.
    const images = await Promise.all(markers.map((m, i) => ensurePoiBadge(this.map, { pack: 'number', name: String(i + 1) }, m.colors)))
    if (generation !== this.generation) return
    const features = markers.map((m, i) => ({
      type: 'Feature' as const,
      properties: { n: i + 1, name: m.name, image: images[i], ink: m.colors.ink },
      geometry: { type: 'Point' as const, coordinates: [m.location.lng, m.location.lat] },
    }))
    ;(this.map.getSource(SOURCE) as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features })
  }

  destroy(): void {
    this.generation++
    this.map.off('click', LAYER, this.click)
    this.map.off('mouseenter', LAYER, this.enter)
    this.map.off('mouseleave', LAYER, this.leave)
    if (this.map.getLayer(LAYER)) this.map.removeLayer(LAYER)
    if (this.map.getSource(SOURCE)) this.map.removeSource(SOURCE)
  }
}
