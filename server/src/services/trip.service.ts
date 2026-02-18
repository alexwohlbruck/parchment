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
} from '../types/trip.types'
import { Coordinate } from '../types/unified-routing.types'
import { routingService } from './routing.service'

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
        return ['walking', 'driving', 'biking']
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
        // Transit (can include walking to/from transit)
        return ['walking'] // TODO: Add transit when implemented
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
        })
        segments.push(...result.multimodalSegments)
      } else {
        result.segment.segmentIndex = segments.length
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
