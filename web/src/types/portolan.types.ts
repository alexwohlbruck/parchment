/**
 * Portolan transit tile types.
 *
 * Portolan is the pipeline that charts GTFS feeds into schematic transit
 * ribbons and cuts them into MVT pyramids. Barrelman serves those pyramids
 * at /tiles/portolan/*, which parchment reaches through the server proxy
 * (/proxy/portolan/*). Schemas mirror the portolan atlas so a server change
 * breaks typecheck rather than a screen:
 *   portolan/web/src/lib/api.ts (TilesIndexEntry, TileJSON, StyleSet)
 *   portolan/internal/atlas/atlas.go (index.json writer)
 *   portolan/internal/pipeline/pipeline.go ~889 (ribbon props)
 *   portolan/internal/pipeline/stations.go ~1114 (symbol props)
 */

/** One row of /tiles/portolan/index.json — every feed with a cut pyramid.
 *  Bounds and maxzoom ride along so every vector source can be built from
 *  the index alone, without touching each feed's tiles.json. */
export interface PortolanIndexEntry {
  feed: string
  name?: string
  bounds?: number[] // [w,s,e,n]
  maxzoom: number
}

/** TileJSON for one feed pyramid (served next to the tiles). The client
 *  builds tile URLs from the index instead ({z}/{x}/{y}.mvt is fixed), so
 *  this is informational. */
export interface PortolanTileJSON {
  tilejson?: string
  name?: string
  tiles: string[]
  minzoom: number
  maxzoom: number
  bounds?: number[]
  vector_layers?: { id: string; minzoom?: number; maxzoom?: number }[]
}

/** Per-class render style from the feed's resolved style manifest
 *  (<out>.style.json, served next to the pyramid). Colors ride inline in
 *  the tiles; the manifest carries width/opacity multipliers per class. */
export interface PortolanModeStyle {
  color?: string
  width: number
  opacity: number
  band_floor?: number
  trunk?: string
  hidden?: boolean
}

export interface PortolanStyleSet {
  modes: Record<string, PortolanModeStyle>
  colors?: Record<string, string>
  names?: Record<string, string>
  caterpillars?: boolean
  osm_stop_names?: boolean
}

/** Portolan's mode classes, in display order. The follow-up UI groups
 *  these as rail/bus/ferry/other; the renderer filters per class. */
export const PORTOLAN_CLASSES = [
  'metro',
  'tram',
  'regional',
  'monorail',
  'funicular',
  'cable',
  'aerial',
  'ferry',
  'bus',
] as const
export type PortolanClass = (typeof PORTOLAN_CLASSES)[number]

/** Ribbon feature properties (vector layer `ribbons`, z0..max). */
export interface PortolanRibbonProps {
  seg: string
  /** steady: fixed slot offset; transition: eased between forks;
   *  bridge: pipeline bookkeeping, renders exactly like steady. */
  kind: 'steady' | 'transition' | 'bridge'
  color: string
  route_color: string // hex without '#'
  routes: string // CSV of member route ids
  label: string
  route_type: number
  mode: PortolanClass | string
  slot: number
  nslots: number
  /** steady/bridge: the slot offset in px (off_from/off_to are 0) */
  offset_px: number
  /** transition: ease endpoints over line-progress (offset_px is 0) */
  off_from_px: number
  off_to_px: number
  /** zoom band this copy belongs to — exactly one band draws per zoom */
  band_min: number
  band_max: number
  len_m: number
  /** per-route weekly activity: semicolon-joined 42-hex-char masks
   *  aligned with `routes` (7 days x 6 digits, Monday first) */
  acts?: string
}

/** Station label features (vector layer `stations`, z>=11). Aligned CSVs:
 *  routes[i] <-> labels[i] <-> route_colors[i] <-> modes[i] <-> shapes[i],
 *  acts semicolon-joined at the same index. */
export interface PortolanStationProps {
  ftype: 'station'
  name: string
  routes: string
  labels: string
  route_colors: string
  modes: string
  shapes?: string
  acts?: string
  imp?: number
  rank?: number
  nmarkers?: number
}

/** Marker (dot/pill) features (vector layer `markers`, z>=11). */
export interface PortolanMarkerProps {
  ftype: 'marker'
  name?: string
  routes: string
  labels?: string
  route_colors?: string
  modes?: string
  shapes?: string
  acts?: string
  /** "hex@off;hex@off…" — one dot per stopping line at its slot offset */
  dots?: string
  /** lines fill the whole bundle: a white pill spanning span_px instead */
  span_px?: number
  bearing?: number
  nmarkers?: number
  imp?: number
  rank?: number
}

/** Caterpillar bullet features (vector layer `cat`, z>=12): inline route
 *  bullets riding the ribbons. vec/veclo are JSON-encoded [x,y] px anchor
 *  offsets (MVT values are scalar, so the tiler ships them as text). */
export interface PortolanCatProps {
  ftype: 'cat'
  route: string
  mode: string
  label: string
  hex: string
  shape?: string
  band: number
  /** true: a word label set along the ribbon instead of a bullet */
  text?: boolean
  ang?: number
  vec: string | [number, number]
  veclo: string | [number, number]
  acts?: string
}
