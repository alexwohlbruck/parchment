import type { Place, PlaceBrand } from '../types/place.types'

/**
 * Resolve the brand a place belongs to from its OSM tags.
 *
 * The key mirrors the geo_brands catalog exactly: the brand:wikidata QID when
 * present (stable, language-independent), otherwise "name:<lower(brand)>". We
 * intentionally do NOT fall back to `operator` — the catalog only aggregates
 * rows carrying a `brand` tag, so an operator-based key would browse to nothing.
 *
 * Returns null when the place carries no brand. locationCount is filled later
 * from the catalog (see place.service).
 */
export function resolveBrand(place: Partial<Place>): PlaceBrand | null {
  const tags = place.tags
  if (!tags) return null

  const wikidata = tags['brand:wikidata'] || undefined
  const name = tags['brand'] || undefined
  if (!wikidata && !name) return null

  const brandKey = wikidata
    ? wikidata
    : `name:${name!.trim().toLowerCase().replace(/\s+/g, ' ')}`

  return {
    brandKey,
    name: (name ?? wikidata) as string,
    ...(wikidata ? { wikidata } : {}),
  }
}
