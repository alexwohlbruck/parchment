/** Flagsticks on golf greens, from barrelman's `golf_features`. */
import { booleanPointInPolygon } from '@turf/turf'
import { DETAIL_SOURCE, GOLF_FLAG_MINZOOM, GOLF_TILES } from '@/lib/map-style/detail-layers'
import type { ObjectInstance, ObjectSourceSpec } from './object-layer'
import { hash } from './vary'

export const GOLF_MODELS = {
  'golf-flag': '/models/golf-flag.glb',
}

/** A 7 ft flagstick, drawn 2.5x so it reads from above a green; true size is a few pixels at z19. */
const FLAG_HEIGHT = 2.13 * 2.5

export type GolfPinSite = { key: string; lng: number; lat: number }

export const golfSiteKey = (feature: any) => `${feature.properties?.kind}:${feature.id}`

const isArea = (feature: any) => feature.geometry?.type === 'Polygon' || feature.geometry?.type === 'MultiPolygon'

/**
 * Where each flag stands: on a mapped `golf=pin`, or, for a green with none
 * (nearly every green in OSM), at the green's middle. Features arrive as tile
 * pieces, so a green's pieces are merged before its middle is found.
 */
export function golfPinSites(features: any[]): GolfPinSite[] {
  const pins = new Map<string, GolfPinSite>()
  const greens = new Map<string, any[]>()
  for (const feature of features) {
    const kind = feature.properties?.kind
    if (kind === 'pin' && feature.geometry?.type === 'Point' && feature.id != null) {
      const [lng, lat] = feature.geometry.coordinates
      pins.set(golfSiteKey(feature), { key: golfSiteKey(feature), lng, lat })
    } else if (kind === 'green' && isArea(feature) && feature.id != null) {
      const key = golfSiteKey(feature)
      greens.set(key, [...(greens.get(key) ?? []), feature])
    }
  }

  const sites = [...pins.values()]
  for (const [key, pieces] of greens) {
    if (sites.some(pin => pieces.some(piece => booleanPointInPolygon([pin.lng, pin.lat], piece.geometry)))) continue
    const [lng, lat] = middle(pieces)
    sites.push({ key, lng, lat })
  }
  return sites
}

/** The centre of the pieces' joint bounds, which tile clipping does not move, kept inside the green. */
function middle(pieces: any[]): [number, number] {
  let [west, south, east, north] = [Infinity, Infinity, -Infinity, -Infinity]
  for (const piece of pieces)
    for (const [lng, lat] of piece.geometry.coordinates.flat(piece.geometry.type === 'Polygon' ? 1 : 2)) {
      west = Math.min(west, lng)
      east = Math.max(east, lng)
      south = Math.min(south, lat)
      north = Math.max(north, lat)
    }
  const centre: [number, number] = [(west + east) / 2, (south + north) / 2]
  if (pieces.some(piece => booleanPointInPolygon(centre, piece.geometry))) return centre
  return widestSpanMiddle(pieces, centre[1]) ?? pieces[0].geometry.coordinates.flat(3).slice(0, 2)
}

/** The middle of the widest stretch of green along a parallel, for a green whose bounds' centre is off the grass. */
function widestSpanMiddle(pieces: any[], lat: number): [number, number] | null {
  let best: [number, number] | null = null
  let width = 0
  for (const piece of pieces) {
    const polygons = piece.geometry.type === 'Polygon' ? [piece.geometry.coordinates] : piece.geometry.coordinates
    for (const rings of polygons) {
      const crossings: number[] = []
      for (const ring of rings)
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const [[xi, yi], [xj, yj]] = [ring[i], ring[j]]
          if (yi > lat !== yj > lat) crossings.push(xi + ((lat - yi) * (xj - xi)) / (yj - yi))
        }
      crossings.sort((a, b) => a - b)
      for (let k = 0; k + 1 < crossings.length; k += 2) {
        if (crossings[k + 1] - crossings[k] <= width) continue
        width = crossings[k + 1] - crossings[k]
        best = [(crossings[k] + crossings[k + 1]) / 2, lat]
      }
    }
  }
  return best
}

export function golfFlagInstance(feature: any, lng: number, lat: number): ObjectInstance | null {
  const kind = feature.properties?.kind
  if (kind !== 'pin' && kind !== 'green') return null
  const seed = feature.id ?? `${lng},${lat}`
  return {
    lng,
    lat,
    height: FLAG_HEIGHT,
    spread: FLAG_HEIGHT,
    heading: hash(seed, 7) * Math.PI * 2,
    shade: 1,
    model: 'golf-flag',
  }
}

function golfObjects(): ObjectSourceSpec {
  let sites = new Map<string, [number, number]>()
  return {
    source: DETAIL_SOURCE,
    sourceLayer: GOLF_TILES,
    minzoom: GOLF_FLAG_MINZOOM,
    prepare: (map, spec) => {
      const features = map.querySourceFeatures(spec.source, { sourceLayer: spec.sourceLayer })
      sites = new Map(golfPinSites(features).map(site => [site.key, [site.lng, site.lat]]))
    },
    positions: feature => {
      const site = sites.get(golfSiteKey(feature))
      return site ? [site] : []
    },
    toInstance: golfFlagInstance,
  }
}

export const GOLF_OBJECTS = golfObjects()
