import type { ExpressionSpecification } from 'maplibre-gl'
import { subSolarPoint } from '@/lib/map/sun-position'

export const DAYNIGHT_LAYER_ID = 'daynight-overlay'
export const DAYNIGHT_SOURCE_ID = 'daynight'
export const NIGHT_LIGHTS_ATTRIBUTION = '<a href="https://science.nasa.gov/earth/earth-observatory/earth-at-night/maps/" target="_blank">NASA Earth Observatory / Suomi NPP VIIRS (2016)</a>'
export const MERCATOR_LATITUDE_LIMIT = 85.0511287798066

export function dayNightOpacity(globe: boolean): ExpressionSpecification {
  return ['interpolate', ['linear'], ['zoom'],
    0, globe ? 0 : 1,
    4, globe ? 0 : 0.8,
    6, 0.7,
    8, 0.2,
    9, 0,
  ]
}

export function globeSunDirection(date: Date): [number, number, number] {
  const sun = subSolarPoint(date)
  const lat = sun.lat * Math.PI / 180
  const lng = sun.lng * Math.PI / 180
  return [Math.cos(lat) * Math.sin(lng), Math.sin(lat), Math.cos(lat) * Math.cos(lng)]
}
