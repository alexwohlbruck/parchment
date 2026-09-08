import type { LocationQuery, LocationQueryValue } from 'vue-router'

/**
 * Directions state ⇄ URL query.
 *
 * Format (all optional except wp):
 *   ?wp=35.217123,-80.820206,Current%20Location
 *   &wp=35.225773,-80.852785,Bank%20of%20America%20Stadium
 *   &wpid=&wpid=osm/way/12345
 *   &mode=multi&sort=cheapest&depart=2026-06-12T18:00:00Z
 *
 * `wp` repeats in order (first = origin, last = destination); the third
 * comma-field onward is the label (labels may themselves contain commas).
 *
 * `wpid` repeats alongside it, one entry per `wp`, holding that waypoint's
 * place id where it has one — a label alone can't be looked back up, so
 * without it a reloaded link knows a stop is called "Target" but nothing
 * else about it. Empty entries are placeholders keeping the two lists in
 * step, and the whole param is omitted when no waypoint has an id.
 *
 * Shareable: pasting the URL reproduces the same directions request.
 */

export interface DirectionsUrlWaypoint {
  lat: number
  lng: number
  label?: string
  /** Composite place id ("osm/node/123"), when the waypoint resolves to one. */
  id?: string
}

export interface DirectionsUrlState {
  waypoints: DirectionsUrlWaypoint[]
  mode?: string
  sort?: string
  depart?: string
}

const COORD_PRECISION = 6

export function serializeDirectionsQuery(
  state: DirectionsUrlState,
): Record<string, string | string[]> {
  const query: Record<string, string | string[]> = {}
  if (state.waypoints.length > 0) {
    query.wp = state.waypoints.map((w) => {
      const base = `${w.lat.toFixed(COORD_PRECISION)},${w.lng.toFixed(COORD_PRECISION)}`
      return w.label ? `${base},${w.label}` : base
    })
    if (state.waypoints.some((w) => w.id)) {
      query.wpid = state.waypoints.map((w) => w.id ?? '')
    }
  }
  if (state.mode) query.mode = state.mode
  if (state.sort) query.sort = state.sort
  if (state.depart) query.depart = state.depart
  return query
}

function asArray(
  v: LocationQueryValue | LocationQueryValue[] | undefined,
): string[] {
  if (v == null) return []
  return (Array.isArray(v) ? v : [v]).filter((x): x is string => x != null)
}

function asString(
  v: LocationQueryValue | LocationQueryValue[] | undefined,
): string | undefined {
  const arr = asArray(v)
  return arr.length ? arr[0] : undefined
}

/** Returns null when the query carries no (valid) directions state. */
export function parseDirectionsQuery(
  query: LocationQuery,
): DirectionsUrlState | null {
  const waypoints: DirectionsUrlWaypoint[] = []
  // Ids are matched to `wp` by position, so index into the raw list rather
  // than the accepted one — a malformed `wp` is skipped but still consumes
  // its slot in `wpid`.
  const ids = asArray(query.wpid)
  asArray(query.wp).forEach((raw, i) => {
    const [latS, lngS, ...rest] = raw.split(',')
    const lat = parseFloat(latS)
    const lng = parseFloat(lngS)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return
    const label = rest.join(',').trim()
    const id = ids[i]?.trim()
    waypoints.push({ lat, lng, ...(label ? { label } : {}), ...(id ? { id } : {}) })
  })
  if (waypoints.length === 0) return null
  return {
    waypoints,
    mode: asString(query.mode),
    sort: asString(query.sort),
    depart: asString(query.depart),
  }
}

/** Stable equality for deciding whether the URL needs updating. */
export function directionsQueryEquals(
  a: Record<string, string | string[]>,
  b: LocationQuery,
): boolean {
  const keys = ['wp', 'wpid', 'mode', 'sort', 'depart'] as const
  for (const k of keys) {
    const av = a[k]
    const bv = b[k]
    const aArr = av == null ? [] : Array.isArray(av) ? av : [av]
    const bArr = asArray(bv)
    if (aArr.length !== bArr.length) return false
    for (let i = 0; i < aArr.length; i++) {
      if (aArr[i] !== bArr[i]) return false
    }
  }
  return true
}
