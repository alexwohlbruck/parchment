import { Component } from 'vue'
import { Place } from './place.types'

export interface SearchResult {
  id: string
  type: 'bookmark' | 'place' | 'current_location'
  title: string
  description?: string
  icon?: string
  color?: string
  metadata: {
    // Bookmark metadata
    bookmark?: {
      id: string
      presetType?: 'home' | 'work' | 'school'
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
  }
}

// Lightweight autocomplete result with minimal data
export interface AutocompleteResult {
  id: string
  type: 'bookmark' | 'place' | 'current_location'
  title: string
  description?: string
  icon?: string
  color?: string
  // Minimal metadata - just coordinates for navigation
  lat: number
  lng: number
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
