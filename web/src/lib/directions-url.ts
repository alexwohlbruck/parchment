import type { LocationQuery, LocationQueryValue } from 'vue-router'

/**
 * Directions state ⇄ URL query.
 *
 * Format (all optional except wp):
 *   ?wp=35.217123,-80.820206,Current%20Location
 *   &wp=35.225773,-80.852785,Bank%20of%20America%20Stadium
 *   &mode=multi&sort=cheapest&depart=2026-06-12T18:00:00Z
 *
 * `wp` repeats in order (first = origin, last = destination); the third
 * comma-field onward is the label (labels may themselves contain commas).
 * Shareable: pasting the URL reproduces the same directions request.
 */

export interface DirectionsUrlWaypoint {
  lat: number
  lng: number
  label?: string
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
  for (const raw of asArray(query.wp)) {
    const [latS, lngS, ...rest] = raw.split(',')
    const lat = parseFloat(latS)
    const lng = parseFloat(lngS)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) continue
    const label = rest.join(',').trim()
    waypoints.push({ lat, lng, ...(label ? { label } : {}) })
  }
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
  const keys = ['wp', 'mode', 'sort', 'depart'] as const
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
