import type { Place, TransitDeparture } from '../types/place.types'
import type { Language } from '../lib/i18n/i18n.types'
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
 * Check if a place is missing meaningful address data
 * For buildings/POIs, we want at least a street address
 */
function isMissingAddressData(place: Place): boolean {
  if (!place.address?.value) return true
  
  const addr = place.address.value
  
  // Check if we have street address - this is the most important component
  const hasStreet = !!addr.street1
  
  // If we don't have a street address, consider it missing
  // (even if we have city/country, that's not specific enough for a building)
  return !hasStreet
}

/**
 * Enrich a place with address data from reverse geocoding if address is missing
 */
async function enrichPlaceWithAddressData(place: Place): Promise<Place> {
  // Skip if we already have good address data
  if (!isMissingAddressData(place)) {
    console.log('📍 Place already has address data, skipping address enrichment')
    return place
  }
  
  // Skip if we don't have coordinates
  if (!place.geometry.value.center) {
    console.log('📍 Place has no coordinates, cannot enrich address')
    return place
  }
  
  const startTime = Date.now()
  console.log('📍 Place missing address data, attempting reverse geocoding enrichment...')
  
  try {
    const { lat, lng } = place.geometry.value.center
    
    // Get geocoding integrations sorted by priority (Nominatim > Geoapify)
    const geocodingIntegrations = integrationManager.getConfiguredIntegrationsByCapability(
      IntegrationCapabilityId.GEOCODING
    )
    
    if (!geocodingIntegrations.length) {
      console.log('📍 No geocoding integration available for address enrichment')
      return place
    }
    
    // Try each geocoding integration in priority order
    for (const integrationRecord of geocodingIntegrations) {
      const integration = integrationManager.getCachedIntegrationInstance(integrationRecord)
      
      if (!integration?.capabilities.geocoding) continue
      
      console.log(`📍 Trying address enrichment with ${integrationRecord.integrationId}...`)
      
      try {
        const results = await integration.capabilities.geocoding.reverseGeocode(lat, lng)
        
        if (results?.[0]?.address?.value) {
          const geocodedAddress = results[0].address
          
          // Only use the address if it has meaningful data
          const addr = geocodedAddress.value
          if (addr.street1 || addr.locality) {
            console.log(`📍 Successfully enriched address from ${integrationRecord.integrationId}`)
            place.address = geocodedAddress
            
            // Add to sources if not already present
            const sourceId = geocodedAddress.sourceId
            if (!place.sources.some(s => s.sourceId === sourceId)) {
              place.sources.push({
                sourceId,
                timestamp: geocodedAddress.timestamp,
              })
            }
            
            const enrichTime = Date.now() - startTime
            console.log(`⏱️ [PERF] Address enrichment: ${enrichTime}ms`)
            return place
          }
        }
      } catch (error) {
        console.error(`📍 Error enriching address with ${integrationRecord.integrationId}:`, error)
        // Continue to next integration
      }
    }
    
    console.log('📍 No geocoding integration returned useful address data')
    return place
  } catch (error) {
    console.error('📍 Error during address enrichment:', error)
    return place
  }
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
 * @param options Optional parameters including language for localized results
 * @returns Provider-specific place data or null if not found
 */
export async function lookupPlaceById(
  source: Source,
  placeId: string,
  options?: { language?: Language },
): Promise<Place | null> {
  try {
    console.log(`[lookupPlaceById] Looking up source=${source}, placeId=${placeId}`)
    const integrationRecord =
      integrationManager.getConfiguredIntegrationForSource(
        source,
        IntegrationCapabilityId.PLACE_INFO,
      )

    if (!integrationRecord) {
      console.log(`[lookupPlaceById] No integration found for source=${source} with PLACE_INFO capability`)
      return null
    }

    console.log(`[lookupPlaceById] Found integration: ${integrationRecord.integrationId}`)
    const integration =
      integrationManager.getCachedIntegrationInstance(integrationRecord)
    if (!integration) {
      console.log(`[lookupPlaceById] Integration instance not cached`)
      return null
    }

    console.log(`[lookupPlaceById] Calling getPlaceInfo...`)
    return (
      (await integration.capabilities.placeInfo?.getPlaceInfo(
        placeId,
        options,
      )) ?? null
    )
  } catch (error) {
    console.error(`[lookupPlaceById] Error:`, error)
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
    language?: Language
  },
): Promise<Place[]> {
  try {
    const {
      radius = 500,
      sourceBlacklist = [],
      autocomplete = false,
      language,
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
          { radius, language },
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
    language?: Language
  },
): Promise<Place | null> {
  const startTime = Date.now()
  console.log(`⏱️ [PERF] Third party place lookup: ${name} at ${coordinates.lat},${coordinates.lng}`)
  
  try {
    const {
      userId,
      radius = 500,
      sourceBlacklist = [],
      autocomplete = false,
      language,
    } = options || {}

    // Get all places matching the name and coordinates from all providers
    const searchStart = Date.now()
    const places = await lookupPlacesByNameAndLocation(name, coordinates, {
      radius,
      sourceBlacklist,
      autocomplete,
      language,
    })
    const searchTime = Date.now() - searchStart
    console.log(`⏱️ [PERF] Multi-provider search: ${searchTime}ms (found ${places.length} places)`)

    if (places.length === 0) {
      console.log(`⏱️ [PERF] Third party lookup (no results): ${Date.now() - startTime}ms`)
      return null
    }

    if (userId && places.length > 0) {
      const bookmarkStart = Date.now()
      // TODO: Where else do we need to add bookmark info?
      await addBookmarkInfo(places, userId)
      const bookmarkTime = Date.now() - bookmarkStart
      console.log(`⏱️ [PERF] Third party bookmark info: ${bookmarkTime}ms`)
    }

    const totalTime = Date.now() - startTime
    console.log(`⏱️ [PERF] Third party place lookup total: ${totalTime}ms`)

    return places[0] || null
  } catch (error) {
    console.error(`❌ [PERF] Error getting place by name and coordinates (${Date.now() - startTime}ms):`, error)
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
  language: Language = 'en'
): Promise<Place> {
  const startTime = Date.now()
  console.log(`⏱️ [PERF] Starting Wiki data enrichment`)
  
  try {
    // First, try to find Wikidata ID via parent relations (especially for transit stops)
    await enrichPlaceWithParentRelations(place)
    
    // Check if we have a Wikidata ID (either original or from parent relation)
    const wikidataId = place.externalIds?.wikidata
    if (!wikidataId) {
      
      // For transit stops without Wikidata, try to find onestop ID by coordinates
      if (isPlaceTransitStop(place) && place.name.value && place.geometry.value.center) {
        const coordSearchStart = Date.now()
        const onestopId = await tryFindOnestopIdByCoordinates(place.name.value, place.geometry.value.center)
        const coordSearchTime = Date.now() - coordSearchStart
        console.log(`⏱️ [PERF] Coordinate search for onestop ID: ${coordSearchTime}ms`)
        
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
      
      console.log(`⏱️ [PERF] Wiki data enrichment (no Wikidata ID): ${Date.now() - startTime}ms`)
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
    const wikidataFetchStart = Date.now()
    const wikidataEntity = await wikidataIntegration.getEntityData(wikidataId, language)
    const wikidataFetchTime = Date.now() - wikidataFetchStart
    console.log(`⏱️ [PERF] Wikidata entity fetch: ${wikidataFetchTime}ms`)
    
    if (!wikidataEntity) {
      console.log(`No Wikidata entity found for ID: ${wikidataId}`)
      console.log(`⏱️ [PERF] Wiki data enrichment (no entity): ${Date.now() - startTime}ms`)
      return place
    }

    // Extract onestop IDs from Wikidata and add to transit data if this is a transit stop
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
    const wikidataPlaceStart = Date.now()
    const wikidataPlace = await wikidataIntegration.capabilities.placeInfo?.getPlaceInfo(wikidataId)
    const wikidataPlaceTime = Date.now() - wikidataPlaceStart
    console.log(`⏱️ [PERF] Wikidata place info fetch: ${wikidataPlaceTime}ms`)
    
    if (wikidataPlace) {
      const mergeStart = Date.now()
      place = mergePlaces(place, wikidataPlace)
      const mergeTime = Date.now() - mergeStart
      console.log(`⏱️ [PERF] Wikidata place merge: ${mergeTime}ms`)
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
          const wikipediaStart = Date.now()
          const wikipediaPlace = await wikipediaIntegration.capabilities.placeInfo?.getPlaceInfo(`${language}:${wikipediaTitle}`)
          const wikipediaTime = Date.now() - wikipediaStart
          console.log(`⏱️ [PERF] Wikipedia fetch: ${wikipediaTime}ms`)
          
          if (wikipediaPlace) {
            const mergeStart = Date.now()
            place = mergePlaces(place, wikipediaPlace)
            const mergeTime = Date.now() - mergeStart
            console.log(`⏱️ [PERF] Wikipedia merge: ${mergeTime}ms`)
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
            const wikimediaStart = Date.now()
            const wikimediaPlace = await wikimediaIntegration.capabilities.placeInfo?.getPlaceInfo(wikimediaId)
            const wikimediaTime = Date.now() - wikimediaStart
            console.log(`⏱️ [PERF] Wikimedia fetch: ${wikimediaTime}ms`)

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
    language?: Language
  },
): Promise<Place | null> {
  const startTime = Date.now()
  console.log(`⏱️ [PERF] Starting enriched place lookup: source=${source}, id=${id}`)
  
  try {
    const { userId, language = 'en' } = options || {}

    // Step 1: Get base place data
    const step1Start = Date.now()
    let place = await lookupPlaceById(source, id)
    const step1Time = Date.now() - step1Start
    console.log(`⏱️ [PERF] Step 1 - Base place lookup: ${step1Time}ms`)
    
    if (!place) {
      console.log(`⏱️ [PERF] Total time (no place found): ${Date.now() - startTime}ms`)
      return null
    }

    // Step 2: Look up from other sources and merge
    // Skip third-party search for transit stops to avoid overriding authoritative transit data
    const skipThirdPartySearch = isPlaceTransitStop(place) && source === SOURCE.TRANSITLAND
    
    if (place.name?.value && place.geometry.value.center && !skipThirdPartySearch) {
      const step2Start = Date.now()
      const { lat, lng } = place.geometry.value.center

      const thirdPartyPlace = await lookupPlaceByNameAndLocation(
        place.name.value,
        { lat, lng },
        {
          radius: 500,
          sourceBlacklist: [source], // Exclude the original source
        },
      )
      const step2Time = Date.now() - step2Start
      console.log(`⏱️ [PERF] Step 2 - Third party place lookup: ${step2Time}ms`)

      if (thirdPartyPlace) {
        const mergeStart = Date.now()
        place = mergePlaces(place, thirdPartyPlace)
        const mergeTime = Date.now() - mergeStart
        console.log(`⏱️ [PERF] Step 2b - Place merge: ${mergeTime}ms`)
      }
    } else if (skipThirdPartySearch) {
      console.log(`⏱️ [PERF] Step 2 - Skipped third party search for Transitland transit stop`)
    }

    // Step 3 & 4: Enrich with Wiki data and address data in parallel
    // Transit departure data is now fetched separately via the widget system
    // Clone the place object for each enrichment to avoid race conditions
    const enrichmentStart = Date.now()
    const [wikiEnrichedPlace, addressEnrichedPlace] = await Promise.all([
      enrichPlaceWithWikiData(JSON.parse(JSON.stringify(place)), language),
      enrichPlaceWithAddressData(JSON.parse(JSON.stringify(place)))
    ])

    // Merge the results (wiki data takes precedence for conflicts)
    place = mergePlaces(wikiEnrichedPlace, addressEnrichedPlace)
    const enrichmentTime = Date.now() - enrichmentStart
    console.log(`⏱️ [PERF] Step 3-4 - Parallel enrichment (Wiki + Address): ${enrichmentTime}ms`)

    // Step 5: Resolve widget descriptors based on place data
    const { resolveWidgetDescriptors } = await import('./widget.service')
    place.widgets = resolveWidgetDescriptors(place)

    // Step 6: Add bookmark information if user ID is provided
    if (userId && place) {
      const step6Start = Date.now()
      const bookmarkInfo = await findBookmarkByExternalIds(
        place.externalIds,
        userId,
      )
      if (bookmarkInfo) {
        place.bookmark = bookmarkInfo.bookmark
        place.collectionIds = bookmarkInfo.collectionIds
      }
      const step6Time = Date.now() - step6Start
      console.log(`⏱️ [PERF] Step 6 - Bookmark info: ${step6Time}ms`)
    }

    const totalTime = Date.now() - startTime
    console.log(`⏱️ [PERF] Total enriched place lookup time: ${totalTime}ms`)

    return place
  } catch (error) {
    const totalTime = Date.now() - startTime
    console.error(
      `❌ [PERF] Error looking up and merging place data (${source}/${id}) after ${totalTime}ms:`,
      error,
    )
    return null
  }
}

/**
 * Look up and enrich a place by coordinates using reverse geocoding
 * @param lat Latitude
 * @param lng Longitude
 * @param options Optional parameters for user context and search radius
 * @returns Enriched place or null if not found
 */
export async function lookupEnrichedPlaceByCoordinates(
  lat: number,
  lng: number,
  options?: {
    userId?: User['id']
    radius?: number
    language?: Language
  },
): Promise<Place | null> {
  const startTime = Date.now()
  console.log(`⏱️ [PERF] Starting coordinate-based place lookup: lat=${lat}, lng=${lng}`)
  
  try {
    const { userId, radius = 50, language = 'en' } = options || {}

    // Step 1: Reverse geocode to find place at coordinates
    const geocodingIntegrations = integrationManager.getConfiguredIntegrationsByCapability(
      IntegrationCapabilityId.GEOCODING
    )
    
    if (!geocodingIntegrations.length) {
      console.error('No geocoding integration available')
      return null
    }
    
    const geocodingIntegration = integrationManager.getCachedIntegrationInstance(geocodingIntegrations[0])
    
    if (!geocodingIntegration?.capabilities.geocoding) {
      console.error('Geocoding capability not available')
      return null
    }
    
    const step1Start = Date.now()
    const results = await geocodingIntegration.capabilities.geocoding.reverseGeocode(lat, lng)
    const step1Time = Date.now() - step1Start
    console.log(`⏱️ [PERF] Step 1 - Reverse geocoding: ${step1Time}ms`)
    
    if (!results?.[0]) {
      console.log(`⏱️ [PERF] Total time (no results): ${Date.now() - startTime}ms`)
      return null
    }
    
    let place = results[0]
    
    // Step 2: If we found a place with a name or ID, try to get full enriched details
    // This handles clicking near a POI - we want the full POI details, not just address
    
    // First, check if we have an OSM ID - if so, use the full enrichment pipeline
    const osmId = place.externalIds?.[SOURCE.OSM]
    if (osmId) {
      console.log(`📍 Found OSM ID: ${osmId}, using full enrichment pipeline...`)
      
      const step2Start = Date.now()
      const enrichedPlace = await lookupEnrichedPlaceById(SOURCE.OSM, osmId, { userId, language })
      const step2Time = Date.now() - step2Start
      console.log(`⏱️ [PERF] Step 2 - Full enrichment by OSM ID: ${step2Time}ms`)
      
      if (enrichedPlace) {
        // Override the coordinates with the exact clicked coordinates
        // This ensures the marker stays where the user clicked
        enrichedPlace.geometry = {
          ...enrichedPlace.geometry,
          value: {
            ...enrichedPlace.geometry.value,
            center: { lat, lng },
          },
        }
        
        const totalTime = Date.now() - startTime
        console.log(`⏱️ [PERF] Total coordinate lookup time (with OSM enrichment): ${totalTime}ms`)
        return enrichedPlace
      }
    }
    
    // Second, check if we have a Geoapify place ID
    // Fetch it to extract the OSM ID, then use OSM for full enrichment
    const geoapifyPlaceId = place.externalIds?.[SOURCE.GEOAPIFY]
    if (!osmId && geoapifyPlaceId) {
      console.log(`📍 Found Geoapify place ID: ${geoapifyPlaceId}, extracting OSM ID...`)
      
      const step2Start = Date.now()
      
      // Fetch from Geoapify to get OSM ID
      const { IntegrationId, IntegrationCapabilityId } = await import('../types/integration.enums.js')
      const geoapifyRecords = integrationManager
        .getConfiguredIntegrationsByCapability(IntegrationCapabilityId.PLACE_INFO)
        .filter((int) => int.integrationId === IntegrationId.GEOAPIFY)
      
      if (geoapifyRecords.length) {
        const geoapifyIntegration = integrationManager.getCachedIntegrationInstance(geoapifyRecords[0])
        
        if (geoapifyIntegration?.capabilities.placeInfo) {
          try {
            const geoapifyPlace = await geoapifyIntegration.capabilities.placeInfo.getPlaceInfo(geoapifyPlaceId)
            const extractedOsmId = geoapifyPlace?.externalIds?.[SOURCE.OSM]
            
            if (extractedOsmId) {
              console.log(`📍 Extracted OSM ID from Geoapify: ${extractedOsmId}, using full OSM enrichment...`)
              const enrichedPlace = await lookupEnrichedPlaceById(SOURCE.OSM, extractedOsmId, { userId, language })
              const step2Time = Date.now() - step2Start
              console.log(`⏱️ [PERF] Step 2 - Full enrichment via Geoapify→OSM: ${step2Time}ms`)
              
              if (enrichedPlace) {
                // Override the coordinates with the exact clicked coordinates
                enrichedPlace.geometry = {
                  ...enrichedPlace.geometry,
                  value: {
                    ...enrichedPlace.geometry.value,
                    center: { lat, lng },
                  },
                }
                
                const totalTime = Date.now() - startTime
                console.log(`⏱️ [PERF] Total coordinate lookup time (with Geoapify→OSM enrichment): ${totalTime}ms`)
                return enrichedPlace
              }
            }
          } catch (error) {
            console.error('Error fetching Geoapify place for OSM ID extraction:', error)
          }
        }
      }
      
      const step2Time = Date.now() - step2Start
      console.log(`⏱️ [PERF] Step 2 - Geoapify place lookup (no OSM ID found): ${step2Time}ms`)
    }
    
    // If no OSM ID but we have a name, try name+location search
    if (place.name?.value && place.geometry.value.center) {
      console.log(`📍 Found place with name: ${place.name.value}, searching for full details...`)
      
      const step2Start = Date.now()
      const fullPlace = await lookupPlaceByNameAndLocation(
        place.name.value,
        place.geometry.value.center,
        {
          userId,
          radius: 50, // Search within 50m
          language,
        }
      )
      const step2Time = Date.now() - step2Start
      console.log(`⏱️ [PERF] Step 2 - Name+location search: ${step2Time}ms`)
      
      if (fullPlace) {
        // Override the coordinates with the exact clicked coordinates
        // This ensures the marker stays where the user clicked
        fullPlace.geometry = {
          ...fullPlace.geometry,
          value: {
            ...fullPlace.geometry.value,
            center: { lat, lng },
          },
        }
        
        const totalTime = Date.now() - startTime
        console.log(`⏱️ [PERF] Total coordinate lookup time (with name search): ${totalTime}ms`)
        return fullPlace
      }
    }
    
    // Step 3: No place found or no name - return address-only data
    console.log(`📍 No place found, returning address-only data`)
    
    // Override geocoded coordinates with the exact clicked coordinates
    place.geometry = {
      ...place.geometry,
      value: {
        ...place.geometry.value,
        center: { lat, lng },
      },
    }
    
    // Strip POI data for address-only results
    place.id = `coords/${lat}/${lng}`
    place.externalIds = {}
    place.name = { value: null, sourceId: 'geocoding', timestamp: new Date().toISOString() }
    place.description = null
    place.placeType = { value: 'address', sourceId: 'geocoding', timestamp: new Date().toISOString() }
    place.photos = []
    place.contactInfo = {
      phone: null,
      email: null,
      website: null,
      socials: {},
    }
    place.openingHours = null
    place.ratings = undefined
    place.transit = null
    place.relations = null
    place.amenities = {}
    
    // Note: No enrichment for address-only results since we've stripped all IDs and data

    const totalTime = Date.now() - startTime
    console.log(`⏱️ [PERF] Total coordinate lookup time (basic enrichment): ${totalTime}ms`)

    return place
  } catch (error) {
    const totalTime = Date.now() - startTime
    console.error(
      `❌ [PERF] Error looking up place by coordinates (${lat},${lng}) after ${totalTime}ms:`,
      error,
    )
    return null
  }
}
