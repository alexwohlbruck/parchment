/**
 * The editable shape of a custom layer, and the conversions either side of it.
 *
 * A `Layer` stores its map-engine configuration as one loose object: the
 * layer's own keys (`id`, `type`, `paint`, `layout`, `filter`, …) with the
 * source either inlined or named by id. That's the right thing to persist and
 * the wrong thing to bind a form to, so the editor works on a `LayerDraft`:
 * the pieces it has controls for, pulled apart, plus an `extra` bag holding
 * everything it doesn't understand so a round-trip never loses keys.
 *
 * Pure by design — no Vue, no store, no map. The editor components stay thin
 * because the rules live here and are unit-tested directly.
 */

import { MapEngine, SourceType, type Layer } from '@/types/map.types'
import {
  LAYER_KINDS_BY_SOURCE,
  requiresSourceLayer,
  type StyleLayerKind,
  type StyleSourceKind,
} from './spec'

/** How a source is addressed. Which modes are valid depends on the kind. */
export type SourceMode = 'tilejson' | 'tiles' | 'url' | 'inline'

export interface SourceDraft {
  id: string
  kind: StyleSourceKind
  mode: SourceMode
  /** TileJSON / GeoJSON / image URL, depending on `kind` + `mode`. */
  url: string
  /** Tile URL templates, for `mode: 'tiles'`. */
  tiles: string[]
  tileSize?: number
  minzoom?: number
  maxzoom?: number
  attribution?: string
  scheme?: 'xyz' | 'tms'
  /** raster-dem only. */
  encoding?: 'mapbox' | 'terrarium'
  /** GeoJSON pasted straight in, as text so the editor can show parse errors. */
  data: string
  /** GeoJSON clustering. */
  cluster?: boolean
  /** Image source corner coordinates, clockwise from top-left. */
  coordinates?: [number, number][]
  /** Source keys we have no control for. Preserved verbatim. */
  extra: Record<string, unknown>
}

export interface LayerDraft {
  /** Library metadata. */
  name: string
  icon: string | null
  showInLayerSelector: boolean
  fadeBasemap: boolean
  visible: boolean
  engines: MapEngine[]

  /** Style layer. */
  layerId: string
  kind: StyleLayerKind
  sourceLayer: string
  minzoom?: number
  maxzoom?: number
  filter?: unknown
  paint: Record<string, unknown>
  layout: Record<string, unknown>
  /** Layer keys we have no control for (`slot`, `metadata`, …). */
  extra: Record<string, unknown>

  source: SourceDraft
}

/** Layer keys the draft models explicitly; everything else lands in `extra`. */
const MODELLED_LAYER_KEYS = new Set([
  'id',
  'type',
  'source',
  'source-layer',
  'minzoom',
  'maxzoom',
  'filter',
  'paint',
  'layout',
])

const MODELLED_SOURCE_KEYS = new Set([
  'id',
  'type',
  'url',
  'tiles',
  'tileSize',
  'minzoom',
  'maxzoom',
  'attribution',
  'scheme',
  'encoding',
  'data',
  'cluster',
  'coordinates',
])

/** Valid modes for each source kind, most common first. */
export const SOURCE_MODES: Record<StyleSourceKind, readonly SourceMode[]> = {
  raster: ['tiles', 'tilejson'],
  'raster-dem': ['tiles', 'tilejson'],
  vector: ['tilejson', 'tiles'],
  geojson: ['url', 'inline'],
  image: ['url'],
}

/** A URL-safe slug, so generated ids read like the layer they belong to. */
export function slugify(input: string, fallback: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return slug || fallback
}

function emptySource(kind: StyleSourceKind): SourceDraft {
  return {
    id: '',
    kind,
    mode: SOURCE_MODES[kind][0],
    url: '',
    tiles: [''],
    data: '',
    extra: {},
    ...(kind === 'raster' ? { tileSize: 256 } : {}),
    ...(kind === 'raster-dem' ? { encoding: 'mapbox' as const } : {}),
  }
}

/** A fresh draft for "new layer", pre-filled with something that renders. */
export function createLayerDraft(
  kind: StyleSourceKind = 'raster',
): LayerDraft {
  const layerKind = LAYER_KINDS_BY_SOURCE[kind][0]
  return {
    name: '',
    icon: null,
    showInLayerSelector: true,
    fadeBasemap: false,
    visible: true,
    engines: [MapEngine.MAPBOX, MapEngine.MAPLIBRE],
    layerId: '',
    kind: layerKind,
    sourceLayer: '',
    paint: {},
    layout: {},
    extra: {},
    source: emptySource(kind),
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {}
}

/** Split an object into the keys we model and the ones we merely carry. */
function partition(
  source: Record<string, unknown>,
  modelled: Set<string>,
): Record<string, unknown> {
  const extra: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(source)) {
    if (!modelled.has(key)) extra[key] = value
  }
  return extra
}

function sourceFromConfiguration(raw: unknown): SourceDraft {
  const object = asRecord(raw)
  const kind = (object.type as StyleSourceKind) ?? 'raster'
  const base = emptySource(
    (['raster', 'raster-dem', 'vector', 'geojson', 'image'] as string[]).includes(
      kind,
    )
      ? kind
      : 'raster',
  )

  const tiles = Array.isArray(object.tiles)
    ? (object.tiles as string[]).filter(t => typeof t === 'string')
    : []

  // GeoJSON `data` is a URL when it's a string and an inline document
  // otherwise — the spec overloads one key for both.
  const geojsonUrl = typeof object.data === 'string' ? object.data : ''
  const geojsonInline =
    object.data && typeof object.data === 'object'
      ? JSON.stringify(object.data, null, 2)
      : ''

  const mode: SourceMode =
    base.kind === 'geojson'
      ? geojsonInline
        ? 'inline'
        : 'url'
      : base.kind === 'image'
        ? 'url'
        : tiles.length
          ? 'tiles'
          : object.url
            ? 'tilejson'
            : base.mode

  return {
    ...base,
    id: typeof object.id === 'string' ? object.id : '',
    mode,
    url:
      base.kind === 'geojson'
        ? geojsonUrl
        : typeof object.url === 'string'
          ? object.url
          : '',
    tiles: tiles.length ? tiles : [''],
    tileSize: typeof object.tileSize === 'number' ? object.tileSize : base.tileSize,
    minzoom: typeof object.minzoom === 'number' ? object.minzoom : undefined,
    maxzoom: typeof object.maxzoom === 'number' ? object.maxzoom : undefined,
    attribution:
      typeof object.attribution === 'string' ? object.attribution : undefined,
    scheme: object.scheme === 'tms' ? 'tms' : undefined,
    encoding:
      object.encoding === 'terrarium'
        ? 'terrarium'
        : base.kind === 'raster-dem'
          ? 'mapbox'
          : undefined,
    data: geojsonInline,
    cluster: object.cluster === true ? true : undefined,
    coordinates: Array.isArray(object.coordinates)
      ? (object.coordinates as [number, number][])
      : undefined,
    extra: partition(object, MODELLED_SOURCE_KEYS),
  }
}

/** Read an existing layer into an editable draft. */
export function layerToDraft(layer: Layer): LayerDraft {
  const configuration = asRecord(layer.configuration)
  const kind = (configuration.type as StyleLayerKind) ?? 'raster'

  return {
    name: layer.name ?? '',
    icon: layer.icon ?? null,
    showInLayerSelector: layer.showInLayerSelector ?? true,
    fadeBasemap: layer.fadeBasemap ?? false,
    visible: layer.visible ?? true,
    engines: layer.engine?.length
      ? [...layer.engine]
      : [MapEngine.MAPBOX, MapEngine.MAPLIBRE],
    layerId: typeof configuration.id === 'string' ? configuration.id : '',
    kind,
    sourceLayer:
      typeof configuration['source-layer'] === 'string'
        ? (configuration['source-layer'] as string)
        : '',
    minzoom:
      typeof configuration.minzoom === 'number' ? configuration.minzoom : undefined,
    maxzoom:
      typeof configuration.maxzoom === 'number' ? configuration.maxzoom : undefined,
    filter: configuration.filter,
    paint: asRecord(configuration.paint),
    layout: asRecord(configuration.layout),
    extra: partition(configuration, MODELLED_LAYER_KEYS),
    source: sourceFromConfiguration(configuration.source),
  }
}

/** The source object as the style spec wants it, `id` included. */
export function draftToSourceSpec(
  draft: SourceDraft,
): Record<string, unknown> {
  const spec: Record<string, unknown> = {
    ...draft.extra,
    id: draft.id,
    type: draft.kind,
  }

  if (draft.kind === 'geojson') {
    if (draft.mode === 'inline') {
      // Callers validate first; an unparseable document becomes an empty
      // collection rather than throwing mid-render.
      spec.data = parseGeoJson(draft.data) ?? {
        type: 'FeatureCollection',
        features: [],
      }
    } else {
      spec.data = draft.url
    }
    if (draft.cluster) spec.cluster = true
  } else if (draft.kind === 'image') {
    spec.url = draft.url
    if (draft.coordinates) spec.coordinates = draft.coordinates
  } else if (draft.mode === 'tilejson') {
    spec.url = draft.url
  } else {
    spec.tiles = draft.tiles.map(t => t.trim()).filter(Boolean)
  }

  if (draft.kind === 'raster' && draft.tileSize) spec.tileSize = draft.tileSize
  if (draft.kind === 'raster-dem' && draft.encoding) {
    spec.encoding = draft.encoding
  }
  if (draft.minzoom !== undefined) spec.minzoom = draft.minzoom
  if (draft.maxzoom !== undefined) spec.maxzoom = draft.maxzoom
  if (draft.attribution) spec.attribution = draft.attribution
  if (draft.scheme === 'tms') spec.scheme = 'tms'

  return spec
}

/** Collapse a draft back into a `Layer['configuration']`. */
export function draftToConfiguration(
  draft: LayerDraft,
): Layer['configuration'] {
  const configuration: Record<string, unknown> = {
    ...draft.extra,
    id: draft.layerId,
    type: draft.kind,
    source: draftToSourceSpec(draft.source),
  }

  if (requiresSourceLayer(draft.source.kind) && draft.sourceLayer) {
    configuration['source-layer'] = draft.sourceLayer
  }
  if (draft.minzoom !== undefined) configuration.minzoom = draft.minzoom
  if (draft.maxzoom !== undefined) configuration.maxzoom = draft.maxzoom
  if (draft.filter !== undefined) configuration.filter = draft.filter
  if (Object.keys(draft.paint).length) configuration.paint = { ...draft.paint }
  if (Object.keys(draft.layout).length) {
    configuration.layout = { ...draft.layout }
  }

  return configuration as Layer['configuration']
}

/** The library fields of a draft, ready for the layers store. */
export function draftToLayerFields(draft: LayerDraft) {
  return {
    name: draft.name.trim(),
    icon: draft.icon,
    showInLayerSelector: draft.showInLayerSelector,
    fadeBasemap: draft.fadeBasemap,
    visible: draft.visible,
    engine: [...draft.engines],
    configuration: draftToConfiguration(draft),
  }
}

/** Fill in ids the user never has to think about, derived from the name. */
export function withGeneratedIds(draft: LayerDraft, seed: string): LayerDraft {
  const slug = slugify(draft.name, seed)
  return {
    ...draft,
    layerId: draft.layerId || slug,
    source: {
      ...draft.source,
      id: draft.source.id || `${slug}-source`,
    },
  }
}

// ── Validation ───────────────────────────────────────────────────────────────

export interface DraftIssue {
  field: string
  /** i18n key under `layers.editor.errors`. */
  message: string
}

const TILE_TEMPLATE = /\{z\}/i

export function parseGeoJson(text: string): unknown | null {
  if (!text.trim()) return null
  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

/**
 * Everything that would stop the layer rendering. Ordered so the first issue
 * is the one worth jumping the user to.
 */
export function validateDraft(draft: LayerDraft): DraftIssue[] {
  const issues: DraftIssue[] = []
  const { source } = draft

  if (!draft.name.trim()) issues.push({ field: 'name', message: 'nameRequired' })

  if (source.kind === 'geojson') {
    if (source.mode === 'inline') {
      if (!parseGeoJson(source.data)) {
        issues.push({ field: 'source.data', message: 'invalidGeoJson' })
      }
    } else if (!source.url.trim()) {
      issues.push({ field: 'source.url', message: 'urlRequired' })
    }
  } else if (source.kind === 'image') {
    if (!source.url.trim()) {
      issues.push({ field: 'source.url', message: 'urlRequired' })
    }
    if (!source.coordinates || source.coordinates.length !== 4) {
      issues.push({ field: 'source.coordinates', message: 'cornersRequired' })
    }
  } else if (source.mode === 'tilejson') {
    if (!source.url.trim()) {
      issues.push({ field: 'source.url', message: 'urlRequired' })
    }
  } else {
    const tiles = source.tiles.map(t => t.trim()).filter(Boolean)
    if (!tiles.length) {
      issues.push({ field: 'source.tiles', message: 'tilesRequired' })
    } else if (!tiles.every(t => TILE_TEMPLATE.test(t))) {
      issues.push({ field: 'source.tiles', message: 'tileTemplate' })
    }
  }

  if (requiresSourceLayer(source.kind) && !draft.sourceLayer.trim()) {
    issues.push({ field: 'sourceLayer', message: 'sourceLayerRequired' })
  }

  if (
    draft.minzoom !== undefined &&
    draft.maxzoom !== undefined &&
    draft.minzoom > draft.maxzoom
  ) {
    issues.push({ field: 'minzoom', message: 'zoomRange' })
  }

  return issues
}

/** The `SourceType` enum value matching a draft's source kind. */
export function sourceTypeOf(kind: StyleSourceKind): SourceType {
  return kind as unknown as SourceType
}
