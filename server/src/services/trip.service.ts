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
  TripWarning,
  TripScore,
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
        if (mode === 'transit') {
          // Transit generates multiple trip candidates (one per itinerary)
          const trips = await this.planTransitTrips(request, dataSources)
          candidates.push(...trips)
        } else {
          const trip = await this.planModeTrip(request, mode, dataSources)
          if (trip) candidates.push(trip)
        }
      } catch (error) {
        console.error(`Failed to plan ${mode} trip:`, error)
      }
    }

    // Score and rank trips.
    // referenceTime = when the user wants to depart. Used so a transit trip
    // that doesn't leave for 6 hours scores worse than an immediate drive.
    const referenceTime =
      request.preferredDepartureTime || new Date().toISOString()

    const scored = candidates.map((trip) => {
      const score = this.scoreTrip(trip, referenceTime)
      return {
        trip,
        score: {
          ...score,
          overall: this.computeOverallScore(score),
        },
        rank: 0,
      }
    })

    // All named sort preferences use direct ranking — the primary metric
    // determines order, with balanced score as a tiebreaker. Only the
    // default "balanced" mode uses the weighted scoring system.
    switch (request.sortPreference) {
      case 'earliest_arrival':
        this.rankByArrivalTime(scored)
        break
      case 'shortest':
        this.rankByDuration(scored)
        break
      case 'cheapest':
        this.rankByCost(scored)
        break
      case 'greenest':
        this.rankByCo2(scored)
        break
      case 'fewest_transfers':
        this.rankByTransfers(scored)
        break
      case 'least_walking':
        this.rankByWalkingDistance(scored)
        break
    }

    const sorted = scored
      .sort((a, b) => b.score.overall - a.score.overall)

    const rankedTrips: TripCandidate[] = this.filterQualityTrips(sorted)
      .map((candidate, index) => ({ ...candidate, rank: index + 1 }))

    return {
      request,
      trips: rankedTrips,
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
    const warnings: TripWarning[] = []
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

      // ── Apply time constraints from the origin waypoint ──────────
      const constraintWarnings = this.applyWaypointTimeConstraints(
        from,
        i,
        currentState,
      )
      warnings.push(...constraintWarnings.warnings)
      currentState = constraintWarnings.state

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

    // ── Check arrival constraint on the final waypoint ─────────────
    const lastWp = request.waypoints[request.waypoints.length - 1]
    if (lastWp.arriveBy) {
      const arriveByTime = new Date(lastWp.arriveBy).getTime()
      const actualArrival = new Date(currentState.currentTime).getTime()
      if (actualArrival > arriveByTime) {
        const overshoot = Math.round((actualArrival - arriveByTime) / 1000)
        warnings.push({
          type: 'time_constraint_violated',
          waypointIndex: request.waypoints.length - 1,
          message: `Arrived ${Math.ceil(overshoot / 60)} min after requested arrival time`,
          overshootSeconds: overshoot,
        })
      }
    }

    const tripStats = this.calculateStats(segments)

    return {
      segments,
      tripStats,
      earliestStartTime: segments[0]?.startTime || currentState.currentTime,
      latestEndTime:
        segments[segments.length - 1]?.endTime || currentState.currentTime,
      ...(warnings.length > 0 && { warnings }),
      dataSources,
      requestId: request.requestId,
      generatedAt: new Date().toISOString(),
    }
  }

  /**
   * Apply per-waypoint time constraints (departAfter, arriveBy, dwellTime)
   * and return updated state + any warnings.
   */
  private applyWaypointTimeConstraints(
    waypoint: Waypoint,
    waypointIndex: number,
    state: SegmentState,
  ): { state: SegmentState; warnings: TripWarning[] } {
    const warnings: TripWarning[] = []
    let currentTime = new Date(state.currentTime).getTime()

    // Check arriveBy — warn if we arrived after the requested time
    if (waypoint.arriveBy) {
      const arriveByTime = new Date(waypoint.arriveBy).getTime()
      if (currentTime > arriveByTime) {
        const overshoot = Math.round((currentTime - arriveByTime) / 1000)
        warnings.push({
          type: 'time_constraint_violated',
          waypointIndex,
          message: `Arrived ${Math.ceil(overshoot / 60)} min after requested arrival time`,
          overshootSeconds: overshoot,
        })
      }
    }

    // Apply dwellTime — time spent at this waypoint before continuing
    if (waypoint.dwellTime && waypoint.dwellTime > 0) {
      currentTime += waypoint.dwellTime * 60 * 1000 // minutes → ms
    }

    // Enforce departAfter — don't leave before the specified time
    if (waypoint.departAfter) {
      const departAfterTime = new Date(waypoint.departAfter).getTime()
      if (currentTime < departAfterTime) {
        // Wait until the departure time
        currentTime = departAfterTime
      }
    }

    return {
      state: {
        ...state,
        currentTime: new Date(currentTime).toISOString(),
      },
      warnings,
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
        cost: { value: driveLeg.distance * TripService.FUEL_COST_PER_METER, currency: 'USD' },
        co2: driveLeg.distance * TripService.CO2_PER_METER.driving,
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
        cost: { value: leg.distance * TripService.FUEL_COST_PER_METER, currency: 'USD' },
        co2: leg.distance * TripService.CO2_PER_METER.driving,
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
   * Plan multiple transit trips — returns one TripResponse per itinerary.
   *
   * Used by planTrip() to generate multiple transit candidates for scoring.
   * Requests 3 itineraries from MOTIS and composes each independently.
   */
  private async planTransitTrips(
    request: TripRequest,
    dataSources: DataSource[],
  ): Promise<TripResponse[]> {
    const preferences = {
      ...(request.routingPreferences || {}),
      ...(request.language && { language: request.language }),
    }
    const startTime =
      request.preferredDepartureTime || new Date().toISOString()

    try {
      const from = request.waypoints[0]
      const to = request.waypoints[request.waypoints.length - 1]

      const transitResponse = await transitRoutingService.getTransitRoute({
        from: from.location,
        to: to.location,
        time: startTime,
        arriveBy: false,
        numItineraries: 5,
        transitModes: preferences?.transitModes,
        maxWalkDistance: preferences?.maxWalkingDistance,
        maxTransfers: preferences?.maxTransfers,
        wheelchair: preferences?.wheelchairAccessible,
      })

      if (!transitResponse.itineraries.length) return []

      // Compose each itinerary into a full TripResponse.
      // Itineraries are independent — compose in parallel for faster response.
      const composed = await Promise.all(
        transitResponse.itineraries.map(async (itinerary) => {
          const segments = await this.composeTransitItinerary(
            itinerary,
            startTime,
            from,
            to,
            preferences,
          )
          if (segments.length === 0) return null

          // Index segments
          segments.forEach((seg, idx) => {
            seg.segmentIndex = idx
            seg.legIndex = 0
          })

          const tripStats = this.calculateStats(segments)

          // Apply itinerary-level fare from GTFS data (via MOTIS).
          // This already accounts for transfer rules (e.g. free transfers
          // within 105 minutes) so it replaces per-boarding fare summing.
          if (itinerary.fare) {
            tripStats.totalCost = {
              value: itinerary.fare.amount,
              currency: itinerary.fare.currency,
            }
          }

          return {
            segments,
            tripStats,
            earliestStartTime: segments[0]?.startTime || startTime,
            latestEndTime:
              segments[segments.length - 1]?.endTime || startTime,
            dataSources,
            requestId: request.requestId,
            generatedAt: new Date().toISOString(),
          } as TripResponse
        }),
      )

      return composed.filter((r): r is TripResponse => r !== null)
    } catch (error) {
      console.error('Transit routing failed:', error)
      return []
    }
  }

  /**
   * Compose a single MOTIS itinerary into an array of TripSegments.
   *
   * Replaces MOTIS walking legs with accurate GraphHopper walking routes,
   * and converts transit legs to TripSegments with TransitDetails.
   * Reused by both planTransitTrips() and planTransitSegment().
   *
   * The `origin` and `destination` waypoints ensure the first walking
   * leg starts at the user's exact origin and the last walking leg
   * ends at the user's exact destination — MOTIS may snap these to
   * nearby transit stop coordinates which can be hundreds of feet off.
   *
   * Walking segments that precede transit legs are timed so the user
   * arrives at the stop shortly before the transit departure, rather
   * than starting the walk at the overall trip departure time and
   * waiting at the station. A configurable buffer (default 2 min)
   * ensures the user arrives a bit early.
   */
  private async composeTransitItinerary(
    itinerary: any,
    startTime: string,
    origin: Waypoint,
    destination: Waypoint,
    preferences?: any,
  ): Promise<TripSegment[]> {
    const legs = itinerary.legs
    const segments: TripSegment[] = []
    // Buffer before transit departure (seconds). User preference 1-5 min.
    const transitBufferMin = preferences?.transitBufferMinutes ?? 2
    const transitBufferSec = transitBufferMin * 60

    for (let i = 0; i < legs.length; i++) {
      const leg = legs[i]

      if (leg.transitLeg) {
        // Transit leg — convert MOTIS leg to our TripSegment with TransitDetails
        const transitSegment = this.buildTransitSegment(
          leg,
          { location: { lat: leg.from.lat, lng: leg.from.lng }, type: 'via' },
          { location: { lat: leg.to.lat, lng: leg.to.lng }, type: 'via' },
          leg.startTime, // use MOTIS departure time for the transit leg
        )
        segments.push(transitSegment)
      } else {
        // Walking leg — route via GraphHopper for accurate geometry.
        // Use the user's actual origin/destination for the first/last
        // walking legs so the route reaches the exact endpoints, not
        // the MOTIS-snapped stop coordinates which can be off by
        // hundreds of feet.
        const isFirstLeg = i === 0
        const isLastLeg = i === legs.length - 1

        const walkFrom: Waypoint = isFirstLeg
          ? origin
          : {
              location: { lat: leg.from.lat, lng: leg.from.lng },
              type: 'via',
              label: leg.from.name || undefined,
            }
        const walkTo: Waypoint = isLastLeg
          ? destination
          : {
              location: { lat: leg.to.lat, lng: leg.to.lng },
              type: 'via',
              label: leg.to.name || undefined,
            }

        // Determine walk start time:
        // - Access walk (before first transit): back-calculate from transit departure
        // - Transfer walk (between transit legs): start when previous transit arrives
        // - Egress walk (after last transit): start when last transit arrives
        const nextLeg = i < legs.length - 1 ? legs[i + 1] : null
        const prevSegEnd = segments.length > 0
          ? new Date(segments[segments.length - 1].endTime).getTime()
          : null
        const tripStart = new Date(startTime).getTime()
        let walkStartTime: string

        if (prevSegEnd) {
          // Transfer or egress walk — always start right when previous segment ends
          walkStartTime = new Date(prevSegEnd).toISOString()
        } else if (nextLeg?.transitLeg) {
          // Access walk (first segment) — use MOTIS estimate for initial timing;
          // we'll recalculate after getting the real GraphHopper duration below.
          const transitDeparture = new Date(nextLeg.startTime).getTime()
          const walkDuration = leg.duration || 0 // seconds (MOTIS estimate)
          const idealStart = transitDeparture - (walkDuration * 1000) - (transitBufferSec * 1000)
          walkStartTime = new Date(Math.max(idealStart, tripStart)).toISOString()
        } else {
          walkStartTime = startTime
        }

        const walkResult = await this.planWalkingSegmentForTransit(
          walkFrom,
          walkTo,
          walkStartTime,
          preferences,
        )

        let walkSegment: TripSegment
        if (walkResult) {
          walkSegment = walkResult.segment
        } else {
          // Fallback: use the straight-line walk from MOTIS
          walkSegment = this.buildWalkingFallbackSegment(
            leg,
            walkStartTime,
          )
        }

        // Re-time walks that precede a transit leg using the actual
        // GraphHopper duration instead of the MOTIS estimate. MOTIS
        // often underestimates walk time (it uses straight-line or
        // its own heuristic), so the walk can overshoot the transit
        // departure if we only use the MOTIS-based start time.
        if (nextLeg?.transitLeg) {
          const transitDeparture = new Date(nextLeg.startTime).getTime()
          const actualWalkDuration = walkSegment.duration // seconds (from GraphHopper)

          if (!prevSegEnd) {
            // Access walk (first segment): recalculate start time using
            // actual walk duration so we arrive buffer-minutes early.
            const idealStart = transitDeparture - (actualWalkDuration * 1000) - (transitBufferSec * 1000)
            const newStart = Math.max(idealStart, tripStart)
            walkSegment.startTime = new Date(newStart).toISOString()
            // Walk ends at start + actual duration
            const newEnd = newStart + (actualWalkDuration * 1000)
            walkSegment.endTime = new Date(newEnd).toISOString()
            walkSegment.duration = actualWalkDuration
          } else {
            // Transfer walk (between transit legs): starts when previous
            // transit arrives. If the walk can't finish before the next
            // transit departs, this connection is infeasible — skip the
            // entire itinerary.
            const walkEnd = prevSegEnd + (actualWalkDuration * 1000)
            if (walkEnd > transitDeparture) {
              // Infeasible: walk takes longer than the transfer window
              return []
            }
          }

          // Extend walk segment to fill the gap up to transit departure.
          // The extra time is wait time at the stop, but the timeline
          // should show a continuous bar rather than a gap.
          const walkEnd = new Date(walkSegment.endTime).getTime()
          if (transitDeparture > walkEnd) {
            walkSegment.endTime = new Date(transitDeparture).toISOString()
            walkSegment.duration = (transitDeparture - new Date(walkSegment.startTime).getTime()) / 1000
          }
        }

        segments.push(walkSegment)
      }
    }

    // MOTIS in transit-only mode with stop IDs may omit access/egress WALK
    // legs entirely — the itinerary starts at the boarding stop and ends
    // at the alighting stop. Synthesize the missing walking segments via
    // GraphHopper so the trip connects the user's actual origin/destination.

    if (segments.length > 0) {
      const firstSeg = segments[0]
      const lastSeg = segments[segments.length - 1]

      // Access walk: origin → first transit boarding stop
      if (firstSeg.mode !== 'walking') {
        const stopWaypoint: Waypoint = {
          location: firstSeg.start.location,
          type: 'via',
          label: firstSeg.start.label,
        }
        // Back-calculate start time from transit departure
        const transitDeparture = new Date(firstSeg.startTime).getTime()
        const tripStart = new Date(startTime).getTime()

        // First get the walk to compute actual duration
        const accessResult = await this.planWalkingSegmentForTransit(
          origin,
          stopWaypoint,
          startTime, // temporary; we'll re-time below
          preferences,
        )

        if (accessResult) {
          const actualDuration = accessResult.segment.duration
          const idealStart = transitDeparture - (actualDuration * 1000) - (transitBufferSec * 1000)
          const newStart = Math.max(idealStart, tripStart)
          accessResult.segment.startTime = new Date(newStart).toISOString()
          const newEnd = newStart + (actualDuration * 1000)
          accessResult.segment.endTime = new Date(newEnd).toISOString()

          // Extend to fill gap up to transit departure
          if (transitDeparture > newEnd) {
            accessResult.segment.endTime = new Date(transitDeparture).toISOString()
            accessResult.segment.duration = (transitDeparture - newStart) / 1000
          }

          segments.unshift(accessResult.segment)
        }
      }

      // Egress walk: last transit alighting stop → destination
      if (lastSeg.mode !== 'walking') {
        const stopWaypoint: Waypoint = {
          location: lastSeg.end.location,
          type: 'via',
          label: lastSeg.end.label,
        }
        const egressStart = lastSeg.endTime

        const egressResult = await this.planWalkingSegmentForTransit(
          stopWaypoint,
          destination,
          egressStart,
          preferences,
        )

        if (egressResult) {
          segments.push(egressResult.segment)
        }
      }
    }

    return segments
  }

  /**
   * Plan transit segment — walk → transit → walk composition.
   *
   * Queries Barrelman for a single transit itinerary between two waypoints.
   * Used by planModeTrip() for multi-waypoint transit (each leg planned
   * independently). For multi-candidate generation, see planTransitTrips().
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

      const itinerary = transitResponse.itineraries[0]
      const segments = await this.composeTransitItinerary(
        itinerary,
        state.currentTime,
        from,
        to,
        preferences,
      )

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

    // Convert GeoJSON geometry to Array<{lat, lng}> format
    // Barrelman returns {type: 'LineString', coordinates: [[lng,lat],...]}
    // but the frontend map layer expects [{lat, lng}, ...]
    let geometry: any = null
    if (leg.geometry?.coordinates) {
      geometry = leg.geometry.coordinates.map(
        ([lng, lat]: [number, number]) => ({ lat, lng }),
      )
    }

    // MOTIS often returns distance=0 for transit legs — compute from geometry
    const distance = leg.distance > 0
      ? leg.distance
      : TripService.computeDistanceFromGeometry(geometry)

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
      distance,
      geometry,
      instructions: [],
      co2: distance * TripService.CO2_PER_METER.transit,
      details: { transitDetails },
    }
  }

  /**
   * Build a fallback walking segment from MOTIS straight-line data
   * when GraphHopper routing fails.
   */
  private buildWalkingFallbackSegment(leg: any, startTime: string): TripSegment {
    // Convert GeoJSON geometry to Array<{lat, lng}> format
    let geometry: any = null
    if (leg.geometry?.coordinates) {
      geometry = leg.geometry.coordinates.map(
        ([lng, lat]: [number, number]) => ({ lat, lng }),
      )
    }

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
      geometry,
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
   * Compute total distance in meters from a polyline of {lat, lng} points.
   * Used when MOTIS returns distance=0 for transit legs.
   */
  private static computeDistanceFromGeometry(
    geometry: Array<{ lat: number; lng: number }> | null,
  ): number {
    if (!geometry || geometry.length < 2) return 0
    let total = 0
    for (let i = 1; i < geometry.length; i++) {
      const p1 = geometry[i - 1]
      const p2 = geometry[i]
      const dLat = ((p2.lat - p1.lat) * Math.PI) / 180
      const dLng = ((p2.lng - p1.lng) * Math.PI) / 180
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((p1.lat * Math.PI) / 180) *
          Math.cos((p2.lat * Math.PI) / 180) *
          Math.sin(dLng / 2) ** 2
      total += 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    }
    return total
  }

  /**
   * Calculate trip statistics from segments
   */
  private calculateStats(segments: TripSegment[]): TripStats {
    let totalDuration = 0
    let totalDistance = 0
    let totalCost = 0
    let totalCo2 = 0
    let totalWalkingDistance = 0
    let totalTransfers = 0

    for (const segment of segments) {
      totalDuration += segment.duration
      totalDistance += segment.distance
      totalCost += segment.cost?.value || 0
      totalCo2 += segment.co2 || 0

      if (segment.mode === 'walking') {
        totalWalkingDistance += segment.distance
      }
      if (segment.mode === 'transit') {
        totalTransfers++
      }
    }

    // Transfers = number of boardings - 1 (first boarding isn't a transfer)
    if (totalTransfers > 0) totalTransfers--

    return {
      totalDuration,
      totalDistance,
      totalCost:
        totalCost > 0 ? { value: totalCost, currency: 'USD' } : undefined,
      totalCo2: totalCo2 > 0 ? totalCo2 : undefined,
      totalWalkingDistance:
        totalWalkingDistance > 0 ? totalWalkingDistance : undefined,
      totalTransfers: totalTransfers > 0 ? totalTransfers : undefined,
    }
  }

  // ── Quality filtering ────────────────────────────────────────────────────────

  private static readonly MAX_TRIPS = 15

  /**
   * Filter to quality trips only. Keeps up to MAX_TRIPS, dropping trips that
   * are clearly worse than the best option in every meaningful way.
   *
   * Rules applied in order:
   * 1. Quality floor — drop trips >4× the fastest AND >60 min
   * 2. Per-mode cap — max MAX_PER_MODE trips of each mode for variety
   *    (transit is capped by earliest arrival, not by score order)
   * 3. Near-duplicate — drop same-mode trips within 5% duration
   */
  private static readonly QUALITY_FLOOR_SECONDS = 60 * 60 // 60 minutes
  private static readonly MAX_PER_MODE = 2

  private filterQualityTrips(
    sorted: Array<{ trip: TripResponse; score: TripScore; rank: number }>,
  ): Array<{ trip: TripResponse; score: TripScore; rank: number }> {
    if (sorted.length <= 2) return sorted

    const shortestDuration = Math.min(
      ...sorted.map((c) => c.trip.tripStats.totalDuration),
    )

    // For transit, pre-select the earliest-arriving trips to keep.
    // Transit departure times are fixed by the schedule, so arrival time
    // matters more than trip duration — a 17-min trip departing now beats
    // a 12-min trip departing in 10 minutes.
    const transitPreferred = new Set(
      sorted
        .filter((c) => this.getTripMode(c.trip) === 'transit')
        .sort((a, b) => {
          const aEnd = new Date(
            a.trip.segments[a.trip.segments.length - 1]?.endTime || 0,
          ).getTime()
          const bEnd = new Date(
            b.trip.segments[b.trip.segments.length - 1]?.endTime || 0,
          ).getTime()
          return aEnd - bEnd
        })
        .slice(0, TripService.MAX_PER_MODE),
    )

    const kept: typeof sorted = []
    const modeCounts: Record<string, number> = {}

    for (const c of sorted) {
      const dur = c.trip.tripStats.totalDuration
      const mode = this.getTripMode(c.trip)

      // Trips under 1 hour are always reasonable — never filter them.
      // Long trips are filtered if they're > 4× the fastest option.
      if (
        dur > TripService.QUALITY_FLOOR_SECONDS &&
        dur > shortestDuration * 4
      ) {
        continue
      }

      // Per-mode cap: ensure variety across modes.
      // Transit uses arrival-time ordering; other modes use score ordering.
      const modeCount = modeCounts[mode] || 0
      if (modeCount >= TripService.MAX_PER_MODE) continue
      if (mode === 'transit' && !transitPreferred.has(c)) continue

      // Drop near-duplicates: same dominant mode, duration within 5%
      const dominated = kept.some((k) => {
        if (this.getTripMode(k.trip) !== mode) return false
        const durRatio = dur / Math.max(k.trip.tripStats.totalDuration, 1)
        return durRatio > 0.95 && durRatio < 1.05
      })
      if (dominated) continue

      kept.push(c)
      modeCounts[mode] = modeCount + 1
      if (kept.length >= TripService.MAX_TRIPS) break
    }

    return kept
  }

  /**
   * Determine the dominant mode of a trip. Transit if any segment is transit,
   * otherwise the mode with the most duration. Prevents transit trips (which
   * start with walking legs) from being compared as "walking".
   */
  private getTripMode(trip: TripResponse): Mode {
    const hasTransit = trip.segments.some((s) => s.mode === 'transit')
    if (hasTransit) return 'transit'

    const durations: Partial<Record<Mode, number>> = {}
    for (const seg of trip.segments) {
      durations[seg.mode] = (durations[seg.mode] || 0) + seg.duration
    }

    let best: Mode = trip.segments[0]?.mode || 'walking'
    let max = 0
    for (const [mode, dur] of Object.entries(durations)) {
      if (dur! > max) {
        max = dur!
        best = mode as Mode
      }
    }
    return best
  }

  // ── Trip scoring ─────────────────────────────────────────────────────────────

  /** CO2 emission factors in kilograms per meter. */
  private static readonly CO2_PER_METER: Record<string, number> = {
    walking: 0,
    biking: 0,
    transit: 0.00005, // ~50g/km = 0.05 kg/km
    driving: 0.00024, // ~240g/km = 0.24 kg/km
    wheelchair: 0,
  }

  /** Fuel cost per meter for driving (based on ~$3.50/gal, ~25 MPG → ~$0.087/km) */
  private static readonly FUEL_COST_PER_METER = 0.000087

  // Transit fare is provided by MOTIS from GTFS fare data (fare_attributes.txt).
  // No hardcoded default — agencies without fare data simply show no price.

  /**
   * Score a trip across multiple dimensions.
   * Each dimension is normalized to 0-1 where 1 is best.
   *
   * @param referenceTime - when the user wants to depart (ISO string).
   *   Used to compute arrival offset so transit trips that don't depart
   *   for hours are scored worse than immediate-departure modes.
   */
  private scoreTrip(trip: TripResponse, referenceTime: string): TripScore {
    return {
      overall: 0, // computed later by computeOverallScore
      time: this.scoreTime(trip, referenceTime),
      cost: this.scoreCost(trip),
      comfort: this.scoreComfort(trip),
      environmental: this.scoreEnvironmental(trip),
      safety: 0.5, // TODO: derive from GraphHopper edge data when available
    }
  }

  /**
   * Time score: based on arrival offset from the requested departure time.
   *
   * Uses `arrivalTime - referenceTime` instead of raw trip duration so that
   * trips with long waits (e.g. transit not departing for 6 hours) are
   * properly penalized. For immediate-departure modes (driving, walking,
   * cycling) the arrival offset ≈ duration, so this is backward-compatible.
   */
  private scoreTime(trip: TripResponse, referenceTime: string): number {
    const refMs = new Date(referenceTime).getTime()
    const arrMs = new Date(trip.latestEndTime).getTime()
    const arrivalOffset = (arrMs - refMs) / 1000

    // Use the greater of arrival offset and duration. Arrival offset is
    // normally ≥ duration, but if clocks or planning times are slightly
    // off we never want the score to be *better* than raw duration implies.
    const effective = Math.max(arrivalOffset, trip.tripStats.totalDuration)
    if (effective <= 0) return 1

    // Ratio-preserving: trips ≤10 min all score 1.0. Longer trips scale
    // linearly — a 20 min trip scores 0.5, a 54 min trip scores 0.185.
    // This preserves real-world duration ratios (5.4× slower → 5.4× lower
    // score) so fast modes always outrank slow ones in balanced mode.
    return 600 / Math.max(600, effective)
  }

  /** Cost score: inverse of monetary cost. Free trips → 1.0 */
  private scoreCost(trip: TripResponse): number {
    const cost = trip.tripStats.totalCost?.value ?? 0
    if (cost <= 0) return 1
    // $2 → 0.83, $5 → 0.67, $10 → 0.50, $20 → 0.33
    return 10 / (10 + cost)
  }

  /**
   * Comfort score: penalizes long walks and many transfers.
   * - Walking > 500m starts penalizing (transit access/egress context)
   * - Each transfer beyond 1 penalizes
   * - Pure walking/cycling trips get full comfort score — the walk
   *   penalty only applies when walking is an inconvenient part of
   *   a multimodal trip, not when it IS the mode.
   */
  private scoreComfort(trip: TripResponse): number {
    const mode = trip.segments[0]?.mode
    const isPureWalkOrBike =
      trip.segments.length > 0 &&
      trip.segments.every((s) => s.mode === 'walking' || s.mode === 'biking')
    if (isPureWalkOrBike) return 1

    const walkDist = trip.tripStats.totalWalkingDistance ?? 0
    const transfers = trip.tripStats.totalTransfers ?? 0

    // Walk penalty: 0m → 1.0, 500m → 0.5, 1500m → 0.25
    const walkScore = 500 / (500 + walkDist)

    // Transfer penalty: 0 → 1.0, 1 → 0.67, 2 → 0.5, 3 → 0.4
    const transferScore = 1 / (1 + transfers * 0.5)

    return walkScore * 0.6 + transferScore * 0.4
  }

  /**
   * Environmental score: based on CO2 emissions.
   * Walking/biking → 1.0, transit → ~0.7, driving → ~0.3
   */
  private scoreEnvironmental(trip: TripResponse): number {
    const totalCo2 = trip.tripStats.totalCo2 ?? 0
    if (totalCo2 <= 0) return 1
    // 0kg → 1.0, 0.25kg → 0.5 (≈1km driving), 1kg → 0.2
    return 0.25 / (0.25 + totalCo2)
  }

  /**
   * Override overall scores so trips sort by earliest arrival time.
   * Ties are broken by the balanced weighted score.
   */
  private rankByArrivalTime(
    candidates: Array<{ trip: TripResponse; score: TripScore }>,
  ): void {
    if (candidates.length === 0) return

    const arrivals = candidates.map((c) => {
      const segs = c.trip.segments
      if (!segs || segs.length === 0) return Infinity
      return new Date(segs[segs.length - 1].endTime).getTime()
    })

    const earliest = Math.min(...arrivals.filter((t) => t !== Infinity))
    const latest = Math.max(...arrivals.filter((t) => t !== Infinity))
    const range = latest - earliest

    for (let i = 0; i < candidates.length; i++) {
      let primary: number
      if (arrivals[i] === Infinity) {
        primary = 0
      } else if (range === 0) {
        primary = 1
      } else {
        primary = 1 - (arrivals[i] - earliest) / range
      }
      // Balanced score as tiebreaker (scaled to <1 so it never overrides primary)
      const balanced = this.computeOverallScore(candidates[i].score)
      candidates[i].score.overall = primary + balanced * 0.001
    }
  }

  /**
   * Override overall scores so trips sort by lowest CO2 emissions.
   * Ties are broken by the balanced weighted score.
   */
  private rankByCo2(
    candidates: Array<{ trip: TripResponse; score: TripScore }>,
  ): void {
    if (candidates.length === 0) return

    const emissions = candidates.map((c) => c.trip.tripStats.totalCo2 ?? 0)

    const lowest = Math.min(...emissions)
    const highest = Math.max(...emissions)
    const range = highest - lowest

    for (let i = 0; i < candidates.length; i++) {
      let primary: number
      if (range === 0) {
        primary = 1
      } else {
        primary = 1 - (emissions[i] - lowest) / range
      }
      // Balanced score as tiebreaker
      const balanced = this.computeOverallScore(candidates[i].score)
      candidates[i].score.overall = primary + balanced * 0.001
    }
  }

  /**
   * Override overall scores so trips sort by fewest transfers.
   * Non-transit trips (0 transfers) rank first. Ties broken by balanced score.
   */
  private rankByTransfers(
    candidates: Array<{ trip: TripResponse; score: TripScore }>,
  ): void {
    if (candidates.length === 0) return

    const transfers = candidates.map(
      (c) => c.trip.tripStats.totalTransfers ?? 0,
    )

    const fewest = Math.min(...transfers)
    const most = Math.max(...transfers)
    const range = most - fewest

    for (let i = 0; i < candidates.length; i++) {
      let primary: number
      if (range === 0) {
        primary = 1
      } else {
        primary = 1 - (transfers[i] - fewest) / range
      }
      const balanced = this.computeOverallScore(candidates[i].score)
      candidates[i].score.overall = primary + balanced * 0.001
    }
  }

  /**
   * Override overall scores so trips sort by least walking distance.
   * Trips with no walking rank first. Ties broken by balanced score.
   */
  private rankByWalkingDistance(
    candidates: Array<{ trip: TripResponse; score: TripScore }>,
  ): void {
    if (candidates.length === 0) return

    const walkDists = candidates.map(
      (c) => c.trip.tripStats.totalWalkingDistance ?? 0,
    )

    const shortest = Math.min(...walkDists)
    const longest = Math.max(...walkDists)
    const range = longest - shortest

    for (let i = 0; i < candidates.length; i++) {
      let primary: number
      if (range === 0) {
        primary = 1
      } else {
        primary = 1 - (walkDists[i] - shortest) / range
      }
      const balanced = this.computeOverallScore(candidates[i].score)
      candidates[i].score.overall = primary + balanced * 0.001
    }
  }

  /**
   * Override overall scores so trips sort by shortest total duration.
   * Ties broken by balanced score.
   */
  private rankByDuration(
    candidates: Array<{ trip: TripResponse; score: TripScore }>,
  ): void {
    if (candidates.length === 0) return

    const durations = candidates.map(
      (c) => c.trip.tripStats.totalDuration,
    )

    const shortest = Math.min(...durations)
    const longest = Math.max(...durations)
    const range = longest - shortest

    for (let i = 0; i < candidates.length; i++) {
      let primary: number
      if (range === 0) {
        primary = 1
      } else {
        primary = 1 - (durations[i] - shortest) / range
      }
      const balanced = this.computeOverallScore(candidates[i].score)
      candidates[i].score.overall = primary + balanced * 0.001
    }
  }

  /**
   * Override overall scores so trips sort by lowest cost.
   * Free trips rank first. Ties broken by balanced score.
   */
  private rankByCost(
    candidates: Array<{ trip: TripResponse; score: TripScore }>,
  ): void {
    if (candidates.length === 0) return

    const costs = candidates.map(
      (c) => c.trip.tripStats.totalCost?.value ?? 0,
    )

    const lowest = Math.min(...costs)
    const highest = Math.max(...costs)
    const range = highest - lowest

    for (let i = 0; i < candidates.length; i++) {
      let primary: number
      if (range === 0) {
        primary = 1
      } else {
        primary = 1 - (costs[i] - lowest) / range
      }
      const balanced = this.computeOverallScore(candidates[i].score)
      candidates[i].score.overall = primary + balanced * 0.001
    }
  }

  /**
   * Compute the overall score as a weighted combination of dimensions.
   * Used for balanced mode and as tiebreaker in direct-ranking sorts.
   */
  private computeOverallScore(score: TripScore): number {
    const weights = this.getScoreWeights()
    return (
      score.time * weights.time +
      score.cost * weights.cost +
      score.comfort * weights.comfort +
      score.environmental * weights.environmental +
      score.safety * weights.safety
    )
  }

  /**
   * Balanced weight distribution for overall scoring.
   *
   * All named sort preferences (shortest, cheapest, greenest, etc.) use
   * direct ranking methods — they don't go through the weight system.
   * These weights are used only for balanced/default mode and as the
   * tiebreaker in direct-ranking sorts.
   *
   * Time is weighted highest so faster trips win in balanced mode.
   * The ratio-preserving time formula ensures a 10-min drive always
   * outranks a 54-min bike ride, while still allowing a slightly slower
   * but greener/cheaper trip to win when durations are close (~30%).
   */
  private getScoreWeights(): Record<
    keyof Omit<TripScore, 'overall'>,
    number
  > {
    return {
      time: 0.45,
      cost: 0.10,
      comfort: 0.15,
      environmental: 0.15,
      safety: 0.15,
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
