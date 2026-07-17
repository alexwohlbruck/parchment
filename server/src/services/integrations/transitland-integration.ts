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

/**
 * A raw Transitland departure paired with the contextual fields needed to
 * compute an absolute timestamp (service_date + stop timezone). Threaded
 * through `transformDepartures` instead of being hung off the raw object
 * with sentinel underscore-prefixed properties.
 */
interface DepartureWithContext {
  raw: any
  serviceDate?: string
  timezone?: string
}

/**
 * Per-timezone formatter cache. `Intl.DateTimeFormat` construction is the
 * dominant cost in `toAbsoluteIso`, called once per departure (~hundreds
 * per place request). Keying by IANA zone gives us a single allocation
 * per zone for the lifetime of the process.
 */
const formatterCache = new Map<string, Intl.DateTimeFormat>()

function getTzFormatter(timezone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timezone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
    formatterCache.set(timezone, f)
  }
  return f
}

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
    console.log(`[PERF] Transitland getDepartures: ${onestopId}`)
    
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
      
      // Collect departures and stitch each one to its parent stop's
      // service_date + timezone. Transitland returns these on the stop, not
      // on the departure itself, but they're required to disambiguate
      // HH:mm:ss times across midnight (today vs tomorrow vs late-night
      // GTFS service hours like 25:30).
      const collected: DepartureWithContext[] = []

      const collectFrom = (stop: any) => {
        if (!stop?.departures?.length) return
        const stopServiceDate: string | undefined = stop.service_date
        const timezone: string | undefined = stop.stop_timezone
        for (const dep of stop.departures) {
          // Transitland may place service_date on the departure instead
          // of the stop (especially for late-night GTFS trips that cross
          // midnight). Fall back to the departure's own field.
          const serviceDate = stopServiceDate || dep.service_date || dep.date
          collected.push({ raw: dep, serviceDate, timezone })
        }
      }

      for (const stop of data.stops) {
        collectFrom(stop)
        if (stop.children?.length) {
          for (const child of stop.children) collectFrom(child)
        }
      }

      return this.transformDepartures(collected)
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
   * Combine a `YYYY-MM-DD` service date and a `HH:mm:ss` time (which may
   * exceed 24h for late-night GTFS service) into an absolute UTC ISO
   * timestamp, interpreting the wall-clock value in the stop's timezone.
   *
   * Done with raw `Intl.DateTimeFormat` math instead of dayjs so we don't
   * have to add a runtime dep to the server. Returns undefined if any
   * input is missing or malformed.
   */
  private toAbsoluteIso(
    serviceDate?: string,
    time?: string,
    timezone?: string,
  ): string | undefined {
    if (!serviceDate || !time) return undefined
    const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(serviceDate)
    const timeMatch = /^(\d{1,3}):(\d{2}):(\d{2})/.exec(time)
    if (!dateMatch || !timeMatch) return undefined

    const [, ys, ms, ds] = dateMatch
    const [, hs, mins, ss] = timeMatch
    const y = Number(ys)
    const mo = Number(ms) - 1
    const d = Number(ds)
    const hours = Number(hs)
    const minutes = Number(mins)
    const seconds = Number(ss)

    // Wall-clock instant in UTC, then offset by the stop's TZ to get the
    // real UTC moment that corresponds to the displayed local time.
    const wallUtcMs = Date.UTC(y, mo, d, 0, 0, 0)
      + hours * 3600_000 + minutes * 60_000 + seconds * 1000

    if (!timezone) return new Date(wallUtcMs).toISOString()

    // Compute the timezone's offset at that wall-clock instant by formatting
    // it back through Intl and diffing. Formatter is memoized per zone — see
    // `getTzFormatter` above.
    try {
      const parts = getTzFormatter(timezone).formatToParts(new Date(wallUtcMs))
      const get = (t: string) => Number(parts.find(p => p.type === t)?.value ?? '0')
      const tzWallMs = Date.UTC(
        get('year'), get('month') - 1, get('day'),
        get('hour') === 24 ? 0 : get('hour'),
        get('minute'), get('second'),
      )
      const offsetMs = tzWallMs - wallUtcMs
      return new Date(wallUtcMs - offsetMs).toISOString()
    } catch {
      return new Date(wallUtcMs).toISOString()
    }
  }

  /**
   * Transform Transitland departures data to our format
   */
  private transformDepartures(items: DepartureWithContext[]): TransitDeparture[] {
    return items.map(({ raw: dep, serviceDate, timezone }) => {
      // Display times — use estimated (local HH:mm:ss) when available for
      // realtime, falling back to the scheduled GTFS time.
      const arrivalTime = dep.arrival?.estimated || dep.arrival_time || dep.arrival?.scheduled
      const departureTime = dep.departure?.estimated || dep.departure_time || dep.departure?.scheduled
      const scheduledArrival = dep.arrival?.scheduled || dep.arrival_time
      const scheduledDeparture = dep.departure?.scheduled || dep.departure_time

      // Absolute ISO timestamps — prefer the pre-computed UTC values from
      // Transitland (correct timezone handling for GTFS 25:xx times) over
      // our own toAbsoluteIso which requires stop_timezone.
      const arrivalAt = dep.arrival?.estimated_utc || dep.arrival?.scheduled_utc
        || this.toAbsoluteIso(serviceDate, arrivalTime, timezone)
      const departureAt = dep.departure?.estimated_utc || dep.departure?.scheduled_utc
        || this.toAbsoluteIso(serviceDate, departureTime, timezone)

      return {
        arrivalTime,
        departureTime,
        arrivalAt,
        departureAt,
        serviceDate,
        timezone,
        scheduledArrivalTime: scheduledArrival,
        scheduledDepartureTime: scheduledDeparture,
        delay: dep.delay ?? dep.arrival?.delay ?? dep.departure?.delay
          ?? dep.arrival?.estimated_delay ?? dep.departure?.estimated_delay,
        realTime: Boolean(dep.realtime || dep.arrival?.estimated || dep.departure?.estimated),
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
    console.log(`[PERF] Transitland getStop: ${onestopId}`)
    
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
      console.log(`[PERF] Transitland API fetch: ${fetchTime}ms`)

      if (!response.ok) {
        if (response.status === 404) {
          console.log(`[PERF] Transitland getStop (404): ${Date.now() - startTime}ms`)
          return null
        }
        console.error('Transitland stop API error:', response.status, response.statusText)
        return null
      }

      const parseStart = Date.now()
      const data = await response.json()
      const parseTime = Date.now() - parseStart
      console.log(`[PERF] Transitland JSON parse: ${parseTime}ms`)
      
      // Transitland API returns stops in an array
      if (data.stops && data.stops.length > 0) {
        const totalTime = Date.now() - startTime
        console.log(`[PERF] Transitland getStop total: ${totalTime}ms`)
        return data.stops[0]
      }
      
      console.log(`[PERF] Transitland getStop (no stops): ${Date.now() - startTime}ms`)
      return null
    } catch (error) {
      console.error(`[PERF] Error fetching stop from Transitland (${Date.now() - startTime}ms):`, error)
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
