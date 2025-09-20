import {
  IntegrationConfig,
  IntegrationTestResult,
  IntegrationCapabilityId,
  IntegrationId,
  Integration,
  TransitDataCapability,
} from '../../types/integration.types'
import { TransitDeparture } from '../../types/place.types'
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
  ]
  readonly capabilities = {
    transitData: {
      getDepartures: this.getDepartures.bind(this),
    } as TransitDataCapability,
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

    try {
      const baseUrl = `${TRANSITLAND_API_BASE_URL}/stops`
      const params = new URLSearchParams()
      params.append('apikey', this.config.apiKey)
      params.append('lat', lat.toString())
      params.append('lon', lng.toString())
      if (radius) {
        params.append('radius', radius.toString())
      } else {
        params.append('radius', '100') // 100 meter default radius
      }
      if (name) {
        params.append('search', name)
      }

      const response = await fetch(`${baseUrl}?${params.toString()}`)

      if (!response.ok) {
        console.error('Transitland search API error:', response.status, response.statusText)
        return []
      }

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
    this.ensureInitialized()

    try {
      const baseUrl = `${TRANSITLAND_API_BASE_URL}/stops`
      const url = `${baseUrl}/${encodeURIComponent(onestopId)}/departures`
      
      const params = new URLSearchParams()
      params.append('apikey', this.config.apiKey)
      
      if (options?.next) {
        params.append('next', options.next.toString())
      }
      if (options?.startTime) {
        params.append('start_time', options.startTime)
      }
      if (options?.endTime) {
        params.append('end_time', options.endTime)
      }
      if (options?.limit) {
        params.append('limit', options.limit.toString())
      }

      const fullUrl = `${url}?${params.toString()}`
      const response = await fetch(fullUrl)

      if (!response.ok) {
        console.error(`Transitland API error for ${onestopId}:`, response.status, response.statusText)
        const errorText = await response.text()
        console.error('Error response:', errorText)
        return []
      }

      const data = await response.json()
      
      // Collect departures from all stops and child stops
      let allDepartures: any[] = []
      
      if (data.stops && data.stops.length > 0) {
        for (const stop of data.stops) {
          // Add departures directly from the stop
          if (stop.departures && stop.departures.length > 0) {
            allDepartures.push(...stop.departures)
          }
          
          // Add departures from child stops (platforms)
          if (stop.children && stop.children.length > 0) {
            for (const child of stop.children) {
              if (child.departures && child.departures.length > 0) {
                allDepartures.push(...child.departures)
              }
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
}
