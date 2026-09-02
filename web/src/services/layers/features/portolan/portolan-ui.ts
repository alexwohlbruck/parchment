/**
 * Portolan selector logic — the pure half of the layer-group UI.
 *
 * The renderer (portolan-transit.service) filters by portolan's nine mode
 * classes; the selector offers four toggles (Rail / Bus / Ferry / Other),
 * so this module owns the mapping between the two, plus the service-time
 * slider's date construction and the station features' gtfs_ids parsing.
 * Everything here is side-effect free and unit tested.
 */

import { PORTOLAN_CLASSES, type PortolanClass } from '@/types/portolan.types'

/** The default Transit layer group; its visibility IS the portolan
 *  enable switch (plus the localStorage dev flag as an OR). */
export const TRANSIT_GROUP_ID = 'default:group:transit'

/** Synthetic selector rows are not `layers` rows, but their toggle state
 *  persists in the same localStorage visibility override map the layers
 *  store already writes — these are the ids it is keyed by. */
export const CLASS_GROUP_ROW_ID_PREFIX = 'portolan:class:'

export const TRANSIT_CLASS_GROUPS = ['rail', 'bus', 'ferry', 'other'] as const
export type TransitClassGroup = (typeof TRANSIT_CLASS_GROUPS)[number]

// Rail sweeps everything that runs on a track or a cable-hauled track;
// "other" is defined by subtraction so any class portolan grows later
// lands there instead of becoming untogglable.
const CLAIMED: Record<Exclude<TransitClassGroup, 'other'>, PortolanClass[]> = {
  rail: ['metro', 'tram', 'regional', 'monorail', 'funicular', 'cable'],
  bus: ['bus'],
  ferry: ['ferry'],
}

export const CLASS_GROUP_MEMBERS: Record<TransitClassGroup, PortolanClass[]> = {
  ...CLAIMED,
  other: PORTOLAN_CLASSES.filter(
    c => !Object.values(CLAIMED).some(list => list.includes(c)),
  ),
}

/** Expand the four group toggles into the per-class visibility map the
 *  renderer's setClassVisibility takes. Full map every time — merge
 *  semantics would otherwise leave a re-enabled group half-hidden. */
export function classVisibilityFor(
  groups: Record<TransitClassGroup, boolean>,
): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  for (const g of TRANSIT_CLASS_GROUPS) {
    for (const cls of CLASS_GROUP_MEMBERS[g]) out[cls] = groups[g]
  }
  return out
}

// ── service-time construction ──────────────────────────────────────────

/** Minutes since local midnight — the slider's unit. */
export function minutesOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes()
}

/** Portolan day index: Monday-first, matching the acts masks' 7×24 layout
 *  (JS Sunday=0 → portolan Monday=0). */
export function portolanDay(date: Date): number {
  return (date.getDay() + 6) % 7
}

/**
 * The Date a detached slider position stands for: the next occurrence of
 * `day` (Monday-first) at `minutes` past midnight, counted from `from`.
 * The acts filter only reads weekday and hour, so which calendar week the
 * date lands in is irrelevant — but returning a real future instant keeps
 * the value honest for display and debugging.
 */
export function dateAtDaySlot(day: number, minutes: number, from = new Date()): Date {
  const d = new Date(from)
  const delta = (day - portolanDay(from) + 7) % 7
  d.setDate(d.getDate() + delta)
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0)
  return d
}

// ── station identity ───────────────────────────────────────────────────

export interface GtfsIdPair {
  feedOnestopId: string
  stopId: string
  /** `<feed-onestop>:<stop_id>` verbatim — a valid transit.land stop_key,
   *  so it rides the /place/provider/transitland/:placeId route as-is. */
  stopKey: string
}

/**
 * Parse a portolan station/marker feature's `gtfs_ids` property:
 * semicolon-joined `<feed-onestop>:<stop_id>` pairs. Older tiles lack the
 * property entirely — an empty result means "no click affordance", never
 * an error. Split on the FIRST colon only: feed onestop ids never contain
 * one, but agency stop_ids sometimes do.
 */
export function parseGtfsIds(raw: unknown): GtfsIdPair[] {
  if (typeof raw !== 'string' || !raw) return []
  const out: GtfsIdPair[] = []
  for (const pair of raw.split(';')) {
    const colon = pair.indexOf(':')
    if (colon <= 0 || colon === pair.length - 1) continue
    out.push({
      feedOnestopId: pair.slice(0, colon),
      stopId: pair.slice(colon + 1),
      stopKey: pair,
    })
  }
  return out
}

/** Where a clicked station goes: an OSM object, or a transit.land stop
 *  key, or nowhere. Route names are the caller's (AppRoute) — this module
 *  stays free of the router. */
export type StopTarget = (
  | { kind: 'osm'; type: string; id: string }
  | { kind: 'transitland'; stopKey: string }
) & {
  /**
   * The symbol stands for a whole complex rather than one station, so the
   * panel should open all of it.
   *
   * Read from `nmarkers`, not from `gtfs_ids`: that prop lists every stop
   * merged into the station — platforms AND parent records — so even a plain
   * two-platform station carries several pairs and counting them would call
   * everything a complex. `nmarkers` is one per ribbon bundle the station's
   * lines snap to, which is what actually makes a drawn label cover more than
   * one station: Canal St is one symbol over four of them.
   */
  complex?: boolean
}

/**
 * Which place a click on this station feature identifies.
 *
 * The OSM object first, whenever there is one. Portolan matches every
 * GTFS stop it draws against the OSM stop beside it — that match is where
 * the drawn name comes from — and records it as `osm`. So a station
 * clicked on the transit layer and the same station clicked as a basemap
 * POI are the SAME object and must open the same URL, rather than two
 * pages about one platform keyed by different vocabularies. It is also
 * the precedence the rest of the app uses (place.utils: OSM first, then
 * coords, then whatever provider is left).
 *
 * `gtfs_ids` is the fallback. A `<feed-onestop>:<stop_id>` pair is a valid
 * transit.land stop_key and rides the provider route untranslated, which
 * is worth having where OSM has no stop mapped — but it names a row in a
 * feed, not a place in the world.
 *
 * null when neither is present: the label draws, and does not pretend to
 * be a link.
 */
export function stopTargetFor(props: any): StopTarget | null {
  // The merged label is the whole interchange; one corridor's marker is not.
  // Present only when true, so a plain station's target stays exactly what it
  // has always been.
  const complex =
    props?.ftype === 'station' && Number(props?.nmarkers ?? 0) > 1
      ? { complex: true as const }
      : {}

  const osm = String(props?.osm ?? '')
  const slash = osm.indexOf('/')
  if (slash > 0 && slash < osm.length - 1) {
    return { kind: 'osm', type: osm.slice(0, slash), id: osm.slice(slash + 1), ...complex }
  }
  // a merged complex can carry several pairs; the tiler orders them by
  // importance, so the first is the one to open
  const pairs = parseGtfsIds(props?.gtfs_ids)
  return pairs.length ? { kind: 'transitland', stopKey: pairs[0].stopKey, ...complex } : null
}
