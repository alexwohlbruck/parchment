import {
  IntegrationConfig,
  IntegrationTestResult,
  IntegrationCapabilityId,
  IntegrationId,
  Integration,
  TransitDataCapability,
  PlaceInfoCapability,
} from '../../types/integration.types'
import { TransitDeparture, Place } from '../../types/place.types'
import { SOURCE } from '../../lib/constants'

const TRANSITLAND_API_BASE_URL = 'https://transit.land/api/v2/rest'

export interface TransitlandConfig extends IntegrationConfig {
  apiKey: string
}

export class TransitlandIntegration implements Integration<TransitlandConfig> {
  private initialized = false

  readonly integrationId = IntegrationId.TRANSITLAND
  readonly capabilityIds: IntegrationCapabilityId[] = [
    IntegrationCapabilityId.MAP_LAYER,
    IntegrationCapabilityId.TRANSIT_DATA,
    IntegrationCapabilityId.PLACE_INFO,
  ]
  readonly capabilities = {
    transitData: {
      getDepartures: this.getDepartures.bind(this),
    } as TransitDataCapability,
    placeInfo: {
      getPlaceInfo: this.getPlaceInfo.bind(this),
    } as PlaceInfoCapability,
  }
  readonly sources = [SOURCE.TRANSITLAND]

  protected config: TransitlandConfig = {
    apiKey: '',
  }

  initialize(config: TransitlandConfig): void {
    if (!this.validateConfig(config)) {
      throw new Error('Invalid configuration: API key is required')
    }

    this.config = {
      apiKey: config.apiKey,
    }

    this.initialized = true
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error(
        `Integration ${this.integrationId} has not been initialized. Call initialize() first.`,
      )
    }
  }

  async testConnection(
    config: TransitlandConfig,
  ): Promise<IntegrationTestResult> {
    if (!this.validateConfig(config)) {
      return {
        success: false,
        message: 'Invalid configuration: API key is required',
      }
    }

    try {
      // Attempt a lightweight request against Transitland tiles using the key
      const testUrl =
        'https://transit.land/api/v2/tiles/routes/tiles/0/0/0.pbf?apikey=' +
        encodeURIComponent(config.apiKey)
      const response = await fetch(testUrl)

      if (!response.ok) {
        return {
          success: false,
          message: 'Invalid API key or API error',
        }
      }

      return { success: true }
    } catch (error: any) {
      return {
        success: false,
        message: error?.message || 'Failed to connect to Transitland API',
      }
    }
  }

  validateConfig(config: TransitlandConfig): boolean {
    return Boolean(config && config.apiKey)
  }

  /**
   * Search for stops near coordinates
   */
  async searchStopsNear(lat: number, lng: number, radius?: number, name?: string): Promise<any[]> {
    this.ensureInitialized()

    const baseUrl = `${TRANSITLAND_API_BASE_URL}/stops`
    const params = new URLSearchParams({
      apikey: this.config.apiKey,
      lat: lat.toString(),
      lon: lng.toString(),
      radius: (radius || 100).toString(),
    })
    
    if (name) params.append('search', name)

    try {
      const response = await fetch(`${baseUrl}?${params.toString()}`)
      if (!response.ok) return []

      const data = await response.json()
      return data.stops || []
    } catch (error) {
      console.error('Error searching stops in Transitland:', error)
      return []
    }
  }

  /**
   * Get departures for a Transitland stop
   */
  async getDepartures(onestopId: string, options?: {
    next?: number // seconds
    startTime?: string
    endTime?: string
    limit?: number
  }): Promise<TransitDeparture[]> {
    const startTime = Date.now()
    console.log(`⏱️ [PERF] Transitland getDepartures: ${onestopId}`)
    
    this.ensureInitialized()

    const baseUrl = `${TRANSITLAND_API_BASE_URL}/stops`
    const url = `${baseUrl}/${encodeURIComponent(onestopId)}/departures`
    
    const params = new URLSearchParams({ apikey: this.config.apiKey })
    
    if (options?.next) params.append('next', options.next.toString())
    if (options?.startTime) params.append('start_time', options.startTime)
    if (options?.endTime) params.append('end_time', options.endTime)
    if (options?.limit) params.append('limit', options.limit.toString())

    try {
      const response = await fetch(`${url}?${params.toString()}`)
      if (!response.ok) return []

      const data = await response.json()
      if (!data.stops?.length) return []
      
      // Collect departures from all stops and child stops
      const allDepartures: any[] = []
      
      for (const stop of data.stops) {
        if (stop.departures?.length) {
          allDepartures.push(...stop.departures)
        }
        
        if (stop.children?.length) {
          for (const child of stop.children) {
            if (child.departures?.length) {
              allDepartures.push(...child.departures)
            }
          }
        }
      }
      
      return this.transformDepartures(allDepartures)
    } catch (error) {
      console.error('Error fetching departures from Transitland:', error)
      return []
    }
  }

  /**
   * Extract direction name from headsign (terminal station)
   */
  private extractDirectionFromHeadsign(headsign?: string): string {
    if (!headsign) return 'Unknown'
    
    // Extract the destination after "to " (e.g., "North to UNCC" -> "UNCC")
    const match = headsign.match(/to (.+)$/i)
    if (match) {
      return match[1].trim()
    }
    
    // If no "to" pattern, return the headsign as-is (e.g., "Linden", "Kimball")
    return headsign
  }

  /**
   * Transform Transitland departures data to our format
   */
  private transformDepartures(departures: any[]): TransitDeparture[] {
    return departures.map((dep: any) => {
      // Try multiple possible field names for times
      const arrivalTime = dep.arrival_time || dep.arrival?.time || dep.arrival?.estimated_time || dep.arrival?.scheduled_time
      const departureTime = dep.departure_time || dep.departure?.time || dep.departure?.estimated_time || dep.departure?.scheduled_time
      const scheduledArrival = dep.scheduled_arrival_time || dep.arrival?.scheduled_time
      const scheduledDeparture = dep.scheduled_departure_time || dep.departure?.scheduled_time
      
      return {
        arrivalTime,
        departureTime,
        scheduledArrivalTime: scheduledArrival,
        scheduledDepartureTime: scheduledDeparture,
        delay: dep.delay || dep.arrival?.delay || dep.departure?.delay,
        realTime: Boolean(dep.realtime || dep.arrival?.estimated_time || dep.departure?.estimated_time),
        headsign: dep.trip?.trip_headsign || dep.stop_headsign,
        direction: this.extractDirectionFromHeadsign(dep.trip?.trip_headsign || dep.stop_headsign),
        stopSequence: dep.stop_sequence,
        trip: {
          id: dep.trip?.id || '',
          shortName: dep.trip?.trip_short_name,
          headsign: dep.trip?.trip_headsign || dep.stop_headsign,
          directionId: dep.trip?.direction_id,
          blockId: dep.trip?.block_id,
          routeId: dep.trip?.route?.id || '',
        },
        route: {
          id: dep.trip?.route?.id || '',
          shortName: dep.trip?.route?.route_short_name,
          longName: dep.trip?.route?.route_long_name,
          color: dep.trip?.route?.route_color,
          textColor: dep.trip?.route?.route_text_color,
          type: dep.trip?.route?.route_type,
          agencyId: dep.trip?.route?.agency?.id,
        },
        agency: dep.trip?.route?.agency ? {
          id: dep.trip.route.agency.id,
          name: dep.trip.route.agency.agency_name,
          url: dep.trip.route.agency.agency_url,
          timezone: dep.trip.route.agency.agency_timezone,
          phone: dep.trip.route.agency.agency_phone,
        } : undefined,
      }
    })
  }

  /**
   * Get stop details by onestop ID
   */
  async getStop(onestopId: string): Promise<any | null> {
    const startTime = Date.now()
    console.log(`⏱️ [PERF] Transitland getStop: ${onestopId}`)
    
    this.ensureInitialized()

    try {
      const baseUrl = `${TRANSITLAND_API_BASE_URL}/stops`
      const url = `${baseUrl}/${encodeURIComponent(onestopId)}`
      
      const params = new URLSearchParams()
      params.append('apikey', this.config.apiKey)

      const fullUrl = `${url}?${params.toString()}`

      const fetchStart = Date.now()
      const response = await fetch(fullUrl)
      const fetchTime = Date.now() - fetchStart
      console.log(`⏱️ [PERF] Transitland API fetch: ${fetchTime}ms`)

      if (!response.ok) {
        if (response.status === 404) {
          console.log(`⏱️ [PERF] Transitland getStop (404): ${Date.now() - startTime}ms`)
          return null
        }
        console.error('Transitland stop API error:', response.status, response.statusText)
        return null
      }

      const parseStart = Date.now()
      const data = await response.json()
      const parseTime = Date.now() - parseStart
      console.log(`⏱️ [PERF] Transitland JSON parse: ${parseTime}ms`)
      
      // Transitland API returns stops in an array
      if (data.stops && data.stops.length > 0) {
        const totalTime = Date.now() - startTime
        console.log(`⏱️ [PERF] Transitland getStop total: ${totalTime}ms`)
        return data.stops[0]
      }
      
      console.log(`⏱️ [PERF] Transitland getStop (no stops): ${Date.now() - startTime}ms`)
      return null
    } catch (error) {
      console.error(`❌ [PERF] Error fetching stop from Transitland (${Date.now() - startTime}ms):`, error)
      return null
    }
  }

  /**
   * Get place info by onestop ID (implements PlaceInfoCapability)
   */
  private async getPlaceInfo(
    onestopId: string,
    _options?: { language?: string },
  ): Promise<Place | null> {
    try {
      const stop = await this.getStop(onestopId)
      if (!stop) {
        return null
      }

      // Convert Transitland stop to unified Place format
      return this.adaptStopToPlace(stop)
    } catch (error) {
      console.error('Error getting place info from Transitland:', error)
      return null
    }
  }

  /**
   * Convert Transitland stop data to unified Place format
   */
  private adaptStopToPlace(stop: any): Place {
    const now = new Date().toISOString()
    
    return {
      id: `transitland:${stop.onestop_id}`,
      externalIds: {
        [SOURCE.TRANSITLAND]: stop.onestop_id,
      },
      name: {
        value: stop.stop_name || null,
        sourceId: SOURCE.TRANSITLAND,
        timestamp: now,
      },
      description: {
        value: stop.stop_desc || '',
        sourceId: SOURCE.TRANSITLAND,
        timestamp: now,
      },
      placeType: {
        value: 'Transit Stop',
        sourceId: SOURCE.TRANSITLAND,
        timestamp: now,
      },
      geometry: {
        value: {
          type: 'point',
          center: {
            lat: stop.geometry?.coordinates?.[1] || 0,
            lng: stop.geometry?.coordinates?.[0] || 0,
          },
        },
        sourceId: SOURCE.TRANSITLAND,
        timestamp: now,
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
      transit: {
        value: {
          onestopId: stop.onestop_id,
          name: stop.stop_name,
          code: stop.stop_code,
          description: stop.stop_desc,
          timezone: stop.stop_timezone,
          wheelchairBoarding: stop.wheelchair_boarding,
        },
        sourceId: SOURCE.TRANSITLAND,
        timestamp: now,
      },
      sources: [
        {
          id: SOURCE.TRANSITLAND,
          name: 'Transitland',
          url: `https://transit.land/stops/${stop.onestop_id}`,
          updated: now,
        },
      ],
      lastUpdated: now,
      createdAt: now,
    }
  }
}
