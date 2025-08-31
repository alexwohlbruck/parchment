import type {
  Place,
  PlaceGeometry,
  Address,
  AttributedValue,
  OpeningHours,
} from '../../../types/place.types'
import { getPlaceType } from '../../../lib/place.utils'
import { SOURCE } from '../../../lib/constants'
import { parseOsmHours } from '../../../lib/hours.utils'

// TODO: Check all SOURCE.PELIAS and SOURCE.OSM references. Idk what to do with these yet. Pelias can use various sources.

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
  autocomplete = {
    adaptPlaceDetails: (feature: PeliasFeature, id?: string): Place => {
      return this.adaptPlaceDetails(feature, id)
    },
  }

  placeInfo = {
    adaptPlaceDetails: (feature: PeliasFeature, id?: string): Place => {
      return this.adaptPlaceDetails(feature, id)
    },
  }

  geocoding = {
    adaptPlaceDetails: (feature: PeliasFeature, id?: string): Place => {
      return this.adaptPlaceDetails(feature, id)
    },
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

    // TODO: We may want server-side formatted address, but for now we will return raw address object for pelias
    // // Only use the label as formatted address if we don't have street-level data
    // // The label often includes the place name which contaminates the address
    // if (address.street1) {
    //   // Build our own formatted address from components to avoid place name contamination
    //   const parts = []
    //   if (address.street1) parts.push(address.street1)
    //   if (address.locality) parts.push(address.locality)
    //   if (address.region && address.postalCode) {
    //     parts.push(`${address.region} ${address.postalCode}`)
    //   } else if (address.region) {
    //     parts.push(address.region)
    //   } else if (address.postalCode) {
    //     parts.push(address.postalCode)
    //   }
    //   if (address.country) parts.push(address.country)

    //   address.formatted = parts.join(', ')
    // }

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
    const timestamp = new Date().toISOString()

    return {
      phone: osmData?.phone
        ? {
            value: osmData.phone,
            sourceId: SOURCE.OSM,
            timestamp,
          }
        : null,
      email: osmData?.email
        ? {
            value: osmData.email,
            sourceId: SOURCE.OSM,
            timestamp,
          }
        : null,
      website: osmData?.website
        ? {
            value: osmData.website,
            sourceId: SOURCE.OSM,
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
   * Core method to transform Pelias API data to unified place format
   */
  private adaptPlaceDetails(feature: PeliasFeature, id?: string): Place {
    try {
      const props = feature.properties
      const osmId = props.source_id
      const osmData = props.addendum?.osm || {}

      // Determine the actual source from Pelias response
      // TODO: Add more source checks, pelias also has sources such as WhosOnFirst, OpenCage, etc.
      const actualSource =
        props.source === 'openaddresses' ? SOURCE.OPENADDRESSES : SOURCE.OSM

      // Create external IDs mapping
      const externalIds: Record<string, string> = {}

      // Add the original provider ID to external IDs
      if (osmId && props.source === 'openstreetmap') {
        externalIds[SOURCE.OSM] = osmId
      } else if (props.source === 'openaddresses') {
        externalIds[SOURCE.OPENADDRESSES] = props.gid || props.id
      } else {
        // Default case - use the actual source
        externalIds[actualSource] = props.gid || props.id
      }

      // Generate primary ID using source/providerId format
      const primaryId =
        id || `${actualSource}/${osmId || props.gid || props.id}`

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

      // Create unified place
      const unifiedPlace: Place = {
        id: primaryId,
        externalIds,
        name: {
          value: props.name || null,
          sourceId: actualSource,
        },
        description: null,
        placeType: {
          value: placeType,
          sourceId: actualSource,
        },
        geometry: {
          value: geometry,
          sourceId: actualSource,
        },
        photos: [],
        address: address
          ? {
              value: address,
              sourceId: actualSource,
            }
          : null,
        contactInfo: this.extractContactInfo(osmData),
        openingHours: this.extractOpeningHours(osmData)
          ? {
              value: this.extractOpeningHours(osmData)!,
              sourceId: actualSource,
            }
          : null,
        amenities: this.extractAmenities(props, osmData),
        sources: [
          {
            id: actualSource,
            name:
              actualSource === SOURCE.OSM ? 'OpenStreetMap' : 'OpenAddresses',
            url: osmId ? `https://www.openstreetmap.org/${osmId}` : '',
          },
        ],
        lastUpdated: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      }

      return unifiedPlace
    } catch (error) {
      console.error('Error adapting Pelias data:', error)

      // Determine the actual source for error case
      const actualSource =
        feature.properties?.source === 'openaddresses'
          ? SOURCE.OPENADDRESSES
          : SOURCE.OSM

      // Return minimal valid place data
      return {
        id: id || `${actualSource}/${feature.properties?.gid || 'unknown'}`,
        externalIds: { [actualSource]: feature.properties?.gid || 'unknown' },
        name: {
          value: feature.properties?.name || null,
          sourceId: actualSource,
        },
        description: null,
        placeType: {
          value: 'unknown',
          sourceId: actualSource,
        },
        geometry: {
          value: {
            type: 'point',
            center: {
              lat: feature.geometry?.coordinates?.[1] || 0,
              lng: feature.geometry?.coordinates?.[0] || 0,
            },
          },
          sourceId: actualSource,
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
            id: actualSource,
            name:
              actualSource === SOURCE.OSM ? 'OpenStreetMap' : 'OpenAddresses',
            url: '',
          },
        ],
        lastUpdated: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      }
    }
  }
}
