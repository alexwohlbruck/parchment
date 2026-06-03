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
  ParkedVehicle,
  TransitDetails,
  TransitRoute,
  TransitTrip,
  TransitStop,
  TransitAgency,
  TransitRouteType,
  TransitAccessConfig,
  TransitEgressConfig,
  TripWarning,
  TripScore,
} from '../types/trip.types'
import { Coordinate } from '../types/unified-routing.types'
import type { Place } from '../types/place.types'
import { routingService } from './routing.service'
import { transitRoutingService } from './transit-routing.service'
import { searchByCategory } from './search.service'
import { integrationManager } from './integrations'
import { IntegrationId } from '../types/integration.types'

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

    // When useKnownParkingLocations is on, vehicle modes (driving/biking)
    // are replaced by their parking-aware variants — you can't just teleport
    // to the destination, you need to park first. Non-vehicle modes (walking,
    // transit, wheelchair) are unaffected.
    const useParking = request.routingPreferences?.useKnownParkingLocations
    const parkingVehicleModes: Set<Mode> = useParking
      ? new Set(['driving', 'biking'] as Mode[])
      : new Set()

    for (const mode of modes) {
      // Skip direct vehicle trips when parking is enabled — the parking-
      // aware planner below handles these modes instead.
      if (parkingVehicleModes.has(mode)) continue

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

    // ── Parking-aware candidates ───────────────────────────────────────
    // When useKnownParkingLocations is enabled, search for real parking
    // near the destination and generate park-then-walk candidates.
    if (useParking) {
      const parkingPromises: Promise<void>[] = []

      if (modes.includes('driving')) {
        parkingPromises.push(
          this.planDrivingWithParkingTrip(request, dataSources)
            .then((trip) => { if (trip) candidates.push(trip) })
            .catch((error) => console.error('Parking-aware driving failed:', error)),
        )
      }

      if (modes.includes('biking')) {
        parkingPromises.push(
          this.planBikingWithParkingTrip(request, dataSources)
            .then((trip) => { if (trip) candidates.push(trip) })
            .catch((error) => console.error('Parking-aware biking failed:', error)),
        )
      }

      await Promise.all(parkingPromises)
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
    const carLocation = car.location!

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
          parkedVehicles: [
            ...state.parkedVehicles,
            {
              vehicle: car,
              location: to.location,
              parkedAt: driveSegment.endTime,
            },
          ],
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

  // ── Parking-aware driving ────────────────────────────────────────────────────

  /** Search radius for parking lots near a destination (meters). */
  private static readonly PARKING_SEARCH_RADIUS = 500
  /** Maximum parking results to evaluate. */
  private static readonly PARKING_MAX_CANDIDATES = 3

  /**
   * Plan a driving trip that parks near the destination and walks the rest.
   *
   * Searches for real parking (amenity/parking via Overpass) within
   * PARKING_SEARCH_RADIUS of the destination, then generates a trip:
   *   [optional walk to car] → drive to parking → walk to destination
   *
   * If vehicle locations are known and the car is elsewhere, the trip
   * starts with a walk-to-car segment (same as planDrivingSegment).
   *
   * Returns the fastest parking+walk combo, or null if no parking found
   * or driving direct is clearly better.
   */
  private async planDrivingWithParkingTrip(
    request: TripRequest,
    dataSources: DataSource[],
  ): Promise<TripResponse | null> {
    const from = request.waypoints[0]
    const to = request.waypoints[request.waypoints.length - 1]
    const preferences = {
      ...(request.routingPreferences || {}),
      ...(request.language && { language: request.language }),
    }
    const startTime =
      request.preferredDepartureTime || new Date().toISOString()
    const maxWalkDistance = preferences.maxWalkingDistance ?? 1000 // meters

    // Search for parking lots near the destination
    const parkingPlaces = await this.searchNearbyParking(
      to.location,
      TripService.PARKING_SEARCH_RADIUS,
    )

    if (parkingPlaces.length === 0) return null

    // Sort by distance to destination and take top N
    const sortedParking = parkingPlaces
      .map((p) => {
        const center = p.geometry.value.center
        return {
          place: p,
          coord: center,
          distToDest: TripService.haversineDistance(center, to.location),
        }
      })
      .sort((a, b) => a.distToDest - b.distToDest)
      .slice(0, TripService.PARKING_MAX_CANDIDATES)

    // Determine drive origin (may need to walk to car first)
    const availableVehicles = request.availableVehicles || []
    const car = availableVehicles.find((v) => v.type === 'car')
    const useKnownLocations = preferences.useKnownVehicleLocations !== false
    const carLocation =
      useKnownLocations && car?.location
        ? car.location
        : null

    // Try each parking spot — pick the one with the best total time
    let bestTrip: TripResponse | null = null
    let bestTotalDuration = Infinity

    for (const { place, coord: parkingCoord, distToDest } of sortedParking) {
      // Skip parking too far to walk from
      if (distToDest > maxWalkDistance) continue

      try {
        const segments: TripSegment[] = []
        let currentTime = new Date(startTime).getTime()

        const parkingWaypoint: Waypoint = {
          location: parkingCoord,
          type: 'via',
          label: place.name?.value || 'Parking',
          place,
        }

        // Step 1: Walk to car (if car is elsewhere)
        if (carLocation) {
          const distToCar = TripService.haversineDistance(
            from.location,
            carLocation,
          )
          if (distToCar > 50) {
            const walkRoute = await routingService.getRoute(
              [
                { type: 'coordinates', value: [from.location.lat, from.location.lng] },
                { type: 'coordinates', value: [carLocation.lat, carLocation.lng] },
              ],
              'pedestrian',
              preferences,
            )

            if (!walkRoute.routes.length) continue
            const walkLeg = walkRoute.routes[0].legs[0]

            segments.push({
              segmentIndex: 0,
              mode: 'walking',
              start: from,
              end: {
                location: carLocation,
                type: 'via',
                label: 'Your car',
              },
              startTime: new Date(currentTime).toISOString(),
              endTime: new Date(
                currentTime + walkLeg.duration * 1000,
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
            })

            currentTime += walkLeg.duration * 1000
          }
        }

        // Step 2: Drive to parking
        const driveFrom = carLocation && segments.length > 0
          ? carLocation
          : from.location

        const driveRoute = await routingService.getRoute(
          [
            { type: 'coordinates', value: [driveFrom.lat, driveFrom.lng] },
            { type: 'coordinates', value: [parkingCoord.lat, parkingCoord.lng] },
          ],
          'auto',
          preferences,
        )

        if (!driveRoute.routes.length) continue
        const driveLeg = driveRoute.routes[0].legs[0]

        // Extract parking cost from OSM fee tag if available
        const hasFee = place.tags?.['fee'] === 'yes'
        const parkingCost = hasFee
          ? { value: 2.0, currency: 'USD' } // Estimated default when fee=yes
          : undefined

        const driveSegment: TripSegment = {
          segmentIndex: segments.length,
          mode: 'driving',
          vehicle: car || undefined,
          start: segments.length > 0
            ? { location: carLocation!, type: 'via', label: 'Your car' }
            : from,
          end: parkingWaypoint,
          startTime: new Date(currentTime).toISOString(),
          endTime: new Date(
            currentTime + driveLeg.duration * 1000,
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
          details: parkingCost
            ? { vehicleDetails: { parkingCost } }
            : undefined,
        }

        segments.push(driveSegment)
        currentTime += driveLeg.duration * 1000

        // Step 3: Walk from parking to destination
        const walkRoute = await routingService.getRoute(
          [
            { type: 'coordinates', value: [parkingCoord.lat, parkingCoord.lng] },
            { type: 'coordinates', value: [to.location.lat, to.location.lng] },
          ],
          'pedestrian',
          preferences,
        )

        if (!walkRoute.routes.length) continue
        const walkLeg = walkRoute.routes[0].legs[0]

        segments.push({
          segmentIndex: segments.length,
          mode: 'walking',
          start: parkingWaypoint,
          end: to,
          startTime: new Date(currentTime).toISOString(),
          endTime: new Date(
            currentTime + walkLeg.duration * 1000,
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
        })

        currentTime += walkLeg.duration * 1000

        const totalDuration = (currentTime - new Date(startTime).getTime()) / 1000
        if (totalDuration >= bestTotalDuration) continue

        const tripStats = this.calculateStats(segments)

        // Add parking cost to total trip cost
        if (parkingCost) {
          const baseCost = tripStats.totalCost?.value ?? 0
          tripStats.totalCost = {
            value: baseCost + parkingCost.value,
            currency: 'USD',
          }
        }

        bestTotalDuration = totalDuration
        bestTrip = {
          segments,
          tripStats,
          earliestStartTime: segments[0].startTime,
          latestEndTime: segments[segments.length - 1].endTime,
          dataSources,
          requestId: request.requestId,
          generatedAt: new Date().toISOString(),
          parkedVehicles: car
            ? [{
                vehicle: car,
                location: parkingCoord,
                parkedAt: driveSegment.endTime,
                cost: parkingCost,
              }]
            : undefined,
        }
      } catch (error) {
        // Individual parking spot failed — try next
        continue
      }
    }

    return bestTrip
  }

  // ── Parking-aware biking ─────────────────────────────────────────────────────

  /** Search radius for bicycle parking near a destination (meters). */
  private static readonly BIKE_PARKING_SEARCH_RADIUS = 300
  /** Maximum bicycle parking results to evaluate. */
  private static readonly BIKE_PARKING_MAX_CANDIDATES = 3

  /**
   * Plan a biking trip that parks at a bike rack near the destination and
   * walks the remaining distance.
   *
   * Searches for real bicycle parking (amenity/bicycle_parking via Barrelman)
   * within BIKE_PARKING_SEARCH_RADIUS of the destination, then generates:
   *   [optional walk to bike] → bike to rack → walk to destination
   *
   * Returns the fastest parking+walk combo, or null if no bike parking found.
   */
  private async planBikingWithParkingTrip(
    request: TripRequest,
    dataSources: DataSource[],
  ): Promise<TripResponse | null> {
    const from = request.waypoints[0]
    const to = request.waypoints[request.waypoints.length - 1]
    const preferences = {
      ...(request.routingPreferences || {}),
      ...(request.language && { language: request.language }),
    }
    const startTime =
      request.preferredDepartureTime || new Date().toISOString()
    const maxWalkDistance = preferences.maxWalkingDistance ?? 1000 // meters

    // Search for bicycle parking near the destination
    const parkingPlaces = await this.searchNearbyParking(
      to.location,
      TripService.BIKE_PARKING_SEARCH_RADIUS,
      'amenity/bicycle_parking',
    )

    if (parkingPlaces.length === 0) return null

    // Sort by distance to destination and take top N
    const sortedParking = parkingPlaces
      .map((p) => {
        const center = p.geometry.value.center
        return {
          place: p,
          coord: center,
          distToDest: TripService.haversineDistance(center, to.location),
        }
      })
      .sort((a, b) => a.distToDest - b.distToDest)
      .slice(0, TripService.BIKE_PARKING_MAX_CANDIDATES)

    // Determine ride origin (may need to walk to bike first)
    const availableVehicles = request.availableVehicles || []
    const bike = availableVehicles.find((v) =>
      v.type === 'bike' || v.type === 'e-bike' || v.type === 'scooter' || v.type === 'e-scooter',
    )
    const useKnownLocations = preferences.useKnownVehicleLocations !== false
    const bikeLocation =
      useKnownLocations && bike?.location
        ? bike.location
        : null

    // Try each parking spot — pick the one with the best total time
    let bestTrip: TripResponse | null = null
    let bestTotalDuration = Infinity

    for (const { place, coord: parkingCoord, distToDest } of sortedParking) {
      // Skip parking too far to walk from
      if (distToDest > maxWalkDistance) continue

      try {
        const segments: TripSegment[] = []
        let currentTime = new Date(startTime).getTime()

        const parkingWaypoint: Waypoint = {
          location: parkingCoord,
          type: 'via',
          label: place.name?.value || 'Bike parking',
          place,
        }

        // Step 1: Walk to bike (if bike is elsewhere)
        let rideOrigin = from.location
        if (bikeLocation) {
          const distToBike = TripService.haversineDistance(
            from.location,
            bikeLocation,
          )
          if (distToBike > 50) {
            const walkRoute = await routingService.getRoute(
              [
                { type: 'coordinates', value: [from.location.lat, from.location.lng] },
                { type: 'coordinates', value: [bikeLocation.lat, bikeLocation.lng] },
              ],
              'pedestrian',
              preferences,
            )

            if (!walkRoute.routes.length) continue
            const walkLeg = walkRoute.routes[0].legs[0]

            segments.push({
              segmentIndex: 0,
              mode: 'walking',
              start: from,
              end: {
                location: bikeLocation,
                type: 'via',
                label: 'Your bike',
              },
              startTime: new Date(currentTime).toISOString(),
              endTime: new Date(
                currentTime + walkLeg.duration * 1000,
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
            })

            currentTime += walkLeg.duration * 1000
            rideOrigin = bikeLocation
          }
        }

        // Step 2: Bike to parking
        const bikeRoute = await routingService.getRoute(
          [
            { type: 'coordinates', value: [rideOrigin.lat, rideOrigin.lng] },
            { type: 'coordinates', value: [parkingCoord.lat, parkingCoord.lng] },
          ],
          'bicycle',
          preferences,
        )

        if (!bikeRoute.routes.length) continue
        const bikeLeg = bikeRoute.routes[0].legs[0]

        const bikeSegment: TripSegment = {
          segmentIndex: segments.length,
          mode: 'biking',
          vehicle: bike || undefined,
          start: segments.length > 0
            ? { location: rideOrigin, type: 'via', label: 'Your bike' }
            : from,
          end: parkingWaypoint,
          startTime: new Date(currentTime).toISOString(),
          endTime: new Date(
            currentTime + bikeLeg.duration * 1000,
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

        segments.push(bikeSegment)
        currentTime += bikeLeg.duration * 1000

        // Step 3: Walk from bike parking to destination
        const walkRoute = await routingService.getRoute(
          [
            { type: 'coordinates', value: [parkingCoord.lat, parkingCoord.lng] },
            { type: 'coordinates', value: [to.location.lat, to.location.lng] },
          ],
          'pedestrian',
          preferences,
        )

        if (!walkRoute.routes.length) continue
        const walkLeg = walkRoute.routes[0].legs[0]

        segments.push({
          segmentIndex: segments.length,
          mode: 'walking',
          start: parkingWaypoint,
          end: to,
          startTime: new Date(currentTime).toISOString(),
          endTime: new Date(
            currentTime + walkLeg.duration * 1000,
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
        })

        currentTime += walkLeg.duration * 1000

        const totalDuration = (currentTime - new Date(startTime).getTime()) / 1000
        if (totalDuration >= bestTotalDuration) continue

        const tripStats = this.calculateStats(segments)

        bestTotalDuration = totalDuration
        bestTrip = {
          segments,
          tripStats,
          earliestStartTime: segments[0].startTime,
          latestEndTime: segments[segments.length - 1].endTime,
          dataSources,
          requestId: request.requestId,
          generatedAt: new Date().toISOString(),
          parkedVehicles: bike
            ? [{
                vehicle: bike,
                location: parkingCoord,
                parkedAt: bikeSegment.endTime,
              }]
            : undefined,
        }
      } catch (error) {
        // Individual parking spot failed — try next
        continue
      }
    }

    return bestTrip
  }

  /**
   * Search for parking near a location.
   *
   * Uses the category search capability (Barrelman integration).
   * Returns full Place objects so they can be attached to trip waypoints.
   * @param category  OSM preset — "amenity/parking" for cars,
   *                  "amenity/bicycle_parking" for bikes.
   */
  private async searchNearbyParking(
    center: Coordinate,
    radius: number,
    category: string = 'amenity/parking',
  ): Promise<Place[]> {
    try {
      // Convert center + radius to bounding box
      const dLat = radius / 111320
      const dLng = radius / (111320 * Math.cos((center.lat * Math.PI) / 180))

      const bounds = {
        north: center.lat + dLat,
        south: center.lat - dLat,
        east: center.lng + dLng,
        west: center.lng - dLng,
      }

      const places = await searchByCategory(category, {
        bounds,
        limit: 10,
        sort: 'distance',
      })

      return places.filter(
        (p) => p.geometry?.value?.center?.lat && p.geometry?.value?.center?.lng,
      )
    } catch (error) {
      console.error(`Parking search (${category}) failed:`, error)
      return []
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
    const bikeLocation = bike.location!

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

      if (!route.routes.length) {
        console.warn(
          'Direct biking: routing returned no routes for',
          `(${from.location.lat},${from.location.lng}) → (${to.location.lat},${to.location.lng})`,
        )
        return null
      }

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

      const walkCandidates = composed.filter((r): r is TripResponse => r !== null)

      // ── Multi-access/egress strategies ──────────────────────────────
      // Generate alternative transit candidates with non-walking access
      // and/or egress modes. Only the best MOTIS itinerary is used for
      // these variants to keep candidate count manageable.
      //
      // Trip combination model patterns:
      //   3.4  bike → park → transit → walk
      //   3.6  bike → transit (carry) → bike
      //   3.7  car → park → transit → walk
      //   3.2  walk → transit → shared bike
      //   3.5  walk → transit → shared scooter
      const additionalCandidates: TripResponse[] = []

      const availableVehicles = request.availableVehicles || []
      const useKnownLocations =
        preferences?.useKnownVehicleLocations !== false

      if (transitResponse.itineraries.length > 0) {
        const bestItinerary = transitResponse.itineraries[0]
        const bike = availableVehicles.find((v) =>
          ['bike', 'e-bike', 'scooter', 'e-scooter'].includes(v.type),
        )
        const car = availableVehicles.find((v) => v.type === 'car')

        const compositionPromises: Promise<TripResponse | null>[] = []

        // ── Vehicle-access combinations (require known vehicle locations) ──
        if (useKnownLocations && availableVehicles.length > 0) {
          // 3.4: bike → park → transit → walk
          if (bike?.location) {
            compositionPromises.push(
              this.composeTransitWithAccessAndEgress(
                bestItinerary,
                startTime,
                from,
                to,
                {
                  mode: 'biking',
                  vehicle: bike,
                  vehicleLocation: bike.location,
                },
                { mode: 'walking' },
                preferences,
                dataSources,
              ),
            )
          }

          // 3.6: bike → transit (carry bike on board) → bike
          if (bike?.location) {
            compositionPromises.push(
              this.composeTransitWithAccessAndEgress(
                bestItinerary,
                startTime,
                from,
                to,
                {
                  mode: 'biking',
                  vehicle: bike,
                  vehicleLocation: bike.location,
                  carryOnTransit: true,
                },
                { mode: 'biking' },
                preferences,
                dataSources,
              ),
            )
          }

          // 3.7: car → park → transit → walk
          if (car?.location) {
            compositionPromises.push(
              this.composeTransitWithAccessAndEgress(
                bestItinerary,
                startTime,
                from,
                to,
                {
                  mode: 'driving',
                  vehicle: car,
                  vehicleLocation: car.location,
                  searchParking: preferences?.useKnownParkingLocations,
                },
                { mode: 'walking' },
                preferences,
                dataSources,
              ),
            )
          }
        }

        // ── Shared mobility egress (no vehicle required) ──────────────
        // 3.2: walk → transit → shared bike
        compositionPromises.push(
          this.composeTransitWithAccessAndEgress(
            bestItinerary,
            startTime,
            from,
            to,
            { mode: 'walking' },
            { mode: 'shared-bike', searchSharedMobility: true },
            preferences,
            dataSources,
          ),
        )

        // 3.5: walk → transit → shared scooter
        compositionPromises.push(
          this.composeTransitWithAccessAndEgress(
            bestItinerary,
            startTime,
            from,
            to,
            { mode: 'walking' },
            { mode: 'shared-scooter', searchSharedMobility: true },
            preferences,
            dataSources,
          ),
        )

        const results = await Promise.all(compositionPromises)
        for (const result of results) {
          if (result) additionalCandidates.push(result)
        }
      }

      return [...walkCandidates, ...additionalCandidates]
    } catch (error) {
      console.error('Transit routing failed:', error)
      return []
    }
  }

  /**
   * Compose a transit trip with independent access and egress modes.
   *
   * Extracts the transit core from a MOTIS itinerary and wraps it with
   * access and egress legs routed via configurable modes. This is the
   * unified composer for all transit trip patterns:
   *
   *   3.1  walk → transit → walk
   *   3.4  bike → park → transit → walk
   *   3.6  bike → transit (carry) → bike
   *   3.7  car → park → transit → walk
   *   3.2  walk → transit → shared bike
   *   3.5  walk → transit → shared scooter
   *
   * Access timing is back-calculated from the transit departure so the
   * user arrives at the boarding stop with a configurable buffer.
   */
  private async composeTransitWithAccessAndEgress(
    itinerary: any,
    startTime: string,
    origin: Waypoint,
    destination: Waypoint,
    access: TransitAccessConfig,
    egress: TransitEgressConfig,
    preferences: any,
    dataSources: DataSource[],
  ): Promise<TripResponse | null> {
    try {
      const legs = itinerary.legs
      const segments: TripSegment[] = []

      const transitBufferMin = preferences?.transitBufferMinutes ?? 2
      const transitBufferSec = transitBufferMin * 60

      // ── Extract transit segments from the itinerary ─────────────────
      const transitSegments: TripSegment[] = []
      for (const leg of legs) {
        if (leg.transitLeg) {
          const seg = this.buildTransitSegment(
            leg,
            { location: { lat: leg.from.lat, lng: leg.from.lng }, type: 'via' },
            { location: { lat: leg.to.lat, lng: leg.to.lng }, type: 'via' },
            leg.startTime,
          )
          // Mark carrying vehicle on transit if bike carry-on
          if (access.carryOnTransit && access.vehicle) {
            seg.carryingVehicle = true
          }
          transitSegments.push(seg)
        }
      }

      if (transitSegments.length === 0) return null

      // Bike carry-on: verify all transit legs allow bikes on board.
      // Reject the itinerary if any leg's route doesn't allow bikes.
      if (access.carryOnTransit) {
        const transitRouteIds = legs
          .filter((l: any) => l.transitLeg && l.routeId)
          .map((l: any) => l.routeId as string)

        if (transitRouteIds.length > 0) {
          const allAllowed = await this.checkBikesAllowed(transitRouteIds)
          if (!allAllowed) return null
        }
      }

      const firstTransit = transitSegments[0]
      const lastTransit = transitSegments[transitSegments.length - 1]
      const transitDeparture = new Date(firstTransit.startTime).getTime()
      const tripStart = new Date(startTime).getTime()

      const boardingStop: Waypoint = {
        location: firstTransit.start.location,
        type: 'via',
        label: firstTransit.start.label,
      }

      // ── Build access leg ──────────────────────────────────────────────
      const accessSegments = await this.buildAccessLeg(
        origin,
        boardingStop,
        access,
        transitDeparture,
        transitBufferSec,
        tripStart,
        preferences,
      )
      if (!accessSegments) return null
      segments.push(...accessSegments.segments)

      // If driving with parking, track the parked vehicle
      const parkedVehicles: ParkedVehicle[] = []
      if (accessSegments.parkedVehicle) {
        parkedVehicles.push(accessSegments.parkedVehicle)
      }

      // ── Transit core ──────────────────────────────────────────────────
      segments.push(...transitSegments)

      // ── Build egress leg ──────────────────────────────────────────────
      const alightingStop: Waypoint = {
        location: lastTransit.end.location,
        type: 'via',
        label: lastTransit.end.label,
      }
      const egressStartTime = lastTransit.endTime

      const egressSegments = await this.buildEgressLeg(
        alightingStop,
        destination,
        egress,
        egressStartTime,
        access.carryOnTransit ? access.vehicle : undefined,
        preferences,
      )
      if (egressSegments) {
        segments.push(...egressSegments)
      }

      // ── Insert transfer walks between transit legs ─────────────────
      const finalSegments = await this.insertTransferWalks(
        segments,
        preferences,
      )
      if (!finalSegments) return null // Infeasible transfer

      // Index segments
      finalSegments.forEach((seg, idx) => {
        seg.segmentIndex = idx
        seg.legIndex = 0
      })

      const tripStats = this.calculateStats(finalSegments)

      // Apply itinerary-level fare if available
      if (itinerary.fare) {
        tripStats.totalCost = {
          value: (tripStats.totalCost?.value ?? 0) + itinerary.fare.amount,
          currency: itinerary.fare.currency,
        }
      }

      return {
        segments: finalSegments,
        tripStats,
        earliestStartTime: finalSegments[0]?.startTime || startTime,
        latestEndTime:
          finalSegments[finalSegments.length - 1]?.endTime || startTime,
        dataSources,
        requestId: undefined,
        generatedAt: new Date().toISOString(),
        parkedVehicles: parkedVehicles.length > 0 ? parkedVehicles : undefined,
      } as TripResponse
    } catch (error) {
      const accessLabel = access.mode + (access.carryOnTransit ? ' (carry)' : '')
      console.error(`Transit with ${accessLabel}→${egress.mode} failed:`, error)
      return null
    }
  }

  /**
   * Build access segments: origin → boarding stop.
   *
   * Returns the segments array plus optional parked vehicle info.
   * For walking access, routes via pedestrian profile.
   * For vehicle access, optionally walks to vehicle first, then rides to stop.
   * For driving, optionally searches for park-and-ride parking.
   */
  private async buildAccessLeg(
    origin: Waypoint,
    boardingStop: Waypoint,
    access: TransitAccessConfig,
    transitDeparture: number,
    transitBufferSec: number,
    tripStart: number,
    preferences: any,
  ): Promise<{ segments: TripSegment[]; parkedVehicle?: ParkedVehicle } | null> {
    if (access.mode === 'walking') {
      // Simple walk access — handled by composeTransitItinerary, not here
      return { segments: [] }
    }

    const vehicle = access.vehicle!
    const vehicleLocation = access.vehicleLocation!
    const segments: TripSegment[] = []

    const routeProfile = access.mode === 'biking' ? 'bicycle' : 'auto'
    const co2Factor = access.mode === 'biking'
      ? TripService.CO2_PER_METER.biking
      : TripService.CO2_PER_METER.driving

    // For car access with parking, search for park-and-ride lots
    let rideDestination = boardingStop
    let parkAndRideWalk: TripSegment | null = null

    if (access.mode === 'driving' && access.searchParking) {
      const parkingResults = await this.searchNearbyParking(
        boardingStop.location,
        TripService.PARKING_SEARCH_RADIUS,
      )
      if (parkingResults.length > 0) {
        const closest = parkingResults[0]
        const center = closest.geometry?.value?.center ?? { lat: closest.lat, lng: closest.lng }
        rideDestination = {
          location: center,
          type: 'via',
          label: closest.name?.value || 'Park & Ride',
          place: closest,
        }
      }
    }

    // Check if vehicle is far from origin — walk to vehicle first
    const distToVehicle = TripService.haversineDistance(
      origin.location,
      vehicleLocation,
    )
    const needsWalkToVehicle = distToVehicle > 200

    const vehicleWaypoint: Waypoint = {
      location: vehicleLocation,
      type: 'via',
      label: vehicle.name || `Your ${vehicle.type}`,
    }

    // Route from vehicle (or origin) to boarding stop / parking
    const rideOrigin = needsWalkToVehicle ? vehicleWaypoint : origin
    const rideRoute = await routingService.getRoute(
      [
        { type: 'coordinates', value: [rideOrigin.location.lat, rideOrigin.location.lng] },
        { type: 'coordinates', value: [rideDestination.location.lat, rideDestination.location.lng] },
      ],
      routeProfile,
      preferences,
    )

    if (!rideRoute.routes.length) return null
    const rideLeg = rideRoute.routes[0].legs[0]

    // If parked at a lot, plan walk from parking to stop
    const parkedAtLot = rideDestination !== boardingStop
    let parkWalkDuration = 0
    if (parkedAtLot) {
      const parkWalkResult = await this.planWalkingSegmentForTransit(
        rideDestination,
        boardingStop,
        new Date(tripStart).toISOString(),
        preferences,
      )
      if (parkWalkResult) {
        parkAndRideWalk = parkWalkResult.segment
        parkWalkDuration = parkAndRideWalk.duration * 1000
      }
    }

    // Back-calculate timing from transit departure
    const rideEndTime = transitDeparture - transitBufferSec * 1000 - parkWalkDuration
    const rideDuration = rideLeg.duration * 1000
    const rideStartTime = rideEndTime - rideDuration

    // Walk to vehicle if needed
    if (needsWalkToVehicle) {
      const walkRoute = await routingService.getRoute(
        [
          { type: 'coordinates', value: [origin.location.lat, origin.location.lng] },
          { type: 'coordinates', value: [vehicleLocation.lat, vehicleLocation.lng] },
        ],
        'pedestrian',
        preferences,
      )

      if (!walkRoute.routes.length) return null
      const walkLeg = walkRoute.routes[0].legs[0]

      const walkEnd = rideStartTime
      const walkStart = Math.max(walkEnd - walkLeg.duration * 1000, tripStart)

      segments.push({
        segmentIndex: 0,
        mode: 'walking',
        start: origin,
        end: vehicleWaypoint,
        startTime: new Date(walkStart).toISOString(),
        endTime: new Date(walkEnd).toISOString(),
        duration: (walkEnd - walkStart) / 1000,
        distance: walkLeg.distance,
        geometry: walkLeg.geometry,
        instructions: walkLeg.instructions,
        co2: 0,
        totalElevationGain: walkLeg.totalElevationGain,
        totalElevationLoss: walkLeg.totalElevationLoss,
        maxElevation: walkLeg.maxElevation,
        minElevation: walkLeg.minElevation,
        edgeSegments: walkLeg.edgeSegments,
      })
    }

    // Build ride segment
    segments.push({
      segmentIndex: 0,
      mode: access.mode,
      vehicle,
      start: rideOrigin,
      end: rideDestination,
      startTime: new Date(rideStartTime).toISOString(),
      endTime: new Date(rideEndTime).toISOString(),
      duration: (rideEndTime - rideStartTime) / 1000,
      distance: rideLeg.distance,
      geometry: rideLeg.geometry,
      instructions: rideLeg.instructions,
      co2: rideLeg.distance * co2Factor,
      cost:
        access.mode === 'driving'
          ? { value: rideLeg.distance * TripService.FUEL_COST_PER_METER, currency: 'USD' }
          : undefined,
      totalElevationGain: rideLeg.totalElevationGain,
      totalElevationLoss: rideLeg.totalElevationLoss,
      maxElevation: rideLeg.maxElevation,
      minElevation: rideLeg.minElevation,
      edgeSegments: rideLeg.edgeSegments,
    })

    // Add parking walk if needed
    if (parkAndRideWalk) {
      const parkWalkStart = rideEndTime
      const parkWalkEnd = parkWalkStart + parkAndRideWalk.duration * 1000
      parkAndRideWalk.startTime = new Date(parkWalkStart).toISOString()
      parkAndRideWalk.endTime = new Date(parkWalkEnd).toISOString()
      segments.push(parkAndRideWalk)
    }

    // Track parked vehicles for driving access
    const parkedVehicle: ParkedVehicle | undefined =
      access.mode === 'driving' && !access.carryOnTransit
        ? {
            vehicle,
            location: rideDestination.location,
            parkedAt: new Date(rideEndTime).toISOString(),
          }
        : undefined

    return { segments, parkedVehicle }
  }

  /**
   * Build egress segments: alighting stop → destination.
   *
   * Supports walking, personal cycling (carry-on), and shared mobility.
   */
  private async buildEgressLeg(
    alightingStop: Waypoint,
    destination: Waypoint,
    egress: TransitEgressConfig,
    egressStartTime: string,
    carriedVehicle: Vehicle | undefined,
    preferences: any,
  ): Promise<TripSegment[] | null> {
    const segments: TripSegment[] = []

    switch (egress.mode) {
      case 'walking': {
        const egressResult = await this.planWalkingSegmentForTransit(
          alightingStop,
          destination,
          egressStartTime,
          preferences,
        )
        if (egressResult) segments.push(egressResult.segment)
        break
      }

      case 'biking': {
        // Personal bike egress (carried on transit)
        const egressRoute = await routingService.getRoute(
          [
            { type: 'coordinates', value: [alightingStop.location.lat, alightingStop.location.lng] },
            { type: 'coordinates', value: [destination.location.lat, destination.location.lng] },
          ],
          'bicycle',
          preferences,
        )
        if (egressRoute.routes.length) {
          const egressLeg = egressRoute.routes[0].legs[0]
          if (egressLeg.distance >= 5) {
            segments.push({
              segmentIndex: 0,
              mode: 'biking',
              vehicle: carriedVehicle ?? egress.vehicle,
              start: alightingStop,
              end: destination,
              startTime: egressStartTime,
              endTime: new Date(
                new Date(egressStartTime).getTime() + egressLeg.duration * 1000,
              ).toISOString(),
              duration: egressLeg.duration,
              distance: egressLeg.distance,
              geometry: egressLeg.geometry,
              instructions: egressLeg.instructions,
              co2: egressLeg.distance * TripService.CO2_PER_METER.biking,
              totalElevationGain: egressLeg.totalElevationGain,
              totalElevationLoss: egressLeg.totalElevationLoss,
              maxElevation: egressLeg.maxElevation,
              minElevation: egressLeg.minElevation,
              edgeSegments: egressLeg.edgeSegments,
            })
          }
        }
        break
      }

      case 'shared-bike':
      case 'shared-scooter': {
        // Try GBFS real-time stations first, fall back to OSM
        const vehicleType = egress.mode === 'shared-bike' ? 'bike' : 'scooter'
        let stations: any[] = []

        // Step 1: GBFS real-time availability
        try {
          const gbfsStations = await this.fetchGbfsNearbyStations(
            alightingStop.location, 500, vehicleType,
          )
          stations = gbfsStations.map((s: any) => ({
            geometry: { value: { center: { lat: s.lat, lng: s.lon } } },
            name: { value: s.name },
            lat: s.lat,
            lng: s.lon,
          }))
        } catch { /* GBFS unavailable */ }

        // Step 2: Fall back to OSM category search
        if (stations.length === 0) {
          const stationCategory = egress.mode === 'shared-bike'
            ? 'amenity/bicycle_rental'
            : 'amenity/scooter_rental'

          const dLat = 500 / 111320
          const dLng = 500 / (111320 * Math.cos((alightingStop.location.lat * Math.PI) / 180))

          stations = await searchByCategory(stationCategory, {
            bounds: {
              north: alightingStop.location.lat + dLat,
              south: alightingStop.location.lat - dLat,
              east: alightingStop.location.lng + dLng,
              west: alightingStop.location.lng - dLng,
            },
            limit: 5,
            sort: 'distance',
          }).catch(() => [] as any[])
        }

        if (stations.length > 0) {
          const station = stations[0]
          const stationCoord: Coordinate = station.geometry?.value?.center
            ?? { lat: station.lat, lng: station.lng }

          // Walk to station
          const walkToStation = await this.planWalkingSegmentForTransit(
            alightingStop,
            {
              location: stationCoord,
              type: 'via',
              label: station.name?.value || (egress.mode === 'shared-bike' ? 'Bike Share' : 'Scooter Share'),
              place: station,
            },
            egressStartTime,
            preferences,
          )

          let rideStart = egressStartTime
          if (walkToStation) {
            segments.push(walkToStation.segment)
            rideStart = walkToStation.segment.endTime
          }

          // Ride from station to destination
          const routeProfile = 'bicycle' // scooters use bike routing
          const rideRoute = await routingService.getRoute(
            [
              { type: 'coordinates', value: [stationCoord.lat, stationCoord.lng] },
              { type: 'coordinates', value: [destination.location.lat, destination.location.lng] },
            ],
            routeProfile,
            preferences,
          )

          if (rideRoute.routes.length) {
            const rideLeg = rideRoute.routes[0].legs[0]
            segments.push({
              segmentIndex: 0,
              mode: 'biking',
              ownership: 'shared',
              start: {
                location: stationCoord,
                type: 'via',
                label: station.name?.value || 'Shared vehicle',
              },
              end: destination,
              startTime: rideStart,
              endTime: new Date(
                new Date(rideStart).getTime() + rideLeg.duration * 1000,
              ).toISOString(),
              duration: rideLeg.duration,
              distance: rideLeg.distance,
              geometry: rideLeg.geometry,
              instructions: rideLeg.instructions,
              co2: rideLeg.distance * TripService.CO2_PER_METER.biking,
              totalElevationGain: rideLeg.totalElevationGain,
              totalElevationLoss: rideLeg.totalElevationLoss,
              maxElevation: rideLeg.maxElevation,
              minElevation: rideLeg.minElevation,
              edgeSegments: rideLeg.edgeSegments,
            })
          }
        } else {
          // No shared stations found — fall back to walking egress
          const walkEgress = await this.planWalkingSegmentForTransit(
            alightingStop,
            destination,
            egressStartTime,
            preferences,
          )
          if (walkEgress) segments.push(walkEgress.segment)
        }
        break
      }

      default:
        // Unsupported egress mode — fall back to walking
        const fallback = await this.planWalkingSegmentForTransit(
          alightingStop,
          destination,
          egressStartTime,
          preferences,
        )
        if (fallback) segments.push(fallback.segment)
    }

    return segments.length > 0 ? segments : null
  }

  /**
   * Insert walking transfer segments between consecutive transit legs.
   *
   * Returns null if any transfer is infeasible (walk finishes after
   * the next transit departure).
   */
  private async insertTransferWalks(
    segments: TripSegment[],
    preferences: any,
  ): Promise<TripSegment[] | null> {
    const finalSegments: TripSegment[] = []
    for (let i = 0; i < segments.length; i++) {
      finalSegments.push(segments[i])

      if (
        segments[i].mode === 'transit' &&
        i + 1 < segments.length &&
        segments[i + 1].mode === 'transit'
      ) {
        const fromStop = segments[i].end
        const toStop = segments[i + 1].start
        const transferStart = segments[i].endTime

        const transferDist = TripService.haversineDistance(
          fromStop.location,
          toStop.location,
        )
        if (transferDist > 50) {
          const transferWalk = await this.planWalkingSegmentForTransit(
            fromStop,
            toStop,
            transferStart,
            preferences,
          )
          if (transferWalk) {
            const walkEnd = new Date(transferWalk.segment.endTime).getTime()
            const nextDeparture = new Date(segments[i + 1].startTime).getTime()
            if (walkEnd > nextDeparture) {
              return null // Infeasible transfer
            }
            finalSegments.push(transferWalk.segment)
          }
        }
      }
    }
    return finalSegments
  }

  /**
   * Haversine distance between two coordinates in meters.
   */
  private static haversineDistance(a: Coordinate, b: Coordinate): number {
    const dLat = ((b.lat - a.lat) * Math.PI) / 180
    const dLng = ((b.lng - a.lng) * Math.PI) / 180
    const sinHalf =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((a.lat * Math.PI) / 180) *
        Math.cos((b.lat * Math.PI) / 180) *
        Math.sin(dLng / 2) ** 2
    return 6371000 * 2 * Math.atan2(Math.sqrt(sinHalf), Math.sqrt(1 - sinHalf))
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
   * Check bikes_allowed for a set of MOTIS route IDs.
   * MOTIS uses composite IDs: "{feedId}_{routeId}".
   * Returns true if ALL routes allow bikes (bikesAllowed >= 1).
   */
  /**
   * Fetch nearby shared-mobility stations from Barrelman's GBFS service.
   * Returns stations with real-time availability, sorted by distance.
   */
  private async fetchGbfsNearbyStations(
    center: Coordinate,
    radius: number,
    vehicleType: string,
  ): Promise<any[]> {
    try {
      const systemIntegration = integrationManager
        .getConfiguredIntegrations()
        .find((i: any) => i.integrationId === IntegrationId.BARRELMAN)

      const config = systemIntegration?.config as
        | { host?: string; apiKey?: string }
        | undefined
      if (!config?.host) return []

      const params = new URLSearchParams({
        lat: String(center.lat),
        lng: String(center.lng),
        radius: String(radius),
        vehicleType,
        limit: '5',
      })

      const headers: Record<string, string> = {}
      if (config.apiKey) headers['Authorization'] = `Bearer ${config.apiKey}`

      const response = await fetch(
        `${config.host}/gbfs/nearby-stations?${params}`,
        { headers, signal: AbortSignal.timeout(5_000) },
      )

      if (!response.ok) return []
      const data = await response.json() as any
      return data.stations || []
    } catch {
      return []
    }
  }

  private async checkBikesAllowed(motisRouteIds: string[]): Promise<boolean> {
    if (motisRouteIds.length === 0) return true

    try {
      const systemIntegration = integrationManager
        .getConfiguredIntegrations()
        .find((i: any) => i.integrationId === IntegrationId.BARRELMAN)

      const config = systemIntegration?.config as
        | { host?: string; apiKey?: string }
        | undefined
      if (!config?.host) return true // Can't check — allow by default

      const routeParam = motisRouteIds.join(',')
      const headers: Record<string, string> = {}
      if (config.apiKey) headers['Authorization'] = `Bearer ${config.apiKey}`

      const response = await fetch(
        `${config.host}/transit/bikes-allowed?routes=${encodeURIComponent(routeParam)}`,
        { headers, signal: AbortSignal.timeout(5_000) },
      )
      if (!response.ok) return true // Network error — allow by default

      const data = await response.json() as Record<string, number>
      // All routes must have bikes_allowed >= 1 (some or all trips allow bikes)
      return motisRouteIds.every(id => (data[id] ?? 0) >= 1)
    } catch {
      return true // Integration not configured, timeout, or error — allow by default
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

    // Surface realtime metadata from MOTIS legs. Barrelman passes through
    // the GTFS-RT fields: realTime (boolean), departureDelay/arrivalDelay
    // (seconds, positive = late).
    if (leg.realTime) {
      transitDetails.realTimeData = true
      if (leg.departureDelay != null) {
        transitDetails.delay = leg.departureDelay
      }
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

    // For transit variants, pre-select the earliest-arriving trips PER
    // sub-type. Walk+transit, bike+transit, and car+transit are counted
    // separately, but within each sub-type the earliest arrival wins.
    const transitPreferred = new Set<typeof sorted[number]>()
    const transitSubTypes = new Set(
      sorted
        .map((c) => this.getTripMode(c.trip))
        .filter((m) => m.includes('transit')),
    )
    for (const subType of transitSubTypes) {
      const subCandidates = sorted
        .filter((c) => this.getTripMode(c.trip) === subType)
        .sort((a, b) => {
          const aEnd = new Date(
            a.trip.segments[a.trip.segments.length - 1]?.endTime || 0,
          ).getTime()
          const bEnd = new Date(
            b.trip.segments[b.trip.segments.length - 1]?.endTime || 0,
          ).getTime()
          return aEnd - bEnd
        })
        .slice(0, TripService.MAX_PER_MODE)
      for (const c of subCandidates) transitPreferred.add(c)
    }

    // Pre-select the best trip per mode so we always show at least one
    // representative for each mode, even if it's much slower than driving.
    const bestPerMode = new Set<typeof sorted[number]>()
    const seenModes = new Set<string>()
    for (const c of sorted) {
      const mode = this.getTripMode(c.trip)
      if (!seenModes.has(mode)) {
        seenModes.add(mode)
        bestPerMode.add(c)
      }
    }

    const kept: typeof sorted = []
    const modeCounts: Record<string, number> = {}

    for (const c of sorted) {
      const dur = c.trip.tripStats.totalDuration
      const mode = this.getTripMode(c.trip)

      // Trips under 1 hour are always reasonable — never filter them.
      // Long trips are filtered if they're > 4× the fastest option,
      // UNLESS they're the best trip for their mode — always keep one
      // representative per mode so users see all their options.
      if (
        dur > TripService.QUALITY_FLOOR_SECONDS &&
        dur > shortestDuration * 4 &&
        !bestPerMode.has(c)
      ) {
        continue
      }

      // Per-mode cap: ensure variety across modes.
      // Transit sub-types use arrival-time ordering; other modes use score order.
      const modeCount = modeCounts[mode] || 0
      if (modeCount >= TripService.MAX_PER_MODE) continue
      if (mode.includes('transit') && !transitPreferred.has(c)) continue

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
   * Determine the dominant mode of a trip for quality filtering.
   *
   * Transit trips are sub-typed by access mode so that walk+transit,
   * bike+transit, and car+transit are counted separately in the per-mode
   * cap — they represent genuinely different travel strategies.
   *
   * Non-transit trips return their longest-duration mode.
   */
  private getTripMode(trip: TripResponse): string {
    const hasTransit = trip.segments.some((s) => s.mode === 'transit')
    if (hasTransit) {
      // Distinguish transit access strategies so each gets its own
      // per-mode cap slot. A bike+transit trip is meaningfully different
      // from a walk+transit trip.
      const firstNonWalk = trip.segments.find(
        (s) => s.mode !== 'walking' && s.mode !== 'transit',
      )
      if (firstNonWalk) return `${firstNonWalk.mode}+transit`
      return 'transit'
    }

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
      safety: this.scoreSafety(trip),
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
   * Safety score derived from GraphHopper edge segment data.
   *
   * Computes a distance-weighted average across all edge segments in
   * the trip. Each edge is scored 0-1 based on:
   *   - Road class (dedicated paths > residential > arterials > highways)
   *   - Surface quality (paved > gravel > dirt)
   *   - Bike infrastructure (bike network membership, bike priority)
   *   - Road environment (bridges/tunnels penalized slightly)
   *
   * Transit segments are scored as 1.0 (inherently safe). Segments
   * without edge data fall back to mode-based defaults:
   *   walking → 0.7, biking → 0.5, driving → 0.6, transit → 1.0
   */
  private scoreSafety(trip: TripResponse): number {
    let totalWeightedScore = 0
    let totalDistance = 0

    for (const segment of trip.segments) {
      // Transit is inherently safe — no road interaction
      if (segment.mode === 'transit') {
        totalWeightedScore += segment.distance * 1.0
        totalDistance += segment.distance
        continue
      }

      const edges = segment.edgeSegments
      if (!edges || edges.length === 0) {
        // No edge data — use mode-based default
        const defaultScore = TripService.MODE_SAFETY_DEFAULTS[segment.mode] ?? 0.5
        totalWeightedScore += segment.distance * defaultScore
        totalDistance += segment.distance
        continue
      }

      // Score each edge and weight by distance
      for (const edge of edges) {
        const edgeLength = (edge.endDistance ?? 0) - (edge.startDistance ?? 0)
        if (edgeLength <= 0) continue

        let edgeScore = 0.5 // baseline

        // Road class scoring
        edgeScore += TripService.ROAD_CLASS_SAFETY[edge.roadClass ?? ''] ?? 0

        // Surface scoring — paved is safe, unpaved less so
        edgeScore += TripService.SURFACE_SAFETY[edge.surface ?? ''] ?? 0

        // Bike infrastructure bonus (for biking/walking modes)
        if (segment.mode === 'biking' || segment.mode === 'walking') {
          if (edge.bikeNetwork) edgeScore += 0.1
          if (edge.bikePriority != null && edge.bikePriority > 0.5) edgeScore += 0.1
        }

        // Road environment penalty
        if (edge.roadEnvironment === 'tunnel') edgeScore -= 0.1
        if (edge.roadEnvironment === 'ferry') edgeScore -= 0.05

        // Smoothness penalty for walking/cycling
        if (segment.mode !== 'driving') {
          edgeScore += TripService.SMOOTHNESS_SAFETY[edge.smoothness ?? ''] ?? 0
        }

        // Clamp to [0, 1]
        edgeScore = Math.max(0, Math.min(1, edgeScore))

        totalWeightedScore += edgeLength * edgeScore
        totalDistance += edgeLength
      }
    }

    if (totalDistance <= 0) return 0.5
    return totalWeightedScore / totalDistance
  }

  /** Default safety scores by mode when no edge data is available. */
  private static readonly MODE_SAFETY_DEFAULTS: Record<string, number> = {
    walking: 0.7,
    biking: 0.5,
    driving: 0.6,
    wheelchair: 0.6,
    transit: 1.0,
  }

  /** Safety deltas by road class (added to 0.5 baseline). */
  private static readonly ROAD_CLASS_SAFETY: Record<string, number> = {
    // Dedicated paths — safest
    cycleway: 0.4,
    footway: 0.4,
    path: 0.3,
    pedestrian: 0.4,
    living_street: 0.3,
    // Residential — mostly safe
    residential: 0.2,
    service: 0.15,
    // Minor roads
    unclassified: 0.1,
    tertiary: 0.05,
    tertiary_link: 0.05,
    // Arterials — less safe for pedestrians/cyclists
    secondary: -0.05,
    secondary_link: -0.05,
    primary: -0.1,
    primary_link: -0.1,
    // High-speed roads — dangerous for non-motorized
    trunk: -0.2,
    trunk_link: -0.15,
    motorway: -0.3,
    motorway_link: -0.25,
    // Stairs — risky for wheels
    steps: -0.1,
    track: 0.0,
  }

  /** Safety deltas by surface type. */
  private static readonly SURFACE_SAFETY: Record<string, number> = {
    asphalt: 0.1,
    concrete: 0.1,
    paved: 0.1,
    paving_stones: 0.05,
    cobblestone: -0.05,
    compacted: 0.0,
    gravel: -0.05,
    fine_gravel: 0.0,
    dirt: -0.1,
    sand: -0.15,
    grass: -0.1,
    mud: -0.2,
  }

  /** Safety deltas by smoothness. */
  private static readonly SMOOTHNESS_SAFETY: Record<string, number> = {
    excellent: 0.1,
    good: 0.05,
    intermediate: 0.0,
    bad: -0.1,
    very_bad: -0.15,
    horrible: -0.2,
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
