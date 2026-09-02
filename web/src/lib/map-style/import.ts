/**
 * Importing layers from a Mapbox Studio / Maputnik style.
 *
 * Those tools export a whole style document — sources, layers, sprite, glyphs.
 * A Parchment layer is one style layer plus the source it draws from, so an
 * import is really a pick: show what's in the document, let the user choose,
 * and stitch each chosen layer back together with its source inlined.
 *
 * A few things travel badly between styles, and it's kinder to say so up front
 * than to add a layer that renders nothing:
 *   - `mapbox://` source URLs need a Mapbox token the app may not be using.
 *   - Sprite images (`icon-image`, `*-pattern`) come from the origin style's
 *     sprite sheet, which does not come with the layer.
 *   - Fonts in `text-font` must exist in the basemap's glyph set.
 */

import { layerToDraft, type LayerDraft } from './draft'
import { STYLE_LAYER_KINDS, type StyleLayerKind } from './spec'
import type { Layer } from '@/types/map.types'

export type ImportWarning =
  | 'mapboxProtocol'
  | 'spriteImage'
  | 'customFont'
  | 'missingSource'
  | 'unsupportedType'

export interface ImportCandidate {
  /** The style layer's own id, used as the list key. */
  id: string
  name: string
  kind: string
  /** False when we can't build a usable layer from it. */
  importable: boolean
  warnings: ImportWarning[]
  /** The stitched configuration, source inlined. */
  configuration: Record<string, unknown>
}

export interface ParsedStyle {
  /** The style's own name, offered as a group name on bulk import. */
  name?: string
  candidates: ImportCandidate[]
  /** Set when the input was a bare layer object rather than a whole style. */
  singleLayer: boolean
}

export class StyleParseError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function usesMapboxProtocol(source: Record<string, unknown>): boolean {
  const url = typeof source.url === 'string' ? source.url : ''
  const tiles = Array.isArray(source.tiles) ? (source.tiles as string[]) : []
  return (
    url.startsWith('mapbox://') || tiles.some(t => t?.startsWith?.('mapbox://'))
  )
}

function collectWarnings(
  layer: Record<string, unknown>,
  source: Record<string, unknown> | null,
): ImportWarning[] {
  const warnings: ImportWarning[] = []
  if (!source) warnings.push('missingSource')
  else if (usesMapboxProtocol(source)) warnings.push('mapboxProtocol')

  const layout = isRecord(layer.layout) ? layer.layout : {}
  const paint = isRecord(layer.paint) ? layer.paint : {}

  if (
    layout['icon-image'] !== undefined ||
    Object.keys(paint).some(k => k.endsWith('-pattern'))
  ) {
    warnings.push('spriteImage')
  }
  if (layout['text-font'] !== undefined) warnings.push('customFont')

  if (!STYLE_LAYER_KINDS.includes(layer.type as StyleLayerKind)) {
    warnings.push('unsupportedType')
  }

  return warnings
}

function buildCandidate(
  layer: Record<string, unknown>,
  sources: Record<string, unknown>,
): ImportCandidate {
  const sourceId = typeof layer.source === 'string' ? layer.source : ''
  const rawSource = sourceId ? sources[sourceId] : null
  const source = isRecord(rawSource) ? rawSource : null
  const warnings = collectWarnings(layer, source)

  const configuration: Record<string, unknown> = { ...layer }
  if (source) {
    configuration.source = { ...source, id: sourceId }
  } else {
    delete configuration.source
  }

  return {
    id: String(layer.id ?? sourceId ?? 'layer'),
    // Style layer ids are already human-ish ("water-shadow", "road-label"),
    // so they make a better default name than anything we could invent.
    name: String(layer.id ?? 'Imported layer'),
    kind: String(layer.type ?? 'unknown'),
    importable: !!source && !warnings.includes('unsupportedType'),
    warnings,
    configuration,
  }
}

/**
 * Parse a pasted style document (or a single layer object) into candidates.
 * Throws `StyleParseError` with an i18n key for anything unusable.
 */
export function parseStyleDocument(text: string): ParsedStyle {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new StyleParseError('invalidJson')
  }
  if (!isRecord(parsed)) throw new StyleParseError('invalidJson')

  // A whole style: { version, sources, layers }.
  if (Array.isArray(parsed.layers)) {
    const sources = isRecord(parsed.sources) ? parsed.sources : {}
    const candidates = parsed.layers
      .filter(isRecord)
      // Background layers carry no source and nothing worth importing on
      // their own; they'd just paint over the basemap.
      .filter(layer => layer.type !== 'background')
      .map(layer => buildCandidate(layer, sources))

    if (!candidates.length) throw new StyleParseError('noLayers')
    return {
      name: typeof parsed.name === 'string' ? parsed.name : undefined,
      candidates,
      singleLayer: false,
    }
  }

  // A single layer object, pasted on its own.
  if (typeof parsed.type === 'string') {
    return {
      candidates: [buildCandidate(parsed, {})],
      singleLayer: true,
    }
  }

  throw new StyleParseError('notAStyle')
}

/** Turn a chosen candidate into an editable draft. */
export function candidateToDraft(candidate: ImportCandidate): LayerDraft {
  const draft = layerToDraft({
    name: candidate.name,
    configuration: candidate.configuration,
  } as unknown as Layer)
  // Keep the style's own layer id — filters and `source-layer` in the
  // imported JSON are written against it.
  draft.layerId = candidate.id
  return draft
}
