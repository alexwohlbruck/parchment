import type {
  UnifiedPlace,
  PlaceGeometry,
  Address,
  AttributedValue,
  OpeningHours,
} from '../../../types/unified-place.types'
import { getPlaceType } from '../../../lib/place.utils'
import { getTimestamp } from '../../../services/merge.service'
import { SOURCE } from '../../../lib/constants'
import { parseOsmHours } from '../../../lib/hours.utils'

/**
 * Interface for Pelias Feature response object
 */
export interface PeliasFeature {
  type: string
  geometry: {
    type: string
    coordinates: [number, number] // [longitude, latitude]
  }
  properties: {
    id: string
    gid: string
    layer: string
    source: string
    source_id: string
    name: string
    housenumber?: string
    street?: string
    postalcode?: string
    accuracy: string
    country?: string
    country_code?: string
    country_gid?: string
    country_a?: string
    region?: string
    region_gid?: string
    region_a?: string
    county?: string
    county_gid?: string
    county_a?: string
    locality?: string
    locality_gid?: string
    neighbourhood?: string
    neighbourhood_gid?: string
    label: string
    addendum?: {
      osm?: Record<string, string>
    }
  }
  bbox?: [number, number, number, number] // [minLon, minLat, maxLon, maxLat]
}

/**
 * Adapter for transforming Pelias API data to unified formats
 */
export class PeliasAdapter {
  /**
   * Transforms Pelias API data to our unified place format
   */
  adaptPlace(feature: PeliasFeature, id?: string): UnifiedPlace {
    try {
      const props = feature.properties
      const osmId = props.source_id
      const osmData = props.addendum?.osm || {}

      // Generate ID
      const placeId = id || osmId || `${SOURCE.PELIAS}/${props.id || props.gid}`

      // Determine place type
      let placeType = props.layer || 'unknown'
      if (props.addendum?.osm) {
        placeType = getPlaceType(props.addendum.osm)
      }

      // Extract coordinates
      const lng = feature.geometry.coordinates[0]
      const lat = feature.geometry.coordinates[1]

      // Create geometry
      const geometry: PlaceGeometry = {
        type: 'point',
        center: {
          lat,
          lng,
        },
      }

      // Add bounding box if available
      if (feature.bbox) {
        geometry.bounds = {
          minLat: feature.bbox[1],
          minLng: feature.bbox[0],
          maxLat: feature.bbox[3],
          maxLng: feature.bbox[2],
        }
      }

      // Create address
      const address = this.extractAddress(props)

      // Create external IDs
      const externalIds: Record<string, string> = {
        [SOURCE.PELIAS]: props.gid || props.id,
      }

      // Add OSM ID if available
      if (osmId && props.source === 'openstreetmap') {
        externalIds[SOURCE.OSM] = osmId
      }

      // Create unified place
      const unifiedPlace: UnifiedPlace = {
        id: placeId,
        externalIds,
        name: props.name || 'Unnamed Place',
        placeType,
        geometry,
        photos: [],
        address,
        contactInfo: this.extractContactInfo(osmData),
        openingHours: this.extractOpeningHours(osmData),
        amenities: this.extractAmenities(props, osmData),
        sources: [
          {
            id: SOURCE.PELIAS,
            name: 'Pelias',
            url: osmId ? `https://www.openstreetmap.org/${osmId}` : '',
          },
        ],
        lastUpdated: getTimestamp(),
        createdAt: getTimestamp(),
      }

      return unifiedPlace
    } catch (error) {
      console.error('Error adapting Pelias data:', error)

      // Return minimal valid place data
      return {
        id: id || `${SOURCE.PELIAS}/${feature.properties?.gid || 'unknown'}`,
        externalIds: { [SOURCE.PELIAS]: feature.properties?.gid || 'unknown' },
        name: feature.properties?.name || 'Unnamed Place',
        placeType: 'unknown',
        geometry: {
          type: 'point',
          center: {
            lat: feature.geometry?.coordinates?.[1] || 0,
            lng: feature.geometry?.coordinates?.[0] || 0,
          },
        },
        photos: [],
        address: null,
        contactInfo: {
          phone: null,
          email: null,
          website: null,
          socials: {},
        },
        openingHours: null,
        amenities: {},
        sources: [
          {
            id: SOURCE.PELIAS,
            name: 'Pelias',
            url: '',
          },
        ],
        lastUpdated: getTimestamp(),
        createdAt: getTimestamp(),
      }
    }
  }

  /**
   * Extract address from Pelias properties
   */
  private extractAddress(props: PeliasFeature['properties']): Address | null {
    const address: Address = {}

    if (props.housenumber || props.street) {
      address.street1 = [props.housenumber, props.street]
        .filter(Boolean)
        .join(' ')
    }

    address.locality = props.locality || undefined
    address.region = props.region || undefined
    address.postalCode = props.postalcode || undefined
    address.country = props.country || undefined
    address.countryCode = props.country_code || undefined
    address.neighborhood = props.neighbourhood || undefined

    // Use the label as formatted address if available
    address.formatted = props.label || undefined

    // Return null if no address components found
    return Object.keys(address).length > 0 ? address : null
  }

  /**
   * Extract contact info from OSM data
   */
  private extractContactInfo(osmData: Record<string, string>): {
    phone: AttributedValue<string> | null
    email: AttributedValue<string> | null
    website: AttributedValue<string> | null
    socials: Record<string, AttributedValue<string>>
  } {
    const timestamp = getTimestamp()

    return {
      phone: osmData?.phone
        ? {
            value: osmData.phone,
            sourceId: SOURCE.PELIAS,
            timestamp,
          }
        : null,
      email: osmData?.email
        ? {
            value: osmData.email,
            sourceId: SOURCE.PELIAS,
            timestamp,
          }
        : null,
      website: osmData?.website
        ? {
            value: osmData.website,
            sourceId: SOURCE.PELIAS,
            timestamp,
          }
        : null,
      socials: {}, // Pelias doesn't provide social media data
    }
  }

  /**
   * Extract opening hours from OSM data
   */
  private extractOpeningHours(
    osmData: Record<string, string>,
  ): OpeningHours | null {
    if (!osmData?.opening_hours) return null

    try {
      // Use the OSM hours parser
      return parseOsmHours({
        opening_hours: osmData.opening_hours,
      })
    } catch (error) {
      console.error('Error processing Pelias opening hours:', error)
      return null
    }
  }

  /**
   * Extract amenities from Pelias properties and OSM data
   */
  private extractAmenities(
    props: PeliasFeature['properties'],
    osmData: Record<string, string>,
  ): Record<string, any> {
    const amenities: Record<string, any> = {}

    // Add place type as amenity
    if (props.layer) {
      amenities[`type:${props.layer}`] = props.layer
    }

    // Add OSM amenities if available
    if (osmData) {
      for (const [key, value] of Object.entries(osmData)) {
        // Skip undefined values and already processed fields
        if (
          value &&
          !['website', 'phone', 'email', 'opening_hours'].includes(key)
        ) {
          amenities[key] = value
        }
      }
    }

    return amenities
  }

  /**
   * Adapt a Pelias feature for autocomplete results
   */
  adaptAutocompletePrediction(feature: PeliasFeature): any {
    try {
      console.log(
        'Adapting Pelias feature for autocomplete:',
        JSON.stringify(feature, null, 2).substring(0, 500) + '...',
      )

      if (!feature || !feature.properties) {
        console.error('Invalid feature structure:', feature)
        throw new Error('Invalid feature structure')
      }

      const props = feature.properties

      if (!feature.geometry || !feature.geometry.coordinates) {
        console.error('Missing geometry in feature:', feature)
        throw new Error('Missing geometry in feature')
      }

      // Create a properly formatted address
      let formattedAddress: string | null = null

      // Determine state abbreviation (use region_a if available, otherwise keep full name)
      const stateAbbr = props.region_a || props.region

      // Check if we have a street address
      const hasStreetAddress =
        !!(props.housenumber && props.street) || !!props.street

      if (hasStreetAddress) {
        // Format with street address: "415 Hawthorne Lane, Charlotte, NC, 28204"
        const streetPart =
          props.housenumber && props.street
            ? `${props.housenumber} ${props.street}`
            : props.street

        formattedAddress = `${streetPart}, ${props.locality || ''}, ${
          stateAbbr || ''
        }`

        if (props.postalcode) {
          formattedAddress += `, ${props.postalcode}`
        }
      } else if (props.neighbourhood) {
        // Format with neighborhood: "First Ward, Charlotte, NC, 28204"
        formattedAddress = `${props.neighbourhood}, ${props.locality || ''}, ${
          stateAbbr || ''
        }`

        if (props.postalcode) {
          formattedAddress += `, ${props.postalcode}`
        }
      } else if (props.locality) {
        // Fall back to just city and state if no neighborhood
        formattedAddress = `${props.locality}, ${stateAbbr || ''}`

        if (props.postalcode) {
          formattedAddress += `, ${props.postalcode}`
        }
      }

      // Clean up extra commas and spaces from empty fields
      formattedAddress =
        formattedAddress
          ?.replace(/,\s*,/g, ',')
          ?.replace(/,\s*$/g, '')
          ?.trim() || null

      // Determine if the source_id is an OSM ID (typically starts with "way/", "node/", or "relation/")
      const isOsmId =
        props.source === 'openstreetmap' &&
        (props.source_id?.startsWith('way/') ||
          props.source_id?.startsWith('node/') ||
          props.source_id?.startsWith('relation/'))

      // TODO: I would like to keep pelias as the provider name, but osm as the "source" name
      // For OSM IDs, we want to use the full ID (way/123, node/456, etc.)
      // For non-OSM IDs, we can use the Pelias ID format
      const id = isOsmId
        ? `osm/${props.source_id}`
        : `${SOURCE.PELIAS}/${props.gid || props.id}`

      return {
        id: id,
        name: props.name,
        description: formattedAddress || props.label, // Use the formatted address for description if available
        types: [props.layer],
        source: SOURCE.PELIAS,
        geometry: {
          lat: feature.geometry.coordinates[1],
          lng: feature.geometry.coordinates[0],
        },
        // Add more address details to help with structuring the final address
        addressDetails: {
          housenumber: props.housenumber,
          street: props.street,
          locality: props.locality,
          region: props.region,
          region_a: props.region_a,
          country: props.country,
          postalcode: props.postalcode,
          neighbourhood: props.neighbourhood,
          formatted: formattedAddress,
        },
      }
    } catch (error) {
      console.error('Error processing Pelias autocomplete item:', error)
      // Return a more complete fallback object with better debugging info
      return {
        id: `${SOURCE.PELIAS}/unknown`,
        name: feature?.properties?.name || 'Unknown',
        description: null,
        source: SOURCE.PELIAS,
        error: error instanceof Error ? error.message : 'Unknown error',
        feature: feature
          ? JSON.stringify(feature).substring(0, 200) + '...'
          : 'null',
        geometry: {
          lat: feature?.geometry?.coordinates?.[1] || 0,
          lng: feature?.geometry?.coordinates?.[0] || 0,
        },
      }
    }
  }
}
