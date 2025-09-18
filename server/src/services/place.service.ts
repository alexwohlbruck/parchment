import type { Place } from '../types/place.types'
import type { SupportedLanguage } from '../lib/i18n'
import { mergePlacesCollection, mergePlaces } from './merge.service'
import { Source, SOURCE } from '../lib/constants'
import { findBookmarkByExternalIds } from './library/bookmarks.service'
import * as turf from '@turf/turf'
import { integrationManager } from './integrations'
import { IntegrationCapabilityId } from '../types/integration.types'
import { User } from '../schema/users.schema'
import { WikidataIntegration } from './integrations/wikidata-integration'
import { WikipediaIntegration } from './integrations/wikipedia-integration'
import { WikimediaIntegration } from './integrations/wikimedia-integration'
import { dedupeWikiPhotos } from './integrations/wiki-utils'

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
    // Check if we have a Wikidata ID
    const wikidataId = place.externalIds?.wikidata
    if (!wikidataId) {
      console.log('No Wikidata ID found for place, skipping Wiki enrichment')
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
