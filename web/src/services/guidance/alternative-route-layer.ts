// A route on offer, drawn faint beneath the one being followed.

import type { GeoJSONSource, Map as MaplibreMap } from 'maplibre-gl'
import type { LngLat } from '@/types/map.types'
import { slotBeforeId } from '@/lib/map/layer-slots'

const SOURCE = 'guidance-alternative'
const BENEATH = 'guidance-route-case'

export class AlternativeRouteLayer {
  constructor(private readonly map: MaplibreMap) {
    map.addSource(SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    map.addLayer(
      {
        id: SOURCE,
        type: 'line',
        source: SOURCE,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': '#6b7280',
          'line-opacity': 0.55,
          'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 12, 4, 18, 14],
        },
      },
      map.getLayer(BENEATH) ? BENEATH : slotBeforeId(map.getStyle().layers, 'middle'),
    )
  }

  show(geometry: LngLat[] | null): void {
    const features = geometry
      ? [{ type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: geometry.map(p => [p.lng, p.lat]) } }]
      : []
    ;(this.map.getSource(SOURCE) as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features })
  }

  destroy(): void {
    if (this.map.getLayer(SOURCE)) this.map.removeLayer(SOURCE)
    if (this.map.getSource(SOURCE)) this.map.removeSource(SOURCE)
  }
}
