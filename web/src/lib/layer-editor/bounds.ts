/**
 * Where a layer's data actually is.
 *
 * A layer you have just pasted a URL for is almost never under the camera —
 * a council's aerial imagery covers one city, a GeoJSON of trailheads covers
 * one valley — so the editor flies to it the first time the data resolves.
 * That only works if we can find out where "it" is, which depends on how the
 * source is addressed:
 *
 *   - inline GeoJSON      → measure it
 *   - GeoJSON by URL      → fetch it, then measure it
 *   - an image overlay    → its four corner coordinates
 *   - TileJSON            → the document's own `bounds`
 *   - bare tile templates → nothing to go on; the camera stays put
 *
 * Everything here is best-effort: a source that won't resolve returns null
 * and the map simply doesn't move.
 */

import * as turf from '@turf/turf'
import { draftToSourceSpec, type SourceDraft } from './draft'

export interface LayerBounds {
  minLng: number
  minLat: number
  maxLng: number
  maxLat: number
}

/**
 * Bounds spanning most of the planet tell us nothing and would yank the
 * camera out to the globe, so they're treated as "unknown".
 */
const WORLD_SPAN_DEGREES = 340

function fromBbox(bbox: number[] | undefined | null): LayerBounds | null {
  if (!bbox || bbox.length < 4) return null
  const [minLng, minLat, maxLng, maxLat] = bbox
  if (![minLng, minLat, maxLng, maxLat].every(Number.isFinite)) return null
  if (maxLng - minLng >= WORLD_SPAN_DEGREES) return null
  // A zero-area bbox is a single point — valid, and `fitBounds` handles it.
  return { minLng, minLat, maxLng, maxLat }
}

function boundsOfGeoJson(document: unknown): LayerBounds | null {
  try {
    return fromBbox(turf.bbox(document as never) as number[])
  } catch {
    return null
  }
}

async function fetchJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`${response.status}`)
  return await response.json()
}

/**
 * The area a style-spec source covers, or null when it can't be determined.
 * Never throws — the caller only wants to know whether to move the camera.
 *
 * Takes the spec rather than the editor's draft so canvas layers, which store
 * a finished spec, can use the same path.
 */
export async function resolveSpecBounds(
  spec: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<LayerBounds | null> {
  // An explicit `bounds` wins: it's what the author declared, and TileJSON
  // fields are frequently copied onto the source itself.
  const declared = fromBbox(spec.bounds as number[] | undefined)
  if (declared) return declared

  try {
    if (spec.type === 'geojson') {
      const data = spec.data
      if (typeof data === 'string') {
        return data.trim() ? boundsOfGeoJson(await fetchJson(data, signal)) : null
      }
      return data ? boundsOfGeoJson(data) : null
    }

    if (spec.type === 'image') {
      const corners = spec.coordinates as number[][] | undefined
      if (!corners?.length) return null
      return fromBbox(turf.bbox(turf.points(corners) as never) as number[])
    }

    // Tiled sources only know where they are if they came with a TileJSON.
    // Bare `{z}/{x}/{y}` templates say nothing, and that's fine.
    if (typeof spec.url === 'string' && spec.url.trim()) {
      const tilejson = (await fetchJson(spec.url, signal)) as { bounds?: number[] }
      return fromBbox(tilejson?.bounds)
    }
  } catch {
    // Unreachable URL, CORS, malformed document — all just mean "don't move".
    return null
  }

  return null
}

/** The same, for a draft in the editor. */
export function resolveSourceBounds(
  source: SourceDraft,
  signal?: AbortSignal,
): Promise<LayerBounds | null> {
  return resolveSpecBounds(draftToSourceSpec(source), signal)
}

/**
 * A stable key for "the data this source points at".
 *
 * Changing a colour shouldn't re-fly the camera; changing the URL should. The
 * key deliberately ignores everything that only affects how the data is drawn.
 */
export function sourceDataKey(source: SourceDraft): string {
  return JSON.stringify([
    source.kind,
    source.mode,
    source.url.trim(),
    source.tiles.map(t => t.trim()).filter(Boolean),
    source.data.trim(),
    source.coordinates,
  ])
}
