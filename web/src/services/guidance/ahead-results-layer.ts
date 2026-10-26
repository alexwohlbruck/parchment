// Places found along the route, numbered in the order they come up.

import type { GeoJSONSource, Map as MaplibreMap } from 'maplibre-gl'
import type { LngLat } from '@/types/map.types'

const SOURCE = 'guidance-ahead'
const DOT = `${SOURCE}-dot`
const NUMBER = `${SOURCE}-number`

export class AheadResultsLayer {
  constructor(private readonly map: MaplibreMap) {
    map.addSource(SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    map.addLayer(
      {
        id: DOT,
        type: 'circle',
        source: SOURCE,
        paint: {
          'circle-radius': 11,
          'circle-color': '#111827',
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
        },
      },
    )
    map.addLayer(
      {
        id: NUMBER,
        type: 'symbol',
        source: SOURCE,
        layout: {
          'text-field': ['to-string', ['get', 'n']],
          'text-size': 12,
          'text-allow-overlap': true,
          'text-font': ['Geist SemiBold'],
        },
        paint: { 'text-color': '#ffffff' },
      },
    )
  }

  setPlaces(points: LngLat[]): void {
    const features = points.map((p, i) => ({
      type: 'Feature' as const,
      properties: { n: i + 1 },
      geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] },
    }))
    ;(this.map.getSource(SOURCE) as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features })
  }

  destroy(): void {
    for (const id of [NUMBER, DOT]) if (this.map.getLayer(id)) this.map.removeLayer(id)
    if (this.map.getSource(SOURCE)) this.map.removeSource(SOURCE)
  }
}
