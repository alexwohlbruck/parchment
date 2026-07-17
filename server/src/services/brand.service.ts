import type { Place } from '../types/place.types'
import { integrationManager } from './integrations'
import {
  IntegrationCapabilityId,
  type BrandCatalogCapability,
  type BrandSummary,
  type MapBounds,
} from '../types/integration.types'
import { fetchWikidataBrandMeta } from './wikidata.service'

/** Resolve the configured brand-catalog capability (Barrelman), or null. */
function getBrandCatalog(): BrandCatalogCapability | null {
  const record = integrationManager.getConfiguredIntegrationsByCapability(
    IntegrationCapabilityId.BRAND_CATALOG,
  )[0]
  if (!record) return null
  const instance = integrationManager.getCachedIntegrationInstance(record)
  return instance?.capabilities.brandCatalog ?? null
}

/** Brand autocomplete suggestions (for blending into search). */
export async function getBrandSuggestions(
  query: string,
  limit = 5,
): Promise<BrandSummary[]> {
  const cap = getBrandCatalog()
  if (!cap) return []
  try {
    return await cap.getBrands(query, limit)
  } catch {
    return []
  }
}

/** Fetch a single brand's catalog row (count, canonical name, wikidata). */
export async function getBrandMeta(brandKey: string): Promise<BrandSummary | null> {
  const cap = getBrandCatalog()
  if (!cap) return null
  try {
    return await cap.getBrand(brandKey)
  } catch {
    return null
  }
}

export interface BrandHeader {
  brandKey: string
  name: string
  wikidata: string | null
  locationCount: number | null
  category: string | null
  logoUrl?: string
  description?: string
}

export interface BrandBrowseResult {
  brand: BrandHeader
  results: Place[]
}

/**
 * A brandKey is a brand:wikidata QID ("Q38076") or a "name:<lower>" fallback.
 * The browse filter must use the ORIGINAL-cased brand name (OSM tag values are
 * case-sensitive), so for name-only brands we prefer the client-supplied label
 * or the catalog's canonical name over the lowercased key.
 */
function buildBrandFilter(
  brandKey: string,
  brandName?: string,
  catalogName?: string,
): { wikidata?: string; name?: string } | null {
  if (/^Q\d+$/.test(brandKey)) return { wikidata: brandKey }
  const name = brandName || catalogName || (brandKey.startsWith('name:') ? brandKey.slice(5) : brandKey)
  return name ? { name } : null
}

export interface BrandBrowseOptions {
  brandName?: string // original-cased label from the client
  bounds?: MapBounds
  lat?: number
  lng?: number
  minResults?: number
  maxResults?: number
  language?: string
}

/**
 * List a brand's locations (viewport-first, widen-if-sparse) and build the
 * header (canonical name + count from the catalog, logo + description from
 * Wikidata). Returns empty results if the brand catalog integration is absent.
 */
export async function searchByBrand(
  brandKey: string,
  options: BrandBrowseOptions = {},
): Promise<BrandBrowseResult> {
  const cap = getBrandCatalog()
  const summary = await getBrandMeta(brandKey)

  const filter = buildBrandFilter(brandKey, options.brandName, summary?.name)
  const wikidata = summary?.wikidata ?? (/^Q\d+$/.test(brandKey) ? brandKey : null)

  const header: BrandHeader = {
    brandKey,
    name: summary?.name || options.brandName || brandKey,
    wikidata,
    locationCount: summary?.locationCount ?? null,
    category: summary?.category ?? null,
  }

  // Prefer the catalog-resolved logo/description (no network). Fall back to a
  // live Wikidata fetch only when the catalog hasn't resolved them yet.
  if (summary?.logoUrl) header.logoUrl = summary.logoUrl
  if (summary?.description) header.description = summary.description ?? undefined
  if (wikidata && (!header.logoUrl || !header.description)) {
    const meta = await fetchWikidataBrandMeta(
      wikidata,
      (options.language || 'en').split('-')[0],
    )
    if (!header.logoUrl && meta.logoUrl) header.logoUrl = meta.logoUrl
    if (!header.description && meta.description) header.description = meta.description
  }

  if (!cap || !filter) return { brand: header, results: [] }

  const results = await cap.searchByBrand(filter, {
    bounds: options.bounds,
    lat: options.lat,
    lng: options.lng,
    minResults: options.minResults,
    limit: options.maxResults,
  })

  return { brand: header, results }
}
