import {
  TripRequest,
  TripResponse,
  TripSegment,
  TripStats,
  TripCandidate,
  MultimodalTripResponse,
  DataSource,
  Waypoint,
  Vehicle,
  Mode,
  SelectedMode,
  SegmentState,
  TransitDetails,
  TransitRoute,
  TransitTrip,
  TransitStop,
  TransitAgency,
  TransitRouteType,
} from '../types/trip.types'
import { Coordinate } from '../types/unified-routing.types'
import { routingService } from './routing.service'
import { transitRoutingService } from './transit-routing.service'

// TODO: Move to database per user
const HARDCODED_VEHICLE_LOCATIONS = {
  car: { lat: 35.20939460988835, lng: -80.86033779410343 },
  bike: { lat: 35.209065248660664, lng: -80.86111205072174 },
}

/**
 * Simplified multimodal trip planning service
 * Supports: walking, driving, biking with optional vehicle locations
 */
export class TripService {
  /**
   * Plan multimodal trip with multiple transportation options
   */
  async planTrip(request: TripRequest): Promise<MultimodalTripResponse> {
    const startTime = Date.now()
    this.validateRequest(request)

    const candidates: TripResponse[] = []
    const dataSources: DataSource[] = []

    // Determine which modes to generate based on selectedMode
    const modes: Mode[] = this.getModesToGenerate(request.selectedMode)

    for (const mode of modes) {
      try {
        const trip = await this.planModeTrip(request, mode, dataSources)
        if (trip) candidates.push(trip)
      } catch (error) {
        console.error(`Failed to plan ${mode} trip:`, error)
      }
    }

    // Rank trips by duration (fastest first)
    const rankedTrips: TripCandidate[] = candidates
      .map((trip, index) => ({
        trip,
        score: {
          overall: 1 / trip.tripStats.totalDuration,
          time: 0,
          cost: 0,
          environmental: 0,
          comfort: 0,
          safety: 0,
        },
        rank: index + 1,
      }))
      .sort((a, b) => b.score.overall - a.score.overall)
      .map((candidate, index) => ({ ...candidate, rank: index + 1 }))

    return {
      request,
      trips: rankedTrips.slice(0, 5), // Return top 5 options
      metadata: {
        totalCandidatesGenerated: candidates.length,
        processingTime: Date.now() - startTime,
        dataSourcesUsed: dataSources,
      },
    }
  }

  /**
   * Determine which modes to generate based on user selection
   * Walking is always included as it can be combined with any mode
   */
  private getModesToGenerate(selectedMode?: SelectedMode): Mode[] {
    switch (selectedMode) {
      case 'multi':
        // Multi-modal: generate all available modes
        return ['walking', 'driving', 'biking', 'transit']
      case 'walking':
        // Walking only
        return ['walking']
      case 'driving':
        // Driving (can include walking to car)
        return ['walking', 'driving']
      case 'biking':
        // Biking (can include walking to bike)
        return ['walking', 'biking']
      case 'transit':
        // Transit: walk + transit + walk composition
        return ['transit']
      case 'wheelchair':
        // Wheelchair — single mode, uses foot profile with custom_model
        return ['wheelchair']
      default:
        // Default to all modes if not specified
        return ['walking', 'driving', 'biking']
    }
  }

  /**
   * Plan a trip for a specific mode
   */
  private async planModeTrip(
    request: TripRequest,
    mode: Mode,
    dataSources: DataSource[],
  ): Promise<TripResponse | null> {
    const segments: TripSegment[] = []
    let currentState: SegmentState = {
      currentTime: request.preferredDepartureTime || new Date().toISOString(),
      currentLocation: request.waypoints[0].location,
      currentMode: mode,
      parkedVehicles: [],
    }

    const preferencesWithLanguage = {
      ...(request.routingPreferences || {}),
      ...(request.language && { language: request.language }),
    }

    // Plan each leg of the journey
    for (let i = 0; i < request.waypoints.length - 1; i++) {
      const from = request.waypoints[i]
      const to = request.waypoints[i + 1]

      const result = await this.planSegment(
        mode,
        from,
        to,
        currentState,
        request.availableVehicles || [],
        preferencesWithLanguage,
      )

      if (!result) return null

      // Handle multimodal segments (walk to vehicle + ride)
      if (result.multimodalSegments) {
        result.multimodalSegments.forEach((seg, idx) => {
          seg.segmentIndex = segments.length + idx
          seg.legIndex = i
        })
        segments.push(...result.multimodalSegments)
      } else {
        result.segment.segmentIndex = segments.length
        result.segment.legIndex = i
        segments.push(result.segment)
      }

      currentState = result.state
    }

    const tripStats = this.calculateStats(segments)

    return {
      segments,
      tripStats,
      earliestStartTime: segments[0]?.startTime || currentState.currentTime,
      latestEndTime:
        segments[segments.length - 1]?.endTime || currentState.currentTime,
      dataSources,
      requestId: request.requestId,
      generatedAt: new Date().toISOString(),
    }
  }

  /**
   * Plan a single segment based on mode
   */
  private async planSegment(
    mode: Mode,
    from: Waypoint,
    to: Waypoint,
    state: SegmentState,
    availableVehicles: Vehicle[],
    preferences: any,
  ): Promise<{
    segment: TripSegment
    state: SegmentState
    multimodalSegments?: TripSegment[]
  } | null> {
    switch (mode) {
      case 'walking':
        return this.planWalkingSegment(from, to, state, preferences)
      case 'driving':
        return this.planDrivingSegment(
          from,
          to,
          state,
          availableVehicles,
          preferences,
        )
      case 'biking':
        return this.planBikingSegment(
          from,
          to,
          state,
          availableVehicles,
          preferences,
        )
      case 'wheelchair':
        return this.planWheelchairSegment(from, to, state, preferences)
      case 'transit':
        return this.planTransitSegment(from, to, state, preferences)
      default:
        return null
    }
  }

  /**
   * Plan walking segment
   */
  private async planWalkingSegment(
    from: Waypoint,
    to: Waypoint,
    state: SegmentState,
    preferences?: any,
  ): Promise<{ segment: TripSegment; state: SegmentState } | null> {
    try {
      const route = await routingService.getRoute(
        [
          {
            type: 'coordinates',
            value: [from.location.lat, from.location.lng],
          },
          { type: 'coordinates', value: [to.location.lat, to.location.lng] },
        ],
        'pedestrian',
        preferences,
      )

      if (!route.routes.length) return null

      const leg = route.routes[0].legs[0]

      // Skip very short segments (< 1 min)
      if (leg.duration < 60) return null

      const segment: TripSegment = {
        segmentIndex: 0,
        mode: 'walking',
        start: from,
        end: to,
        startTime: state.currentTime,
        endTime: new Date(
          new Date(state.currentTime).getTime() + leg.duration * 1000,
        ).toISOString(),
        duration: leg.duration,
        distance: leg.distance,
        geometry: leg.geometry,
        instructions: leg.instructions,
        co2: 0,
        totalElevationGain: leg.totalElevationGain,
        totalElevationLoss: leg.totalElevationLoss,
        maxElevation: leg.maxElevation,
        minElevation: leg.minElevation,
        edgeSegments: leg.edgeSegments,
      }

      return {
        segment,
        state: {
          currentTime: segment.endTime,
          currentLocation: to.location,
          currentMode: 'walking',
          parkedVehicles: state.parkedVehicles,
        },
      }
    } catch (error) {
      console.error('Walking route failed:', error)
      return null
    }
  }

  /**
   * Plan wheelchair segment — uses foot profile with accessibility custom_model
   */
  private async planWheelchairSegment(
    from: Waypoint,
    to: Waypoint,
    state: SegmentState,
    preferences: any,
  ): Promise<{ segment: TripSegment; state: SegmentState } | null> {
    try {
      const route = await routingService.getRoute(
        [
          { type: 'coordinates', value: [from.location.lat, from.location.lng] },
          { type: 'coordinates', value: [to.location.lat, to.location.lng] },
        ],
        'wheelchair',
        preferences,
      )

      if (!route.routes.length) return null

      const leg = route.routes[0].legs[0]
      if (leg.duration < 60) return null

      const segment: TripSegment = {
        segmentIndex: 0,
        mode: 'wheelchair',
        start: from,
        end: to,
        startTime: state.currentTime,
        endTime: new Date(
          new Date(state.currentTime).getTime() + leg.duration * 1000,
        ).toISOString(),
        duration: leg.duration,
        distance: leg.distance,
        geometry: leg.geometry,
        instructions: leg.instructions,
        co2: 0,
        totalElevationGain: leg.totalElevationGain,
        totalElevationLoss: leg.totalElevationLoss,
        maxElevation: leg.maxElevation,
        minElevation: leg.minElevation,
        edgeSegments: leg.edgeSegments,
      }

      return {
        segment,
        state: {
          currentTime: segment.endTime,
          currentLocation: to.location,
          currentMode: 'wheelchair',
          parkedVehicles: state.parkedVehicles,
        },
      }
    } catch (error) {
      console.error('Wheelchair route failed:', error)
      return null
    }
  }

  /**
   * Plan driving segment (with optional walk-to-car)
   */
  private async planDrivingSegment(
    from: Waypoint,
    to: Waypoint,
    state: SegmentState,
    availableVehicles: Vehicle[],
    preferences: any,
  ): Promise<{
    segment: TripSegment
    state: SegmentState
    multimodalSegments?: TripSegment[]
  } | null> {
    const car = availableVehicles.find((v) => v.type === 'car')
    const useKnownLocations = preferences.useKnownVehicleLocations !== false

    // Direct driving (assume car at origin)
    if (!car || !useKnownLocations) {
      return this.planDirectDrive(from, to, state, preferences)
    }

    // Multimodal: walk to car + drive
    const carLocation = HARDCODED_VEHICLE_LOCATIONS.car

    try {
      // Walk to car
      const walkRoute = await routingService.getRoute(
        [
          {
            type: 'coordinates',
            value: [from.location.lat, from.location.lng],
          },
          { type: 'coordinates', value: [carLocation.lat, carLocation.lng] },
        ],
        'pedestrian',
        preferences,
      )

      // Drive to destination
      const driveRoute = await routingService.getRoute(
        [
          { type: 'coordinates', value: [carLocation.lat, carLocation.lng] },
          { type: 'coordinates', value: [to.location.lat, to.location.lng] },
        ],
        'auto',
        preferences,
      )

      if (!walkRoute.routes.length || !driveRoute.routes.length) return null

      const walkLeg = walkRoute.routes[0].legs[0]
      const driveLeg = driveRoute.routes[0].legs[0]

      const walkSegment: TripSegment = {
        segmentIndex: 0,
        mode: 'walking',
        start: from,
        end: { location: carLocation, type: 'via', label: 'Your car' },
        startTime: state.currentTime,
        endTime: new Date(
          new Date(state.currentTime).getTime() + walkLeg.duration * 1000,
        ).toISOString(),
        duration: walkLeg.duration,
        distance: walkLeg.distance,
        geometry: walkLeg.geometry,
        instructions: walkLeg.instructions,
        co2: 0,
        totalElevationGain: walkLeg.totalElevationGain,
        totalElevationLoss: walkLeg.totalElevationLoss,
        maxElevation: walkLeg.maxElevation,
        minElevation: walkLeg.minElevation,
        edgeSegments: walkLeg.edgeSegments,
      }

      const driveSegment: TripSegment = {
        segmentIndex: 1,
        mode: 'driving',
        vehicle: car,
        start: { location: carLocation, type: 'via', label: 'Your car' },
        end: to,
        startTime: walkSegment.endTime,
        endTime: new Date(
          new Date(walkSegment.endTime).getTime() + driveLeg.duration * 1000,
        ).toISOString(),
        duration: driveLeg.duration,
        distance: driveLeg.distance,
        geometry: driveLeg.geometry,
        instructions: driveLeg.instructions,
        cost: { value: driveLeg.distance * 0.0002, currency: 'USD' }, // ~$0.20/km
        co2: driveLeg.distance * 0.00024, // ~240g CO2/km
        totalElevationGain: driveLeg.totalElevationGain,
        totalElevationLoss: driveLeg.totalElevationLoss,
        maxElevation: driveLeg.maxElevation,
        minElevation: driveLeg.minElevation,
        edgeSegments: driveLeg.edgeSegments,
      }

      return {
        segment: driveSegment, // Main segment
        multimodalSegments: [walkSegment, driveSegment],
        state: {
          currentTime: driveSegment.endTime,
          currentLocation: to.location,
          currentMode: 'driving',
          parkedVehicles: state.parkedVehicles,
        },
      }
    } catch (error) {
      console.error('Multimodal driving failed:', error)
      return null
    }
  }

  /**
   * Plan direct driving route (car assumed at origin)
   */
  private async planDirectDrive(
    from: Waypoint,
    to: Waypoint,
    state: SegmentState,
    preferences?: any,
  ): Promise<{ segment: TripSegment; state: SegmentState } | null> {
    try {
      const route = await routingService.getRoute(
        [
          {
            type: 'coordinates',
            value: [from.location.lat, from.location.lng],
          },
          { type: 'coordinates', value: [to.location.lat, to.location.lng] },
        ],
        'auto',
        preferences,
      )

      if (!route.routes.length) return null

      const leg = route.routes[0].legs[0]

      const segment: TripSegment = {
        segmentIndex: 0,
        mode: 'driving',
        start: from,
        end: to,
        startTime: state.currentTime,
        endTime: new Date(
          new Date(state.currentTime).getTime() + leg.duration * 1000,
        ).toISOString(),
        duration: leg.duration,
        distance: leg.distance,
        geometry: leg.geometry,
        instructions: leg.instructions,
        cost: { value: leg.distance * 0.0002, currency: 'USD' },
        co2: leg.distance * 0.00024,
        totalElevationGain: leg.totalElevationGain,
        totalElevationLoss: leg.totalElevationLoss,
        maxElevation: leg.maxElevation,
        minElevation: leg.minElevation,
        edgeSegments: leg.edgeSegments,
      }

      return {
        segment,
        state: {
          currentTime: segment.endTime,
          currentLocation: to.location,
          currentMode: 'driving',
          parkedVehicles: state.parkedVehicles,
        },
      }
    } catch (error) {
      console.error('Direct driving failed:', error)
      return null
    }
  }

  /**
   * Plan biking segment (with optional walk-to-bike)
   */
  private async planBikingSegment(
    from: Waypoint,
    to: Waypoint,
    state: SegmentState,
    availableVehicles: Vehicle[],
    preferences: any,
  ): Promise<{
    segment: TripSegment
    state: SegmentState
    multimodalSegments?: TripSegment[]
  } | null> {
    const bike = availableVehicles.find((v) => v.type === 'bike')
    const useKnownLocations = preferences.useKnownVehicleLocations !== false

    // Direct biking (assume bike at origin)
    if (!bike || !useKnownLocations) {
      return this.planDirectBike(from, to, state, preferences)
    }

    // Multimodal: walk to bike + ride
    const bikeLocation = HARDCODED_VEHICLE_LOCATIONS.bike

    try {
      // Walk to bike
      const walkRoute = await routingService.getRoute(
        [
          {
            type: 'coordinates',
            value: [from.location.lat, from.location.lng],
          },
          { type: 'coordinates', value: [bikeLocation.lat, bikeLocation.lng] },
        ],
        'pedestrian',
        preferences,
      )

      // Bike to destination
      const bikeRoute = await routingService.getRoute(
        [
          { type: 'coordinates', value: [bikeLocation.lat, bikeLocation.lng] },
          { type: 'coordinates', value: [to.location.lat, to.location.lng] },
        ],
        'bicycle',
        preferences,
      )

      if (!walkRoute.routes.length || !bikeRoute.routes.length) return null

      const walkLeg = walkRoute.routes[0].legs[0]
      const bikeLeg = bikeRoute.routes[0].legs[0]

      const walkSegment: TripSegment = {
        segmentIndex: 0,
        mode: 'walking',
        start: from,
        end: { location: bikeLocation, type: 'via', label: 'Your bike' },
        startTime: state.currentTime,
        endTime: new Date(
          new Date(state.currentTime).getTime() + walkLeg.duration * 1000,
        ).toISOString(),
        duration: walkLeg.duration,
        distance: walkLeg.distance,
        geometry: walkLeg.geometry,
        instructions: walkLeg.instructions,
        co2: 0,
        totalElevationGain: walkLeg.totalElevationGain,
        totalElevationLoss: walkLeg.totalElevationLoss,
        maxElevation: walkLeg.maxElevation,
        minElevation: walkLeg.minElevation,
        edgeSegments: walkLeg.edgeSegments,
      }

      const bikeSegment: TripSegment = {
        segmentIndex: 1,
        mode: 'biking',
        vehicle: bike,
        start: { location: bikeLocation, type: 'via', label: 'Your bike' },
        end: to,
        startTime: walkSegment.endTime,
        endTime: new Date(
          new Date(walkSegment.endTime).getTime() + bikeLeg.duration * 1000,
        ).toISOString(),
        duration: bikeLeg.duration,
        distance: bikeLeg.distance,
        geometry: bikeLeg.geometry,
        instructions: bikeLeg.instructions,
        co2: 0,
        totalElevationGain: bikeLeg.totalElevationGain,
        totalElevationLoss: bikeLeg.totalElevationLoss,
        maxElevation: bikeLeg.maxElevation,
        minElevation: bikeLeg.minElevation,
        edgeSegments: bikeLeg.edgeSegments,
      }

      return {
        segment: bikeSegment,
        multimodalSegments: [walkSegment, bikeSegment],
        state: {
          currentTime: bikeSegment.endTime,
          currentLocation: to.location,
          currentMode: 'biking',
          parkedVehicles: state.parkedVehicles,
        },
      }
    } catch (error) {
      console.error('Multimodal biking failed:', error)
      return null
    }
  }

  /**
   * Plan direct biking route (bike assumed at origin)
   */
  private async planDirectBike(
    from: Waypoint,
    to: Waypoint,
    state: SegmentState,
    preferences?: any,
  ): Promise<{ segment: TripSegment; state: SegmentState } | null> {
    try {
      const route = await routingService.getRoute(
        [
          {
            type: 'coordinates',
            value: [from.location.lat, from.location.lng],
          },
          { type: 'coordinates', value: [to.location.lat, to.location.lng] },
        ],
        'bicycle',
        preferences,
      )

      if (!route.routes.length) return null

      const leg = route.routes[0].legs[0]

      const segment: TripSegment = {
        segmentIndex: 0,
        mode: 'biking',
        start: from,
        end: to,
        startTime: state.currentTime,
        endTime: new Date(
          new Date(state.currentTime).getTime() + leg.duration * 1000,
        ).toISOString(),
        duration: leg.duration,
        distance: leg.distance,
        geometry: leg.geometry,
        instructions: leg.instructions,
        co2: 0,
        totalElevationGain: leg.totalElevationGain,
        totalElevationLoss: leg.totalElevationLoss,
        maxElevation: leg.maxElevation,
        minElevation: leg.minElevation,
        edgeSegments: leg.edgeSegments,
      }

      return {
        segment,
        state: {
          currentTime: segment.endTime,
          currentLocation: to.location,
          currentMode: 'biking',
          parkedVehicles: state.parkedVehicles,
        },
      }
    } catch (error) {
      console.error('Direct biking failed:', error)
      return null
    }
  }

  /**
   * Plan transit segment — walk → transit → walk composition.
   *
   * Queries Barrelman for transit itineraries between origin and destination.
   * MOTIS handles stop discovery and transit routing; Parchment replaces
   * the walking legs with actual GraphHopper walking routes for accuracy.
   *
   * Returns multiple segments: [walk to stop, transit leg(s), walk from stop]
   */
  private async planTransitSegment(
    from: Waypoint,
    to: Waypoint,
    state: SegmentState,
    preferences?: any,
  ): Promise<{
    segment: TripSegment
    state: SegmentState
    multimodalSegments?: TripSegment[]
  } | null> {
    try {
      const transitResponse = await transitRoutingService.getTransitRoute({
        from: from.location,
        to: to.location,
        time: state.currentTime,
        arriveBy: false,
        numItineraries: 1,
        transitModes: preferences?.transitModes,
        maxWalkDistance: preferences?.maxWalkingDistance,
        maxTransfers: preferences?.maxTransfers,
        wheelchair: preferences?.wheelchairAccessible,
      })

      if (!transitResponse.itineraries.length) return null

      // Use the best itinerary
      const itinerary = transitResponse.itineraries[0]
      const segments: TripSegment[] = []
      let segmentTime = state.currentTime

      for (const leg of itinerary.legs) {
        if (leg.transitLeg) {
          // Transit leg — convert MOTIS leg to our TripSegment with TransitDetails
          const transitSegment = this.buildTransitSegment(leg, from, to, segmentTime)
          segments.push(transitSegment)
          segmentTime = transitSegment.endTime
        } else {
          // Walking leg — route via GraphHopper for accurate geometry and instructions
          const walkFrom: Waypoint = {
            location: { lat: leg.from.lat, lng: leg.from.lng },
            type: 'via',
            label: leg.from.name || undefined,
          }
          const walkTo: Waypoint = {
            location: { lat: leg.to.lat, lng: leg.to.lng },
            type: 'via',
            label: leg.to.name || undefined,
          }

          const walkResult = await this.planWalkingSegmentForTransit(
            walkFrom,
            walkTo,
            segmentTime,
            preferences,
          )

          if (walkResult) {
            segments.push(walkResult.segment)
            segmentTime = walkResult.segment.endTime
          } else {
            // Fallback: use the straight-line walk from MOTIS
            const fallbackSegment = this.buildWalkingFallbackSegment(
              leg,
              segmentTime,
            )
            segments.push(fallbackSegment)
            segmentTime = fallbackSegment.endTime
          }
        }
      }

      if (segments.length === 0) return null

      // The "main" segment is the first transit leg (or last segment if all walking)
      const mainSegment = segments.find(s => s.mode === 'transit') || segments[segments.length - 1]

      return {
        segment: mainSegment,
        multimodalSegments: segments,
        state: {
          currentTime: segments[segments.length - 1].endTime,
          currentLocation: to.location,
          currentMode: 'transit',
          parkedVehicles: state.parkedVehicles,
        },
      }
    } catch (error) {
      console.error('Transit routing failed:', error)
      return null
    }
  }

  /**
   * Plan a walking segment specifically for transit access/egress.
   * Similar to planWalkingSegment but doesn't skip short walks (< 1 min)
   * because even short walks are important in transit context.
   */
  private async planWalkingSegmentForTransit(
    from: Waypoint,
    to: Waypoint,
    startTime: string,
    preferences?: any,
  ): Promise<{ segment: TripSegment } | null> {
    try {
      const route = await routingService.getRoute(
        [
          { type: 'coordinates', value: [from.location.lat, from.location.lng] },
          { type: 'coordinates', value: [to.location.lat, to.location.lng] },
        ],
        'pedestrian',
        preferences,
      )

      if (!route.routes.length) return null

      const leg = route.routes[0].legs[0]
      // Don't skip short segments for transit — even 30s walks matter
      if (leg.distance < 5) return null

      const segment: TripSegment = {
        segmentIndex: 0,
        mode: 'walking',
        start: from,
        end: to,
        startTime,
        endTime: new Date(
          new Date(startTime).getTime() + leg.duration * 1000,
        ).toISOString(),
        duration: leg.duration,
        distance: leg.distance,
        geometry: leg.geometry,
        instructions: leg.instructions,
        co2: 0,
        totalElevationGain: leg.totalElevationGain,
        totalElevationLoss: leg.totalElevationLoss,
        maxElevation: leg.maxElevation,
        minElevation: leg.minElevation,
        edgeSegments: leg.edgeSegments,
      }

      return { segment }
    } catch {
      return null
    }
  }

  /**
   * Build a TripSegment from a MOTIS transit leg.
   * Maps MOTIS OTPAPI fields to our TransitDetails type.
   */
  private buildTransitSegment(
    leg: any,
    tripFrom: Waypoint,
    tripTo: Waypoint,
    startTime: string,
  ): TripSegment {
    const departureStop: TransitStop = {
      id: leg.from.stopId || '',
      name: leg.from.name || '',
      location: { lat: leg.from.lat, lng: leg.from.lng },
      platformCode: leg.from.platformCode,
      departureTime: leg.startTime,
    }

    const arrivalStop: TransitStop = {
      id: leg.to.stopId || '',
      name: leg.to.name || '',
      location: { lat: leg.to.lat, lng: leg.to.lng },
      platformCode: leg.to.platformCode,
      arrivalTime: leg.endTime,
    }

    const intermediateStops: TransitStop[] = (leg.intermediateStops || []).map(
      (s: any, i: number) => ({
        id: s.stopId || '',
        name: s.name || '',
        location: { lat: s.lat, lng: s.lng },
        platformCode: s.platformCode,
        arrivalTime: s.arrival,
        departureTime: s.departure,
        stopSequence: i + 1,
      }),
    )

    const routeType = this.mapMotisMode(leg.mode)

    const transitDetails: TransitDetails = {
      route: {
        id: leg.routeId || '',
        shortName: leg.routeShortName,
        longName: leg.routeLongName,
        type: routeType,
        color: leg.routeColor,
        textColor: leg.routeTextColor,
        agency: {
          id: leg.agencyId || '',
          name: leg.agencyName || '',
        },
      },
      trip: {
        id: leg.tripId || '',
        headsign: leg.headsign,
      },
      stops: [departureStop, ...intermediateStops, arrivalStop],
      departureStop,
      arrivalStop,
      headsign: leg.headsign,
      shortName: leg.routeShortName,
      color: leg.routeColor,
      textColor: leg.routeTextColor,
    }

    return {
      segmentIndex: 0,
      mode: 'transit',
      start: {
        location: { lat: leg.from.lat, lng: leg.from.lng },
        type: 'via',
        label: leg.from.name,
      },
      end: {
        location: { lat: leg.to.lat, lng: leg.to.lng },
        type: 'via',
        label: leg.to.name,
      },
      startTime: leg.startTime,
      endTime: leg.endTime,
      duration: leg.duration,
      distance: leg.distance,
      geometry: leg.geometry || null,
      instructions: [],
      co2: leg.distance * 0.00005, // ~50g CO2/km for transit
      details: { transitDetails },
    }
  }

  /**
   * Build a fallback walking segment from MOTIS straight-line data
   * when GraphHopper routing fails.
   */
  private buildWalkingFallbackSegment(leg: any, startTime: string): TripSegment {
    return {
      segmentIndex: 0,
      mode: 'walking',
      start: {
        location: { lat: leg.from.lat, lng: leg.from.lng },
        type: 'via',
        label: leg.from.name,
      },
      end: {
        location: { lat: leg.to.lat, lng: leg.to.lng },
        type: 'via',
        label: leg.to.name,
      },
      startTime,
      endTime: new Date(
        new Date(startTime).getTime() + leg.duration * 1000,
      ).toISOString(),
      duration: leg.duration,
      distance: leg.distance,
      geometry: leg.geometry || null,
      instructions: [],
      co2: 0,
    }
  }

  /**
   * Map MOTIS mode strings to our TransitRouteType enum.
   */
  private mapMotisMode(mode: string): TransitRouteType {
    switch (mode) {
      case 'TRAM': return 'tram' as TransitRouteType
      case 'SUBWAY': return 'subway' as TransitRouteType
      case 'RAIL': return 'rail' as TransitRouteType
      case 'BUS': return 'bus' as TransitRouteType
      case 'FERRY': return 'ferry' as TransitRouteType
      case 'CABLE_CAR': return 'cable_car' as TransitRouteType
      case 'GONDOLA': return 'gondola' as TransitRouteType
      case 'FUNICULAR': return 'funicular' as TransitRouteType
      default: return 'bus' as TransitRouteType
    }
  }

  /**
   * Calculate trip statistics from segments
   */
  private calculateStats(segments: TripSegment[]): TripStats {
    let totalDuration = 0
    let totalDistance = 0
    let totalCost = 0
    let totalCo2 = 0

    for (const segment of segments) {
      totalDuration += segment.duration
      totalDistance += segment.distance
      totalCost += segment.cost?.value || 0
      totalCo2 += segment.co2 || 0
    }

    return {
      totalDuration,
      totalDistance,
      totalCost:
        totalCost > 0 ? { value: totalCost, currency: 'USD' } : undefined,
      totalCo2: totalCo2 > 0 ? totalCo2 : undefined,
    }
  }

  /**
   * Validate trip request
   */
  private validateRequest(request: TripRequest): void {
    if (!request.waypoints || request.waypoints.length < 2) {
      throw new Error('Trip request must have at least 2 waypoints')
    }

    for (const waypoint of request.waypoints) {
      if (
        !waypoint.location ||
        typeof waypoint.location.lat !== 'number' ||
        typeof waypoint.location.lng !== 'number'
      ) {
        throw new Error('All waypoints must have valid coordinates')
      }
    }
  }
}

export const tripService = new TripService()
export const multimodalTripService = tripService // Alias for backwards compatibility
