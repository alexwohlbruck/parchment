import { Component } from 'vue'
import { Place } from './place.types'

// Category/Preset types for OSM tagging schema
export interface CategoryResult {
  id: string
  type: 'category'
  name: string
  description?: string
  icon?: string
  color?: string
  // OSM metadata for building Overpass queries
  tags: Record<string, string>
  addTags?: Record<string, string>
  geometry: string[]
  fields?: string[]
  searchable: boolean
  aliases?: string[]
}

export interface SearchResult {
  id: string
  type: 'bookmark' | 'place' | 'current_location' | 'category'
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
  type: 'bookmark' | 'place' | 'current_location' | 'category'
  title: string
  description?: string
  icon?: string
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
