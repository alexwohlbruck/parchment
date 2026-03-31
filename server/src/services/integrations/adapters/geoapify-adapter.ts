import type {
  Place,
  PlaceGeometry,
  Address,
  AttributedValue,
} from '../../../types/place.types'
import type {
  UnifiedRoute,
  Route,
  RouteLeg,
  RouteInstruction,
  RouteSummary,
  RouteRequest,
  Coordinate,
  TravelMode,
} from '../../../types/unified-routing.types'
import { getPlaceType } from '../../../lib/place.utils'
import { matchTags } from '../../../lib/osm-presets'
import { buildPlaceIcon } from '../../../lib/place-categories'
import { SOURCE } from '../../../lib/constants'
import { getPresetFromGeoapifyCategory } from '../mappings/geoapify-preset-mapping'

export interface GeoapifyFeature {
  type: string
  geometry: {
    type: string
    coordinates: [number, number]
  }
  properties: {
    place_id: string
    name?: string
    categories?: string[]
    street?: string
    housenumber?: string
    postcode?: string
    city?: string
    state?: string
    country?: string
    country_code?: string
    formatted?: string
    lat: number
    lon: number
    datasource?: {
      raw?: {
        osm_id: string
        osm_type: 'n' | 'w' | 'r'
      }
    }
    [key: string]: any
  }
}

// Geoapify Routing API types
export interface GeoapifyRoutingResponse {
  type: 'FeatureCollection'
  features: GeoapifyRouteFeature[]
  properties: {
    mode: string
    waypoints: Array<{ location: [number, number] }>
    units: string
    time?: number
  }
}

export interface GeoapifyRouteFeature {
  type: 'Feature'
  properties: {
    mode: string
    waypoints: Array<{ location: [number, number]; original_index: number }>
    units: string
    distance: number
    time: number
    legs: GeoapifyRouteLeg[]
  }
  geometry: {
    type: 'LineString' | 'MultiLineString'
    coordinates: Array<[number, number]> | Array<Array<[number, number]>>
  }
}

export interface GeoapifyRouteLeg {
  distance: number
  time: number
  steps: GeoapifyRouteStep[]
}

export interface GeoapifyRouteStep {
  distance: number
  time: number
  from_index?: number
  to_index?: number
  instruction?: {
    text: string
    type: string | number // Can be string like "StartAtLeft" or number
    transition_instruction?: string
    pre_transition_instruction?: string
    post_transition_instruction?: string
    contains_next_instruction?: boolean
  }
  geometry?: {
    type: 'LineString'
    coordinates: Array<[number, number]>
  }
  // Additional properties from route_details
  speed?: number
  speed_limit?: number
  surface?: string
  road_class?: string
  name?: string // street name
  
  // Elevation properties (when elevation details are requested)
  elevation?: number
  max_elevation?: number
  min_elevation?: number
  elevation_gain?: number
}

function getOsmId(feature: GeoapifyFeature): string | null {
  if (!feature.properties.datasource?.raw?.osm_id || !feature.properties.datasource?.raw?.osm_type) {
    return null
  }
  const typeMap = {
    n: 'node',
    w: 'way',
    r: 'relation',
  }
  return [
    'osm',
    typeMap[feature.properties.datasource.raw.osm_type] || 'node',
    feature.properties.datasource.raw.osm_id,
  ].join('/')
}

export class GeoapifyAdapter {
  // Geocoding and autocomplete methods
  geocoding = {
    adaptPlaceDetails: (feature: GeoapifyFeature): Place => {
      return this.adaptPlaceDetails(feature)
    },
  }

  autocomplete = {
    adaptPlaceDetails: (feature: GeoapifyFeature): Place => {
      return this.adaptPlaceDetails(feature)
    },
  }

  // Routing methods
  routing = {
    adaptRouteResponse: (
      response: GeoapifyRoutingResponse,
      request: RouteRequest,
    ): UnifiedRoute => {
      return this.adaptRouteResponse(response, request)
    },
  }

  adaptPlaceDetails(feature: GeoapifyFeature): Place {
    try {
      const props = feature.properties
      const timestamp = new Date().toISOString()

      const lng = feature.geometry.coordinates[0]
      const lat = feature.geometry.coordinates[1]

      const geometry: PlaceGeometry = {
        type: 'point',
        center: { lat, lng },
      }

      const address = this.extractAddress(props)
      const rawTags = (props.datasource?.raw && typeof props.datasource.raw === 'object')
        ? props.datasource.raw as Record<string, string>
        : null
      const placeType = rawTags ? getPlaceType(rawTags) : 'unknown'
      const presetMatch = rawTags ? matchTags(rawTags) : null
      const icon = buildPlaceIcon(presetMatch)

      const osmId = getOsmId(feature)
      const externalIds: Record<string, string> = {}
      
      // Extract OSM ID from datasource.raw (only available in place details API, not reverse geocoding)
      if (props.datasource?.raw?.osm_id && props.datasource?.raw?.osm_type) {
        // Map Geoapify OSM type codes to full names
        const typeMap: Record<string, string> = {
          'n': 'node',
          'w': 'way',
          'r': 'relation',
        }
        const osmType = typeMap[props.datasource.raw.osm_type] || 'node'
        externalIds.osm = `${osmType}/${props.datasource.raw.osm_id}`
      }
      if (props.place_id) {
        externalIds.geoapify = props.place_id
      }

      const sourceId = SOURCE.OSM

      const place: Place = {
        id: osmId || `geoapify/${props.place_id}`,
        externalIds,
        name: {
          value: props.name || null,
          sourceId: sourceId,
          timestamp,
        },
        description: null,
        placeType: {
          value: placeType || 'unknown',
          sourceId: sourceId,
          timestamp,
        },
        icon,
        geometry: {
          value: geometry,
          sourceId: sourceId,
          timestamp,
        },
        photos: [],
        address: address
          ? {
              value: address,
              sourceId: sourceId,
              timestamp,
            }
          : null,
        contactInfo: {
          phone: null,
          email: null,
          website: null,
          socials: {},
        },
        openingHours: null,
        amenities: this.extractAmenities(props),
        sources: [
          {
            id: SOURCE.OSM,
            name: 'OpenStreetMap',
            url: '',
          },
        ],
        lastUpdated: timestamp,
        createdAt: timestamp,
      }

      return place
    } catch (error) {
      console.error('Error adapting Geoapify data:', error)

      const fallbackExternalIds: Record<string, string> = {}
      if (feature.properties?.place_id) {
        fallbackExternalIds.geoapify = feature.properties.place_id
      }

      return {
        id: `geoapify/${feature.properties?.place_id || 'unknown'}`,
        externalIds: fallbackExternalIds,
        name: {
          value: feature.properties?.name || null,
          sourceId: SOURCE.OSM,
        },
        description: null,
        placeType: {
          value: 'unknown',
          sourceId: SOURCE.OSM,
        },
        geometry: {
          value: {
            type: 'point',
            center: {
              lat: feature.geometry?.coordinates?.[1] || 0,
              lng: feature.geometry?.coordinates?.[0] || 0,
            },
          },
          sourceId: SOURCE.OSM,
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
            id: SOURCE.OSM,
            name: 'OpenStreetMap',
            url: '',
          },
        ],
        lastUpdated: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      }
    }
  }

  private extractAddress(props: GeoapifyFeature['properties']): Address | null {
    if (!props.street && !props.city && !props.postcode && !props.country) {
      return null
    }

    const address: Address = {}

    if (props.housenumber && props.street) {
      address.street1 = `${props.housenumber} ${props.street}`
    } else if (props.street) {
      address.street1 = props.street
    }

    address.locality = props.city || undefined
    address.region = props.state || undefined
    address.postalCode = props.postcode || undefined
    address.country = props.country || undefined
    address.countryCode = props.country_code?.toUpperCase() || undefined
    address.formatted = props.formatted || undefined

    return Object.keys(address).length > 0 ? address : null
  }

  private extractAmenities(
    props: GeoapifyFeature['properties'],
  ): Record<string, any> {
    const amenities: Record<string, any> = {}

    if (props.categories) {
      props.categories.forEach((category, index) => {
        amenities[`category_${index}`] = category
      })
    }

    return amenities
  }

  /**
   * Convert Geoapify routing response to unified format
   */
  private adaptRouteResponse(
    response: GeoapifyRoutingResponse,
    request: RouteRequest,
  ): UnifiedRoute {
    const routes: Route[] = response.features.map((feature, index) => {
      return this.adaptRoute(feature, request, index)
    })

    return {
      routes,
      metadata: {
        provider: 'geoapify',
        requestId: request.requestId,
        processingTime: response.properties.time || 0,
        attribution: ['© Geoapify routing engine'],
      },
    }
  }

  /**
   * Convert Geoapify route feature to unified route
   */
  private adaptRoute(
    feature: GeoapifyRouteFeature,
    request: RouteRequest,
    index: number,
  ): Route {
    const props = feature.properties
    
    // Handle both LineString and MultiLineString geometries
    let flatCoordinates: Array<[number, number]> = []
    if (feature.geometry.type === 'MultiLineString') {
      // Flatten MultiLineString coordinates
      flatCoordinates = (feature.geometry.coordinates as Array<Array<[number, number]>>).flat()
    } else {
      // LineString coordinates
      flatCoordinates = feature.geometry.coordinates as Array<[number, number]>
    }
    
    const geometry = flatCoordinates.map(coord => ({
      lng: coord[0],
      lat: coord[1],
    }))

    const legs = props.legs.map((leg, legIndex) => 
      this.adaptRouteLeg(leg, request, legIndex, flatCoordinates)
    )

    // Calculate bounding box from geometry
    const lngs = geometry.map(coord => coord.lng)
    const lats = geometry.map(coord => coord.lat)
    const boundingBox: [number, number, number, number] = [
      Math.min(...lngs),
      Math.min(...lats),
      Math.max(...lngs),
      Math.max(...lats),
    ]

    return {
      id: `geoapify-${Date.now()}-${index}`,
      summary: this.adaptRouteSummary(props, request, legs),
      legs,
      geometry,
      boundingBox,
      provider: 'geoapify',
      createdAt: new Date(),
    }
  }

  /**
   * Convert Geoapify route summary to unified format
   */
  private adaptRouteSummary(
    props: GeoapifyRouteFeature['properties'],
    request: RouteRequest,
    legs: RouteLeg[],
  ): RouteSummary {
    // Calculate overall elevation data from legs
    let totalElevationGain = 0
    let totalElevationLoss = 0
    let maxElevation: number | undefined
    let minElevation: number | undefined
    
    legs.forEach(leg => {
      if (leg.totalElevationGain) {
        totalElevationGain += leg.totalElevationGain
      }
      if (leg.totalElevationLoss) {
        totalElevationLoss += leg.totalElevationLoss
      }
      if (leg.maxElevation !== undefined) {
        maxElevation = maxElevation === undefined 
          ? leg.maxElevation 
          : Math.max(maxElevation, leg.maxElevation)
      }
      if (leg.minElevation !== undefined) {
        minElevation = minElevation === undefined 
          ? leg.minElevation 
          : Math.min(minElevation, leg.minElevation)
      }
    })
    
    return {
      totalDistance: props.distance,
      totalDuration: props.time,
      hasTolls: false, // Geoapify doesn't provide this info
      hasHighways: false, // Geoapify doesn't provide this info
      hasFerries: false, // Geoapify doesn't provide this info
      
      // Elevation data
      totalElevationGain: totalElevationGain > 0 ? totalElevationGain : undefined,
      totalElevationLoss: totalElevationLoss > 0 ? totalElevationLoss : undefined,
      maxElevation,
      minElevation,
      
      departureTime: request.departureTime,
      arrivalTime: request.departureTime
        ? new Date(request.departureTime.getTime() + props.time * 1000)
        : undefined,
    }
  }

  /**
   * Convert Geoapify route leg to unified format
   */
  private adaptRouteLeg(
    leg: GeoapifyRouteLeg,
    request: RouteRequest,
    legIndex: number,
    routeGeometry?: Array<[number, number]>,
  ): RouteLeg {
    const startWaypoint = request.waypoints[legIndex]
    const endWaypoint = request.waypoints[legIndex + 1]

    const instructions = leg.steps.map((step, stepIndex) => 
      this.adaptRouteInstruction(step, stepIndex, routeGeometry)
    )

    // Extract geometry from all steps
    const geometry: Coordinate[] = []
    leg.steps.forEach(step => {
      if (step.geometry?.coordinates) {
        step.geometry.coordinates.forEach(coord => {
          geometry.push({ lng: coord[0], lat: coord[1] })
        })
      } else if (routeGeometry && step.from_index !== undefined && step.to_index !== undefined) {
        // Fallback: use route geometry with from_index and to_index
        for (let i = step.from_index; i <= step.to_index && i < routeGeometry.length; i++) {
          const coord = routeGeometry[i]
          geometry.push({ lng: coord[0], lat: coord[1] })
        }
      }
    })

    // Calculate elevation totals from steps
    let totalElevationGain = 0
    let totalElevationLoss = 0
    let maxElevation: number | undefined
    let minElevation: number | undefined
    
    leg.steps.forEach(step => {
      if (step.elevation_gain !== undefined) {
        if (step.elevation_gain > 0) {
          totalElevationGain += step.elevation_gain
        } else if (step.elevation_gain < 0) {
          totalElevationLoss += Math.abs(step.elevation_gain)
        }
      }
      
      if (step.max_elevation !== undefined) {
        maxElevation = maxElevation === undefined 
          ? step.max_elevation 
          : Math.max(maxElevation, step.max_elevation)
      }
      
      if (step.min_elevation !== undefined) {
        minElevation = minElevation === undefined 
          ? step.min_elevation 
          : Math.min(minElevation, step.min_elevation)
      }
    })

    return {
      startWaypoint,
      endWaypoint,
      mode: request.mode,
      distance: leg.distance,
      duration: leg.time,
      geometry,
      instructions,
      hasTolls: false, // Geoapify doesn't provide this info
      hasHighways: false, // Geoapify doesn't provide this info
      hasFerries: false, // Geoapify doesn't provide this info
      
      // Elevation data
      totalElevationGain: totalElevationGain > 0 ? totalElevationGain : undefined,
      totalElevationLoss: totalElevationLoss > 0 ? totalElevationLoss : undefined,
      maxElevation,
      minElevation,
    }
  }

  /**
   * Convert Geoapify route step to unified instruction
   */
  private adaptRouteInstruction(
    step: GeoapifyRouteStep,
    stepIndex: number,
    routeGeometry?: Array<[number, number]>,
  ): RouteInstruction {
    
    // Safe handling for missing geometry
    let coordinate: { lng: number; lat: number } | undefined
    
    if (step.geometry && step.geometry.coordinates && step.geometry.coordinates.length > 0) {
      const firstCoord = step.geometry.coordinates[0]
      coordinate = {
        lng: firstCoord[0],
        lat: firstCoord[1],
      }
    } else if (routeGeometry && step.from_index !== undefined && step.from_index < routeGeometry.length) {
      // Fallback: use route geometry with from_index
      const coord = routeGeometry[step.from_index]
      coordinate = {
        lng: coord[0],
        lat: coord[1],
      }
    }
    
    // Safe handling for missing instruction data
    const instructionType = step.instruction?.type ?? 'continue'
    const instructionText = step.instruction?.text ?? `Continue for ${Math.round(step.distance)}m`
    
    // Calculate elevation gain/loss
    let elevationGain: number | undefined
    let elevationLoss: number | undefined
    
    if (step.elevation_gain !== undefined) {
      if (step.elevation_gain > 0) {
        elevationGain = step.elevation_gain
      } else if (step.elevation_gain < 0) {
        elevationLoss = Math.abs(step.elevation_gain)
      }
    }
    
    return {
      type: this.mapGeoapifyInstructionType(instructionType),
      text: instructionText,
      coordinate: coordinate || { lng: 0, lat: 0 }, // Fallback coordinate
      distance: step.distance,
      duration: step.time,
      modifier: this.mapGeoapifyInstructionModifier(instructionType),
      
      // Elevation and surface data
      elevation: step.elevation,
      elevationGain,
      elevationLoss,
      maxElevation: step.max_elevation,
      minElevation: step.min_elevation,
      surface: step.surface,
      roadClass: step.road_class,
    }
  }

  // TODO: Check these
  /**
   * 
   * Map Geoapify instruction type to unified format
   */
  private mapGeoapifyInstructionType(type: string | number): string {
    // Handle string types (newer API format)
    if (typeof type === 'string') {
      switch (type.toLowerCase()) {
        case 'startatleft':
        case 'startatright':
        case 'start':
          return 'start'
        case 'left':
        case 'right':
        case 'slightleft':
        case 'slightright':
        case 'sharpleft':
        case 'sharpright':
          return 'turn'
        case 'straight':
        case 'continue':
          return 'continue'
        case 'destinationreached':
        case 'destination':
          return 'destination'
        case 'roundabout':
          return 'roundabout'
        case 'ramp':
          return 'ramp'
        default:
          return 'continue'
      }
    }
    
    // Handle number types (legacy format)
    switch (type) {
      case 0:
        return 'start'
      case 1:
        return 'continue'
      case 2:
      case 3:
      case 4:
      case 5:
        return 'turn'
      case 6:
        return 'roundabout'
      case 7:
        return 'ramp'
      case 8:
        return 'destination'
      default:
        return 'continue'
    }
  }

  /**
   * Map Geoapify instruction type to turn modifier
   */
  private mapGeoapifyInstructionModifier(
    type: string | number,
  ): 'left' | 'right' | 'straight' | 'slight-left' | 'slight-right' | 'u-turn' | undefined {
    // Handle string types (newer API format)
    if (typeof type === 'string') {
      switch (type.toLowerCase()) {
        case 'left':
          return 'left'
        case 'right':
          return 'right'
        case 'slightleft':
          return 'slight-left'
        case 'slightright':
          return 'slight-right'
        case 'sharpleft':
          return 'left'
        case 'sharpright':
          return 'right'
        case 'straight':
        case 'continue':
          return 'straight'
        case 'uturn':
          return 'u-turn'
        default:
          return undefined
      }
    }
    
    // Handle number types (legacy format)
    switch (type) {
      case 1:
        return 'straight'
      case 2:
        return 'slight-right'
      case 3:
        return 'right'
      case 4:
        return 'left'
      case 5:
        return 'slight-left'
      default:
        return undefined
    }
  }
}
