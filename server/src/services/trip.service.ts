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
  SortPreference,
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

    // Score and rank trips
    const rankedTrips: TripCandidate[] = candidates
      .map((trip) => ({
        trip,
        score: this.scoreTrip(trip),
        rank: 0,
      }))
      .map((candidate) => ({
        ...candidate,
        score: {
          ...candidate.score,
          overall: this.computeOverallScore(
            candidate.score,
            request.sortPreference,
          ),
        },
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
        numItineraries: 3,
        transitModes: preferences?.transitModes,
        maxWalkDistance: preferences?.maxWalkingDistance,
        maxTransfers: preferences?.maxTransfers,
        wheelchair: preferences?.wheelchairAccessible,
      })

      if (!transitResponse.itineraries.length) return []

      // Compose each itinerary into a full TripResponse
      const results: TripResponse[] = []
      for (const itinerary of transitResponse.itineraries) {
        const segments = await this.composeTransitItinerary(
          itinerary,
          startTime,
          preferences,
        )
        if (segments.length === 0) continue

        // Index segments
        segments.forEach((seg, idx) => {
          seg.segmentIndex = idx
          seg.legIndex = 0
        })

        const tripStats = this.calculateStats(segments)
        results.push({
          segments,
          tripStats,
          earliestStartTime: segments[0]?.startTime || startTime,
          latestEndTime:
            segments[segments.length - 1]?.endTime || startTime,
          dataSources,
          requestId: request.requestId,
          generatedAt: new Date().toISOString(),
        })
      }

      return results
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
   * Walking segments that precede transit legs are timed so the user
   * arrives at the stop shortly before the transit departure, rather
   * than starting the walk at the overall trip departure time and
   * waiting at the station. A configurable buffer (default 2 min)
   * ensures the user arrives a bit early.
   */
  private async composeTransitItinerary(
    itinerary: any,
    startTime: string,
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
        // Walking leg — route via GraphHopper for accurate geometry
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
          // Access walk (first segment) — back-calculate from transit departure
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

        // For walks that precede transit, extend the segment to fill
        // the gap up to the transit departure. The extra time is wait
        // time at the stop, but the timeline should show a continuous
        // bar rather than a gap with dots.
        if (nextLeg?.transitLeg) {
          const transitDeparture = new Date(nextLeg.startTime).getTime()
          const walkEnd = new Date(walkSegment.endTime).getTime()
          if (transitDeparture > walkEnd) {
            walkSegment.endTime = new Date(transitDeparture).toISOString()
            walkSegment.duration = (transitDeparture - new Date(walkSegment.startTime).getTime()) / 1000
          }
        }

        segments.push(walkSegment)
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
      geometry,
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

  // ── Trip scoring ─────────────────────────────────────────────────────────────

  /** CO2 emission factors in grams per meter. */
  private static readonly CO2_PER_METER: Record<string, number> = {
    walking: 0,
    biking: 0,
    transit: 0.05, // ~50g/km
    driving: 0.24, // ~240g/km
    wheelchair: 0,
  }

  /**
   * Score a trip across multiple dimensions.
   * Each dimension is normalized to 0-1 where 1 is best.
   */
  private scoreTrip(trip: TripResponse): TripScore {
    return {
      overall: 0, // computed later by computeOverallScore
      time: this.scoreTime(trip),
      cost: this.scoreCost(trip),
      comfort: this.scoreComfort(trip),
      environmental: this.scoreEnvironmental(trip),
      safety: 0.5, // TODO: derive from GraphHopper edge data when available
    }
  }

  /** Time score: inverse of duration, normalized so a 10 min trip → 1.0 */
  private scoreTime(trip: TripResponse): number {
    const duration = trip.tripStats.totalDuration
    if (duration <= 0) return 1
    // Sigmoid-ish: 600s → 1.0, 3600s → 0.17, 7200s → 0.08
    return 600 / (600 + duration)
  }

  /** Cost score: inverse of monetary cost. Free trips → 1.0 */
  private scoreCost(trip: TripResponse): number {
    const cost = trip.tripStats.totalCost?.value ?? 0
    if (cost <= 0) return 1
    // $1 → 0.5, $5 → 0.17, $20 → 0.05
    return 1 / (1 + cost)
  }

  /**
   * Comfort score: penalizes long walks and many transfers.
   * - Walking > 500m starts penalizing
   * - Each transfer beyond 1 penalizes
   */
  private scoreComfort(trip: TripResponse): number {
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
    // 0g → 1.0, 250g → 0.5 (≈1km driving), 1000g → 0.2
    return 250 / (250 + totalCo2)
  }

  /**
   * Compute the overall score as a weighted combination of dimensions.
   * Weights depend on the user's sort preference.
   */
  private computeOverallScore(
    score: TripScore,
    sortPreference?: SortPreference,
  ): number {
    const weights = this.getScoreWeights(sortPreference)
    return (
      score.time * weights.time +
      score.cost * weights.cost +
      score.comfort * weights.comfort +
      score.environmental * weights.environmental +
      score.safety * weights.safety
    )
  }

  /**
   * Weight distribution by sort preference.
   * Each set sums to 1.0.
   */
  private getScoreWeights(sortPreference?: SortPreference): Record<
    keyof Omit<TripScore, 'overall'>,
    number
  > {
    switch (sortPreference) {
      case 'fastest':
        return {
          time: 0.7,
          cost: 0.05,
          comfort: 0.1,
          environmental: 0.05,
          safety: 0.1,
        }
      case 'cheapest':
        return {
          time: 0.15,
          cost: 0.55,
          comfort: 0.1,
          environmental: 0.1,
          safety: 0.1,
        }
      case 'fewest_transfers':
        return {
          time: 0.15,
          cost: 0.05,
          comfort: 0.6,
          environmental: 0.1,
          safety: 0.1,
        }
      case 'least_walking':
        return {
          time: 0.1,
          cost: 0.05,
          comfort: 0.65,
          environmental: 0.1,
          safety: 0.1,
        }
      case 'greenest':
        return {
          time: 0.1,
          cost: 0.05,
          comfort: 0.1,
          environmental: 0.65,
          safety: 0.1,
        }
      default:
        // Balanced default
        return {
          time: 0.4,
          cost: 0.1,
          comfort: 0.2,
          environmental: 0.15,
          safety: 0.15,
        }
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
