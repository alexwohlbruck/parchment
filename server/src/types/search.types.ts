export interface CategoryResult {
  id: string
  type: 'category'
  name: string
  description?: string
  icon?: string       // raw OSM preset icon string (e.g. "temaki-bicycle_parked")
  iconName?: string   // resolved icon name ready for ItemIcon (e.g. "bicycle")
  iconPack?: 'lucide' | 'maki'
  iconCategory?: string
  color?: string
  // OSM metadata for building Overpass queries
  tags: Record<string, string>
  addTags?: Record<string, string>
  geometry: string[]
  fields?: string[]
  searchable: boolean
  aliases?: string[]
}

import { Place } from './place.types'

/** A brand suggestion in search results ("See all McDonald's locations"). */
export interface BrandSearchMeta {
  brandKey: string
  name: string
  wikidata?: string
  locationCount?: number
  category?: string
  /** Brand logo URL (Wikidata P154), when resolved. */
  logoUrl?: string
  /** Representative location, for map centering when navigating. */
  lat?: number
  lng?: number
}

export interface SearchResult {
  id: string
  type: 'bookmark' | 'place' | 'current_location' | 'category' | 'brand'
  title: string
  description?: string
  icon?: string
  iconPack?: 'lucide' | 'maki'
  iconCategory?: string
  color?: string
  metadata: {
    // Bookmark metadata
    bookmark?: {
      id: string
      frequentType?: 'home' | 'work' | 'school' | 'custom'
      iconColor: string
      address?: string
      lat: number
      lng: number
      externalIds: Record<string, string>
    }
    // Place metadata
    place?: Place
    // Category metadata
    category?: {
      tags: Record<string, string>
      addTags?: Record<string, string>
      geometry: string[]
    }
    // Brand metadata
    brand?: BrandSearchMeta
  }
}

// Lightweight autocomplete result with minimal data
export interface AutocompleteResult {
  id: string
  type: 'bookmark' | 'place' | 'current_location' | 'category' | 'brand'
  title: string
  description?: string
  icon?: string
  iconPack?: 'lucide' | 'maki'
  iconCategory?: string
  color?: string
  // Minimal metadata - just coordinates for navigation (optional for categories)
  lat?: number
  lng?: number
  // Category metadata for OSM queries
  category?: {
    tags: Record<string, string>
    addTags?: Record<string, string>
    geometry: string[]
  }
  // Brand metadata for the "see all locations" browse
  brand?: BrandSearchMeta
}

export interface SearchOptions {
  query: string
  lat?: number
  lng?: number
  radius?: number
  maxResults?: number
  autocomplete?: boolean
}

export interface SearchResponse {
  query: string
  results: SearchResult[]
  totalCount: number
}

export interface AutocompleteResponse {
  query: string
  results: AutocompleteResult[]
  totalCount: number
}
