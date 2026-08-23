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
  /** Doodle only: how thick the stroke is drawn, in pixels. */
  width?: number
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

export interface CanvasBody {
  layers: CanvasLayer[]
  /** Pins, lines and shapes drawn straight onto the canvas. */
  annotations?: CanvasAnnotation[]
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
