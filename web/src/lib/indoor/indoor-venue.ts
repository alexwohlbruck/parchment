/** Which indoor venue the floor picker serves, from the venue outlines in view. */
import { BASEMAP_FACILITIES, INDOOR_PLACE_CLASSES } from '@/lib/map-style/indoor-layers'

export type IndoorLevel = { level: number; name: string }

export type IndoorVenue = {
  id: number
  name?: string
  /** Top floor first, as a lift panel lists them. */
  levels: IndoorLevel[]
  defaultLevel: number
  /** buildings_3d ids the floor plan stands in. */
  buildings: string[]
}

/** The venue the floor picker serves and the level it shows, null for its outside; null when none is in view. */
export const showsBasement = (focus: IndoorFocus) => focus?.level != null && focus.level < 0

export type IndoorFocus = { venue: IndoorVenue; level: number | null } | null

type VenueFeature = {
  properties: Record<string, unknown> | null
  geometry: { type: string; coordinates: any }
}

export function parseVenue(feature: VenueFeature): IndoorVenue | null {
  const p = feature.properties ?? {}
  const id = Number(p.venue)
  if (!Number.isFinite(id)) return null
  const levels = parseVenueLevels(p.levels, p.level_names)
  return {
    id,
    name: typeof p.name === 'string' ? p.name : undefined,
    levels,
    defaultLevel: Number(p.default_level ?? 0),
    buildings: refs(p.buildings),
  }
}

/** Levels from `"-1;0;1"` and names from `"-1=B1;0=G"`, top floor first. */
export function parseVenueLevels(levels: unknown, names: unknown): IndoorLevel[] {
  const named = new Map<number, string>()
  for (const pair of String(names ?? '').split(';')) {
    const at = pair.indexOf('=', 1)
    if (at > 0) named.set(Number(pair.slice(0, at)), pair.slice(at + 1))
  }
  return [...new Set(String(levels ?? '').split(';').filter(Boolean).map(Number))]
    .filter(n => Number.isFinite(n))
    .sort((a, b) => b - a)
    .map(level => ({ level, name: named.get(level) ?? levelNumber(level) }))
}

/** 0 is G and basements are B1, B2…, as most building signage numbers them. */
function levelNumber(level: number): string {
  if (level === 0) return 'G'
  if (Number.isInteger(level)) return level < 0 ? `B${-level}` : String(level)
  return String(level)
}

/** A venue opens on its default floor, unless that is underground: then on its outside, until asked. */
export const openingLevel = (venue: IndoorVenue) => (venue.defaultLevel >= 0 ? venue.defaultLevel : null)

/**
 * The multi-level venue under the centre of the view, else the nearest one
 * reaching into `focusArea`, the middle of the screen as a ring of [lng, lat].
 */
export function focusedVenue(
  features: VenueFeature[],
  center: [number, number],
  focusArea: number[][],
): IndoorVenue | null {
  let best: { venue: IndoorVenue; distance: number } | null = null
  const seen = new Map<number, number>()
  for (const f of features) {
    const venue = parseVenue(f)
    if (!venue || venue.levels.length < 2 || !reaches(f.geometry, focusArea)) continue
    const distance = distanceToShape(f.geometry, center)
    if ((seen.get(venue.id) ?? Infinity) <= distance) continue
    seen.set(venue.id, distance)
    if (!best || distance < best.distance) best = { venue, distance }
  }
  return best?.venue ?? null
}

const refs = (value: unknown) => String(value ?? '').split(';').filter(Boolean)

/** The buildings floor plans stand in, as the style's `;id;` string; a venue shown from outside keeps its own. */
export function clearedBuildings(features: VenueFeature[], focus: IndoorFocus): string {
  const ids = new Set<string>()
  for (const f of features) {
    if (focus?.level === null && Number(f.properties?.venue) === focus.venue.id) continue
    for (const id of refs(f.properties?.buildings)) ids.add(id)
  }
  return ids.size ? `;${[...ids].sort().join(';')};` : ''
}

/** 0 inside the polygon, else the distance to its nearest vertex in degrees. */
function distanceToShape(geometry: VenueFeature['geometry'], [x, y]: [number, number]): number {
  const polygons: number[][][][] =
    geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : []
  let nearest = Infinity
  for (const rings of polygons) {
    if (insideRing(rings[0], x, y) && !rings.slice(1).some(r => insideRing(r, x, y))) return 0
    for (const [px, py] of rings[0]) nearest = Math.min(nearest, Math.hypot(px - x, py - y))
  }
  return nearest
}

/** Whether a polygon's outline overlaps `area` at all. */
function reaches(geometry: VenueFeature['geometry'], area: number[][]): boolean {
  const polygons: number[][][][] =
    geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : []
  return polygons.some(([ring]) =>
    ring.some(([x, y]) => insideRing(area, x, y))
    || area.some(([x, y]) => insideRing(ring, x, y))
    || ring.some((a, i) => i > 0 && area.some((c, j) => j > 0 && crosses(ring[i - 1], a, area[j - 1], c))))
}

function crosses(a: number[], b: number[], c: number[], d: number[]): boolean {
  const side = (p: number[], q: number[], r: number[]) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]))
  return side(a, b, c) !== side(a, b, d) && side(c, d, a) !== side(c, d, b)
}

function insideRing(ring: number[][], x: number, y: number): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

const OSM_TYPE_DIGIT: Record<string, number> = { node: 1, way: 2, relation: 3 }

/** The basemap tiles' id for an OSM element: `node/5` is 51. */
export function basemapId(ref: string): string | null {
  const [type, id] = ref.split('/')
  return OSM_TYPE_DIGIT[type] && /^\d+$/.test(id ?? '') ? `${id}${OSM_TYPE_DIGIT[type]}` : null
}

/** Whether a floor plan badges this place itself, so the basemap should not. */
function drawsPlace(p: Record<string, unknown>): boolean {
  if (p.class === 'aeroway') return p.ref != null
  return INDOOR_PLACE_CLASSES.includes(String(p.class))
    && !BASEMAP_FACILITIES.includes(String(p.subclass ?? ''))
    && (p.name != null || p.subclass === 'atm' || p.subclass === 'pharmacy')
}

/** Whether a venue's floor plan is showing, rather than its outside. */
export type ShownInside = (venue: number, defaultLevel: number) => boolean

/** Whether the focused venue shows a floor, and any other its default one, as the style draws them. */
export const shownInside = (focus: IndoorFocus): ShownInside => (venue, defaultLevel) =>
  focus?.venue.id === venue ? focus.level !== null : defaultLevel >= 0

const inside = (p: Record<string, unknown>, shown: ShownInside) => shown(Number(p.venue), Number(p.default_level ?? 0))

const joined = (ids: Set<string>) => (ids.size ? `;${[...ids].sort().join(';')};` : '')

/** Doors, lifts and station entrances a showing floor plan signs itself, as the style's `;node/1;` string of OSM ids. */
export function replacedFixtures(features: Pick<VenueFeature, 'properties'>[], shown: ShownInside): string {
  const ids = new Set<string>()
  for (const { properties: p } of features) {
    if (p?.kind === 'poi' && typeof p.id === 'string' && FIXTURE_CLASSES.includes(String(p.class)) && inside(p, shown)) ids.add(p.id)
  }
  return joined(ids)
}

const FIXTURE_CLASSES = ['door', 'elevator']

/** The basemap ids of the places showing floor plans draw on their own level, as the style's `;id;` string. */
export function replacedPlaces(features: Pick<VenueFeature, 'properties'>[], shown: ShownInside): string {
  const ids = new Set<string>()
  for (const { properties: p } of features) {
    const id = p && p.kind === 'poi' && typeof p.id === 'string' && drawsPlace(p) && inside(p, shown) ? basemapId(p.id) : null
    if (id) ids.add(id)
  }
  return joined(ids)
}
