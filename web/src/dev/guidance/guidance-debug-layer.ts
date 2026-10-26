// Dev overlay: raw fixes (grey, sized by accuracy) linked to where each was
// snapped (blue).

import type { GeoJSONSource, Map as MaplibreMap } from 'maplibre-gl'
import { guidanceEngine } from '@/services/guidance/guidance-engine.service'

const SOURCE_ID = 'guidance-debug'
const HISTORY = 30
const REFRESH_MS = 250

type Feature = GeoJSON.Feature<GeoJSON.Geometry, { kind: string; accuracy?: number }>

export function attachGuidanceDebug(map: MaplibreMap): () => void {
  const history: Feature[] = []
  let lastFixT: number | null = null

  map.addSource(SOURCE_ID, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  map.addLayer({
    id: `${SOURCE_ID}-link`,
    type: 'line',
    source: SOURCE_ID,
    filter: ['==', ['get', 'kind'], 'link'],
    paint: { 'line-color': '#f97316', 'line-width': 1.5 },
  })
  map.addLayer({
    id: `${SOURCE_ID}-fix`,
    type: 'circle',
    source: SOURCE_ID,
    filter: ['==', ['get', 'kind'], 'fix'],
    paint: {
      'circle-color': '#64748b',
      'circle-opacity': 0.55,
      'circle-radius': ['interpolate', ['linear'], ['get', 'accuracy'], 3, 3, 30, 9],
      'circle-stroke-color': '#fff',
      'circle-stroke-width': 1,
    },
  })
  map.addLayer({
    id: `${SOURCE_ID}-match`,
    type: 'circle',
    source: SOURCE_ID,
    filter: ['==', ['get', 'kind'], 'match'],
    paint: { 'circle-color': '#2563eb', 'circle-radius': 3 },
  })

  const timer = setInterval(() => {
    const diagnostics = guidanceEngine.diagnostics
    const fix = diagnostics?.lastFix
    const match = diagnostics?.lastMatch
    if (!fix || !match || fix.t === lastFixT) return
    lastFixT = fix.t
    const raw: [number, number] = [fix.position.lng, fix.position.lat]
    const snapped: [number, number] = [match.point.lng, match.point.lat]
    history.push(
      { type: 'Feature', geometry: { type: 'Point', coordinates: raw }, properties: { kind: 'fix', accuracy: fix.accuracy } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: snapped }, properties: { kind: 'match' } },
      { type: 'Feature', geometry: { type: 'LineString', coordinates: [raw, snapped] }, properties: { kind: 'link' } },
    )
    history.splice(0, Math.max(0, history.length - HISTORY * 3))
    ;(map.getSource(SOURCE_ID) as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: history })
  }, REFRESH_MS)

  return () => {
    clearInterval(timer)
    for (const id of ['match', 'fix', 'link']) {
      if (map.getLayer(`${SOURCE_ID}-${id}`)) map.removeLayer(`${SOURCE_ID}-${id}`)
    }
    if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID)
  }
}
