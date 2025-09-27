import type { Place, TransitDeparture } from '../types/place.types'
import type { SupportedLanguage } from '../lib/i18n'
import { mergePlacesCollection, mergePlaces, calculateTextSimilarity } from './merge.service'
import type { PlaceRelation } from '../types/place.types'
import { Source, SOURCE } from '../lib/constants'
import { findBookmarkByExternalIds } from './library/bookmarks.service'
import * as turf from '@turf/turf'
import { integrationManager } from './integrations'
import { IntegrationCapabilityId } from '../types/integration.types'
import { User } from '../schema/users.schema'
import { WikidataIntegration } from './integrations/wikidata-integration'
import { WikipediaIntegration } from './integrations/wikipedia-integration'
import { WikimediaIntegration } from './integrations/wikimedia-integration'
import { TransitlandIntegration } from './integrations/transitland-integration'
import { dedupeWikiPhotos } from './integrations/wiki-utils'
import { isTransitStopType, isTransitStop, extractOnestopIdFromWikidata, extractAllOnestopIdsFromWikidata } from '../lib/transit-utils'

/**
 * Normalize transit stop names for better fuzzy matching
 * Handles common differences between OSM and GTFS naming conventions
 */
function normalizeTransitStopName(name: string): string {
  const original = name
  const normalized = name
    .toLowerCase()
    .trim()
    // Normalize Unicode characters (decompose accents, etc.)
    .normalize('NFD')
    // Remove diacritics/accents for better matching
    .replace(/[\u0300-\u036f]/g, '')
    // Replace common separators with spaces
    .replace(/[&+/\-_]/g, ' ')
    // Remove parentheses and their contents (often contains system names or directions)
    .replace(/\([^)]*\)/g, '')
    .replace(/\[[^\]]*\]/g, '')
    // Remove multiple spaces and trim
    .replace(/\s+/g, ' ')
    .trim()
    
  console.log(`🔄 [Transit] Normalized "${original}" → "${normalized}"`)
  return normalized
}

/**
 * Calculate similarity between transit stop names using specialized normalization
 * Returns a score from 0 to 1, where 1 is a perfect match
 */
function calculateTransitStopSimilarity(name1: string, name2: string): number {
  if (!name1 || !name2) return 0
  
  const normalized1 = normalizeTransitStopName(name1)
  const normalized2 = normalizeTransitStopName(name2)
  
  // Use the existing fuzzy matching logic but with transit-specific normalization
  return calculateTextSimilarity(normalized1, normalized2)
}

/**
 * Extract OSM tags from place amenities
 */
function extractOsmTags(place: Place): Record<string, string> {
  const tags: Record<string, string> = {}
  
  if (!place.amenities) return tags
  
  // Convert amenities back to tag format
  for (const [key, value] of Object.entries(place.amenities)) {
    if (key.startsWith('type:')) continue // Skip type prefixed keys
    
    const tagValue = typeof value === 'object' && value?.value !== undefined ? value.value : value
    if (typeof tagValue === 'string') {
      tags[key] = tagValue
    } else if (typeof tagValue === 'boolean') {
      tags[key] = tagValue ? 'yes' : 'no'
    } else if (typeof tagValue === 'number') {
      tags[key] = tagValue.toString()
    }
  }
  
  return tags
}

/**
 * Look up parent relations for a place, particularly useful for transit stops
 * that might have their Wikidata on a parent "transit stop area" relation
 */
async function enrichPlaceWithParentRelations(place: Place): Promise<void> {
  if (!shouldLookupParentRelations(place)) return
  
  const osmId = place.externalIds[SOURCE.OSM]
  if (!osmId) return
  
  const nominatimIntegration = integrationManager.getIntegration('nominatim')
  if (!nominatimIntegration) return
  
  try {
    const baseUrl = nominatimIntegration.config.baseUrl || 'https://nominatim.openstreetmap.org'
    const relations = await nominatimIntegration.adapter.lookupParentRelations(osmId, baseUrl)
    
    if (!relations.length) return
    
    place.relations = {
      value: relations,
      sourceId: SOURCE.OSM,
      timestamp: new Date().toISOString(),
    }
    
    // For transit stops, check if any parent relation is a transit stop area with Wikidata
    if (isPlaceTransitStop(place)) {
      const transitStopArea = relations.find(rel => 
        rel.tags?.public_transport === 'stop_area' || 
        rel.tags?.type === 'public_transport'
      )
      
      if (transitStopArea?.tags?.wikidata) {
        place.externalIds[SOURCE.WIKIDATA] = transitStopArea.tags.wikidata
      }
    }
  } catch (error) {
    console.error('Error looking up parent relations:', error)
  }
}

/**
 * Determine if we should look up parent relations for a place
 * This helps avoid unnecessary API calls for places that are unlikely to benefit
 */
function shouldLookupParentRelations(place: Place): boolean {
  // Always lookup for transit stops (they might have parent stop areas)
  if (isPlaceTransitStop(place)) {
    return true
  }
  
  // Lookup for buildings that might be part of complexes
  const placeType = place.placeType.value?.toLowerCase()
  if (placeType?.includes('building') || placeType?.includes('office') || placeType?.includes('shop')) {
    return true
  }
  
  // Lookup for amenities that might be part of larger facilities
  const amenityKeys = Object.keys(place.amenities || {})
  const interestingAmenities = ['parking', 'restaurant', 'cafe', 'shop', 'atm', 'toilets']
  if (amenityKeys.some(key => interestingAmenities.includes(key))) {
    return true
  }
  
  return false
}

/**
 * Check if a place is a transit stop using both place type and OSM tags
 */
function isPlaceTransitStop(place: Place): boolean {
  const placeType = place.placeType.value
  const osmTags = extractOsmTags(place)
  return isTransitStop(placeType, osmTags)
}

/**
 * Try to find a Transitland onestop ID by searching near coordinates
 * This is a fallback for transit stops without Wikidata IDs
 */
async function tryFindOnestopIdByCoordinates(
  name: string,
  coordinates: { lat: number; lng: number }
): Promise<string | null> {
  console.debug('🔍 [Transit] Attempting coordinate-based onestop ID lookup:')
  console.debug('  - Name:', name)
  console.debug('  - Coordinates:', coordinates)
  
  try {
    // Get Transitland integration
    const transitlandIntegrationRecord = integrationManager.getConfiguredIntegrationForSource(
      SOURCE.TRANSITLAND,
      IntegrationCapabilityId.TRANSIT_DATA,
    )

    if (!transitlandIntegrationRecord) {
      console.debug('🚫 [Transit] Transitland integration not configured')
      return null
    }

    const transitlandIntegration = integrationManager.getCachedIntegrationInstance(transitlandIntegrationRecord) as TransitlandIntegration
    if (!transitlandIntegration) {
      console.debug('🚫 [Transit] Transitland integration instance not found')
      return null
    }

    console.log('🌐 [Transit] Searching Transitland for nearby stops (150m radius)')
    // Search for stops near the coordinates without name filter to get all candidates
    const nearbyStops = await transitlandIntegration.searchStopsNear(
      coordinates.lat,
      coordinates.lng,
      150, // 150 meter radius for better coverage
      // name - removed to get all nearby stops for fuzzy matching
    )

    console.log(`📍 [Transit] Found ${nearbyStops.length} nearby stops, applying fuzzy name matching...`)

    if (nearbyStops.length > 0) {
      const candidatesWithSimilarity = nearbyStops.map(stop => {
        const nameSimilarity = calculateTransitStopSimilarity(name, stop.stop_name || '')
        console.log(`  🎯 [Transit] "${stop.stop_name}" → similarity: ${(nameSimilarity * 100).toFixed(1)}%`)
        return {
          ...stop,
          nameSimilarity,
          onestopId: stop.onestop_id || stop.id
        }
      })
      
      candidatesWithSimilarity.sort((a, b) => {
        if (Math.abs(a.nameSimilarity - b.nameSimilarity) > 0.01) {
          return b.nameSimilarity - a.nameSimilarity
        }
        return (a.distance || 999) - (b.distance || 999)
      })
      
      console.log(`🎯 [Transit] Top fuzzy matching candidates:`)
      candidatesWithSimilarity.slice(0, 5).forEach((candidate, index) => {
        console.log(`  ${index + 1}. "${candidate.stop_name}"`)
        console.log(`     - Similarity: ${(candidate.nameSimilarity * 100).toFixed(1)}%`)
        console.log(`     - Distance: ${candidate.distance || 'Unknown'}m`)
        console.log(`     - Onestop ID: ${candidate.onestop_id}`)
      })
      
      const bestMatch = candidatesWithSimilarity[0]
      const MIN_SIMILARITY_THRESHOLD = 0.25  // Reduced from 0.3 to 0.25 for more fuzzy matching
      const HIGH_SIMILARITY_THRESHOLD = 0.75 // Reduced from 0.8 to 0.75 for grouping similar stops
      
      console.log(`📊 [Transit] Thresholds: MIN=${(MIN_SIMILARITY_THRESHOLD * 100).toFixed(0)}%, HIGH=${(HIGH_SIMILARITY_THRESHOLD * 100).toFixed(0)}%`)
      
      if (bestMatch.nameSimilarity >= MIN_SIMILARITY_THRESHOLD) {
        const highSimilarityMatches = candidatesWithSimilarity.filter(
          candidate => candidate.nameSimilarity >= HIGH_SIMILARITY_THRESHOLD
        )
        
        if (highSimilarityMatches.length > 1) {
          console.log(`🔍 [Transit] Found ${highSimilarityMatches.length} high-similarity matches, storing multiple IDs`)
          highSimilarityMatches.forEach((match, index) => {
            console.log(`    ${index + 1}. "${match.stop_name}" (${match.onestopId}) - ${(match.nameSimilarity * 100).toFixed(1)}%`)
          })
          const allOnestopIds = highSimilarityMatches.map(match => match.onestopId)
          ;(tryFindOnestopIdByCoordinates as any)._lastFoundMultipleIds = allOnestopIds
          console.log(`✅ [Transit] Returning primary match: ${allOnestopIds[0]}`)
          return allOnestopIds[0]
        } else {
          console.log(`✅ [Transit] Found single best match: "${bestMatch.stop_name}" (${bestMatch.onestopId}) - ${(bestMatch.nameSimilarity * 100).toFixed(1)}%`)
          return bestMatch.onestopId
        }
      } else {
        console.log(`❌ [Transit] Best match similarity too low: ${(bestMatch.nameSimilarity * 100).toFixed(1)}% < ${(MIN_SIMILARITY_THRESHOLD * 100).toFixed(0)}%`)
      }
    } else {
      console.log(`❌ [Transit] No nearby stops found within 150m`)
    }

    return null
  } catch (error) {
    console.error('❌ [Transit] Error finding onestop ID by coordinates:', error)
    return null
  }
}

// TODO: Move this to more relevant file (merge service?)
/**
 * Add bookmark information to places
 */
async function addBookmarkInfo(places: Place[], userId: string): Promise<void> {
  try {
    for (const place of places) {
      if (place.externalIds) {
        const bookmarkInfo = await findBookmarkByExternalIds(
          place.externalIds,
          userId,
        )
        if (bookmarkInfo) {
          place.bookmark = bookmarkInfo.bookmark
          place.collectionIds = bookmarkInfo.collectionIds
        }
      }
    }
  } catch (error) {
    console.error('Error adding bookmark information:', error)
  }
}

/**
 * Look up a place by ID from a given source
 *
 * @param source The source ID (e.g., SOURCE.GOOGLE, SOURCE.OSM)
 * @param placeId The provider-specific ID for the place
 * @returns Provider-specific place data or null if not found
 */
export async function lookupPlaceById(
  source: Source,
  placeId: string,
): Promise<Place | null> {
  try {
    const integrationRecord =
      integrationManager.getConfiguredIntegrationForSource(
        source,
        IntegrationCapabilityId.PLACE_INFO,
      )

    if (!integrationRecord) return null

    const integration =
      integrationManager.getCachedIntegrationInstance(integrationRecord)
    if (!integration) return null

    return (
      (await integration.capabilities.placeInfo?.getPlaceInfo(placeId)) ?? null
    )
  } catch (error) {
    return null
  }
}

/** 
 * Look up a place by name/coordinates on all available providers
 *
 * @param name The name of the place
 * @param coordinates The coordinates of the place
 * @param options Optional parameters including radius and source blacklist
 * @returns Array of Place objects from all providers
 */
// TODO: Full implementation for search results instead of autocomplete results
export async function lookupPlacesByNameAndLocation(
  name: string,
  coordinates: { lat: number; lng: number },
  options?: {
    autocomplete?: boolean
    radius?: number
    sourceBlacklist?: Source[]
    userId?: User['id']
  },
): Promise<Place[]> {
  try {
    const {
      radius = 500,
      sourceBlacklist = [],
      autocomplete = false,
    } = options || {}

    const integrationRecords = integrationManager
      .getConfiguredIntegrationsByCapability(
        autocomplete
          ? IntegrationCapabilityId.AUTOCOMPLETE
          : IntegrationCapabilityId.SEARCH,
      )
      .filter((integrationRecord) => {
        // Get the cached integration instance to check sources
        const integration =
          integrationManager.getCachedIntegrationInstance(integrationRecord)
        // Filter out integrations whose sources are in the blacklist
        return !integration?.sources?.some((source: Source) =>
          sourceBlacklist.includes(source),
        )
      })

    if (integrationRecords.length === 0) {
      // TODO: Return useful error to client
      return []
    }

    const searchPromises = integrationRecords.map(async (integrationRecord) => {
      const integration =
        integrationManager.getCachedIntegrationInstance(integrationRecord)
      if (!integration) return null

      if (autocomplete) {
        return integration.capabilities.autocomplete?.getAutocomplete(
          name,
          coordinates.lat,
          coordinates.lng,
        )
      } else {
        return integration.capabilities.search?.searchPlaces(
          name,
          coordinates.lat,
          coordinates.lng,
        )
      }
    })

    const results = (await Promise.all(searchPromises))
      .flat()
      .filter(
        (result): result is Place => result !== null && result !== undefined,
      )

    return mergePlacesCollection(results).sort((a, b) => {
      // Sort by distance from coordinates
      const distanceA = turf.distance(
        turf.point([coordinates.lng, coordinates.lat]),
        turf.point([a.geometry.value.center.lng, a.geometry.value.center.lat]),
        { units: 'meters' },
      )
      const distanceB = turf.distance(
        turf.point([coordinates.lng, coordinates.lat]),
        turf.point([b.geometry.value.center.lng, b.geometry.value.center.lat]),
        { units: 'meters' },
      )
      return distanceA - distanceB
    })
  } catch (error) {
    console.error('Error looking up places by name and coordinates:', error)
    return []
  }
}

/**
 * Look up a place by name/coordinates
 * Uses lookupPlacesByNameAndCoordinates and fetches the best result
 *
 * @param name The name of the place
 * @param coordinates The coordinates of the place
 * @param options Optional parameters including userId, radius, language and source blacklist
 * @returns A deduplicated Place object
 */
export async function lookupPlaceByNameAndLocation(
  name: string,
  coordinates: { lat: number; lng: number },
  options?: {
    autocomplete?: boolean
    userId?: User['id']
    radius?: number
    sourceBlacklist?: Source[]
    language?: SupportedLanguage
  },
): Promise<Place | null> {
  try {
    const {
      userId,
      radius = 500,
      sourceBlacklist = [],
      autocomplete = false,
    } = options || {}

    // Get all places matching the name and coordinates from all providers
    const places = await lookupPlacesByNameAndLocation(name, coordinates, {
      radius,
      sourceBlacklist,
      autocomplete,
    })

    if (places.length === 0) {
      return null
    }

    if (userId && places.length > 0) {
      // TODO: Where else do we need to add bookmark info?
      await addBookmarkInfo(places, userId)
    }

    return places[0] || null
  } catch (error) {
    console.error('Error getting place by name and coordinates:', error)
    return null
  }
}

/**
 * Enrich a place with data from Wiki sources (Wikidata, Wikipedia, Wikimedia Commons)
 * This implements the dependency chain where Wikidata is fetched first, then Wikipedia and Wikimedia
 * 
 * @param place The place to enrich
 * @param language Optional language preference
 * @returns The enriched place or the original place if Wiki data is not available
 */
async function enrichPlaceWithWikiData(
  place: Place, 
  language: SupportedLanguage = 'en'
): Promise<Place> {
  try {
    // First, try to find Wikidata ID via parent relations (especially for transit stops)
    await enrichPlaceWithParentRelations(place)
    
    // Check if we have a Wikidata ID (either original or from parent relation)
    const wikidataId = place.externalIds?.wikidata
    if (!wikidataId) {
      
      // For transit stops without Wikidata, try to find onestop ID by coordinates
      if (isPlaceTransitStop(place) && place.name.value && place.geometry.value.center) {
        const onestopId = await tryFindOnestopIdByCoordinates(place.name.value, place.geometry.value.center)
        if (onestopId) {
          const timestamp = new Date().toISOString()
          
          // Check if multiple IDs were found (stored in function property)
          const multipleIds = (tryFindOnestopIdByCoordinates as any)._lastFoundMultipleIds
          
          place.transit = {
            value: {
              onestopId,
              onestopIds: multipleIds && multipleIds.length > 1 ? multipleIds : undefined,
              name: place.name.value || undefined,
            },
            sourceId: SOURCE.TRANSITLAND,
            timestamp,
          }
          
          delete (tryFindOnestopIdByCoordinates as any)._lastFoundMultipleIds
        }
      }
      
      return place
    }

    // Get Wikidata integration
    const wikidataIntegrationRecord = integrationManager.getConfiguredIntegrationForSource(
      SOURCE.WIKIDATA,
      IntegrationCapabilityId.PLACE_INFO,
    )

    if (!wikidataIntegrationRecord) {
      console.log('Wikidata integration not configured, skipping Wiki enrichment')
      return place
    }

    const wikidataIntegration = integrationManager.getCachedIntegrationInstance(wikidataIntegrationRecord) as WikidataIntegration
    if (!wikidataIntegration) {
      console.log('Wikidata integration instance not found')
      return place
    }

    // Fetch Wikidata entity
    const wikidataEntity = await wikidataIntegration.getEntityData(wikidataId, language)
    if (!wikidataEntity) {
      console.log(`No Wikidata entity found for ID: ${wikidataId}`)
      return place
    }

    // Extract onestop IDs from Wikidata and add to transit data if this is a transit stop
    console.debug(`📡 [Transit] Checking Wikidata entity ${wikidataId} for onestop IDs`)
    const allOnestopIds = extractAllOnestopIdsFromWikidata(wikidataEntity)
    if (allOnestopIds.length > 0 && isPlaceTransitStop(place)) {
      const timestamp = new Date().toISOString()
      
      console.debug(`🎯 [Transit] Wikidata → Transitland mapping successful:`)
      console.debug(`  - Wikidata ID: ${wikidataId}`)
      console.debug(`  - Onestop IDs: ${allOnestopIds.join(', ')}`)
      console.debug(`  - Source: Wikidata P11109 property`)
      allOnestopIds.forEach(id => {
        console.debug(`  - Transitland URL: https://www.transit.land/stops/${id}`)
      })
      
      // Create or update transit info with the onestop IDs
      const transitInfo = {
        onestopId: allOnestopIds[0], // Primary onestop ID (for backward compatibility)
        onestopIds: allOnestopIds.length > 1 ? allOnestopIds : undefined, // All IDs for transfer hubs
        name: place.name.value || undefined,
        ...place.transit?.value
      }

      place.transit = {
        value: transitInfo,
        sourceId: SOURCE.WIKIDATA,
        timestamp,
      }

      if (allOnestopIds.length > 1) {
        console.log(`Linked transit hub to Transitland via Wikidata: ${allOnestopIds.join(', ')}`)
      } else {
        console.log(`Linked transit stop to Transitland via Wikidata: ${allOnestopIds[0]}`)
      }
    }

    // Get Wikidata place data and merge it
    const wikidataPlace = await wikidataIntegration.capabilities.placeInfo?.getPlaceInfo(wikidataId)
    if (wikidataPlace) {
      place = mergePlaces(place, wikidataPlace)
    }

    // Extract Wikipedia title from Wikidata entity
    const wikipediaTitle = wikidataIntegration.extractWikipediaTitle(wikidataEntity, language)
    if (wikipediaTitle) {
      // Get Wikipedia integration
      const wikipediaIntegrationRecord = integrationManager.getConfiguredIntegrationForSource(
        SOURCE.WIKIPEDIA,
        IntegrationCapabilityId.PLACE_INFO,
      )

      if (wikipediaIntegrationRecord) {
        const wikipediaIntegration = integrationManager.getCachedIntegrationInstance(wikipediaIntegrationRecord) as WikipediaIntegration
        if (wikipediaIntegration) {
          // Fetch Wikipedia data
          const wikipediaPlace = await wikipediaIntegration.capabilities.placeInfo?.getPlaceInfo(`${language}:${wikipediaTitle}`)
          if (wikipediaPlace) {
            place = mergePlaces(place, wikipediaPlace)
          }
        }
      }
    }

    // Extract Wikimedia Commons category from Wikidata entity
    const commonsCategory = wikidataIntegration.extractCommonsCategory(wikidataEntity)
    const commonsGallery = wikidataIntegration.extractCommonsGallery(wikidataEntity)

    if (commonsCategory || commonsGallery) {
      // Get Wikimedia integration
      const wikimediaIntegrationRecord = integrationManager.getConfiguredIntegrationForSource(
        SOURCE.WIKIMEDIA,
        IntegrationCapabilityId.PLACE_INFO,
      )

      if (wikimediaIntegrationRecord) {
        const wikimediaIntegration = integrationManager.getCachedIntegrationInstance(wikimediaIntegrationRecord) as WikimediaIntegration
        if (wikimediaIntegration) {
          try {
            // Determine the ID format based on what we have
            const wikimediaId = commonsCategory 
              ? `category:${commonsCategory}`
              : `gallery:${commonsGallery}`

            // Fetch place info (which includes images) from Commons
            const wikimediaPlace = await wikimediaIntegration.capabilities.placeInfo?.getPlaceInfo(wikimediaId)

            if (wikimediaPlace && wikimediaPlace.photos.length > 0) {
              // Update photo priorities before merging
              const existingPhotoCount = place.photos.length
              wikimediaPlace.photos = wikimediaPlace.photos.map((photo, index) => ({
                ...photo,
                value: {
                  ...photo.value,
                  isPrimary: index === 0 && existingPhotoCount === 0, // First image is primary if no existing photos
                },
              }))

              // Properly merge the Wikimedia place to ensure sources are included
              place = mergePlaces(place, wikimediaPlace)
            }
          } catch (error) {
            console.warn('Error fetching Wikimedia Commons images:', error)
          }
        }
      } else {
        // Fallback: Wikimedia not configured; use a temporary instance to fetch multiple images
        try {
          const temp = new WikimediaIntegration()
          temp.initialize({} as any)

          const limit = 8
          let images: any[] = []
          if (commonsCategory) {
            images = await (temp as any).getImagesByCategory(commonsCategory, limit)
          } else if (commonsGallery) {
            images = await (temp as any).getImagesByGallery(commonsGallery, limit)
          }

          if (images && images.length > 0) {
            const existingPhotoCount = place.photos.length
            const timestamp = new Date().toISOString()

            const wikimediaPhotos = images.map((img: any, index: number) => ({
              value: {
                ...img,
                isPrimary: index === 0 && existingPhotoCount === 0,
              },
              sourceId: SOURCE.WIKIMEDIA,
              timestamp,
            }))

            place.photos.push(...wikimediaPhotos)

            const sourceUrl = commonsCategory
              ? `https://commons.wikimedia.org/wiki/Category:${encodeURIComponent(commonsCategory)}`
              : `https://commons.wikimedia.org/wiki/${encodeURIComponent(commonsGallery || '')}`

            const hasWikimediaSource = place.sources.some((s) => s.id === SOURCE.WIKIMEDIA)
            if (!hasWikimediaSource) {
              place.sources.push({ id: SOURCE.WIKIMEDIA, name: 'Wikimedia Commons', url: sourceUrl })
            }
          }
        } catch (fallbackErr) {
          console.warn('Wikimedia Commons fallback failed:', fallbackErr)
        }
      }
    }

    // Final safety net: dedupe photos after all wiki enrichment
    dedupeWikiPhotos(place)

    return place
  } catch (error) {
    console.error('Error enriching place with Wiki data:', error)
    return place // Return original place if enrichment fails
  }
}

/**
 * Enrich a place with transit data from Transitland if it's a transit stop
 * 
 * @param place The place to enrich
 * @returns The enriched place or the original place if transit data is not available
 */
async function enrichPlaceWithTransitData(place: Place): Promise<Place> {
  try {
    // Only enrich places that have transit information but no departures yet
    if (!place.transit?.value) {
      return place
    }

    const transitInfo = place.transit.value
    const onestopIds = transitInfo.onestopIds || [transitInfo.onestopId]
    
    console.debug('🚆 [Transit] Enriching place with transit departures:')
    console.debug(`  - Place: ${place.name.value}`)
    console.debug(`  - Onestop IDs: ${onestopIds.join(', ')}`)
    console.debug(`  - Source: ${place.transit.sourceId}`)
    
    // Skip if no onestop IDs or already have departure data
    if (onestopIds.length === 0 || (transitInfo.departures && transitInfo.departures.length > 0)) {
      console.debug('🚫 [Transit] Skipping: No onestop IDs or already have departure data')
      return place
    }

    // Get Transitland integration
    const transitlandIntegrationRecord = integrationManager.getConfiguredIntegrationForSource(
      SOURCE.TRANSITLAND,
      IntegrationCapabilityId.TRANSIT_DATA,
    )

    if (!transitlandIntegrationRecord) {
      console.debug('🚫 [Transit] Transitland integration not configured, skipping transit enrichment')
      return place
    }

    const transitlandIntegration = integrationManager.getCachedIntegrationInstance(transitlandIntegrationRecord) as TransitlandIntegration
    if (!transitlandIntegration) {
      console.debug('🚫 [Transit] Transitland integration instance not found')
      return place
    }

    console.debug('🔄 [Transit] Fetching departures from Transitland API...')
    
    // Fetch departure data from all onestop IDs (for transfer hubs)
    const allDepartures: TransitDeparture[] = []
    
    for (const onestopId of onestopIds) {
      try {
        console.debug(`🌐 [Transit] Querying departures for onestop ID: ${onestopId}`)
        console.debug(`  - API: GET https://transit.land/api/v2/rest/stops/${onestopId}/departures`)
        console.debug(`  - Parameters: next=3600 (1 hour), limit=20`)
        
        const departures = await transitlandIntegration.getDepartures(onestopId, {
          next: 3600, // Next hour
          limit: 20
        })
        
        if (departures && departures.length > 0) {
          console.debug(`✅ [Transit] Found ${departures.length} departures for ${onestopId}`)
          allDepartures.push(...departures)
        } else {
          console.debug(`🚫 [Transit] No departures found for ${onestopId}`)
        }
      } catch (error) {
        console.error(`❌ [Transit] Error fetching departures for onestop ID ${onestopId}:`, error)
        // Continue with other onestop IDs
      }
    }

    if (allDepartures && allDepartures.length > 0) {
      // Sort departures by time to provide a unified schedule
      allDepartures.sort((a, b) => {
        const timeA = a.departureTime || a.arrivalTime || ''
        const timeB = b.departureTime || b.arrivalTime || ''
        return timeA.localeCompare(timeB)
      })

      // Update the existing transit data with all departures
      const existingTransit = place.transit?.value || { onestopId: onestopIds[0] }
      const updatedTransit = {
        ...existingTransit,
        departures: allDepartures,
      }

      place.transit = {
        value: updatedTransit,
        sourceId: SOURCE.TRANSITLAND,
        timestamp: new Date().toISOString(),
      }

      // Add Transitland as a source if not already present
      const hasTransitlandSource = place.sources.some((s) => s.id === SOURCE.TRANSITLAND)
      if (!hasTransitlandSource) {
        const primaryOnestopId = onestopIds[0]
        place.sources.push({
          id: SOURCE.TRANSITLAND,
          name: 'Transitland',
          url: `https://www.transit.land/stops/${primaryOnestopId}`,
        })
      }
    }

    return place
  } catch (error) {
    console.error('Error enriching place with transit data:', error)
    return place // Return original place if enrichment fails
  }
}

/**
 * Look up a place by ID and enrich it with data from other sources
 *
 * @param source The source ID (e.g., SOURCE.GOOGLE, SOURCE.OSM)
 * @param id The ID for the place in that source
 * @param options Optional parameters including userId and language
 * @returns A merged Place object with consolidated data from multiple sources
 */
export async function lookupEnrichedPlaceById(
  source: Source,
  id: string,
  options?: {
    userId?: User['id']
    language?: SupportedLanguage
  },
): Promise<Place | null> {
  try {
    const { userId, language = 'en' } = options || {}

    let place = await lookupPlaceById(source, id)
    if (!place) return null

    // If place has name and location, look it up from other sources and merge in
    if (place.name?.value && place.geometry.value.center) {
      const { lat, lng } = place.geometry.value.center

      const thirdPartyPlace = await lookupPlaceByNameAndLocation(
        place.name.value,
        { lat, lng },
        {
          radius: 500,
          sourceBlacklist: [source], // Exclude the original source
        },
      )

      if (thirdPartyPlace) {
        place = mergePlaces(place, thirdPartyPlace)
      }
    }

    // Enrich with Wiki data (Wikidata, Wikipedia, Wikimedia Commons)
    place = await enrichPlaceWithWikiData(place, language)

    // Enrich with transit data from Transitland
    place = await enrichPlaceWithTransitData(place)

    // Add bookmark information if user ID is provided
    if (userId && place) {
      const bookmarkInfo = await findBookmarkByExternalIds(
        place.externalIds,
        userId,
      )
      if (bookmarkInfo) {
        place.bookmark = bookmarkInfo.bookmark
        place.collectionIds = bookmarkInfo.collectionIds
      }
    }

    return place
  } catch (error) {
    console.error(
      `Error looking up and merging place data (${source}/${id}):`,
      error,
    )
    return null
  }
}
