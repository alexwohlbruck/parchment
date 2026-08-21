/**
 * Portolan expression and predicate logic — the pure half of the renderer.
 *
 * Structural port of the portolan atlas viewer; keep it diffable against
 * portolan/web/src/views/MapView.vue and portolan/web/src/lib/dynamic.ts
 * rather than rewriting idiomatically, so future atlas style changes can
 * be carried across. Line references are to those files.
 */

import type { PortolanStyleSet } from '@/types/portolan.types'

// MapLibre expressions are heterogeneous arrays; the style spec types add
// nothing here, so the atlas's `any` convention carries over.
export type Expr = any

// ── zoom bands (MapView.vue:37-44) ─────────────────────────────────────
// The pipeline emits one copy of the map per band, and exactly one band
// may be visible at a time or every ribbon doubles. band_min keys them.
export const BANDS = [
  { min: 15, max: 24, key: 15 },
  { min: 14, max: 15, key: 14 },
  { min: 13, max: 14, key: 13 },
  { min: 0, max: 13, key: 0 },
] as const

export const bandForZoom = (z: number) =>
  (BANDS.find(b => z >= b.min && z < b.max) ?? BANDS[BANDS.length - 1]).key

// ── ribbon offsets (MapView.vue:142-161) ───────────────────────────────
// Offsets live in DIFFERENT properties depending on the segment kind: a
// steady segment carries its slot offset in `offset_px` (off_from/off_to
// are 0), a transition carries the ease endpoints in off_from_px/
// off_to_px (offset_px is 0). Reading the transition pair for everything
// collapses every bundle onto one line.
export const zoomScaledOffset = (e: Expr): Expr => [
  'interpolate',
  ['linear'],
  ['zoom'],
  11,
  ['*', e, 0.5],
  14,
  e,
]
export const STEADY_OFFSET: Expr = zoomScaledOffset(['get', 'offset_px'])
// Transitions ease over ['line-progress'], which MapLibre only computes
// for GeoJSON sources with lineMetrics — hence the hydration pipeline.
export const TRANSITION_OFFSET: Expr = zoomScaledOffset([
  'interpolate',
  ['cubic-bezier', 0.4, 0, 0.6, 1],
  ['line-progress'],
  0,
  ['get', 'off_from_px'],
  1,
  ['get', 'off_to_px'],
])
// Bridges render exactly like steady ribbons — the gap-bridge distinction
// is pipeline bookkeeping, not something a rider sees.
export const KINDS: [string, Expr][] = [
  ['steady', STEADY_OFFSET],
  ['transition', TRANSITION_OFFSET],
  ['bridge', STEADY_OFFSET],
]

// ── ribbon width/opacity (MapView.vue:357-381) ─────────────────────────
export const widthExpr = (w: Expr): Expr => [
  'interpolate',
  ['linear'],
  ['zoom'],
  10,
  ['*', 1.0, w],
  13,
  ['*', 2.0, w],
  15,
  ['*', 3.0, w],
  16,
  ['*', 3.6, w],
]

/** Per-class width and opacity matches from a feed's resolved style set.
 *  Absent classes fall through to 1; a missing manifest (barrelman may
 *  not serve one) is a literal 1 — a match with zero branches is not a
 *  valid expression. */
export function modeExprs(st: PortolanStyleSet | null): { w: Expr; o: Expr } {
  const w: Expr[] = ['match', ['coalesce', ['get', 'mode'], '']]
  const o: Expr[] = ['match', ['coalesce', ['get', 'mode'], '']]
  for (const [name, m] of Object.entries(st?.modes ?? {})) {
    if (name === 'unknown') continue
    w.push(name, m.width ?? 1)
    o.push(name, m.opacity ?? 1)
  }
  if (w.length === 2) return { w: 1, o: 1 }
  w.push(1)
  o.push(1)
  return { w, o }
}

// Hydrated transition/bridge features carry per-feed RESOLVED
// width/opacity (_w/_o, baked in hydration from the owning feed's style
// set): the twin layers are shared across feeds, so a per-layer
// expression cannot split by feed — the value rides on the feature.
export const perFeedW = (w: Expr): Expr => ['coalesce', ['get', '_w'], w]
export const perFeedO = (o: Expr): Expr => ['coalesce', ['get', '_o'], o]

export const RIBBON_COLOR: Expr = ['concat', '#', ['get', 'route_color']]

// ── service-time filter (MapView.vue:1526-1561) ────────────────────────
// hex digits with bit b set — the bit test as a match label set
export const HEX_BIT = [
  ['1', '3', '5', '7', '9', 'b', 'd', 'f'],
  ['2', '3', '6', '7', 'a', 'b', 'e', 'f'],
  ['4', '5', '6', '7', 'c', 'd', 'e', 'f'],
  ['8', '9', 'a', 'b', 'c', 'd', 'e', 'f'],
]
// acts is per-ROUTE: a semicolon-joined list of 42-char masks aligned
// with the routes CSV, so the test is ANY route slot awake — slots ride
// at stride 43 (42 chars + the ';').
export const ACTS_MAX_ROUTES = 16

/** Where one instant lives inside a 42-char weekly mask: the hex digit
 *  index and the digit values with that hour's bit set. 7 days x 6
 *  digits, Monday first, each day a big-endian 24-bit word with hour 0
 *  at the LSB — so an hour's digit sits at day*6 + (5 - floor(hour/4)),
 *  bit hour%4 of that digit. */
export function actsSlot(date: Date): { digit: number; hexDigits: string[] } {
  const day = (date.getDay() + 6) % 7 // JS Sunday=0 → portolan Monday=0
  const hour = date.getHours()
  return { digit: day * 6 + (5 - Math.floor(hour / 4)), hexDigits: HEX_BIT[hour % 4] }
}

/** MapLibre filter for "any member route awake at `date`", or null when
 *  no time is set. Empty/missing acts renders always-active — visible is
 *  the honest default when the calendar pass knows nothing. */
export function actsFilterExpr(date: Date | null): Expr | null {
  if (!date || Number.isNaN(date.getTime())) return null
  const { digit, hexDigits } = actsSlot(date)
  const acts: Expr = ['coalesce', ['get', 'acts'], '']
  const routeOn = (j: number): Expr => {
    const at = j * 43 + digit
    // a slot beyond the actual route count slices to '' → false, so the
    // fixed fan-out is inert past the feature's own routes
    return ['match', ['slice', acts, at, at + 1], hexDigits, true, false]
  }
  const tests = Array.from({ length: ACTS_MAX_ROUTES }, (_, j) => routeOn(j))
  return ['case', ['==', acts, ''], true, ['any', ...tests]]
}

/** Filter clause hiding the disabled classes, or null when all are on. */
export function classFilterExpr(classesOff: Set<string>): Expr | null {
  if (!classesOff.size) return null
  return ['!', ['in', ['get', 'mode'], ['literal', [...classesOff]]]]
}

/** Combine a layer's structural filter (band/kind, recorded at creation)
 *  with the live time/class clauses. No clauses restores exactly the
 *  structural filter, so recombination is lossless (MapView.vue:1569). */
export function composeFilter(structural: Expr | null, clauses: Expr[]): Expr | null {
  if (!clauses.length) return structural
  return ['all', ...(structural ? [structural] : []), ...clauses]
}

// ── activity masks (dynamic.ts:28-95) ──────────────────────────────────
// 168 bits: 7 days x 24 hours, Monday first, hex as 7x6 chars, hour 0 =
// LSB of each day's word.

export function maskActive(mask: string, day: number, hour: number): boolean {
  const bits = parseInt(mask.slice(day * 6, day * 6 + 6), 16)
  return ((bits >>> hour) & 1) === 1
}

export const routesOf = (props: any): string[] =>
  String(props.routes ?? '')
    .split(',')
    .filter(Boolean)

/** A station is visible while ANY member route is (a) in an enabled
 *  class and (b) awake AT THIS STATION at the given instant. Stations
 *  carry per-route `acts` sampled from their snapped segments; the
 *  route-level mask is the fallback for entries without one (parchment
 *  has no activity endpoint, so `masks` is {} and missing acts renders
 *  always-active — the honest default). `date` null = the all-service
 *  map. Aligned arrays: routes[i] <-> modes[i] <-> acts[i]. */
export function stationVisible(
  props: Record<string, any>,
  masks: Record<string, string>,
  date: Date | null,
  classesOff: Set<string>,
): boolean {
  const routes = routesOf(props)
  if (routes.length === 0) return true
  const modes = String(props.modes ?? '').split(',')
  const acts = String(props.acts ?? '').split(';')
  const day = date ? (date.getDay() + 6) % 7 : 0
  const hour = date ? date.getHours() : 0
  return routes.some((r, i) => {
    if (classesOff.has(modes[i])) return false
    if (!date) return true
    const a = acts[i]
    if (a && a.length === 42) return maskActive(a, day, hour)
    const m = masks[r]
    return !m || maskActive(m, day, hour)
  })
}

/** Indices of a feature's routes that are awake at `date` AND in an
 *  enabled class — the subset a bullet strip should show. Returns null
 *  when nothing is filtered (reuse the original feature; no churn). */
export function activeRouteIdx(
  props: Record<string, any>,
  masks: Record<string, string>,
  date: Date | null,
  classesOff: Set<string>,
): number[] | null {
  const routes = routesOf(props)
  if (!routes.length || (!date && !classesOff.size)) return null
  const modes = String(props.modes ?? '').split(',')
  const acts = String(props.acts ?? '').split(';')
  const day = date ? (date.getDay() + 6) % 7 : 0
  const hour = date ? date.getHours() : 0
  const idx: number[] = []
  routes.forEach((r, i) => {
    if (classesOff.has(modes[i])) return
    if (date) {
      const a = acts[i]
      if (a && a.length === 42) {
        if (!maskActive(a, day, hour)) return
      } else {
        const m = masks[r]
        if (m && !maskActive(m, day, hour)) return
      }
    }
    idx.push(i)
  })
  return idx.length === routes.length ? null : idx
}

// ── bullet strips (dynamic.ts:133-171) ─────────────────────────────────

/** Bullet image id for one route; the image itself is generated on
 *  demand by the styleimagemissing handler. */
export const bulletId = (label: string, hex: string, shape = '') =>
  `blt-${hex || '888888'}-${shape}-${label}`

// "FX"/"6X"/"7X" are express variants of a line the set already shows —
// Apple never bullets them separately, and neither does portolan
export const isVariantLabel = (l: string, all: string[]) =>
  l.length >= 2 && l.endsWith('X') && all.includes(l.slice(0, -1))

/** Bullets a station label shows: EVERY distinct (label, color) pair,
 *  and only for classes where a bullet means something. No count cap —
 *  the strip renderer wraps long sets into rows instead of truncating. */
export function bulletIdsOf(p: any): string[] {
  const labels = String(p.labels ?? '').split(',')
  const colors = String(p.route_colors ?? '').split(',')
  const modes = String(p.modes ?? '').split(',')
  const shapes = String(p.shapes ?? '').split(',')
  const seen = new Set<string>()
  const out: string[] = []
  labels.forEach((l, i) => {
    if (!l || l.length > 8) return
    if (modes[i] === 'regional' || modes[i] === 'bus') return
    if (isVariantLabel(l, labels)) return
    const id = bulletId(l, colors[i], shapes[i] ?? '')
    if (seen.has(id)) return
    seen.add(id)
    out.push(id)
  })
  return out
}
