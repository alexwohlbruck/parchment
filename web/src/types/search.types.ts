import { Component } from 'vue'
import { Place, TransitLineRef, TransitStopRef } from '@/types/place.types'

import type { QueryIntent } from '@server/types/search.types'

export type { CategoryResult, QueryIntent } from '@server/types/search.types'

/** A brand suggestion in search results ("See all McDonald's locations"). */
export interface BrandSearchMeta {
  brandKey: string
  name: string
  wikidata?: string
  locationCount?: number
  category?: string
  logoUrl?: string
  lat?: number
  lng?: number
}

export interface SearchResult {
  id: string
  type: 'bookmark' | 'place' | 'current_location' | 'category' | 'brand' | 'transit_route' | 'transit_stop'
  title: string
  description?: string
  icon?: string
  iconCategory?: string
  color?: string
  metadata: {
    // Brand metadata
    brand?: BrandSearchMeta
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
    place?: {
      id: string
      externalIds: Record<string, string>
      address?: string
      lat: number
      lng: number
      placeType?: string
      // Rich metadata for full search results
      ratings?: {
        rating?: number
        reviewCount?: number
      }
      openingHours?: any // OpeningHours type
      contactInfo?: {
        phone?: string
        website?: string
        email?: string
      }
      amenities?: Record<string, any>
    }
    // Current location metadata
    currentLocation?: {
      lat: number
      lng: number
    }
    // Transit metadata (metadata.place carries the displayable pseudo-place)
    transitLine?: TransitLineRef
    transitStop?: TransitStopRef
  }
}

// Lightweight autocomplete result with minimal data
export interface AutocompleteResult {
  id: string
  type: 'bookmark' | 'place' | 'current_location' | 'category' | 'brand' | 'transit_route' | 'transit_stop'
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
  // Transit metadata: how to open a GTFS line or GTFS-only stop
  transitLine?: TransitLineRef
  transitStop?: TransitStopRef
  /** Preset of a place large enough to hold precise destinations, like an airport's terminals. */
  arrivalPresetId?: string
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
  /** The id of the one result the query clearly means: a place, category, brand or transit line. */
  match?: string
  intent?: QueryIntent
}

export interface AutocompleteResponse {
  query: string
  results: AutocompleteResult[]
  totalCount: number
  /** Absent from servers older than query intent. */
  intent?: QueryIntent
}

// Legacy types for compatibility
export enum SearchResultType {
  BOOKMARK = 'bookmark',
  PLACE = 'place',
  CURRENT_LOCATION = 'current_location',
}

export interface SearchCategory {
  id: string
  name: string
  icon: Component
  keywords: string[]
  osmTags: Record<string, string[]>
}

/** A selectable value a search filter offers. Structurally a `ChipOption`,
 *  which is how the filter bar renders it. */
export interface FilterOption {
  label: string
  value: string | number | boolean
  disabled?: boolean
  icon?: Component
}
