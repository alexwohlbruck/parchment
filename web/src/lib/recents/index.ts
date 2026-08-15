/**
 * Recents kinds.
 *
 * Each entry here is one concrete recents list built on the generic
 * `createRecentsStore` core. To host a new data type, add another instance
 * with its own `blobType` and entry interface — nothing else is required.
 */

import type { PlaceCategory } from '@/types/place.types'
import { createRecentsStore } from './recents-store'

export { createRecentsStore } from './recents-store'
export type { RecentsStore, RecentsStoreConfig } from './recents-store'

/** A committed search — a free-text query, a POI category, or a brand. */
export interface RecentSearchEntry {
  /** Display text: the typed query, the category's human name, or the brand name. */
  query: string
  at: number // epoch ms
  /** 'text' (default), 'category', or 'brand'. A category/brand recent re-runs that browse. */
  kind?: 'text' | 'category' | 'brand'
  /** Present when kind === 'category' — the category id to re-run (e.g. "amenity/bicycle_parking"). */
  categoryId?: string
  /** Present when kind === 'brand' — the brand key to re-run (QID or "name:<lower>"). */
  brandKey?: string
  /** Present when kind === 'brand' — the original-cased brand name for the browse filter. */
  brandName?: string
  /** Present when kind === 'brand' — the brand logo URL, for the recents chip. */
  brandLogoUrl?: string
  /** Category icon glyph, stored so the empty-state palette can render it without loading the category store. */
  iconName?: string
  iconPack?: 'lucide' | 'maki'
  /** Category class, drives the display colour via getCategoryColor. */
  iconCategory?: string
}

/**
 * A recently-viewed place. Compact by design — just enough to render a list
 * item and rebuild the place route; the full record is re-fetched on click.
 */
export interface RecentPlaceEntry {
  /** `Place.id` — feeds `getPlaceRoute()` for navigation. */
  id: string
  title: string
  subtitle?: string
  icon?: string
  iconPack?: 'lucide' | 'maki'
  /** Drives the display colour via `getCategoryColor` at render time. */
  category?: PlaceCategory
  lat?: number
  lng?: number
  at: number // epoch ms
}

/**
 * Stable identity for a recent search, in one key space across all three kinds
 * so they never collide even when they share a label ("Cafe" the category vs
 * "cafe" the typed query). Used to dedupe the stored list, to dedupe recents
 * against live palette results, and to key the dashboard's recents list.
 */
export function recentSearchIdentity(e: RecentSearchEntry): string {
  if (e.kind === 'category' && e.categoryId) return `category:${e.categoryId}`
  if (e.kind === 'brand' && e.brandKey) return `brand:${e.brandKey}`
  return `text:${e.query.trim().toLowerCase()}`
}

/** Stable identity for a recently-viewed place — the same key space as above. */
export function recentPlaceIdentity(e: RecentPlaceEntry): string {
  return `place:${e.id}`
}

/**
 * Recent searches. Keeps the historical `search-history` blob type so existing
 * synced blobs and the K_m rotation orchestrator keep working unchanged.
 */
export const recentSearches = createRecentsStore<RecentSearchEntry>({
  blobType: 'search-history',
  maxEntries: 100,
  identityOf: recentSearchIdentity,
})

/** Recently-viewed places. */
export const recentPlaces = createRecentsStore<RecentPlaceEntry>({
  blobType: 'recent-places',
  maxEntries: 100,
  identityOf: recentPlaceIdentity,
})
