import {
  TripRequest,
  TripResponse,
  TripSegment,
  TripStats,
  TripScore,
  TripCandidate,
  MultimodalTripResponse,
  TripPlanningError,
  DataSource,
  Waypoint,
  Vehicle,
  Mode,
  SegmentPlanInput,
  SegmentPlanResult,
  SegmentState,
  CurrencyAmount,
} from '../types/trip.types'
import {
  Coordinate,
  TravelMode,
  WaypointType,
} from '../types/unified-routing.types'
import { routingService } from './routing.service'

// TODO: Keep data per user in database
const HARDCODED_VEHICLE_LOCATIONS = {
  car: {
    lat: 35.20939460988835,
    lng: -80.86033779410343,
  },
  bike: {
    lat: 35.209065248660664,
    lng: -80.86111205072174,
  },
}

/**
 * Core multimodal trip planning service
 * Implements segment-wise planning with vehicle state tracking
 */
export class TripService {
  private segmentPlanners: Map<Mode, SegmentPlanner> = new Map()
  private tripScorer: TripScorer = new TripScorer()

  constructor() {
    // Initialize segment planners for each mode
    this.segmentPlanners.set('walking', new WalkingSegmentPlanner())
    this.segmentPlanners.set('driving', new DrivingSegmentPlanner())
    this.segmentPlanners.set('biking', new BikingSegmentPlanner())
    this.segmentPlanners.set('transit', new TransitSegmentPlanner())
    this.segmentPlanners.set('rideshare', new RideshareSegmentPlanner())
    this.segmentPlanners.set('wheelchair', new WheelchairSegmentPlanner())
  }

  /**
   * Main entry point for multimodal trip planning
   */
  async planTrip(request: TripRequest): Promise<MultimodalTripResponse> {
    const startTime = Date.now()
    const dataSources: DataSource[] = []
    const errors: TripPlanningError[] = []
    const warnings: string[] = []

    try {
      // Validate request
      this.validateRequest(request)

      // Generate trip candidates using different strategies
      const candidates = await this.generateTripCandidates(
        request,
        dataSources,
        errors,
      )

      // Score and rank trips
      const scoredTrips = await this.scoreAndRankTrips(candidates, request)

      // Filter and deduplicate
      const finalTrips = this.filterTrips(scoredTrips, request)

      return {
        request,
        trips: finalTrips,
        metadata: {
          totalCandidatesGenerated: candidates.length,
          processingTime: Date.now() - startTime,
          dataSourcesUsed: dataSources,
          warnings: warnings.length > 0 ? warnings : undefined,
          errors: errors.length > 0 ? errors : undefined,
        },
      }
    } catch (error) {
      throw new Error(
        `Multimodal trip planning failed: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      )
    }
  }

  /**
   * Generate multiple trip candidates using different modal combinations
   */
  private async generateTripCandidates(
    request: TripRequest,
    dataSources: DataSource[],
    errors: TripPlanningError[],
  ): Promise<TripResponse[]> {
    const candidates: TripResponse[] = []

    // Strategy 1: Single mode trips
    const singleModeTrips = await this.generateSingleModeTrips(
      request,
      dataSources,
      errors,
    )
    candidates.push(...singleModeTrips)

    // Strategy 2: Multimodal trips with personal vehicles
    if (request.availableVehicles && request.availableVehicles.length > 0) {
      const multimodalTrips = await this.generateMultimodalTrips(
        request,
        dataSources,
        errors,
      )
      candidates.push(...multimodalTrips)
    }

    // Strategy 3: Transit + walking combinations
    const transitTrips = await this.generateTransitTrips(
      request,
      dataSources,
      errors,
    )
    candidates.push(...transitTrips)

    return candidates
  }

  /**
   * Generate single-mode trip options
   */
  private async generateSingleModeTrips(
    request: TripRequest,
    dataSources: DataSource[],
    errors: TripPlanningError[],
  ): Promise<TripResponse[]> {
    const trips: TripResponse[] = []
    const modes: Mode[] = ['walking', 'driving', 'biking', 'transit']

    for (const mode of modes) {
      try {
        const trip = await this.planSingleModeTrip(request, mode, dataSources)
        if (trip) {
          trips.push(trip)
        }
      } catch (error) {
        errors.push({
          code: 'SINGLE_MODE_PLANNING_FAILED',
          message: `Failed to plan ${mode} trip: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`,
          mode,
        })
      }
    }

    return trips
  }

  /**
   * Plan a single-mode trip using segment-wise planning
   */
  private async planSingleModeTrip(
    request: TripRequest,
    mode: Mode,
    dataSources: DataSource[],
  ): Promise<TripResponse | null> {
    const planner = this.segmentPlanners.get(mode)
    if (!planner) {
      throw new Error(`No planner available for mode: ${mode}`)
    }

    const segments: TripSegment[] = []
    let currentState: SegmentState = {
      currentTime: request.preferredDepartureTime || new Date().toISOString(),
      currentLocation: request.waypoints[0].location,
      currentMode: mode,
      parkedVehicles: [],
    }

    // Plan each segment
    for (let i = 0; i < request.waypoints.length - 1; i++) {
      const segmentInput: SegmentPlanInput = {
        from: request.waypoints[i],
        to: request.waypoints[i + 1],
        priorState: currentState,
        preferences: request.routingPreferences || {},
        availableVehicles: request.availableVehicles || [],
        departureTime: currentState.currentTime,
      }

      const result = await planner.planSegment(segmentInput)
      if (!result) {
        return null // Cannot complete this trip with this mode
      }

      // Check if this segment has multimodal sub-segments (walking → vehicle)
      if (result.segment.details?.multimodalSegments) {
        // Use the separate walking and vehicle segments
        const multimodalSegments = result.segment.details.multimodalSegments

        // Update segment indices to be sequential
        multimodalSegments.forEach((seg, index) => {
          seg.segmentIndex = segments.length + index
        })

        segments.push(...multimodalSegments)
      } else {
        // Use the single segment as-is
        result.segment.segmentIndex = segments.length
        segments.push(result.segment)
      }

      currentState = result.resultingState
    }

    // Calculate trip stats
    const tripStats = this.calculateTripStats(segments)

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
   * Generate multimodal trips using personal vehicles
   */
  private async generateMultimodalTrips(
    request: TripRequest,
    dataSources: DataSource[],
    errors: TripPlanningError[],
  ): Promise<TripResponse[]> {
    const trips: TripResponse[] = []

    // For now, implement a simple park-and-ride strategy
    // This can be expanded to more sophisticated multimodal combinations

    for (const vehicle of request.availableVehicles || []) {
      try {
        const trip = await this.planParkAndRideTrip(
          request,
          vehicle,
          dataSources,
        )
        if (trip) {
          trips.push(trip)
        }
      } catch (error) {
        errors.push({
          code: 'MULTIMODAL_PLANNING_FAILED',
          message: `Failed to plan multimodal trip with ${vehicle.type}: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`,
        })
      }
    }

    return trips
  }

  /**
   * Plan a park-and-ride trip (drive to transit, then transit)
   */
  private async planParkAndRideTrip(
    request: TripRequest,
    vehicle: Vehicle,
    dataSources: DataSource[],
  ): Promise<TripResponse | null> {
    // This is a simplified implementation
    // In practice, you'd need to find optimal park-and-ride locations

    // For now, just return null - this would be implemented based on
    // available transit stops and parking facilities
    return null
  }

  /**
   * Generate transit-focused trips
   */
  private async generateTransitTrips(
    request: TripRequest,
    dataSources: DataSource[],
    errors: TripPlanningError[],
  ): Promise<TripResponse[]> {
    // This would integrate with GTFS data to find optimal transit routes
    // For now, return empty array - would be implemented with GTFS integration
    return []
  }

  /**
   * Score and rank trip candidates
   */
  private async scoreAndRankTrips(
    candidates: TripResponse[],
    request: TripRequest,
  ): Promise<TripCandidate[]> {
    const scoredTrips: TripCandidate[] = []

    for (const trip of candidates) {
      const score = this.tripScorer.scoreTrip(trip, request)
      scoredTrips.push({
        trip,
        score,
        rank: 0, // Will be set after sorting
      })
    }

    // Sort by overall score (descending)
    scoredTrips.sort((a, b) => b.score.overall - a.score.overall)

    // Assign ranks
    scoredTrips.forEach((candidate, index) => {
      candidate.rank = index + 1
    })

    return scoredTrips
  }

  /**
   * Filter and deduplicate trips
   */
  private filterTrips(
    scoredTrips: TripCandidate[],
    request: TripRequest,
  ): TripCandidate[] {
    // Remove trips that are too similar
    const filtered: TripCandidate[] = []
    const maxTrips = 5 // Configurable

    for (const candidate of scoredTrips) {
      if (filtered.length >= maxTrips) break

      // Check if this trip is significantly different from existing ones
      const isDifferent = filtered.every((existing) =>
        this.areTripsSignificantlyDifferent(candidate.trip, existing.trip),
      )

      if (isDifferent) {
        filtered.push(candidate)
      }
    }

    return filtered
  }

  /**
   * Check if two trips are significantly different
   */
  private areTripsSignificantlyDifferent(
    trip1: TripResponse,
    trip2: TripResponse,
  ): boolean {
    const timeDiff = Math.abs(
      trip1.tripStats.totalDuration - trip2.tripStats.totalDuration,
    )
    const costDiff = Math.abs(
      (trip1.tripStats.totalCost?.value || 0) -
        (trip2.tripStats.totalCost?.value || 0),
    )

    // Consider trips different if they differ by more than 10% in time or $5 in cost
    return timeDiff > trip1.tripStats.totalDuration * 0.1 || costDiff > 5
  }

  /**
   * Calculate aggregate trip statistics
   */
  private calculateTripStats(segments: TripSegment[]) {
    const totalDuration = segments.reduce((sum, seg) => sum + seg.duration, 0)
    const totalDistance = segments.reduce((sum, seg) => sum + seg.distance, 0)
    const totalCost = segments.reduce(
      (sum, seg) => sum + (seg.cost?.value || 0),
      0,
    )
    const totalCo2 = segments.reduce((sum, seg) => sum + (seg.co2 || 0), 0)
    const totalWalkingDistance = segments
      .filter((seg) => seg.mode === 'walking')
      .reduce((sum, seg) => sum + seg.distance, 0)
    const totalTransfers =
      segments.filter((seg) => seg.mode === 'transit').length - 1

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

/**
 * Abstract base class for segment planners
 */
abstract class SegmentPlanner {
  abstract planSegment(
    input: SegmentPlanInput,
  ): Promise<SegmentPlanResult | null>
}

/**
 * Walking segment planner
 */
class WalkingSegmentPlanner extends SegmentPlanner {
  async planSegment(
    input: SegmentPlanInput,
  ): Promise<SegmentPlanResult | null> {
    try {
      // Use the routing service to get actual walking directions
      const routeResult = await routingService.getRoute(
        [
          {
            type: 'coordinates',
            value: [input.from.location.lat, input.from.location.lng],
          },
          {
            type: 'coordinates',
            value: [input.to.location.lat, input.to.location.lng],
          },
        ],
        'pedestrian', // Walking costing
      )

      if (!routeResult.routes.length) {
        return null
      }

      const route = routeResult.routes[0]
      const leg = route.legs[0]

      // Filter out very short walking segments (less than 1 minute)
      // These are likely just routing artifacts or very minor adjustments
      if (leg.duration < 60) {
        console.log(
          `Filtering out short walking segment: ${leg.duration}s (${leg.distance}m)`,
        )
        return null
      }

      const segment: TripSegment = {
        segmentIndex: 0, // Would be set by caller
        mode: 'walking',
        start: input.from,
        end: input.to,
        startTime: input.departureTime,
        endTime: new Date(
          new Date(input.departureTime).getTime() + leg.duration * 1000,
        ).toISOString(),
        duration: leg.duration,
        distance: leg.distance,
        geometry: leg.geometry, // Actual route geometry from routing engine
        instructions: leg.instructions.map((instruction) => instruction.text), // Turn-by-turn directions
        co2: 0, // Walking produces no emissions
      }

      const resultingState: SegmentState = {
        currentTime: segment.endTime,
        currentLocation: input.to.location,
        currentMode: 'walking',
        carryingVehicle: input.priorState.carryingVehicle,
        parkedVehicles: input.priorState.parkedVehicles,
      }

      return { segment, resultingState }
    } catch (error) {
      console.error('Error planning walking segment:', error)
      // Fallback to simple calculation if routing fails
      return this.fallbackPlanSegment(input)
    }
  }

  private fallbackPlanSegment(
    input: SegmentPlanInput,
  ): SegmentPlanResult | null {
    const distance = this.calculateDistance(
      input.from.location,
      input.to.location,
    )
    const duration = Math.round(distance / 1.4) // ~1.4 m/s walking speed

    // Filter out very short walking segments (less than 1 minute)
    if (duration < 60) {
      console.log(
        `Filtering out short fallback walking segment: ${duration}s (${distance}m)`,
      )
      return null
    }

    const segment: TripSegment = {
      segmentIndex: 0, // Would be set by caller
      mode: 'walking',
      start: input.from,
      end: input.to,
      startTime: input.departureTime,
      endTime: new Date(
        new Date(input.departureTime).getTime() + duration * 1000,
      ).toISOString(),
      duration,
      distance,
      geometry: null,
      instructions: [
        `Walk ${Math.round(distance)}m to ${input.to.address || 'destination'}`,
      ],
      co2: 0,
    }

    const resultingState: SegmentState = {
      currentTime: segment.endTime,
      currentLocation: input.to.location,
      currentMode: 'walking',
      carryingVehicle: input.priorState.carryingVehicle,
      parkedVehicles: input.priorState.parkedVehicles,
    }

    return { segment, resultingState }
  }

  private calculateDistance(from: Coordinate, to: Coordinate): number {
    // Haversine formula for great-circle distance
    const R = 6371000 // Earth's radius in meters
    const φ1 = (from.lat * Math.PI) / 180
    const φ2 = (to.lat * Math.PI) / 180
    const Δφ = ((to.lat - from.lat) * Math.PI) / 180
    const Δλ = ((to.lng - from.lng) * Math.PI) / 180

    const a =
      Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

    return R * c
  }
}

/**
 * Driving segment planner
 */
class DrivingSegmentPlanner extends SegmentPlanner {
  async planSegment(
    input: SegmentPlanInput,
  ): Promise<SegmentPlanResult | null> {
    // Check if user has a car available
    const availableCar = input.availableVehicles.find((v) => v.type === 'car')
    
    // Check if we should use known vehicle locations
    const useKnownLocations = input.preferences.useKnownVehicleLocations !== false
    
    // If no vehicle is provided AND we're not using known locations,
    // plan a direct driving route (assume car is at origin)
    if (!availableCar && !useKnownLocations) {
      return this.planDirectDrivingRoute(input)
    }
    
    if (!availableCar) {
      return null // Cannot drive without a car
    }

    // If we're not using known locations, assume car is at origin
    if (!useKnownLocations) {
      return this.planDirectDrivingRoute(input, availableCar)
    }

    // TODO: Remove this hardcoded data before committing - it is sensitive
    // Use hardcoded car location for testing
    const carLocation = HARDCODED_VEHICLE_LOCATIONS.car

    try {
      // Create two separate segments: walking to car + driving to destination
      const segments: TripSegment[] = []

      // Segment 1: Walking to car - use routing service
      const walkingRouteResult = await routingService.getRoute(
        [
          {
            type: 'coordinates',
            value: [input.from.location.lat, input.from.location.lng],
          },
          {
            type: 'coordinates',
            value: [carLocation.lat, carLocation.lng],
          },
        ],
        'pedestrian',
      )

      let walkingSegment: TripSegment
      if (walkingRouteResult.routes.length > 0) {
        const walkingRoute = walkingRouteResult.routes[0]
        const walkingLeg = walkingRoute.legs[0]

        walkingSegment = {
          segmentIndex: 0,
          mode: 'walking',
          start: input.from,
          end: {
            location: carLocation,
            type: 'via',
            label: 'Your car',
          },
          startTime: input.departureTime,
          endTime: new Date(
            new Date(input.departureTime).getTime() +
              walkingLeg.duration * 1000,
          ).toISOString(),
          duration: walkingLeg.duration,
          distance: walkingLeg.distance,
          geometry: walkingLeg.geometry,
          instructions: walkingLeg.instructions.map(
            (instruction) => instruction.text,
          ),
          cost: { value: 0, currency: 'USD' },
          co2: 0,
        }
      } else {
        // Fallback to simple calculation
        const walkingDistance = this.calculateDistance(
          input.from.location,
          carLocation,
        )
        const walkingDuration = Math.round(walkingDistance / 1.39)

        walkingSegment = {
          segmentIndex: 0,
          mode: 'walking',
          start: input.from,
          end: {
            location: carLocation,
            type: 'via',
            label: 'Your car',
          },
          startTime: input.departureTime,
          endTime: new Date(
            new Date(input.departureTime).getTime() + walkingDuration * 1000,
          ).toISOString(),
          duration: walkingDuration,
          distance: walkingDistance,
          geometry: null,
          instructions: [`Walk ${Math.round(walkingDistance)}m to your car`],
          cost: { value: 0, currency: 'USD' },
          co2: 0,
        }
      }

      // Segment 2: Driving from car to destination - use routing service
      const drivingRouteResult = await routingService.getRoute(
        [
          {
            type: 'coordinates',
            value: [carLocation.lat, carLocation.lng],
          },
          {
            type: 'coordinates',
            value: [input.to.location.lat, input.to.location.lng],
          },
        ],
        'auto',
      )

      let drivingSegment: TripSegment
      if (drivingRouteResult.routes.length > 0) {
        const drivingRoute = drivingRouteResult.routes[0]
        const drivingLeg = drivingRoute.legs[0]

        drivingSegment = {
          segmentIndex: 1,
          mode: 'driving',
          ownership: 'personal',
          vehicle: availableCar,
          start: {
            location: carLocation,
            type: 'via',
            label: 'Your car',
          },
          end: input.to,
          startTime: walkingSegment.endTime,
          endTime: new Date(
            new Date(walkingSegment.endTime).getTime() +
              drivingLeg.duration * 1000,
          ).toISOString(),
          duration: drivingLeg.duration,
          distance: drivingLeg.distance,
          geometry: drivingLeg.geometry,
          instructions: drivingLeg.instructions.map(
            (instruction) => instruction.text,
          ),
          cost: {
            value: Math.round(drivingLeg.distance * 0.0002),
            currency: 'USD',
          },
          co2: Math.round(drivingLeg.distance * 0.2),
        }
      } else {
        // Fallback to simple calculation
        const drivingDistance = this.calculateDistance(
          carLocation,
          input.to.location,
        )
        const drivingDuration = Math.round(drivingDistance / 13.9)

        drivingSegment = {
          segmentIndex: 1,
          mode: 'driving',
          ownership: 'personal',
          vehicle: availableCar,
          start: {
            location: carLocation,
            type: 'via',
            label: 'Your car',
          },
          end: input.to,
          startTime: walkingSegment.endTime,
          endTime: new Date(
            new Date(walkingSegment.endTime).getTime() + drivingDuration * 1000,
          ).toISOString(),
          duration: drivingDuration,
          distance: drivingDistance,
          geometry: null,
          instructions: [
            `Drive ${Math.round(drivingDistance / 1000)}km to ${
              input.to.address || 'destination'
            }`,
          ],
          cost: {
            value: Math.round(drivingDistance * 0.0002),
            currency: 'USD',
          },
          co2: Math.round(drivingDistance * 0.2),
        }
      }

      segments.push(walkingSegment, drivingSegment)

      const resultingState: SegmentState = {
        currentTime: drivingSegment.endTime,
        currentLocation: input.to.location,
        currentMode: 'driving',
        parkedVehicles: [
          ...input.priorState.parkedVehicles,
          {
            vehicle: availableCar,
            location: input.to.location,
            parkedAt: drivingSegment.endTime,
          },
        ],
      }

      // Create a combined segment that represents the full trip
      const combinedSegment: TripSegment = {
        segmentIndex: 0,
        mode: 'driving',
        ownership: 'personal',
        vehicle: availableCar,
        start: input.from,
        end: input.to,
        startTime: input.departureTime,
        endTime: drivingSegment.endTime,
        duration: walkingSegment.duration + drivingSegment.duration,
        distance: walkingSegment.distance + drivingSegment.distance,
        geometry: null,
        instructions: [
          ...walkingSegment.instructions,
          ...drivingSegment.instructions,
        ],
        cost: drivingSegment.cost,
        co2: drivingSegment.co2,
        details: {
          // Store the separate segments in details for later use
          multimodalSegments: segments,
        },
      }

      return { segment: combinedSegment, resultingState }
    } catch (error) {
      console.error('Error planning driving segment:', error)
      // Fallback to simple calculation
      return this.fallbackPlanSegment(input, availableCar)
    }
  }

  private fallbackPlanSegment(
    input: SegmentPlanInput,
    availableCar: Vehicle,
  ): SegmentPlanResult {
    const carLocation = HARDCODED_VEHICLE_LOCATIONS.car
    const segments: TripSegment[] = []

    // Segment 1: Walking to car
    const walkingDistance = this.calculateDistance(
      input.from.location,
      carLocation,
    )
    const walkingDuration = Math.round(walkingDistance / 1.39)

    const walkingSegment: TripSegment = {
      segmentIndex: 0,
      mode: 'walking',
      start: input.from,
      end: {
        location: carLocation,
        type: 'via',
        label: 'Your car',
      },
      startTime: input.departureTime,
      endTime: new Date(
        new Date(input.departureTime).getTime() + walkingDuration * 1000,
      ).toISOString(),
      duration: walkingDuration,
      distance: walkingDistance,
      geometry: null,
      instructions: [`Walk ${Math.round(walkingDistance)}m to your car`],
      cost: { value: 0, currency: 'USD' },
      co2: 0,
    }

    // Segment 2: Driving from car to destination
    const drivingDistance = this.calculateDistance(
      carLocation,
      input.to.location,
    )
    const drivingDuration = Math.round(drivingDistance / 13.9)

    const drivingSegment: TripSegment = {
      segmentIndex: 1,
      mode: 'driving',
      ownership: 'personal',
      vehicle: availableCar,
      start: {
        location: carLocation,
        type: 'via',
        label: 'Your car',
      },
      end: input.to,
      startTime: walkingSegment.endTime,
      endTime: new Date(
        new Date(walkingSegment.endTime).getTime() + drivingDuration * 1000,
      ).toISOString(),
      duration: drivingDuration,
      distance: drivingDistance,
      geometry: null,
      instructions: [
        `Drive ${Math.round(drivingDistance / 1000)}km to ${
          input.to.address || 'destination'
        }`,
      ],
      cost: { value: Math.round(drivingDistance * 0.0002), currency: 'USD' },
      co2: Math.round(drivingDistance * 0.2),
    }

    segments.push(walkingSegment, drivingSegment)

    const resultingState: SegmentState = {
      currentTime: drivingSegment.endTime,
      currentLocation: input.to.location,
      currentMode: 'driving',
      parkedVehicles: [
        ...input.priorState.parkedVehicles,
        {
          vehicle: availableCar,
          location: input.to.location,
          parkedAt: drivingSegment.endTime,
        },
      ],
    }

    const combinedSegment: TripSegment = {
      segmentIndex: 0,
      mode: 'driving',
      ownership: 'personal',
      vehicle: availableCar,
      start: input.from,
      end: input.to,
      startTime: input.departureTime,
      endTime: drivingSegment.endTime,
      duration: walkingDuration + drivingDuration,
      distance: walkingDistance + drivingDistance,
      geometry: null,
      instructions: [
        `Walk ${Math.round(walkingDistance)}m to your car`,
        `Drive ${Math.round(drivingDistance / 1000)}km to ${
          input.to.address || 'destination'
        }`,
      ],
      cost: drivingSegment.cost,
      co2: drivingSegment.co2,
      details: {
        multimodalSegments: segments,
      },
    }

    return { segment: combinedSegment, resultingState }
  }

  /**
   * Plan a direct driving route from origin to destination
   * (assumes car is already at the origin)
   */
  private async planDirectDrivingRoute(
    input: SegmentPlanInput,
    vehicle?: Vehicle,
  ): Promise<SegmentPlanResult | null> {
    try {
      // Use routing service to get actual driving directions
      const routeResult = await routingService.getRoute(
        [
          {
            type: 'coordinates',
            value: [input.from.location.lat, input.from.location.lng],
          },
          {
            type: 'coordinates',
            value: [input.to.location.lat, input.to.location.lng],
          },
        ],
        'auto',
      )

      if (!routeResult.routes.length) {
        return null
      }

      const route = routeResult.routes[0]
      const leg = route.legs[0]

      const segment: TripSegment = {
        segmentIndex: 0,
        mode: 'driving',
        ownership: vehicle ? 'personal' : undefined,
        vehicle: vehicle,
        start: input.from,
        end: input.to,
        startTime: input.departureTime,
        endTime: new Date(
          new Date(input.departureTime).getTime() + leg.duration * 1000,
        ).toISOString(),
        duration: leg.duration,
        distance: leg.distance,
        geometry: leg.geometry,
        instructions: leg.instructions.map((instruction) => instruction.text),
        cost: {
          value: Math.round(leg.distance * 0.0002),
          currency: 'USD',
        },
        co2: Math.round(leg.distance * 0.2),
      }

      const resultingState: SegmentState = {
        currentTime: segment.endTime,
        currentLocation: input.to.location,
        currentMode: 'driving',
        parkedVehicles: vehicle
          ? [
              ...input.priorState.parkedVehicles,
              {
                vehicle: vehicle,
                location: input.to.location,
                parkedAt: segment.endTime,
              },
            ]
          : input.priorState.parkedVehicles,
      }

      return { segment, resultingState }
    } catch (error) {
      console.error('Error planning direct driving route:', error)
      return null
    }
  }

  private calculateDistance(from: Coordinate, to: Coordinate): number {
    // Same as walking planner - would use routing engine in practice
    const R = 6371000
    const φ1 = (from.lat * Math.PI) / 180
    const φ2 = (to.lat * Math.PI) / 180
    const Δφ = ((to.lat - from.lat) * Math.PI) / 180
    const Δλ = ((to.lng - from.lng) * Math.PI) / 180

    const a =
      Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

    return R * c * 1.3 // Add 30% for road routing vs straight line
  }
}

/**
 * Biking segment planner
 */
class BikingSegmentPlanner extends SegmentPlanner {
  async planSegment(
    input: SegmentPlanInput,
  ): Promise<SegmentPlanResult | null> {
    // Check if user has a bike available
    const availableBike = input.availableVehicles.find(
      (v) => v.type === 'bike' || v.type === 'e-bike',
    )

    // Check if we should use known vehicle locations
    const useKnownLocations = input.preferences.useKnownVehicleLocations !== false
    
    // If no vehicle is provided AND we're not using known locations,
    // plan a direct biking route (assume bike is at origin)
    if (!availableBike && !useKnownLocations) {
      return this.planDirectBikingRoute(input)
    }
    
    if (!availableBike) {
      return null
    }

    // If we're not using known locations, assume bike is at origin
    if (!useKnownLocations) {
      return this.planDirectBikingRoute(input, availableBike)
    }

    // TODO: Remove this hardcoded data before committing - it is sensitive
    // Use hardcoded bike location for testing
    const bikeLocation = HARDCODED_VEHICLE_LOCATIONS.bike

    try {
      // Create two separate segments: walking to bike + biking to destination
      const segments: TripSegment[] = []

      // Segment 1: Walking to bike - use routing service
      const walkingRouteResult = await routingService.getRoute(
        [
          {
            type: 'coordinates',
            value: [input.from.location.lat, input.from.location.lng],
          },
          {
            type: 'coordinates',
            value: [bikeLocation.lat, bikeLocation.lng],
          },
        ],
        'pedestrian',
      )

      let walkingSegment: TripSegment
      if (walkingRouteResult.routes.length > 0) {
        const walkingRoute = walkingRouteResult.routes[0]
        const walkingLeg = walkingRoute.legs[0]

        walkingSegment = {
          segmentIndex: 0,
          mode: 'walking',
          start: input.from,
          end: {
            location: bikeLocation,
            type: 'via',
            label: 'Your bike',
          },
          startTime: input.departureTime,
          endTime: new Date(
            new Date(input.departureTime).getTime() +
              walkingLeg.duration * 1000,
          ).toISOString(),
          duration: walkingLeg.duration,
          distance: walkingLeg.distance,
          geometry: walkingLeg.geometry,
          instructions: walkingLeg.instructions.map(
            (instruction) => instruction.text,
          ),
          cost: { value: 0, currency: 'USD' },
          co2: 0,
        }
      } else {
        // Fallback to simple calculation
        const walkingDistance = this.calculateDistance(
          input.from.location,
          bikeLocation,
        )
        const walkingDuration = Math.round(walkingDistance / 1.39)

        walkingSegment = {
          segmentIndex: 0,
          mode: 'walking',
          start: input.from,
          end: {
            location: bikeLocation,
            type: 'via',
            label: 'Your bike',
          },
          startTime: input.departureTime,
          endTime: new Date(
            new Date(input.departureTime).getTime() + walkingDuration * 1000,
          ).toISOString(),
          duration: walkingDuration,
          distance: walkingDistance,
          geometry: null,
          instructions: [`Walk ${Math.round(walkingDistance)}m to your bike`],
          cost: { value: 0, currency: 'USD' },
          co2: 0,
        }
      }

      // Segment 2: Biking from bike to destination - use routing service
      const bikingRouteResult = await routingService.getRoute(
        [
          {
            type: 'coordinates',
            value: [bikeLocation.lat, bikeLocation.lng],
          },
          {
            type: 'coordinates',
            value: [input.to.location.lat, input.to.location.lng],
          },
        ],
        'bicycle',
      )

      let bikingSegment: TripSegment
      if (bikingRouteResult.routes.length > 0) {
        const bikingRoute = bikingRouteResult.routes[0]
        const bikingLeg = bikingRoute.legs[0]

        bikingSegment = {
          segmentIndex: 1,
          mode: 'biking',
          ownership: 'personal',
          vehicle: availableBike,
          start: {
            location: bikeLocation,
            type: 'via',
            label: 'Your bike',
          },
          end: input.to,
          startTime: walkingSegment.endTime,
          endTime: new Date(
            new Date(walkingSegment.endTime).getTime() +
              bikingLeg.duration * 1000,
          ).toISOString(),
          duration: bikingLeg.duration,
          distance: bikingLeg.distance,
          geometry: bikingLeg.geometry,
          instructions: bikingLeg.instructions.map(
            (instruction) => instruction.text,
          ),
          cost: { value: 0, currency: 'USD' },
          co2: 0,
        }
      } else {
        // Fallback to simple calculation
        const bikingDistance = this.calculateDistance(
          bikeLocation,
          input.to.location,
        )
        const bikingDuration = Math.round(bikingDistance / 4.17)

        bikingSegment = {
          segmentIndex: 1,
          mode: 'biking',
          ownership: 'personal',
          vehicle: availableBike,
          start: {
            location: bikeLocation,
            type: 'via',
            label: 'Your bike',
          },
          end: input.to,
          startTime: walkingSegment.endTime,
          endTime: new Date(
            new Date(walkingSegment.endTime).getTime() + bikingDuration * 1000,
          ).toISOString(),
          duration: bikingDuration,
          distance: bikingDistance,
          geometry: null,
          instructions: [
            `Bike ${Math.round(bikingDistance / 1000)}km to ${
              input.to.address || 'destination'
            }`,
          ],
          cost: { value: 0, currency: 'USD' },
          co2: 0,
        }
      }

      segments.push(walkingSegment, bikingSegment)

      const resultingState: SegmentState = {
        currentTime: bikingSegment.endTime,
        currentLocation: input.to.location,
        currentMode: 'biking',
        parkedVehicles: [
          ...input.priorState.parkedVehicles,
          {
            vehicle: availableBike,
            location: input.to.location,
            parkedAt: bikingSegment.endTime,
          },
        ],
      }

      // Create a combined segment that represents the full trip
      const combinedSegment: TripSegment = {
        segmentIndex: 0,
        mode: 'biking',
        ownership: 'personal',
        vehicle: availableBike,
        start: input.from,
        end: input.to,
        startTime: input.departureTime,
        endTime: bikingSegment.endTime,
        duration: walkingSegment.duration + bikingSegment.duration,
        distance: walkingSegment.distance + bikingSegment.distance,
        geometry: null,
        instructions: [
          ...walkingSegment.instructions,
          ...bikingSegment.instructions,
        ],
        cost: bikingSegment.cost,
        co2: bikingSegment.co2,
        details: {
          // Store the separate segments in details for later use
          multimodalSegments: segments,
        },
      }

      return { segment: combinedSegment, resultingState }
    } catch (error) {
      console.error('Error planning biking segment:', error)
      // Fallback to simple calculation
      return this.fallbackPlanSegment(input, availableBike)
    }
  }

  private fallbackPlanSegment(
    input: SegmentPlanInput,
    availableBike: Vehicle,
  ): SegmentPlanResult {
    const bikeLocation = HARDCODED_VEHICLE_LOCATIONS.bike
    const segments: TripSegment[] = []

    // Segment 1: Walking to bike
    const walkingDistance = this.calculateDistance(
      input.from.location,
      bikeLocation,
    )
    const walkingDuration = Math.round(walkingDistance / 1.39)

    const walkingSegment: TripSegment = {
      segmentIndex: 0,
      mode: 'walking',
      start: input.from,
      end: {
        location: bikeLocation,
        type: 'via',
        label: 'Your bike',
      },
      startTime: input.departureTime,
      endTime: new Date(
        new Date(input.departureTime).getTime() + walkingDuration * 1000,
      ).toISOString(),
      duration: walkingDuration,
      distance: walkingDistance,
      geometry: null,
      instructions: [`Walk ${Math.round(walkingDistance)}m to your bike`],
      cost: { value: 0, currency: 'USD' },
      co2: 0,
    }

    // Segment 2: Biking from bike to destination
    const bikingDistance = this.calculateDistance(
      bikeLocation,
      input.to.location,
    )
    const bikingDuration = Math.round(bikingDistance / 4.17)

    const bikingSegment: TripSegment = {
      segmentIndex: 1,
      mode: 'biking',
      ownership: 'personal',
      vehicle: availableBike,
      start: {
        location: bikeLocation,
        type: 'via',
        label: 'Your bike',
      },
      end: input.to,
      startTime: walkingSegment.endTime,
      endTime: new Date(
        new Date(walkingSegment.endTime).getTime() + bikingDuration * 1000,
      ).toISOString(),
      duration: bikingDuration,
      distance: bikingDistance,
      geometry: null,
      instructions: [
        `Bike ${Math.round(bikingDistance / 1000)}km to ${
          input.to.address || 'destination'
        }`,
      ],
      cost: { value: 0, currency: 'USD' },
      co2: 0,
    }

    segments.push(walkingSegment, bikingSegment)

    const resultingState: SegmentState = {
      currentTime: bikingSegment.endTime,
      currentLocation: input.to.location,
      currentMode: 'biking',
      parkedVehicles: [
        ...input.priorState.parkedVehicles,
        {
          vehicle: availableBike,
          location: input.to.location,
          parkedAt: bikingSegment.endTime,
        },
      ],
    }

    const combinedSegment: TripSegment = {
      segmentIndex: 0,
      mode: 'biking',
      ownership: 'personal',
      vehicle: availableBike,
      start: input.from,
      end: input.to,
      startTime: input.departureTime,
      endTime: bikingSegment.endTime,
      duration: walkingDuration + bikingDuration,
      distance: walkingDistance + bikingDistance,
      geometry: null,
      instructions: [
        `Walk ${Math.round(walkingDistance)}m to your bike`,
        `Bike ${Math.round(bikingDistance / 1000)}km to ${
          input.to.address || 'destination'
        }`,
      ],
      cost: bikingSegment.cost,
      co2: bikingSegment.co2,
      details: {
        multimodalSegments: segments,
      },
    }

    return { segment: combinedSegment, resultingState }
  }

  /**
   * Plan a direct biking route from origin to destination
   * (assumes bike is already at the origin)
   */
  private async planDirectBikingRoute(
    input: SegmentPlanInput,
    vehicle?: Vehicle,
  ): Promise<SegmentPlanResult | null> {
    try {
      // Use routing service to get actual biking directions
      const routeResult = await routingService.getRoute(
        [
          {
            type: 'coordinates',
            value: [input.from.location.lat, input.from.location.lng],
          },
          {
            type: 'coordinates',
            value: [input.to.location.lat, input.to.location.lng],
          },
        ],
        'bicycle',
      )

      if (!routeResult.routes.length) {
        return null
      }

      const route = routeResult.routes[0]
      const leg = route.legs[0]

      const segment: TripSegment = {
        segmentIndex: 0,
        mode: 'biking',
        ownership: vehicle ? 'personal' : undefined,
        vehicle: vehicle,
        start: input.from,
        end: input.to,
        startTime: input.departureTime,
        endTime: new Date(
          new Date(input.departureTime).getTime() + leg.duration * 1000,
        ).toISOString(),
        duration: leg.duration,
        distance: leg.distance,
        geometry: leg.geometry,
        instructions: leg.instructions.map((instruction) => instruction.text),
        cost: { value: 0, currency: 'USD' },
        co2: 0,
      }

      const resultingState: SegmentState = {
        currentTime: segment.endTime,
        currentLocation: input.to.location,
        currentMode: 'biking',
        parkedVehicles: vehicle
          ? [
              ...input.priorState.parkedVehicles,
              {
                vehicle: vehicle,
                location: input.to.location,
                parkedAt: segment.endTime,
              },
            ]
          : input.priorState.parkedVehicles,
      }

      return { segment, resultingState }
    } catch (error) {
      console.error('Error planning direct biking route:', error)
      return null
    }
  }

  private calculateDistance(from: Coordinate, to: Coordinate): number {
    // Same as other planners - would use routing engine in practice
    const R = 6371000
    const φ1 = (from.lat * Math.PI) / 180
    const φ2 = (to.lat * Math.PI) / 180
    const Δφ = ((to.lat - from.lat) * Math.PI) / 180
    const Δλ = ((to.lng - from.lng) * Math.PI) / 180

    const a =
      Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

    return R * c * 1.2 // Add 20% for bike routing vs straight line
  }
}

/**
 * Transit segment planner
 */
class TransitSegmentPlanner extends SegmentPlanner {
  async planSegment(
    input: SegmentPlanInput,
  ): Promise<SegmentPlanResult | null> {
    // This would integrate with GTFS data
    // For now, return null
    return null
  }
}

/**
 * Rideshare segment planner
 */
class RideshareSegmentPlanner extends SegmentPlanner {
  async planSegment(
    input: SegmentPlanInput,
  ): Promise<SegmentPlanResult | null> {
    // This would integrate with rideshare APIs
    // For now, return null
    return null
  }
}

/**
 * Wheelchair segment planner
 */
class WheelchairSegmentPlanner extends SegmentPlanner {
  async planSegment(
    input: SegmentPlanInput,
  ): Promise<SegmentPlanResult | null> {
    // Similar to walking but with accessibility constraints
    // For now, return null
    return null
  }
}

/**
 * Trip scoring service
 */
class TripScorer {
  scoreTrip(trip: TripResponse, request: TripRequest): TripScore {
    const timeScore = this.scoreTime(trip.tripStats.totalDuration)
    const costScore = this.scoreCost(trip.tripStats.totalCost?.value || 0)
    const environmentalScore = this.scoreEnvironmental(
      trip.tripStats.totalCo2 || 0,
    )
    const comfortScore = this.scoreComfort(trip.segments)
    const safetyScore = this.scoreSafety(
      trip.segments,
      request.routingPreferences?.safetyVsEfficiency || 0.5,
    )

    // Weight the scores based on user preferences
    const safetyWeight = request.routingPreferences?.safetyVsEfficiency || 0.5
    const timeWeight = 1 - safetyWeight

    const overall =
      timeScore * timeWeight * 0.4 +
      costScore * 0.2 +
      environmentalScore * 0.2 +
      comfortScore * 0.1 +
      safetyScore * safetyWeight * 0.1

    return {
      overall,
      time: timeScore,
      cost: costScore,
      comfort: comfortScore,
      environmental: environmentalScore,
      safety: safetyScore,
    }
  }

  private scoreTime(duration: number): number {
    // Score based on duration - shorter is better
    // Normalize to 0-1 scale, with 1 hour being the reference point
    return Math.max(0, 1 - duration / 3600)
  }

  private scoreCost(cost: number): number {
    // Score based on cost - cheaper is better
    // Normalize with $50 as reference point
    return Math.max(0, 1 - cost / 50)
  }

  private scoreEnvironmental(co2: number): number {
    // Score based on CO2 emissions - lower is better
    // Normalize with 10kg as reference point
    return Math.max(0, 1 - co2 / 10000)
  }

  private scoreComfort(segments: TripSegment[]): number {
    // Score based on number of transfers and modes
    const transfers = segments.length - 1
    const hasWeather = segments.some(
      (s) => s.mode === 'walking' || s.mode === 'biking',
    )

    let score = 1.0
    score -= transfers * 0.1 // Penalty for each transfer
    score -= hasWeather ? 0.2 : 0 // Penalty for weather exposure

    return Math.max(0, score)
  }

  private scoreSafety(
    segments: TripSegment[],
    safetyPreference: number,
  ): number {
    // Score based on mode safety and route characteristics
    let score = 1.0

    for (const segment of segments) {
      switch (segment.mode) {
        case 'walking':
        case 'wheelchair':
          score -= 0.1 // Slightly less safe due to pedestrian exposure
          break
        case 'biking':
          score -= 0.2 // More exposure to traffic
          break
        case 'driving':
          score -= 0.1 // Vehicle protection but traffic risk
          break
        case 'transit':
          score += 0.1 // Generally safer
          break
      }
    }

    return Math.max(0, Math.min(1, score))
  }
}

export const multimodalTripService = new TripService()
