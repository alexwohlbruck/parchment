/**
 * Areas planted with objects, from barrelman's `object_areas`: scrub with
 * bushes, shrubbery with close-set shrubs (clipped square where it is tagged
 * `shrubbery:shape=box`), flower beds with bedding plants, ground-mounted solar
 * arrays with rows of panel tables, and single mapped shrubs. See `planting.ts`.
 */
import { DETAIL_SOURCE, OBJECT_AREA_TILES } from '@/lib/map-style/detail-layers'
import type { ObjectInstance } from './object-layer'
import { bearingOf } from './furniture'
import { cellHash, plantedSpec, type Grid } from './planting'
import { lerp, pick } from './vary'

export const AREA_MODELS = {
  'shrub-a': '/models/shrub-a.glb',
  'shrub-b': '/models/shrub-b.glb',
  'shrub-box': '/models/shrub-box.glb',
  flowers: '/models/flowers.glb',
  'solar-table': '/models/solar-table.glb',
}

/** Panel tables in east-west rows, far enough apart that one row does not shade the next. */
const GRIDS: Record<string, Grid> = {
  solar: { dx: 5.2, dy: 8.5, jitter: 0 },
  scrub: { dx: 5, dy: 5, jitter: 0.85 },
  shrubbery: { dx: 1.6, dy: 1.6, jitter: 0.25 },
  flowerbed: { dx: 1.3, dy: 1.3, jitter: 0.7 },
}

const SHRUBS = ['shrub-a', 'shrub-b']

const CLIPPED = new Set(['box', 'block'])

export function areaObject(
  kind: string,
  lng: number,
  lat: number,
  i: number,
  j: number,
  shape?: string,
): ObjectInstance | null {
  const h = (salt: number) => cellHash(i, j, salt)
  switch (kind) {
    case 'shrubbery': {
      const height = lerp({ min: 0.8, max: 1.5 }, h(4))
      const clipped = CLIPPED.has(shape ?? '')
      return {
        lng,
        lat,
        height: clipped ? 1 : height,
        spread: clipped ? 1.5 : height * lerp({ min: 1.2, max: 1.6 }, h(5)),
        heading: clipped ? 0 : h(6) * Math.PI * 2,
        shade: 0.85 + h(7) * 0.2,
        tint: h(8),
        model: clipped ? 'shrub-box' : pick(SHRUBS, h(9)),
      }
    }
    case 'solar':
      // Toward the equator, whichever hemisphere it is in.
      return { lng, lat, height: 1.5, spread: 1.5, heading: bearingOf(lat >= 0 ? 180 : 0)!, shade: 1, model: 'solar-table' }
    case 'flowerbed': {
      const height = lerp({ min: 0.4, max: 0.6 }, h(4))
      return { lng, lat, height, spread: height, heading: h(6) * Math.PI * 2, shade: 0.9 + h(7) * 0.2, tint: h(8), model: 'flowers' }
    }
    case 'scrub':
    case 'shrub': {
      const height = lerp(kind === 'shrub' ? { min: 1.5, max: 3 } : { min: 1, max: 2.6 }, h(4))
      return {
        lng,
        lat,
        height,
        spread: height * lerp({ min: 1, max: 1.5 }, h(5)),
        heading: h(6) * Math.PI * 2,
        shade: 0.85 + h(7) * 0.25,
        tint: h(8),
        model: pick(SHRUBS, h(9)),
      }
    }
    default:
      return null
  }
}

export const AREA_OBJECTS = plantedSpec({
  source: DETAIL_SOURCE,
  sourceLayer: OBJECT_AREA_TILES,
  minzoom: 16.5,
  budget: 5000,
  grid: feature => GRIDS[feature.properties?.kind] ?? null,
  clear: feature => feature.properties?.kind === 'scrub',
  instance: (feature, lng, lat, i, j) => areaObject(feature.properties?.kind, lng, lat, i, j, feature.properties?.shape),
})
