/**
 * Wildfire data helpers.
 *
 * NASA FIRMS serves active-fire detections as CSV; NIFC (perimeters) and NOAA
 * HMS (smoke) already serve GeoJSON via ArcGIS. Only FIRMS needs parsing —
 * kept pure here so it's unit-testable without network.
 */

export interface Bbox {
  west: number
  south: number
  east: number
  north: number
}

export interface GeoJsonFeatureCollection {
  type: 'FeatureCollection'
  features: Array<{
    type: 'Feature'
    geometry: { type: 'Point'; coordinates: [number, number] }
    properties: Record<string, unknown>
  }>
}

export const EMPTY_FC: GeoJsonFeatureCollection = {
  type: 'FeatureCollection',
  features: [],
}

/** Parse a bbox string "west,south,east,north" into numbers, or null. */
export function parseBbox(s: string): Bbox | null {
  const parts = s.split(',').map(Number)
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return null
  const [west, south, east, north] = parts
  return { west, south, east, north }
}

/**
 * Parse a NASA FIRMS active-fire CSV into a GeoJSON point FeatureCollection.
 * VIIRS columns: latitude, longitude, bright_ti4, confidence (l/n/h), frp,
 * acq_date, acq_time, daynight, …
 */
export function parseFirmsCsv(csv: string): GeoJsonFeatureCollection {
  const lines = csv.trim().split(/\r?\n/)
  if (lines.length < 2) return EMPTY_FC

  const header = lines[0].split(',').map((h) => h.trim())
  const idx = (name: string) => header.indexOf(name)
  const iLat = idx('latitude')
  const iLng = idx('longitude')
  if (iLat === -1 || iLng === -1) return EMPTY_FC

  const iBright = idx('bright_ti4')
  const iConf = idx('confidence')
  const iFrp = idx('frp')
  const iDate = idx('acq_date')
  const iTime = idx('acq_time')
  const iDayNight = idx('daynight')

  const num = (cells: string[], i: number): number | null => {
    if (i < 0) return null
    const v = parseFloat(cells[i])
    return Number.isNaN(v) ? null : v
  }
  const str = (cells: string[], i: number): string | null =>
    i >= 0 ? (cells[i]?.trim() ?? null) : null

  const features: GeoJsonFeatureCollection['features'] = []
  for (let r = 1; r < lines.length; r++) {
    const cells = lines[r].split(',')
    const lat = parseFloat(cells[iLat])
    const lng = parseFloat(cells[iLng])
    if (Number.isNaN(lat) || Number.isNaN(lng)) continue
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [lng, lat] },
      properties: {
        brightness: num(cells, iBright),
        confidence: str(cells, iConf),
        frp: num(cells, iFrp), // fire radiative power (MW) — drives heat intensity
        acqDate: str(cells, iDate),
        acqTime: str(cells, iTime),
        dayNight: str(cells, iDayNight),
      },
    })
  }

  return { type: 'FeatureCollection', features }
}
