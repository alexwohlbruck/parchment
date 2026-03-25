import type {
  Place,
  PlaceGeometry,
  Address,
  AttributedValue,
  OpeningHours,
  TransitStopInfo,
  PlaceRelation,
} from '../../../types/place.types'
import { getPlaceType } from '../../../lib/place.utils'
import { matchTags, type GeometryType } from '../../../lib/osm-presets'
import { buildPlaceIcon } from '../../../lib/place-categories'
import { SOURCE } from '../../../lib/constants'
import { parseOpeningHoursForUnifiedFormat } from '../../../lib/place.utils'
import { extractTransitIdentifiers, isTransitStopType, isTransitStop, createTransitInfo } from '../../../lib/transit-utils'

/**
 * Interface for Nominatim hierarchy response (parent relations)
 */
export interface NominatimHierarchyResult {
  place_id: number
  osm_type: 'node' | 'way' | 'relation'
  osm_id: number
  class: string
  type: string
  admin_level?: number
  localname?: string
  rank_search?: number
  rank_address?: number
  extratags?: Record<string, string>
}

/**
 * Interface for Nominatim lookup response object
 */
export interface NominatimLookupResult {
  place_id: number
  licence: string
  osm_type: 'node' | 'way' | 'relation'
  osm_id: number
  boundingbox: [string, string, string, string] // [min_lat, max_lat, min_lon, max_lon]
  lat: string
  lon: string
  display_name: string
  class: string
  type: string
  importance: number
  address?: {
    [key: string]: string
  }
  extratags?: {
    [key: string]: string
  }
  namedetails?: {
    [key: string]: string
  }
  geojson?: {
    type: 'Polygon' | 'MultiPolygon' | 'Point' | 'LineString' | 'MultiLineString'
    coordinates: any[] // GeoJSON coordinates array
  }
}

/**
 * Adapter for transforming Nominatim API data to unified formats
 */
export class NominatimAdapter {
  placeInfo = {
    adaptPlaceDetails: (data: NominatimLookupResult, id?: string): Place => {
      const osmId = `${data.osm_type}/${data.osm_id}`
      const primaryId = id || `${SOURCE.OSM}/${osmId}`
      const timestamp = new Date().toISOString()

      const geometry = this.extractGeometry(data)
      
      // Build complete tags object for place type detection
      const tags: Record<string, string> = {
        [data.class]: data.type,
        ...data.extratags,
      }
      
      // Map Nominatim geometry types to OSM geometry types
      const geometryTypeMap: Record<string, 'point' | 'line' | 'area'> = {
        'point': 'point',
        'linestring': 'line',
        'polygon': 'area',
        'multipolygon': 'area',
      }
      const osmGeometryType = geometryTypeMap[geometry.type] || 'point'

      // Match tags to get preset and build icon
      const presetMatch = matchTags(tags, osmGeometryType as GeometryType)
      const icon = buildPlaceIcon(presetMatch)

      return {
        id: primaryId,
        externalIds: this.extractExternalIds(data, osmId),
        name: {
          value: this.extractName(data),
          sourceId: SOURCE.OSM,
          timestamp,
        },
        description: this.extractDescription(data.extratags),
        placeType: {
          value: getPlaceType(tags, 'en', osmGeometryType) || data.type || 'unknown',
          sourceId: SOURCE.OSM,
          timestamp,
        },
        icon,
        geometry: {
          value: geometry,
          sourceId: SOURCE.OSM,
          timestamp,
        },
        photos: [], // Nominatim doesn't provide photos
        address: this.extractAddress(data.address),
        contactInfo: this.extractContactInfo(data.extratags),
        openingHours: this.extractOpeningHours(data.extratags),
        amenities: this.extractAmenities(data),
        ...this.getTransitField(data),
        sources: [
          {
            id: SOURCE.OSM,
            name: 'OpenStreetMap',
            url: `https://www.openstreetmap.org/${data.osm_type}/${data.osm_id}`,
          },
        ],
        lastUpdated: timestamp,
        createdAt: timestamp,
      }
    },
  }

  /**
   * Extract external IDs from Nominatim data
   */
  private extractExternalIds(data: NominatimLookupResult, osmId: string): Record<string, string> {
    const externalIds: Record<string, string> = {
      [SOURCE.OSM]: osmId,
    }

    // Extract Wikidata ID if available
    if (data.extratags?.wikidata) {
      externalIds[SOURCE.WIKIDATA] = data.extratags.wikidata
    }

    // Extract Wikipedia reference if available
    if (data.extratags?.wikipedia) {
      externalIds[SOURCE.WIKIPEDIA] = data.extratags.wikipedia
    }

    return externalIds
  }

  /**
   * Extract the name from Nominatim data
   */
  private extractName(data: NominatimLookupResult): string | null {
    // namedetails contains the OSM name tags of the object itself
    if (data.namedetails) {
      return (
        data.namedetails.name ||
        data.namedetails['name:en'] ||
        data.namedetails.brand ||
        null
        // Note: do NOT fall back to Object.values()[0] — it picks up alt_name,
        // old_name, or other secondary designations that shouldn't become the title.
      )
    }

    // extratags can carry name/brand when namedetails isn't requested
    if (data.extratags) {
      return (
        data.extratags.name ||
        data.extratags['name:en'] ||
        data.extratags.brand ||
        data.extratags.operator ||
        null
      )
    }

    // Do NOT fall back to display_name — it contains the surrounding area/street
    // name for unnamed objects (e.g. a picnic table at "The Plaza" returns
    // display_name "The Plaza, …", which is the park, not the object's name).
    return null
  }

  /**
   * Extract description from extratags
   */
  private extractDescription(
    extratags?: Record<string, string>,
  ): AttributedValue<string> | null {
    if (!extratags) return null

    const description =
      extratags.description ||
      extratags['description:en'] ||
      extratags.note ||
      extratags.comment ||
      null

    if (!description) return null

    return {
      value: description,
      sourceId: SOURCE.OSM,
      timestamp: new Date().toISOString(),
    }
  }

  /**
   * Extract geometry from Nominatim data
   */
  private extractGeometry(data: NominatimLookupResult): PlaceGeometry {
    const lat = parseFloat(data.lat)
    const lng = parseFloat(data.lon)
    
    // Default to point geometry
    let geometry: PlaceGeometry = {
      type: 'point',
      center: { lat, lng },
    }

    // Process GeoJSON geometry if available
    if (data.geojson) {
      switch (data.geojson.type) {
        case 'LineString':
        case 'MultiLineString':
          geometry = {
            type: 'linestring',
            center: { lat, lng },
            nodes: this.extractLineStringNodes(data.geojson.coordinates, data.geojson.type),
          }
          break
          
        case 'Polygon':
          geometry = {
            type: 'polygon',
            center: { lat, lng },
            nodes: this.extractPolygonNodes(data.geojson.coordinates),
          }
          break
          
        case 'MultiPolygon':
          geometry = {
            type: 'multipolygon',
            center: { lat, lng },
            polygons: this.extractMultiPolygonNodes(data.geojson.coordinates),
          }
          break
          
        case 'Point':
          // Keep as point geometry (already set)
          break
      }
    }

    // Add bounding box if available
    if (data.boundingbox && data.boundingbox.length === 4) {
      const [minLat, maxLat, minLng, maxLng] = data.boundingbox.map(parseFloat)
      geometry.bounds = {
        minLat,
        minLng,
        maxLat,
        maxLng,
      }
    }

    return geometry
  }

  /**
   * Extract coordinate nodes from GeoJSON LineString or MultiLineString coordinates
   * LineString format: [[lng, lat], [lng, lat], ...]
   * MultiLineString format: [[[lng, lat], [lng, lat], ...], ...]
   */
  private extractLineStringNodes(coordinates: any, type: string): Array<{ lat: number; lng: number }> {
    if (!coordinates) return []
    
    if (type === 'LineString') {
      // Direct coordinate array
      return coordinates.map(([lng, lat]: number[]) => ({ lat, lng }))
    } else if (type === 'MultiLineString') {
      // Array of LineStrings - combine all lines into one array
      const allNodes: Array<{ lat: number; lng: number }> = []
      coordinates.forEach((lineCoords: number[][]) => {
        allNodes.push(...lineCoords.map(([lng, lat]) => ({ lat, lng })))
      })
      return allNodes
    }
    
    return []
  }

  /**
   * Extract coordinate nodes from GeoJSON Polygon coordinates
   * GeoJSON Polygon format: [[[lng, lat], [lng, lat], ...]]
   */
  private extractPolygonNodes(coordinates: number[][][]): Array<{ lat: number; lng: number }> {
    if (!coordinates || coordinates.length === 0) return []
    
    // Take the exterior ring (first array in coordinates)
    const exteriorRing = coordinates[0]
    return exteriorRing.map(([lng, lat]) => ({ lat, lng }))
  }

  /**
   * Extract all polygons from GeoJSON MultiPolygon coordinates
   * GeoJSON MultiPolygon format: [[[[lng, lat], [lng, lat], ...]], ...]
   * Returns array of polygon rings where each polygon can have multiple rings (exterior + holes)
   */
  private extractMultiPolygonNodes(coordinates: number[][][][]): Array<Array<{ lat: number; lng: number }>> {
    if (!coordinates || coordinates.length === 0) return []
    
    const polygons: Array<Array<{ lat: number; lng: number }>> = []
    
    // Process each polygon in the multipolygon
    coordinates.forEach((polygonCoords) => {
      if (polygonCoords && polygonCoords.length > 0) {
        // For now, just take the exterior ring (first ring) of each polygon
        // TODO: In the future, we could handle holes by processing all rings
        const exteriorRing = polygonCoords[0]
        if (exteriorRing && exteriorRing.length > 0) {
          polygons.push(exteriorRing.map(([lng, lat]) => ({ lat, lng })))
        }
      }
    })
    
    return polygons
  }

  /**
   * Extract address from Nominatim address breakdown
   */
  private extractAddress(
    address?: Record<string, string>,
  ): AttributedValue<Address> | null {
    if (!address) return null

    const addressObj: Address = {}

    // Map Nominatim address fields to our Address interface
    if (address.house_number && address.road) {
      addressObj.street1 = `${address.house_number} ${address.road}`
    } else if (address.road) {
      addressObj.street1 = address.road
    }

    addressObj.neighborhood = address.suburb || address.neighbourhood
    addressObj.locality = 
      address.city || 
      address.town || 
      address.village || 
      address.municipality
    addressObj.region = 
      address.state || 
      address.county || 
      address.province
    addressObj.postalCode = address.postcode
    addressObj.country = address.country
    addressObj.countryCode = address.country_code?.toUpperCase()

    // Use display_name as formatted address fallback
    if (Object.keys(addressObj).length === 0) {
      return null
    }

    return {
      value: addressObj,
      sourceId: SOURCE.OSM,
      timestamp: new Date().toISOString(),
    }
  }

  /**
   * Extract contact information from extratags
   */
  private extractContactInfo(extratags?: Record<string, string>): {
    phone: AttributedValue<string> | null
    email: AttributedValue<string> | null
    website: AttributedValue<string> | null
    socials: Record<string, AttributedValue<string>>
  } {
    const timestamp = new Date().toISOString()
    const contactInfo = {
      phone: null as AttributedValue<string> | null,
      email: null as AttributedValue<string> | null,
      website: null as AttributedValue<string> | null,
      socials: {} as Record<string, AttributedValue<string>>,
    }

    if (!extratags) return contactInfo

    // Phone
    if (extratags.phone || extratags['contact:phone']) {
      contactInfo.phone = {
        value: extratags.phone || extratags['contact:phone'],
        sourceId: SOURCE.OSM,
        timestamp,
      }
    }

    // Email
    if (extratags.email || extratags['contact:email']) {
      contactInfo.email = {
        value: extratags.email || extratags['contact:email'],
        sourceId: SOURCE.OSM,
        timestamp,
      }
    }

    // Website
    if (extratags.website || extratags['contact:website'] || extratags.url) {
      contactInfo.website = {
        value: extratags.website || extratags['contact:website'] || extratags.url,
        sourceId: SOURCE.OSM,
        timestamp,
      }
    }

    // Social media
    const socialPlatforms = ['facebook', 'instagram', 'twitter', 'linkedin', 'youtube']
    for (const platform of socialPlatforms) {
      const value = extratags[platform] || extratags[`contact:${platform}`]
      if (value) {
        contactInfo.socials[platform] = {
          value,
          sourceId: SOURCE.OSM,
          timestamp,
        }
      }
    }

    return contactInfo
  }

  /**
   * Extract opening hours from extratags
   */
  private extractOpeningHours(
    extratags?: Record<string, string>,
  ): AttributedValue<OpeningHours> | null {
    if (!extratags || !extratags.opening_hours) return null

    const openingHours = extratags.opening_hours
    const isOpen24_7 = openingHours.includes('24/7')

    return {
      value: {
        regularHours: parseOpeningHoursForUnifiedFormat(openingHours) || [],
        isOpen24_7,
        isPermanentlyClosed: extratags.disused === 'yes' || extratags.abandoned === 'yes',
        isTemporarilyClosed: openingHours === 'closed',
        rawText: openingHours,
      },
      sourceId: SOURCE.OSM,
      timestamp: new Date().toISOString(),
    }
  }

  /**
   * Extract amenities from Nominatim data
   */
  private extractAmenities(data: NominatimLookupResult): Record<string, any> {
    const amenities: Record<string, any> = {}

    // Add place classification
    if (data.class && data.type) {
      amenities[`type:${data.class}`] = data.type
    }

    // Add extratags as amenities
    if (data.extratags) {
      for (const [key, value] of Object.entries(data.extratags)) {
        // Skip fields already processed elsewhere
        if (!['name', 'phone', 'email', 'website', 'opening_hours', 'description'].includes(key)) {
          amenities[key] = value
        }
      }
    }

    return amenities
  }

  /**
   * Get transit field for Place object (only includes if there's meaningful transit data)
   */
  private getTransitField(data: NominatimLookupResult): { transit: AttributedValue<TransitStopInfo> } | {} {
    const transitInfo = this.extractTransitInfo(data)
    // Only include transit field if we have an onestop ID or other meaningful identifiers
    if (transitInfo && (transitInfo.value.onestopId || transitInfo.value.code)) {
      return { transit: transitInfo }
    }
    return {}
  }

  /**
   * Extract transit information from Nominatim data
   */
  private extractTransitInfo(data: NominatimLookupResult): AttributedValue<TransitStopInfo> | null {
    const tags = data.extratags || {}
    return createTransitInfo(
      tags,
      this.extractName(data) || undefined,
      data.extratags?.description
    )
  }

  /**
   * Look up parent relations for an OSM object
   * Useful for finding transit stop areas, building complexes, etc.
   */
  async lookupParentRelations(
    osmId: string, // format: "node/123" or "way/456" or "relation/789"
    baseUrl: string
  ): Promise<PlaceRelation[]> {
    const [osmType, osmIdNumber] = osmId.split('/')
    
    const url = new URL(`${baseUrl}/hierarchy`)
    url.searchParams.set('osm_type', osmType.charAt(0).toUpperCase()) // N, W, or R
    url.searchParams.set('osm_id', osmIdNumber)
    url.searchParams.set('format', 'json')
    
    try {
      const response = await fetch(url.toString())
      if (!response.ok) return []
      
      const data: NominatimHierarchyResult[] = await response.json()
      
      return data
        .filter(item => this.isUsefulRelation(item))
        .map(item => ({
          id: `${item.osm_type}/${item.osm_id}`,
          type: item.osm_type,
          name: item.localname || item.extratags?.name,
          placeType: this.getRelationPlaceType(item),
          relationshipType: 'parent' as const,
          tags: item.extratags || {}
        }))
    } catch (error) {
      console.error('Error looking up parent relations:', error)
      return []
    }
  }

  // TODO: Review for necessity
  /**
   * Determine if a relation is useful to return (filters out administrative boundaries, etc.)
   */
  private isUsefulRelation(item: NominatimHierarchyResult): boolean {
    const tags = item.extratags || {}
    
    // Always include transit-related relations
    if (tags.public_transport || tags.railway || tags.route || tags.type === 'public_transport') {
      return true
    }
    
    // Include building complexes, campuses, etc.
    if (tags.amenity || tags.landuse || tags.leisure || tags.tourism) {
      return true
    }
    
    // Include sites and areas
    if (tags.type === 'site' || tags.type === 'multipolygon') {
      return true
    }
    
    // Skip administrative boundaries (unless they're special cases)
    if (item.class === 'boundary' && item.type === 'administrative') {
      return false
    }
    
    // Skip if no meaningful tags
    if (Object.keys(tags).length === 0) {
      return false
    }
    
    return true
  }

  // TODO: Review for necessity
  /**
   * Get a meaningful place type for a relation
   */
  private getRelationPlaceType(item: NominatimHierarchyResult): string {
    const tags = item.extratags || {}
    
    // Transit-specific types
    if (tags.public_transport === 'stop_area') return 'Transit Stop Area'
    if (tags.public_transport === 'platform') return 'Transit Platform'
    if (tags.railway === 'station') return 'Railway Station'
    if (tags.type === 'public_transport') return 'Transit Area'
    
    // Building/facility types
    if (tags.amenity) return tags.amenity.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
    if (tags.landuse) return tags.landuse.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
    if (tags.leisure) return tags.leisure.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
    if (tags.tourism) return tags.tourism.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
    
    // Fallback to class/type
    return `${item.class}/${item.type}`.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
  }
}
