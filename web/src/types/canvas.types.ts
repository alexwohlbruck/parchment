/**
 * Canvases — user-built maps (client types).
 *
 * `scheme` governs the whole record. A `server-key` canvas stores its name and
 * layer stack in cleartext columns, so it can be made on a device with no
 * identity key and shared by link later; a `user-e2ee` canvas stores both in
 * envelopes only the owner's devices can open. Whichever side is in use, the
 * client works with the same shape — `name`, `description`, `body` — and the
 * service decides what actually goes on the wire.
 *
 * A canvas is an ordered stack of layers, drawn bottom-first. The union below
 * is the extension point: every kind of thing a canvas can hold is one arm of
 * it, and the renderer, the editor and the storage layer all switch on `kind`.
 */

import type { FeatureCollection, Position } from 'geojson'
import type { MapEngine } from '@/types/map.types'
import { MARKER_PLATE_SIZE } from '@/lib/map-marker/marker-metrics.mjs'
import type { MarkerShape } from '@/lib/map-marker/marker-shape'

export type CanvasScheme = 'server-key' | 'user-e2ee'

/** A style layer authored in the layer editor. Its source is inlined. */
export interface CanvasStyleLayer {
  id: string
  kind: 'style'
  name: string
  icon?: string | null
  visible: boolean
  configuration: Record<string, unknown>
  engine?: MapEngine[]
}

/** A layer borrowed from the user's library, by id. */
export interface CanvasLibraryLayer {
  id: string
  kind: 'library'
  /** A user layer's id, or a default-template id like `default:hillshade`. */
  layerId: string
  visible: boolean
}

/**
 * A saved place collection drawn as points. Only the collection id lives on
 * the canvas — the places stay under the collection's own encryption, so a
 * server-key canvas never leaks an e2ee collection's contents.
 */
export interface CanvasCollectionLayer {
  id: string
  kind: 'collection'
  collectionId: string
  visible: boolean
  icon?: string | null
  iconColor?: string | null
}

/**
 * How a data layer draws. One imported file can reasonably be points, a
 * heatmap of the same points, or shapes — so the renderer is a property of
 * the layer rather than baked into the data when it lands.
 */
export type CanvasDataRender = 'points' | 'lines' | 'shapes' | 'heatmap'

export interface CanvasDataStyle {
  /** A CSS colour. Applied to fills, strokes and dots alike. */
  color?: string
  /** Circle radius / line width / heatmap radius, depending on `render`. */
  size?: number
  opacity?: number
  /** Feature property to label each feature with. Points only. */
  labelProperty?: string | null
}

/** Where a data layer's features came from, for the row's subtitle. */
export interface CanvasDataOrigin {
  format: 'geojson' | 'kml' | 'gpx' | 'csv' | 'drawn'
  filename?: string
}

/**
 * Geometry the user brought or drew, held inline on the canvas.
 *
 * There is no file store: an imported KML becomes GeoJSON in the canvas
 * document, which is what lets a private canvas hold imported data without
 * the server ever seeing it. It also caps how much you can import — see
 * `MAX_IMPORT_BYTES` in `lib/geo-import`.
 */
export interface CanvasDataLayer {
  id: string
  kind: 'data'
  name: string
  visible: boolean
  render: CanvasDataRender
  /**
   * Inline features. Empty when `url` is set — a curated dataset can be tens
   * of megabytes, and a canvas is saved whole.
   */
  data: FeatureCollection
  /** Fetched by the map instead of being inlined. */
  url?: string
  origin?: CanvasDataOrigin
  style?: CanvasDataStyle
}

/** A saved route, drawn as its path. */
export interface CanvasRouteLayer {
  id: string
  kind: 'route'
  routeId: string
  visible: boolean
  color?: string | null
}

/**
 * Friends' live positions on this canvas.
 *
 * Positions are never stored on the canvas — they are read live from the
 * friends store, which decrypts them per device. The layer only records whose
 * positions to draw, and an empty list means everyone sharing with you.
 */
export interface CanvasPeopleLayer {
  id: string
  kind: 'people'
  visible: boolean
  friendHandles?: string[]
}

export type CanvasLayer =
  | CanvasStyleLayer
  | CanvasLibraryLayer
  | CanvasCollectionLayer
  | CanvasDataLayer
  | CanvasRouteLayer
  | CanvasPeopleLayer

export type CanvasLayerKind = CanvasLayer['kind']

export interface CanvasCamera {
  center: [number, number]
  zoom: number
  bearing?: number
  pitch?: number
}

/**
 * The drawing tools. Annotations are not layers: marking up a map is the
 * quickest thing you do on a canvas, and making you create a layer first put
 * a piece of filing between you and a pin. They live in their own bucket and
 * always draw above the layers.
 */
export type AnnotationTool =
  | 'pin'
  | 'line'
  | 'route'
  | 'polygon'
  | 'rectangle'
  | 'circle'
  | 'isochrone'
  | 'doodle'

/**
 * Everything the toolbar can arm.
 *
 * The eraser is a tool you hold but not a kind of mark: it makes nothing, so
 * it is no part of `AnnotationTool` — nothing keyed by that (what a tool
 * draws, how many clicks it needs, what it can be styled with) has an answer
 * for it.
 */
export type CanvasTool = AnnotationTool | 'erase'

/**
 * Dash patterns a mark's outline can take.
 *
 * Not data-driven in either engine — `line-dasharray` is one of the few paint
 * properties that cannot read a feature — so each style is drawn by its own
 * layer. Keeping the list short keeps that cost to three layers.
 */
export const ANNOTATION_STROKE_STYLES = ['solid', 'dashed', 'dotted'] as const

export type AnnotationStrokeStyle = (typeof ANNOTATION_STROKE_STYLES)[number]

/**
 * How a stroke ends. The names are the engines' own (`line-cap`), and both
 * read it off the feature, so unlike a dash pattern this costs no extra
 * layer.
 */
export const ANNOTATION_STROKE_CAPS = ['round', 'butt', 'square'] as const

export type AnnotationStrokeCap = (typeof ANNOTATION_STROKE_CAPS)[number]

/** What a mark is drawn as when it has not been told otherwise. */
export const ANNOTATION_STYLE_DEFAULTS = {
  strokeWidth: 3,
  strokeOpacity: 1,
  strokeStyle: 'solid' as AnnotationStrokeStyle,
  strokeCap: 'round' as AnnotationStrokeCap,
  fillOpacity: 0.18,
  markerSize: MARKER_PLATE_SIZE / 2,
  markerShape: 'disc' as MarkerShape,
  labelSize: 12,
} as const

export const ANNOTATION_LABEL_POSITIONS = [
  'top',
  'bottom',
  'left',
  'right',
  'center',
] as const

export type AnnotationLabelPosition =
  (typeof ANNOTATION_LABEL_POSITIONS)[number]

export interface CanvasAnnotation {
  id: string
  tool: AnnotationTool
  /**
   * The positions the user clicked, in order. Geometry is derived from these
   * at render time rather than stored — it keeps the document small, and it
   * leaves a rectangle still a rectangle if we ever let one be reshaped.
   */
  positions: Position[]
  /** Circle only: metres from `positions[0]`. */
  radiusMeters?: number
  /**
   * Route only: the path the routing engine snapped through `positions`.
   * Kept alongside the waypoints rather than replacing them, so the route can
   * be re-snapped in another travel mode without losing what was clicked.
   */
  routed?: {
    geometry: Position[]
    mode: 'walking' | 'cycling' | 'driving'
    distance?: number
    duration?: number
  }
  /**
   * Isochrone only: the reachable area the engine returned for the origin in
   * `positions[0]`. Kept alongside the origin rather than replacing it, so
   * the shape can be asked for again in another mode or reach.
   */
  isochrone?: {
    /** Polygon rings — outer first, holes after. */
    geometry: Position[][]
    mode: string
    minutes: number
  }
  label?: string
  /**
   * Where the label sits relative to the mark. Naming a shape and placing
   * that name on the map are different decisions — a label below a pin
   * covers the thing you dropped it on as often as not.
   */
  labelPosition?: AnnotationLabelPosition
  /** One of the app's colour names, or a CSS colour for anything custom. */
  color?: string
  /**
   * How the mark is drawn, over and above its colour. Every field is
   * optional and falls back to `ANNOTATION_STYLE_DEFAULTS`, so a mark made
   * before any of this existed still draws exactly as it did.
   */
  strokeWidth?: number
  strokeOpacity?: number
  strokeStyle?: AnnotationStrokeStyle
  /** Open shapes only: how the ends of the stroke are finished. */
  strokeCap?: AnnotationStrokeCap
  /** Areas only. Defaults to the mark's own colour. */
  fillColor?: string
  fillOpacity?: number
  /** Pins only: the plate's radius, in pixels. */
  markerSize?: number
  /**
   * Pins only: which of the app's marker shapes the pin wears.
   *
   * A disc says "a place is here"; a square says "this is a station", which is
   * the distinction the basemap already draws between a shop and a transit
   * stop; a bare glyph is the quiet one, for a canvas already carrying a lot.
   * See `lib/map-marker`.
   */
  markerShape?: MarkerShape
  labelSize?: number
  /**
   * Pin only: the glyph drawn in the marker. A lucide icon name, or absent
   * for a plain dot.
   */
  icon?: string | null
  /**
   * Whether the label is drawn on the map. Separate from having one: naming a
   * shape so you can find it in the list is a different act from labelling it
   * for a reader, and conflating them means every named thing shouts.
   */
  labelVisible?: boolean
  visible?: boolean
}

/**
 * The map appearance a canvas asks for while it is open.
 *
 * A canvas is a composed view: a hiking map wants terrain and no transit
 * labels, a transit map wants the opposite, and neither should mean changing
 * the settings you keep for everything else. These override the app's own
 * while the canvas is being looked at, and are handed back on the way out.
 */
export interface CanvasMapSettings {
  objects3d: boolean
  terrain3d: boolean
  hdRoads: boolean
  indoorMaps: boolean
  poiLabels: boolean
  roadLabels: boolean
  transitLabels: boolean
  placeLabels: boolean
}

export const CANVAS_MAP_SETTING_KEYS = [
  'objects3d',
  'terrain3d',
  'hdRoads',
  'indoorMaps',
  'poiLabels',
  'roadLabels',
  'transitLabels',
  'placeLabels',
] as const satisfies readonly (keyof CanvasMapSettings)[]

/**
 * A folder in the stack, holding layers, marks and other folders.
 *
 * Nesting is what makes a big canvas legible — a "Transit" folder with
 * "Rail" and "Bus" inside it — so `children` may name another group. The
 * stack is a tree, and `lib/canvas-stack` is the only thing that walks it.
 */
export interface CanvasGroup {
  id: string
  name: string
  /** Hides everything inside it, whatever each item says for itself. */
  visible: boolean
  /** Folded shut in the panel. Nothing to do with what draws. */
  collapsed?: boolean
  /** Ids of the layers, marks and groups inside, bottom first. */
  children: string[]
}

export interface CanvasBody {
  layers: CanvasLayer[]
  /** Pins, lines and shapes drawn straight onto the canvas. */
  annotations?: CanvasAnnotation[]
  /** Folders in the stack. Their contents live in `children`. */
  groups?: CanvasGroup[]
  /**
   * The one stack, bottom first: layer ids, mark ids and group ids
   * interleaved. Absent on a canvas saved before the two lists merged, which
   * reads as every layer and then every mark — the order they drew in then.
   */
  order?: string[]
  camera?: CanvasCamera
  /** Absent means the canvas follows whatever the app is set to. */
  mapSettings?: CanvasMapSettings
}

export interface Canvas {
  id: string
  userId: string
  scheme: CanvasScheme
  isPublic: boolean
  publicToken?: string | null
  publicRole?: 'viewer' | null

  /** Encrypted e2ee envelopes. Null for a server-key canvas. */
  metadataEncrypted?: string | null
  metadataKeyVersion?: number
  bodyEncrypted?: string | null

  createdAt: string
  updatedAt: string

  /**
   * Display fields and the layer stack. Read straight off the row for a
   * server-key canvas, decrypted into place for a user-e2ee one — so
   * everything downstream reads the same properties either way.
   */
  name?: string
  description?: string
  icon?: string | null
  iconPack?: 'lucide' | 'maki'
  iconColor?: string | null
  body?: CanvasBody | null
  /**
   * True when the metadata envelope wouldn't open — a canvas from another
   * device before the seed synced, say. Renders with a placeholder title
   * rather than disappearing.
   */
  undecryptable?: boolean
}

export interface CreateCanvasParams {
  name: string
  description?: string
  icon?: string
  iconColor?: string
  scheme?: CanvasScheme
}

/** An empty body, so callers never have to null-check the layer list. */
export function emptyCanvasBody(): CanvasBody {
  return { layers: [], annotations: [] }
}

/**
 * A detached copy of a canvas body, for the editor to mutate freely.
 *
 * JSON rather than `structuredClone`: bodies come out of a Pinia store, so
 * they arrive as Vue reactive proxies, and `structuredClone` refuses those
 * outright (DataCloneError). A body is plain JSON by construction — it has to
 * be, it round-trips through the API — so this loses nothing.
 */
export function cloneCanvasBody(body: CanvasBody | null | undefined): CanvasBody {
  if (!body) return emptyCanvasBody()
  const clone = JSON.parse(JSON.stringify(body)) as CanvasBody
  // Canvases written before annotations existed have no bucket for them.
  if (!clone.annotations) clone.annotations = []
  return clone
}
