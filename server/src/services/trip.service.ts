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
  SortPreference,
  SegmentState,
  TransitDetails,
  TransitStop,
  TransitRouteType,
  SharedMobilityDetails,
  TripWarning,
  TripScore,
} from '../types/trip.types'
import { Coordinate } from '../types/unified-routing.types'
import type { Place } from '../types/place.types'
import { routingService } from './routing.service'
import { transitRoutingService } from './transit-routing.service'
import { rideshareService } from './rideshare.service'
import { searchByCategory } from './search.service'

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

    // Plan all modes in parallel — each mode query is independent
    const modePromises = modes
      .filter(mode => !parkingVehicleModes.has(mode))
      .map(async (mode): Promise<TripResponse[]> => {
        try {
          if (mode === 'transit') {
            return await this.planIntermodalTransitTrips(request, dataSources)
          } else if (mode === 'rideshare') {
            return await this.planRideshareTrips(request, dataSources)
          } else if (mode === 'biking') {
            // Cycling covers two distinct strategies: your own bike
            // (GraphHopper) and a shared bike/scooter you fetch from a dock
            // (MOTIS RENTAL). Both belong in the cycling and multi profiles.
            const [personal, shared] = await Promise.all([
              this.planModeTrip(request, mode, dataSources),
              this.planSharedVehicleTrips(request, dataSources),
            ])
            return [...(personal ? [personal] : []), ...shared]
          } else {
            const trip = await this.planModeTrip(request, mode, dataSources)
            return trip ? [trip] : []
          }
        } catch (error) {
          console.error(`Failed to plan ${mode} trip:`, error)
          return []
        }
      })

    const modeResults = await Promise.all(modePromises)
    for (const trips of modeResults) {
      candidates.push(...trips)
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
    if (request.sortPreference) {
      this.rankByMetric(scored, TripService.SORT_METRICS[request.sortPreference])
    } else if (this.getArrivalTarget(request)) {
      // Arrive-by with no explicit sort: all candidates land near the
      // target, so prefer the one that lets the user leave latest.
      this.rankByMetric(scored, (c) =>
        c.trip.segments.length
          ? -new Date(c.trip.segments[0].startTime).getTime()
          : Infinity,
      )
    }

    const sorted = scored
      .sort((a, b) => b.score.overall - a.score.overall)

    const rankedTrips: TripCandidate[] = this.filterQualityTrips(sorted, request.sortPreference)
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
    const hasRideshare = rideshareService.isRideshareAvailable()
    switch (selectedMode) {
      case 'multi': {
        // Multi-modal: generate all available modes
        const modes: Mode[] = ['walking', 'driving', 'biking', 'transit']
        if (hasRideshare) modes.push('rideshare')
        return modes
      }
      case 'walking':
        return ['walking']
      case 'driving':
        return ['walking', 'driving']
      case 'biking':
        return ['walking', 'biking']
      case 'transit':
        return ['transit']
      case 'wheelchair':
        return ['wheelchair']
      case 'rideshare':
        return hasRideshare ? ['rideshare'] : []
      default:
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

    // ── Arrive-by: shift the trip later so it lands on the target ──────
    // Street modes can depart whenever, so "arrive by 9:00" means leaving
    // just in time rather than leaving now and arriving early. Skipped when
    // intermediate waypoints carry their own time constraints — shifting
    // would break them.
    const arrivalTarget = this.getArrivalTarget(request)
    if (arrivalTarget && segments.length > 0) {
      const hasIntermediateConstraints = request.waypoints.some(
        (w, i) =>
          i < request.waypoints.length - 1 &&
          (w.departAfter || w.arriveBy || w.dwellTime),
      )
      const targetMs = new Date(arrivalTarget).getTime()
      const endMs = new Date(segments[segments.length - 1].endTime).getTime()
      const shiftMs = targetMs - endMs
      if (!hasIntermediateConstraints && shiftMs > 0) {
        for (const seg of segments) {
          seg.startTime = new Date(
            new Date(seg.startTime).getTime() + shiftMs,
          ).toISOString()
          seg.endTime = new Date(
            new Date(seg.endTime).getTime() + shiftMs,
          ).toISOString()
        }
        currentState = {
          ...currentState,
          currentTime: segments[segments.length - 1].endTime,
        }
      }
    }

    // ── Check arrival constraint on the final waypoint ─────────────
    if (arrivalTarget) {
      const arriveByTime = new Date(arrivalTarget).getTime()
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
   * Arrival deadline for the trip: request-level preferredArrivalTime, or
   * the destination waypoint's arriveBy constraint.
   */
  private getArrivalTarget(request: TripRequest): string | null {
    return (
      request.preferredArrivalTime ||
      request.waypoints[request.waypoints.length - 1]?.arriveBy ||
      null
    )
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
      default:
        // Transit/rideshare are planned at the trip level (planTrip), not per-segment.
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

    // Direct driving (assume car at origin) — still uses the car's energy
    // type for cost/CO2 when one is registered.
    if (!car || !useKnownLocations) {
      return this.planDirectDrive(from, to, state, preferences, car)
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
        cost: { value: driveLeg.distance * this.drivingCostPerMeter(car), currency: 'USD' },
        co2: driveLeg.distance * this.drivingCo2PerMeter(car),
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
    vehicle?: Vehicle,
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
        vehicle,
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
        cost: { value: leg.distance * this.drivingCostPerMeter(vehicle), currency: 'USD' },
        co2: leg.distance * this.drivingCo2PerMeter(vehicle),
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
   * OSM access values that mean the public can't just park there. Excluded
   * by default; the includePrivateParking preference opts back in.
   */
  private static readonly INACCESSIBLE_PARKING_ACCESS = new Set([
    'private', 'no', 'permit', 'permit_holders', 'residents', 'resident',
    'employees', 'staff', 'military', 'agricultural', 'forestry', 'delivery',
  ])
  /**
   * Max gap (m) allowed between where the drive ends and where the walk
   * begins. A larger gap means GraphHopper snapped them to opposite sides of
   * a barrier (rail tracks, a highway) — the lot isn't actually walkable to
   * the destination, so the candidate is dropped rather than "teleporting".
   */
  private static readonly PARKING_CONNECT_MAX_GAP = 80

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

    // Search for parking lots near the destination. Private/inaccessible
    // lots are excluded unless the user opts in.
    const parkingPlaces = await this.searchNearbyParking(
      to.location,
      TripService.PARKING_SEARCH_RADIUS,
      'amenity/parking',
      preferences.includePrivateParking === true,
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

        // Reject lots that don't actually connect to the destination on foot.
        // If the drive's end and the walk's start are far apart, they snapped
        // to opposite sides of a barrier (e.g. rail tracks) and the trip would
        // teleport across — not a real route.
        if (!this.segmentsConnect(driveLeg.geometry, walkLeg.geometry)) continue

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

        // Reject parking that doesn't connect to the destination on foot
        // (snapped across a barrier — would teleport).
        if (!this.segmentsConnect(bikeLeg.geometry, walkLeg.geometry)) continue

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
  /**
   * Whether the end of one routed leg meets the start of the next closely
   * enough to be one continuous trip. A large gap means the router snapped
   * the two onto disconnected networks (across rail tracks, a highway, a
   * river) and the segments would visually teleport.
   */
  private segmentsConnect(
    first: Coordinate[] | undefined,
    second: Coordinate[] | undefined,
  ): boolean {
    const end = first?.[first.length - 1]
    const start = second?.[0]
    if (!end || !start) return true // can't tell — don't reject
    return (
      TripService.haversineDistance(end, start) <=
      TripService.PARKING_CONNECT_MAX_GAP
    )
  }

  private async searchNearbyParking(
    center: Coordinate,
    radius: number,
    category: string = 'amenity/parking',
    includePrivate = false,
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

      // Over-fetch so the access filter still leaves candidates.
      const places = await searchByCategory(category, {
        bounds,
        limit: 25,
        sort: 'distance',
      })

      return places.filter((p) => {
        if (!p.geometry?.value?.center?.lat || !p.geometry?.value?.center?.lng) {
          return false
        }
        // Car parking: drop lots the public can't use, unless opted in.
        if (category === 'amenity/parking' && !includePrivate) {
          const access = p.tags?.['access']
          if (access && TripService.INACCESSIBLE_PARKING_ACCESS.has(access)) {
            return false
          }
        }
        return true
      })
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
  // ── Rideshare planning ─────────────────────────────────────────────

  /**
   * Plan standalone rideshare trips. Queries all configured providers
   * (Uber, Lyft, etc.) in parallel and generates one TripResponse per
   * product option so they can be scored alongside other modes.
   */
  private async planRideshareTrips(
    request: TripRequest,
    dataSources: DataSource[],
  ): Promise<TripResponse[]> {
    const from = request.waypoints[0]
    const to = request.waypoints[request.waypoints.length - 1]
    const startTime = request.preferredDepartureTime || new Date().toISOString()

    const estimates = await rideshareService.getEstimates({
      origin: from.location,
      destination: to.location,
      departureTime: startTime,
    })

    if (!estimates.length) return []

    // All providers share the same origin→destination driving line —
    // fetch the map geometry once, not per provider.
    let geometry: any = null
    try {
      const route = await routingService.getRoute(
        [
          { type: 'coordinates', value: [from.location.lat, from.location.lng] },
          { type: 'coordinates', value: [to.location.lat, to.location.lng] },
        ],
        'auto',
        { ...(request.routingPreferences || {}), language: request.language },
      )
      geometry = route.routes[0]?.legs[0]?.geometry ?? null
    } catch { /* geometry is optional */ }

    const trips: TripResponse[] = []

    for (const estimate of estimates) {
      // Take the cheapest product per provider for the trip list
      // (the full product list is available via the rideshare API directly)
      const product = estimate.products
        .sort((a, b) => a.estimatedPrice.low.value - b.estimatedPrice.low.value)[0]
      if (!product) continue

      const pickupTime = new Date(
        new Date(startTime).getTime() + product.estimatedPickupTime * 1000,
      ).toISOString()
      const dropoffTime = new Date(
        new Date(pickupTime).getTime() + product.estimatedDuration * 1000,
      ).toISOString()

      const segment: TripSegment = {
        segmentIndex: 0,
        legIndex: 0,
        mode: 'rideshare',
        start: from,
        end: to,
        startTime: pickupTime,
        endTime: dropoffTime,
        duration: product.estimatedDuration,
        distance: product.estimatedDistance,
        geometry,
        instructions: [],
        cost: product.estimatedPrice.high,
        co2: product.estimatedDistance * TripService.CO2_PER_METER.driving,
        details: {
          rideshareDetails: {
            provider: estimate.provider,
            productId: product.productId,
            productName: product.displayName,
            vehicleType: 'car',
            estimatedPickupTime: pickupTime,
            pickupEta: product.estimatedPickupTime,
            estimatedPrice: product.estimatedPrice.high,
            priceRange: product.estimatedPrice,
            surgeMultiplier: product.estimatedPrice.surgeMultiplier,
            bookingUrl: product.bookingUrl,
            expiresAt: estimate.expiresAt,
            capacity: product.capacity,
          },
        },
      }

      const totalDuration = product.estimatedPickupTime + product.estimatedDuration

      trips.push({
        segments: [segment],
        tripStats: {
          totalDuration,
          totalDistance: product.estimatedDistance,
          totalCost: product.estimatedPrice.high,
          totalCo2: product.estimatedDistance * TripService.CO2_PER_METER.driving,
        },
        earliestStartTime: startTime,
        latestEndTime: dropoffTime,
        dataSources: [
          ...dataSources,
          {
            id: estimate.provider.toLowerCase(),
            name: estimate.provider,
            url: product.bookingUrl,
            type: 'rideshare_api',
          },
        ],
        requestId: request.requestId,
        generatedAt: new Date().toISOString(),
      } as any)
    }

    return trips
  }

  // ── Intermodal transit planning (MOTIS unified graph) ─────────────

  /**
   * Plan transit trips using MOTIS intermodal routing.
   *
   * Instead of manually enumerating access/egress mode combinations and
   * querying MOTIS separately for each, this sends 1-3 MOTIS queries that
   * handle walk/bike/car/bikeshare access/egress natively within the
   * unified graph (OSM + GTFS + GBFS).
   *
   * Rideshare combinations are derived from the walk-access results since
   * rideshare isn't a MOTIS-routable mode.
   */
  private async planIntermodalTransitTrips(
    request: TripRequest,
    dataSources: DataSource[],
  ): Promise<TripResponse[]> {
    const preferences = request.routingPreferences || {}
    const startTime = request.preferredDepartureTime || new Date().toISOString()
    const from = request.waypoints[0]
    const to = request.waypoints[request.waypoints.length - 1]

    // Skip transit for very short trips in multi-mode — MOTIS exhaustively
    // searches transit even when walking is clearly faster, causing
    // multi-second delays for trips under ~1.5km. An explicit transit
    // request always runs the query.
    const dist = TripService.haversineDistance(from.location, to.location)
    if (dist < 1500 && request.selectedMode !== 'transit') return []

    // Multi-stop trips chain one query per waypoint pair. Vehicle-access
    // queries and rideshare variants are origin→destination concepts and
    // don't apply to chained trips.
    if (request.waypoints.length > 2) {
      return this.planChainedIntermodalTrips(
        request, dataSources, startTime, preferences,
      )
    }

    // Scale search scope to trip distance — shorter trips need less
    // walking radius, longer trips can afford more RAPTOR iterations
    const maxWalkSec = TripService.walkSecondsBudget(
      preferences?.maxWalkingDistance,
      dist < 5000 ? 600 : 900,
    )

    // Arrive-by: anchor the MOTIS search on the arrival target so
    // itineraries land before it, instead of departing as soon as possible.
    const arrivalTarget = this.getArrivalTarget(request)

    const baseRequest = {
      from: from.location,
      to: to.location,
      time: arrivalTarget ?? startTime,
      arriveBy: arrivalTarget != null,
      // Ask MOTIS for a spread of options — a dense network has several
      // distinct routings; filterQualityTrips dedupes them by line signature
      // and keeps the best handful.
      numItineraries: 8,
      searchWindow: dist < 5000 ? 1800 : 3600,
      transitModes: preferences?.transitModes,
      maxTransfers: preferences?.maxTransfers,
      wheelchair: preferences?.wheelchairAccessible,
    }

    // Query 1 (always): WALK access/egress. Kept separate from RENTAL —
    // walk-only queries get Barrelman's wide stop-matching radius (off-street
    // platforms stay boardable) and run in ~100ms, while mixing RENTAL in
    // would force the narrow radius onto the primary transit results.
    // Skip directModes — GraphHopper already computes walk/bike/drive in parallel
    const walkQuery = this.executeIntermodalQuery(
      {
        ...baseRequest,
        preTransitModes: ['WALK'],
        postTransitModes: ['WALK'],
        maxPreTransitTime: maxWalkSec,
        maxPostTransitTime: maxWalkSec,
      },
      from, to, startTime, dataSources, preferences,
    )

    // Query 1a (always): least-transfer sweep. Time-optimal RAPTOR never
    // returns a one-seat ride that arrives a few minutes after a transfer
    // combo — it's Pareto-dominated at generation time, before our scoring
    // ever sees it ("why transfer to a bus when the streetcar goes there?").
    // A heavy per-interchange pad makes RAPTOR surface the simplest
    // itineraries; signature dedup merges them with the time-optimal set
    // and ranking decides.
    const fewTransfersQuery = this.executeIntermodalQuery(
      {
        ...baseRequest,
        numItineraries: 2,
        preTransitModes: ['WALK'],
        postTransitModes: ['WALK'],
        maxPreTransitTime: maxWalkSec,
        maxPostTransitTime: maxWalkSec,
        additionalTransferTime: 15,
      },
      from, to, startTime, dataSources, preferences,
    )

    // Query 1b (always): RENTAL egress — bikeshare/scooter as the transit
    // last mile (train → shared bike → destination). Direct shared rides
    // (no transit) are generated by the cycling profile in
    // planSharedVehicleTrips, so we don't request directModes here.
    const rentalQuery = this.executeIntermodalQuery(
      {
        ...baseRequest,
        preTransitModes: ['WALK'],
        postTransitModes: ['RENTAL'],
        maxPreTransitTime: maxWalkSec,
        maxPostTransitTime: maxWalkSec,
      },
      from, to, startTime, dataSources, preferences,
    )

    const queries: Promise<TripResponse[]>[] = [walkQuery, fewTransfersQuery, rentalQuery]

    const availableVehicles = request.availableVehicles || []
    const useKnownLocations = preferences.useKnownVehicleLocations !== false

    // Query 2 (if car available): CAR_PARKING access (park-and-ride)
    const car = availableVehicles.find(v => v.type === 'car')
    if (car) {
      queries.push(
        this.planVehicleAccessTransitQuery(
          {
            ...baseRequest,
            preTransitModes: ['CAR_PARKING'],
            postTransitModes: ['WALK'],
            maxPostTransitTime: maxWalkSec,
          },
          car, from, to, startTime, dataSources, preferences, useKnownLocations,
        ),
      )
    }

    // Query 3 (if bike available): BIKE access
    const bike = availableVehicles.find(v =>
      ['bike', 'e-bike', 'scooter', 'e-scooter'].includes(v.type),
    )
    if (bike) {
      queries.push(
        this.planVehicleAccessTransitQuery(
          {
            ...baseRequest,
            preTransitModes: ['BIKE'],
            postTransitModes: ['WALK'],
            maxPreTransitTime: 1800,
            maxPostTransitTime: maxWalkSec,
          },
          bike, from, to, startTime, dataSources, preferences, useKnownLocations,
        ),
      )
    }

    // Rideshare + transit: MOTIS can't route rideshare, so derive these by
    // swapping a boundary walk of a walk-access transit trip for a rideshare
    // leg (no extra MOTIS query). Chained onto Query 1 so the rideshare API
    // round-trip overlaps the car/bike MOTIS queries.
    const rideshareQuery: Promise<TripResponse[]> =
      rideshareService.isRideshareAvailable()
        ? walkQuery
            .then(trips =>
              this.deriveRideshareTransitVariants(
                trips, from, to, startTime, preferences,
              ),
            )
            .catch(error => {
              // Rideshare failures are non-fatal, but log so they don't go unnoticed
              console.error('Rideshare+transit composition failed:', error)
              return []
            })
        : Promise.resolve([])

    const results = await Promise.all([...queries, rideshareQuery])
    return results.flat()
  }

  /**
   * Direct shared-vehicle trips: dock or free-floating bikeshare and scooters
   * ridden end to end (walk → shared bike → walk), no transit.
   *
   * Shared mobility is a cycling strategy — a bike you fetch from a dock
   * rather than your own — so it's generated by the cycling profile and
   * appears in both the cycling and multi results. MOTIS returns these as
   * `direct` RENTAL connections; we keep only the pure shared rides here and
   * leave transit+rental combos (last-mile egress) to the transit planner.
   */
  private async planSharedVehicleTrips(
    request: TripRequest,
    dataSources: DataSource[],
  ): Promise<TripResponse[]> {
    // Single origin→destination only — chained shared rides aren't modelled.
    if (request.waypoints.length > 2) return []

    const preferences = request.routingPreferences || {}
    const startTime = request.preferredDepartureTime || new Date().toISOString()
    const from = request.waypoints[0]
    const to = request.waypoints[request.waypoints.length - 1]

    // Under ~500 m walking wins and fetching a bike is pointless overhead.
    const dist = TripService.haversineDistance(from.location, to.location)
    if (dist < 500) return []

    const arrivalTarget = this.getArrivalTarget(request)
    const maxWalkSec = TripService.walkSecondsBudget(
      preferences?.maxWalkingDistance,
      dist < 5000 ? 600 : 900,
    )

    const trips = await this.executeIntermodalQuery(
      {
        from: from.location,
        to: to.location,
        time: arrivalTarget ?? startTime,
        arriveBy: arrivalTarget != null,
        numItineraries: 4,
        // Direct shared ride is the target; maxTransfers 0 caps the transit
        // work MOTIS does alongside it (those itineraries are discarded).
        maxTransfers: 0,
        directModes: ['RENTAL'],
        preTransitModes: ['WALK'],
        postTransitModes: ['WALK'],
        maxPreTransitTime: maxWalkSec,
        maxPostTransitTime: maxWalkSec,
      },
      from, to, startTime, dataSources, preferences,
    )

    // Keep only pure shared-vehicle rides — drop any transit itineraries the
    // query returned as a side effect.
    return trips.filter(
      (t) =>
        t.segments.some((s) => s.ownership === 'shared') &&
        !t.segments.some((s) => s.mode === 'transit'),
    )
  }

  /**
   * Multi-stop transit: chain one intermodal query per waypoint pair, with
   * each leg departing when the previous one arrives (plus any dwell time
   * or departAfter constraint on the intermediate waypoint). Returns one
   * combined candidate.
   *
   * Legs are inherently sequential — leg N+1's departure depends on leg N's
   * arrival. Short legs with no transit option fall back to a walking
   * connection instead of dropping the whole chain. Arrive-by targets are
   * checked (warning) but not back-propagated through the chain.
   */
  private async planChainedIntermodalTrips(
    request: TripRequest,
    dataSources: DataSource[],
    startTime: string,
    preferences: any,
  ): Promise<TripResponse[]> {
    const waypoints = request.waypoints
    const warnings: TripWarning[] = []
    const allSegments: TripSegment[] = []
    let fare: { value: number; currency: string } | null = null
    let fareMixed = false

    let state: SegmentState = {
      currentTime: startTime,
      currentLocation: waypoints[0].location,
      currentMode: 'transit',
      parkedVehicles: [],
    }

    for (let i = 0; i < waypoints.length - 1; i++) {
      const from = waypoints[i]
      const to = waypoints[i + 1]

      const constrained = this.applyWaypointTimeConstraints(from, i, state)
      warnings.push(...constrained.warnings)
      state = constrained.state

      const legDist = TripService.haversineDistance(from.location, to.location)
      const maxWalkSec = TripService.walkSecondsBudget(
        preferences?.maxWalkingDistance,
        legDist < 5000 ? 600 : 900,
      )

      const trips = await this.executeIntermodalQuery(
        {
          from: from.location,
          to: to.location,
          time: state.currentTime,
          arriveBy: false,
          numItineraries: 1,
          searchWindow: legDist < 5000 ? 1800 : 3600,
          transitModes: preferences?.transitModes,
          maxTransfers: preferences?.maxTransfers,
          wheelchair: preferences?.wheelchairAccessible,
          preTransitModes: ['WALK'],
          postTransitModes: ['WALK'],
          maxPreTransitTime: maxWalkSec,
          maxPostTransitTime: maxWalkSec,
        },
        from, to, state.currentTime, dataSources, preferences,
      )

      let legSegments = trips[0]?.segments
      if (!legSegments) {
        // No transit for this leg — walk it if it's walkable, otherwise
        // there is no chained transit option.
        if (legDist > 1500) return []
        const walk = await this.planConnectionWalk(
          from, to, state.currentTime, preferences,
        )
        if (!walk) return []
        legSegments = [walk]
      }

      for (const seg of legSegments) {
        seg.legIndex = i
        allSegments.push(seg)
      }

      // Sum per-leg transit fares when currencies agree
      const legCost = trips[0]?.tripStats.totalCost
      if (legCost) {
        if (!fare) fare = { ...legCost }
        else if (fare.currency === legCost.currency) fare.value += legCost.value
        else fareMixed = true
      }

      state = {
        ...state,
        currentTime: allSegments[allSegments.length - 1].endTime,
        currentLocation: to.location,
      }
    }

    // Final-waypoint arrival check
    const arrivalTarget = this.getArrivalTarget(request)
    if (arrivalTarget) {
      const targetMs = new Date(arrivalTarget).getTime()
      const actualMs = new Date(state.currentTime).getTime()
      if (actualMs > targetMs) {
        const overshoot = Math.round((actualMs - targetMs) / 1000)
        warnings.push({
          type: 'time_constraint_violated',
          waypointIndex: waypoints.length - 1,
          message: `Arrived ${Math.ceil(overshoot / 60)} min after requested arrival time`,
          overshootSeconds: overshoot,
        })
      }
    }

    allSegments.forEach((seg, idx) => {
      seg.segmentIndex = idx
    })
    const tripStats = this.calculateStats(allSegments)
    if (fare && !fareMixed) {
      // Chained segments carry no per-segment cost, so the summed fares
      // ARE the trip cost.
      tripStats.totalCost = fare
    }

    return [{
      segments: allSegments,
      tripStats,
      earliestStartTime: allSegments[0]?.startTime || startTime,
      latestEndTime:
        allSegments[allSegments.length - 1]?.endTime || state.currentTime,
      ...(warnings.length > 0 && { warnings }),
      dataSources,
      requestId: request.requestId,
      generatedAt: new Date().toISOString(),
    }]
  }

  /**
   * Run a vehicle-access intermodal query (CAR_PARKING or BIKE pre-transit).
   *
   * When the vehicle's known location is used and lies more than 200m from
   * the origin, a walk-to-vehicle leg is planned first: the MOTIS query
   * departs from the vehicle once the walk completes, and the walk segment
   * is prepended to each resulting trip (back-timed from the itinerary's
   * first leg, never earlier than the requested departure). For car access,
   * the parking location (end of the driving leg) is recorded in
   * parkedVehicles for return-trip planning.
   */
  private async planVehicleAccessTransitQuery(
    query: import('../types/integration.types').IntermodalRouteRequest,
    vehicle: Vehicle,
    from: Waypoint,
    to: Waypoint,
    startTime: string,
    dataSources: DataSource[],
    preferences: any,
    useKnownLocation: boolean,
  ): Promise<TripResponse[]> {
    try {
      const vehicleLocation =
        useKnownLocation && vehicle.location ? vehicle.location : null

      let walkToVehicle: TripSegment | null = null
      let queryFrom = from.location
      let queryTime = startTime

      if (vehicleLocation) {
        queryFrom = vehicleLocation
        const distToVehicle = TripService.haversineDistance(
          from.location,
          vehicleLocation,
        )
        if (distToVehicle > 200) {
          walkToVehicle = await this.planConnectionWalk(
            from,
            {
              location: vehicleLocation,
              type: 'via',
              label: vehicle.name || `Your ${vehicle.type}`,
            },
            startTime,
            preferences,
          )
          if (walkToVehicle) {
            queryTime = walkToVehicle.endTime
          }
        }
      }

      const trips = await this.executeIntermodalQuery(
        { ...query, from: queryFrom, time: queryTime },
        from, to, startTime, dataSources, preferences,
      )

      const rideMode: Mode = vehicle.type === 'car' ? 'driving' : 'biking'

      for (const trip of trips) {
        // Tag the MOTIS ride leg with the user's vehicle
        const rideSeg = trip.segments.find(s => s.mode === rideMode)
        if (rideSeg) {
          rideSeg.vehicle = vehicle
          if (vehicle.type === 'car') {
            // Recompute emissions and add energy cost using the car's
            // energy type — the adapter used the generic driving rate
            // and MOTIS legs carry no cost.
            const oldCo2 = rideSeg.co2 ?? 0
            rideSeg.co2 = rideSeg.distance * this.drivingCo2PerMeter(vehicle)
            trip.tripStats.totalCo2 =
              (trip.tripStats.totalCo2 ?? 0) + rideSeg.co2 - oldCo2

            const driveCost = rideSeg.distance * this.drivingCostPerMeter(vehicle)
            rideSeg.cost = { value: driveCost, currency: 'USD' }
            const totalCost = trip.tripStats.totalCost
            if (!totalCost) {
              trip.tripStats.totalCost = { value: driveCost, currency: 'USD' }
            } else if (totalCost.currency === 'USD') {
              totalCost.value += driveCost
            }
            // Non-USD fare: skip folding rather than mixing currencies

            trip.parkedVehicles = [{
              vehicle,
              location: rideSeg.end.location,
              parkedAt: rideSeg.endTime,
            }]
          }
        }

        if (walkToVehicle) {
          // Back-time the walk from the itinerary's first leg. MOTIS departs
          // no earlier than queryTime (= startTime + walk duration), so the
          // walk start never precedes the requested departure.
          const firstStart = new Date(trip.segments[0].startTime).getTime()
          const walkDurMs = walkToVehicle.duration * 1000
          const walk: TripSegment = {
            ...walkToVehicle,
            startTime: new Date(firstStart - walkDurMs).toISOString(),
            endTime: new Date(firstStart).toISOString(),
          }
          trip.segments.unshift(walk)
          trip.segments.forEach((seg, idx) => { seg.segmentIndex = idx })

          // Update stats incrementally — recomputing would drop the
          // itinerary-level fare folded into totalCost.
          trip.tripStats.totalDuration += walk.duration
          trip.tripStats.totalDistance += walk.distance
          trip.tripStats.totalWalkingDistance =
            (trip.tripStats.totalWalkingDistance ?? 0) + walk.distance
          trip.earliestStartTime = walk.startTime
        }
      }

      return trips
    } catch (error) {
      console.error(`Vehicle-access (${vehicle.type}) transit query failed:`, error)
      return []
    }
  }

  /**
   * Plan a simple walking connection between two waypoints (e.g. origin →
   * parked vehicle). Returns null when routing fails or the walk is
   * trivially short.
   */
  private async planConnectionWalk(
    from: Waypoint,
    to: Waypoint,
    startTime: string,
    preferences: any,
  ): Promise<TripSegment | null> {
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
      if (leg.distance < 5) return null

      return {
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
    } catch {
      return null
    }
  }

  private async executeIntermodalQuery(
    request: import('../types/integration.types').IntermodalRouteRequest,
    from: Waypoint,
    to: Waypoint,
    startTime: string,
    dataSources: DataSource[],
    preferences?: any,
  ): Promise<TripResponse[]> {
    try {
      const response = await transitRoutingService.getIntermodalRoute(request)
      if (!response.itineraries?.length) return []

      const adapted = await Promise.all(
        response.itineraries.map(itinerary =>
          this.adaptIntermodalItinerary(itinerary, from, to, startTime, dataSources, preferences),
        ),
      )
      return adapted.filter((t): t is TripResponse => t !== null)
    } catch (error) {
      console.error('Intermodal query failed:', error)
      return []
    }
  }

  /**
   * Adapt a MOTIS intermodal itinerary into a TripResponse.
   *
   * MOTIS legs carry real OSM geometry but no turn-by-turn instructions or
   * edge metadata, and they end at platform centroids. Walking legs are
   * enriched after adaptation: endpoints snapped to the user's exact
   * origin/destination and to real station entrances, then re-routed via
   * GraphHopper for instructions, edge-level safety data, and elevation.
   */
  private async adaptIntermodalItinerary(
    itinerary: import('../types/integration.types').TransitItinerary,
    from: Waypoint,
    to: Waypoint,
    startTime: string,
    dataSources: DataSource[],
    preferences?: any,
  ): Promise<TripResponse | null> {
    let segments: TripSegment[] = []

    for (const leg of itinerary.legs) {
      const segment = this.adaptIntermodalLeg(leg)
      if (segment) segments.push(segment)
    }

    if (segments.length === 0) return null

    // Drop transit legs that walking beats, then enrich the (possibly
    // merged) walks. Order matters: collapsing first lets enrich re-time
    // the merged boundary/transfer walks correctly.
    segments = this.collapseWalkableTransitLegs(segments)
    await this.enrichIntermodalWalks(segments, from, to, startTime, preferences)

    segments.forEach((seg, idx) => {
      seg.segmentIndex = idx
      seg.legIndex = 0
    })

    const tripStats = this.calculateStats(segments)

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
      latestEndTime: segments[segments.length - 1]?.endTime || startTime,
      dataSources,
      requestId: undefined,
      generatedAt: new Date().toISOString(),
    }
  }

  /** Only transit legs at most this long (in-vehicle seconds) are walk-checked. */
  private static readonly COLLAPSE_MAX_RIDE_SEC = 360
  /** Beyond this straight-line distance a leg is never walkable. */
  private static readonly COLLAPSE_MAX_WALK_METERS = 1500
  /**
   * Time transit costs beyond the ride itself (waiting, boarding). A transit
   * leg is only worth keeping if it beats walking by more than this — which
   * is why a one-block bus you'd wait 5 min for loses to a 3-min walk.
   */
  private static readonly COLLAPSE_OVERHEAD_SEC = 240

  /** Estimated street walking speed (m/s) incl. detour factor, for the
   *  collapse decision only — real geometry comes from enrichment later. */
  private static readonly WALK_ESTIMATE_MPS = 1.4 / 1.35

  /**
   * Replace transit legs that walking beats with a walk, then merge adjacent
   * walks. General rule: a leg survives only if `rideTime + overhead < walkTime`,
   * so a one-block bus you'd wait for loses to a short walk while a fast
   * subway one-stop (far apart) is protected.
   *
   * The walk time is estimated from straight-line distance — cheap (no routing
   * call) and good enough because the overhead margin absorbs the error. The
   * resulting walks carry the MOTIS geometry as a placeholder;
   * enrichIntermodalWalks re-routes and re-times them (a collapsed boundary
   * leg becomes an access/egress walk, a collapsed mid leg a transfer walk —
   * both already handled there).
   */
  private collapseWalkableTransitLegs(segments: TripSegment[]): TripSegment[] {
    const collapsed = segments.map((seg) => {
      if (seg.mode !== 'transit') return seg
      if (seg.duration > TripService.COLLAPSE_MAX_RIDE_SEC) return seg
      const crow = TripService.haversineDistance(
        seg.start.location,
        seg.end.location,
      )
      if (crow > TripService.COLLAPSE_MAX_WALK_METERS) return seg

      const walkEst = crow / TripService.WALK_ESTIMATE_MPS
      // Keep the transit leg only if it beats walking by the overhead.
      if (walkEst > seg.duration + TripService.COLLAPSE_OVERHEAD_SEC) return seg

      // Walk wins — replace with a walk (geometry refined by enrichment).
      return {
        ...seg,
        mode: 'walking' as const,
        vehicle: undefined,
        cost: undefined,
        details: undefined,
        co2: 0,
        distance: crow,
        duration: walkEst,
      } as TripSegment
    })

    // Merge runs of consecutive walking segments into one (start of first →
    // end of last). enrichIntermodalWalks recomputes geometry/timing after.
    const merged: TripSegment[] = []
    for (const seg of collapsed) {
      const prev = merged[merged.length - 1]
      if (seg.mode === 'walking' && prev?.mode === 'walking') {
        prev.end = seg.end
        prev.endTime = seg.endTime
        prev.distance += seg.distance
        prev.duration =
          (new Date(seg.endTime).getTime() - new Date(prev.startTime).getTime()) / 1000
      } else {
        merged.push(seg)
      }
    }
    return merged
  }

  /**
   * Convert a max-walking-distance preference (meters) into the MOTIS
   * street-leg time budget (seconds). MOTIS measures the budget in walk
   * time along the street network, so a naive meters/speed conversion
   * silently undershoots the user's stated distance — street routes detour,
   * and a walk a few seconds over the cap kills otherwise-perfect one-seat
   * itineraries. 20% detour headroom plus a minute of slack keeps the cap
   * meaning "about this far", erring on inclusion (scoring handles the rest).
   */
  private static walkSecondsBudget(
    maxWalkingDistanceM: number | undefined,
    defaultSec: number,
  ): number {
    if (!maxWalkingDistanceM) return defaultSec
    return Math.round((maxWalkingDistanceM / 1.4) * 1.2) + 60
  }

  /**
   * Transit modes that board inside a station (vs curbside/pier).
   * Trams/streetcars are deliberately excluded — they board from curbside
   * or median platforms, and snapping to a nearby building's "entrance"
   * teleports the walk to the wrong facility (e.g. the bus terminal a
   * block from a streetcar stop).
   */
  private static readonly STATION_ROUTE_TYPES = new Set([
    'subway', 'rail', 'monorail', 'funicular',
  ])

  /**
   * Max distance (m) an entrance may be from the platform to be trusted as
   * THIS station's entrance. Real entrances sit within ~100m of the platform
   * centroid; anything farther is usually a different building.
   */
  private static readonly ENTRANCE_SNAP_RADIUS_M = 150

  /** True when the segment is a transit leg boarding inside a station. */
  private isStationTransit(seg: TripSegment): boolean {
    if (seg.mode !== 'transit') return false
    const type = seg.details?.transitDetails?.route?.type
    return type != null && TripService.STATION_ROUTE_TYPES.has(type)
  }

  /** Cached station-entrance lookups — entrances are static OSM data. */
  private entranceCache = new Map<
    string,
    Promise<import('../types/integration.types').StationEntrance | null>
  >()
  private static readonly ENTRANCE_CACHE_MAX = 500

  private cachedNearestEntrance(
    lat: number,
    lng: number,
    radiusM: number,
  ): Promise<import('../types/integration.types').StationEntrance | null> {
    const key = `${lat.toFixed(5)},${lng.toFixed(5)},${radiusM}`
    let hit = this.entranceCache.get(key)
    if (!hit) {
      hit = transitRoutingService.getNearestEntrance(lat, lng, radiusM)
      this.entranceCache.set(key, hit)
      if (this.entranceCache.size > TripService.ENTRANCE_CACHE_MAX) {
        // Drop the oldest entry — simple FIFO trim is enough here
        const oldest = this.entranceCache.keys().next().value
        if (oldest) this.entranceCache.delete(oldest)
      }
    }
    return hit
  }

  /**
   * Upgrade MOTIS walking legs in place (all legs in parallel):
   *
   * 1. Exact endpoints — first/last walk start/end at the user's request
   *    coordinates instead of MOTIS's street-graph snap.
   * 2. Entrance snapping — a walk's station-side endpoint moves from the
   *    platform centroid to the nearest real entrance/stairs/elevator.
   * 3. GraphHopper re-route — turn-by-turn instructions, edge segments
   *    (safety scoring), and elevation for the snapped endpoints.
   *
   * Timing: the first segment is back-timed from its anchored end (clamped
   * to the requested departure); the last segment extends forward from its
   * start. Walks between transit legs keep MOTIS timing — any slack is wait
   * time at the next stop. GraphHopper failures leave the MOTIS leg as-is.
   */
  private async enrichIntermodalWalks(
    segments: TripSegment[],
    origin: Waypoint,
    destination: Waypoint,
    startTime: string,
    preferences?: any,
  ): Promise<void> {
    const tripStartMs = new Date(startTime).getTime()
    const last = segments.length - 1

    await Promise.all(
      segments.map(async (seg, i) => {
        if (seg.mode !== 'walking') return

        // 1. Exact user endpoints at the trip boundaries
        if (i === 0) {
          seg.start = origin
        }
        if (i === last) {
          seg.end = destination
        }

        // 2. Entrance snapping on station-facing endpoints. Only for
        // station-based modes — bus/ferry stops are curbside or pier-side
        // and have no entrance to walk to.
        const nextIsTransit = i < last && this.isStationTransit(segments[i + 1])
        const prevIsTransit = i > 0 && this.isStationTransit(segments[i - 1])

        const [boardEntrance, alightEntrance] = await Promise.all([
          nextIsTransit
            ? this.cachedNearestEntrance(seg.end.location.lat, seg.end.location.lng, TripService.ENTRANCE_SNAP_RADIUS_M)
            : Promise.resolve(null),
          prevIsTransit
            ? this.cachedNearestEntrance(seg.start.location.lat, seg.start.location.lng, TripService.ENTRANCE_SNAP_RADIUS_M)
            : Promise.resolve(null),
        ])

        if (boardEntrance) {
          seg.end = {
            location: { lat: boardEntrance.lat, lng: boardEntrance.lon },
            type: 'via',
            label: boardEntrance.name || boardEntrance.description || seg.end.label,
          }
        }
        if (alightEntrance) {
          seg.start = {
            location: { lat: alightEntrance.lat, lng: alightEntrance.lon },
            type: 'via',
            label: alightEntrance.name || alightEntrance.description || seg.start.label,
          }
        }

        // 3. GraphHopper re-route between the (possibly moved) endpoints
        try {
          const route = await routingService.getRoute(
            [
              { type: 'coordinates', value: [seg.start.location.lat, seg.start.location.lng] },
              { type: 'coordinates', value: [seg.end.location.lat, seg.end.location.lng] },
            ],
            'pedestrian',
            preferences,
          )
          if (!route.routes.length) return
          const leg = route.routes[0].legs[0]

          seg.geometry = leg.geometry
          seg.instructions = leg.instructions
          seg.distance = leg.distance
          seg.totalElevationGain = leg.totalElevationGain
          seg.totalElevationLoss = leg.totalElevationLoss
          seg.maxElevation = leg.maxElevation
          seg.minElevation = leg.minElevation
          seg.edgeSegments = leg.edgeSegments

          const ghDurMs = leg.duration * 1000

          const nextIsTransitLeg = i < last && segments[i + 1].mode === 'transit'
          if (i === 0 && nextIsTransitLeg) {
            // Access walk: leave as late as possible while still reaching the
            // stop the preferred buffer before the train departs (rather than
            // arriving exactly on time). The buffer is a soft target — the
            // clamp to the requested departure and ~1 min of walk-time
            // uncertainty flex it naturally. The segment spans walk + buffer
            // wait, so the timeline shows the short wait at the stop.
            const departureMs = new Date(segments[i + 1].startTime).getTime()
            const bufferMs = (preferences?.transitBufferMinutes ?? 2) * 60_000
            const newStart = Math.max(departureMs - ghDurMs - bufferMs, tripStartMs)
            seg.startTime = new Date(newStart).toISOString()
            seg.endTime = new Date(departureMs).toISOString()
            seg.duration = (departureMs - newStart) / 1000
            seg.waitSeconds = Math.max(0, seg.duration - leg.duration)
          } else if (i === 0) {
            // First leg isn't a walk-to-transit (e.g. a fully collapsed trip);
            // just place the routed walk from its start.
            const startMs = new Date(seg.startTime).getTime()
            seg.endTime = new Date(startMs + ghDurMs).toISOString()
            seg.duration = leg.duration
          } else if (i === last) {
            // Anchor the start (transit arrival side); extend the end.
            const startMs = new Date(seg.startTime).getTime()
            seg.endTime = new Date(startMs + ghDurMs).toISOString()
            seg.duration = leg.duration
          } else if (nextIsTransitLeg) {
            // Transfer walk: you walk when you arrive, then wait at the next
            // platform. Stretch the segment to the next departure so a MOTIS
            // gap (walk ends, bus leaves later) doesn't render as dead air —
            // the remainder is explicit wait. Start stays anchored to the
            // previous arrival, so nothing cascades.
            const departureMs = new Date(segments[i + 1].startTime).getTime()
            const startMs = new Date(seg.startTime).getTime()
            if (departureMs > startMs) {
              seg.endTime = new Date(departureMs).toISOString()
              seg.duration = (departureMs - startMs) / 1000
              seg.waitSeconds = Math.max(0, seg.duration - leg.duration)
            }
          }
          // Other middle walks (e.g. to rental stations) keep MOTIS timing —
          // re-timing them would cascade into later segments.
        } catch {
          // GraphHopper failure — the MOTIS leg stands
        }
      }),
    )
  }

  private adaptIntermodalLeg(
    leg: import('../types/integration.types').TransitLeg,
  ): TripSegment | null {
    let geometry: any = null
    if (leg.geometry?.coordinates) {
      geometry = leg.geometry.coordinates.map(
        ([lng, lat]: [number, number]) => ({ lat, lng }),
      )
    }

    const distance = leg.distance > 0
      ? leg.distance
      : TripService.computeDistanceFromGeometry(geometry)

    // Transit legs use the existing buildTransitSegment pattern
    if (leg.transitLeg) {
      return this.buildTransitSegment(leg, { location: { lat: leg.from.lat, lng: leg.from.lng }, type: 'via' } as Waypoint, { location: { lat: leg.to.lat, lng: leg.to.lng }, type: 'via' } as Waypoint, leg.startTime)
    }

    // Street-mode legs (WALK, BIKE, CAR, CAR_PARKING, RENTAL)
    const mode = this.mapIntermodalStreetMode(leg.mode)
    const ownership = leg.mode === 'RENTAL' ? 'shared' as const : undefined

    const segment: TripSegment = {
      segmentIndex: 0,
      mode,
      ownership,
      start: {
        location: { lat: leg.from.lat, lng: leg.from.lng },
        type: 'via',
        label: leg.from.name || undefined,
      },
      end: {
        location: { lat: leg.to.lat, lng: leg.to.lng },
        type: 'via',
        label: leg.to.name || undefined,
      },
      startTime: leg.startTime,
      endTime: leg.endTime,
      duration: leg.duration,
      distance,
      geometry,
      instructions: [],
      co2: distance * (TripService.CO2_PER_METER[mode] ?? 0),
    }

    // Add shared mobility details for RENTAL legs
    if (leg.mode === 'RENTAL') {
      segment.details = {
        sharedMobilityDetails: {
          provider: leg.rentalProvider || 'Unknown',
          stationName: leg.rentalStationName,
          toStationName: (leg as any).rentalToStationName,
          vehicleType: this.mapRentalFormFactor(leg.rentalFormFactor),
          propulsionType: this.mapPropulsionType((leg as any).rentalPropulsionType),
          stationId: leg.rentalStationId,
          unlockUri: (leg as any).rentalUri,
        },
      }
    }

    return segment
  }

  private mapPropulsionType(prop?: string): 'human' | 'electric_assist' | 'electric' | undefined {
    switch (prop) {
      case 'HUMAN': return 'human'
      case 'ELECTRIC_ASSIST': return 'electric_assist'
      case 'ELECTRIC': return 'electric'
      default: return undefined
    }
  }

  private mapIntermodalStreetMode(motisMode: string): Mode {
    switch (motisMode) {
      case 'WALK': return 'walking'
      case 'BIKE': case 'BICYCLE': return 'biking'
      case 'CAR': case 'CAR_PARKING': case 'CAR_DROPOFF': return 'driving'
      case 'RENTAL': return 'biking'
      default: return 'walking'
    }
  }

  private mapRentalFormFactor(formFactor?: string): SharedMobilityDetails['vehicleType'] {
    switch (formFactor) {
      case 'BICYCLE': case 'CARGO_BICYCLE': return 'bike'
      case 'SCOOTER_STANDING': case 'SCOOTER_SEATED': return 'scooter'
      case 'CAR': return 'car'
      case 'MOPED': return 'moped'
      default: return 'bike'
    }
  }

  /** Minimum boundary distance (m) for a rideshare leg to be worth offering. */
  private static readonly RIDESHARE_MIN_LEG_METERS = 800

  /**
   * Derive rideshare→transit and transit→rideshare options from already-computed
   * walk-access transit trips. Rideshare isn't a MOTIS-routable mode, so it's
   * the only transit access/egress mode composed here: we take the earliest-
   * arriving walk-access trip and swap its boundary walk for a rideshare leg.
   * No extra MOTIS query.
   *
   *   access variant:  rideshare → transit → (existing egress)
   *   egress variant:  (existing access) → transit → rideshare
   */
  private async deriveRideshareTransitVariants(
    trips: TripResponse[],
    origin: Waypoint,
    destination: Waypoint,
    startTime: string,
    preferences: any,
  ): Promise<TripResponse[]> {
    // Base: earliest-arriving walk-access trip. Vehicle-access trips
    // (drive/bike to the stop) are not valid bases — slicing their boundary
    // off would silently discard the drive/park legs. Sort by arrival, not
    // totalDuration, since totalDuration excludes transfer-wait gaps.
    const base = trips
      .filter(
        (t) =>
          t.segments.some((s) => s.mode === 'transit') &&
          t.segments.every((s) => s.mode === 'transit' || s.mode === 'walking'),
      )
      .sort(
        (a, b) =>
          new Date(a.latestEndTime).getTime() - new Date(b.latestEndTime).getTime(),
      )[0]
    if (!base) return []

    const segs = base.segments
    const firstTransitIdx = segs.findIndex((s) => s.mode === 'transit')
    const lastTransitIdx = segs.findLastIndex((s) => s.mode === 'transit')
    const firstTransit = segs[firstTransitIdx]
    const lastTransit = segs[lastTransitIdx]

    const tripStartMs = new Date(startTime).getTime()
    const bufferSec = (preferences?.transitBufferMinutes ?? 2) * 60

    // Only offer a rideshare leg where it replaces a substantial walk —
    // a paid ride for a couple hundred meters is never a sensible option.
    const accessDist = TripService.haversineDistance(
      origin.location,
      firstTransit.start.location,
    )
    const egressDist = TripService.haversineDistance(
      lastTransit.end.location,
      destination.location,
    )

    const logFailure = (side: string) => (error: unknown) => {
      console.error(`Rideshare ${side} variant failed:`, error)
      return null
    }

    const [accessVariant, egressVariant] = await Promise.all([
      // rideshare → transit → (existing egress)
      accessDist >= TripService.RIDESHARE_MIN_LEG_METERS
        ? this.buildRideshareLeg(
            origin,
            firstTransit.start,
            'access',
            new Date(firstTransit.startTime).getTime() - bufferSec * 1000,
            tripStartMs,
            preferences,
          )
            .then((ride) =>
              ride
                ? this.assembleTrip(base, [ride, ...segs.slice(firstTransitIdx)], startTime)
                : null,
            )
            .catch(logFailure('access'))
        : null,
      // (existing access) → transit → rideshare
      egressDist >= TripService.RIDESHARE_MIN_LEG_METERS
        ? this.buildRideshareLeg(
            lastTransit.end,
            destination,
            'egress',
            new Date(lastTransit.endTime).getTime(),
            tripStartMs,
            preferences,
          )
            .then((ride) =>
              ride
                ? this.assembleTrip(base, [...segs.slice(0, lastTransitIdx + 1), ride], startTime)
                : null,
            )
            .catch(logFailure('egress'))
        : null,
    ])

    return [accessVariant, egressVariant].filter(
      (t): t is TripResponse => t !== null,
    )
  }

  /**
   * Build a single rideshare leg between two waypoints, timed relative to the
   * transit it connects to. For 'access', `anchorMs` is the latest arrival at
   * the boarding stop (transit departure minus buffer) — the leg is rejected
   * when the user couldn't hail after `tripStartMs` and still make it (pickup
   * wait precedes the ride). For 'egress', `anchorMs` is the transit arrival
   * time and pickup wait happens after alighting. Returns null if no rideshare
   * estimate is available or the timing is infeasible.
   */
  private async buildRideshareLeg(
    from: Waypoint,
    to: Waypoint,
    side: 'access' | 'egress',
    anchorMs: number,
    tripStartMs: number,
    preferences: any,
  ): Promise<TripSegment | null> {
    // Driving geometry only depends on from/to — fetch it concurrently with
    // the (slower, external) rideshare estimate.
    const geometryPromise = routingService
      .getRoute(
        [
          { type: 'coordinates', value: [from.location.lat, from.location.lng] },
          { type: 'coordinates', value: [to.location.lat, to.location.lng] },
        ],
        'auto',
        preferences,
      )
      .then((route) => route.routes[0]?.legs[0]?.geometry ?? null)
      .catch(() => null)

    const estimates = await rideshareService.getEstimates({
      origin: from.location,
      destination: to.location,
      // Egress rides start when transit arrives (possibly far in the future);
      // access rides are hailed around the trip start.
      departureTime: new Date(
        side === 'egress' ? anchorMs : tripStartMs,
      ).toISOString(),
    })
    const cheapest = estimates
      .flatMap((e) =>
        e.products.map((p) => ({ ...p, provider: e.provider, expiresAt: e.expiresAt })),
      )
      .sort((a, b) => a.estimatedPrice.low.value - b.estimatedPrice.low.value)[0]
    if (!cheapest) return null

    let startMs: number
    let endMs: number
    if (side === 'access') {
      endMs = anchorMs
      startMs = endMs - cheapest.estimatedDuration * 1000
      // Infeasible: hailing now, the pickup + ride wouldn't reach the
      // boarding stop before the transit departs.
      if (startMs - cheapest.estimatedPickupTime * 1000 < tripStartMs) {
        return null
      }
    } else {
      startMs = anchorMs + cheapest.estimatedPickupTime * 1000
      endMs = startMs + cheapest.estimatedDuration * 1000
    }

    const geometry = await geometryPromise

    return {
      segmentIndex: 0,
      legIndex: 0,
      mode: 'rideshare',
      start: from,
      end: to,
      startTime: new Date(startMs).toISOString(),
      endTime: new Date(endMs).toISOString(),
      duration: cheapest.estimatedDuration,
      distance: cheapest.estimatedDistance,
      geometry,
      instructions: [],
      cost: cheapest.estimatedPrice.high,
      co2: cheapest.estimatedDistance * TripService.CO2_PER_METER.driving,
      details: {
        rideshareDetails: {
          provider: cheapest.provider,
          productId: cheapest.productId,
          productName: cheapest.displayName,
          vehicleType: 'car',
          pickupEta: cheapest.estimatedPickupTime,
          estimatedPrice: cheapest.estimatedPrice.high,
          priceRange: cheapest.estimatedPrice,
          surgeMultiplier: cheapest.estimatedPrice.surgeMultiplier,
          bookingUrl: cheapest.bookingUrl,
          expiresAt: cheapest.expiresAt,
          capacity: cheapest.capacity,
        },
      },
    }
  }

  /**
   * Re-index a new segment list into a TripResponse, cloning segments so the
   * source trip's segments aren't mutated. Preserves the base trip's transit
   * fare (which lives at the itinerary level, not on individual segments).
   */
  private assembleTrip(
    base: TripResponse,
    newSegments: TripSegment[],
    startTime: string,
  ): TripResponse {
    const cloned = newSegments.map((s, i) => ({
      ...s,
      segmentIndex: i,
      legIndex: 0,
    }))
    const tripStats = this.calculateStats(cloned)

    // Transit fare is itinerary-level (not per-segment), so calculateStats
    // misses it — fold the base trip's transit fare back in. Skip when the
    // currencies disagree: summing a USD rideshare cost into a non-USD fare
    // would produce a mislabeled total, and the rideshare cost alone is the
    // safer floor.
    const baseFare = base.tripStats.totalCost
    if (baseFare && baseFare.value > 0) {
      const segCost = tripStats.totalCost
      if (!segCost || segCost.currency === baseFare.currency) {
        tripStats.totalCost = {
          value: (segCost?.value ?? 0) + baseFare.value,
          currency: baseFare.currency,
        }
      }
    }

    return {
      segments: cloned,
      tripStats,
      earliestStartTime: cloned[0]?.startTime || startTime,
      latestEndTime: cloned[cloned.length - 1]?.endTime || startTime,
      dataSources: base.dataSources,
      requestId: undefined,
      generatedAt: new Date().toISOString(),
    }
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

  private static readonly MAX_TRIPS = 18

  /**
   * Filter to quality trips only. Keeps up to MAX_TRIPS, dropping trips that
   * are clearly worse than the best option in every meaningful way.
   *
   * Rules:
   * 1. Quality floor — drop trips >4× the fastest AND >60 min
   * 2. Transit — keep the best-ranked trip per distinct line signature
   *    (e.g. "3", "2>F", "bike:A"), up to MAX_TRANSIT_OPTIONS. A dense
   *    network has many real alternatives; show them rather than two.
   * 3. Non-transit — max MAX_PER_MODE per mode + near-duplicate removal.
   */
  private static readonly QUALITY_FLOOR_SECONDS = 60 * 60 // 60 minutes
  private static readonly MAX_PER_MODE = 2
  /** Distinct transit routings (by line signature) to surface. */
  private static readonly MAX_TRANSIT_OPTIONS = 8

  private filterQualityTrips(
    sorted: Array<{ trip: TripResponse; score: TripScore; rank: number }>,
    sortPreference?: SortPreference,
  ): Array<{ trip: TripResponse; score: TripScore; rank: number }> {
    if (sorted.length <= 2) return sorted

    const shortestDuration = Math.min(
      ...sorted.map((c) => c.trip.tripStats.totalDuration),
    )

    // Transit: keep the best-ranked trip per distinct line signature, so a
    // dense network surfaces its many real alternatives (3 vs 4 vs A→D vs
    // F…) instead of two near-identical departures. `sorted` is already in
    // the active ranking order (balanced score, or the named sort), so the
    // first trip seen for a signature is its best representative.
    const transitPreferred = new Set<typeof sorted[number]>()
    const seenSignatures = new Set<string>()
    for (const c of sorted) {
      if (!this.getTripMode(c.trip).includes('transit')) continue
      const sig = this.transitSignature(c.trip)
      if (seenSignatures.has(sig)) continue
      seenSignatures.add(sig)
      transitPreferred.add(c)
      if (transitPreferred.size >= TripService.MAX_TRANSIT_OPTIONS) break
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

      if (mode.includes('transit')) {
        // Transit variety is governed by line-signature dedup above.
        if (!transitPreferred.has(c)) continue
      } else {
        // Non-transit: cap per mode and drop near-duplicates (same mode,
        // duration within 5%).
        if ((modeCounts[mode] || 0) >= TripService.MAX_PER_MODE) continue
        const dominated = kept.some((k) => {
          if (this.getTripMode(k.trip) !== mode) return false
          const durRatio = dur / Math.max(k.trip.tripStats.totalDuration, 1)
          return durRatio > 0.95 && durRatio < 1.05
        })
        if (dominated) continue
      }

      kept.push(c)
      modeCounts[mode] = (modeCounts[mode] || 0) + 1
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

    // Shared bike/scooter is its own strategy — a vehicle you fetch from a
    // dock, distinct from a personal bike. Give it a separate per-mode slot
    // so it's never dropped as a near-duplicate of cycling.
    const shared = trip.segments.find((s) => s.ownership === 'shared')
    if (shared) {
      return shared.details?.sharedMobilityDetails?.vehicleType === 'scooter'
        ? 'scootershare'
        : 'bikeshare'
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

  /**
   * A trip's distinct-routing key: the access mode (when not walking) plus
   * the ordered transit line names — e.g. "3", "2>F", "bike:A". Two trips
   * with the same signature are the same "way" (different departures); the
   * filter keeps only the best-ranked one.
   */
  private transitSignature(trip: TripResponse): string {
    const lines = trip.segments
      .filter((s) => s.mode === 'transit')
      .map((s) => {
        const td = s.details?.transitDetails
        return td?.shortName || td?.route?.shortName || td?.route?.id || '?'
      })
    const access = trip.segments.find(
      (s) => s.mode !== 'walking' && s.mode !== 'transit',
    )?.mode
    return (access ? `${access}:` : '') + lines.join('>')
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

  /** Driving CO2 (kg/m) by vehicle energy type. Electric uses US grid intensity. */
  private static readonly DRIVING_CO2_BY_ENERGY: Record<string, number> = {
    gas: 0.00024,
    diesel: 0.00022,
    hybrid: 0.00015,
    electric: 0.00006,
  }

  /** Driving energy cost ($/m) by vehicle energy type. */
  private static readonly DRIVING_COST_BY_ENERGY: Record<string, number> = {
    gas: 0.000087,
    diesel: 0.000095,
    hybrid: 0.000055,
    electric: 0.00003,
  }

  /** CO2 per meter for a driving leg, honoring the vehicle's energy type. */
  private drivingCo2PerMeter(vehicle?: Vehicle): number {
    return (
      TripService.DRIVING_CO2_BY_ENERGY[vehicle?.energyType ?? ''] ??
      TripService.CO2_PER_METER.driving
    )
  }

  /** Energy cost per meter for a driving leg, honoring the energy type. */
  private drivingCostPerMeter(vehicle?: Vehicle): number {
    return (
      TripService.DRIVING_COST_BY_ENERGY[vehicle?.energyType ?? ''] ??
      TripService.FUEL_COST_PER_METER
    )
  }

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
   * Comfort score: penalizes long walks, many transfers, and climbs.
   * - Walking > 500m starts penalizing (transit access/egress context)
   * - Each transfer beyond 1 penalizes
   * - Elevation gain on the walking portions penalizes (hauling up hills
   *   to a stop is the discomfort, so only walk segments count)
   * - Pure walking/cycling trips get full comfort score — the penalties
   *   only apply when walking is an inconvenient part of a multimodal
   *   trip, not when it IS the mode.
   */
  private scoreComfort(trip: TripResponse): number {
    const isPureWalkOrBike =
      trip.segments.length > 0 &&
      trip.segments.every((s) => s.mode === 'walking' || s.mode === 'biking')
    if (isPureWalkOrBike) return 1

    const walkDist = trip.tripStats.totalWalkingDistance ?? 0
    const transfers = trip.tripStats.totalTransfers ?? 0
    const walkClimb = trip.segments.reduce(
      (sum, s) => sum + (s.mode === 'walking' ? s.totalElevationGain ?? 0 : 0),
      0,
    )

    // Walk penalty: 0m → 1.0, 500m → 0.5, 1500m → 0.25
    const walkScore = 500 / (500 + walkDist)

    // Transfer penalty: 0 → 1.0, 1 → 0.67, 2 → 0.5, 3 → 0.4
    const transferScore = 1 / (1 + transfers * 0.5)

    // Climb penalty: 0m gain → 1.0, 30m → 0.625, 100m → 0.33
    const climbScore = 50 / (50 + walkClimb)

    return walkScore * 0.5 + transferScore * 0.3 + climbScore * 0.2
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
   * Primary metric per named sort preference. Lower is better for every
   * metric (rankByMetric normalizes accordingly).
   */
  private static readonly SORT_METRICS: Record<
    SortPreference,
    (c: { trip: TripResponse }) => number
  > = {
    earliest_arrival: (c) =>
      c.trip.segments.length
        ? new Date(c.trip.segments[c.trip.segments.length - 1].endTime).getTime()
        : Infinity,
    shortest: (c) => c.trip.tripStats.totalDuration,
    cheapest: (c) => c.trip.tripStats.totalCost?.value ?? 0,
    greenest: (c) => c.trip.tripStats.totalCo2 ?? 0,
    fewest_transfers: (c) => c.trip.tripStats.totalTransfers ?? 0,
    least_walking: (c) => c.trip.tripStats.totalWalkingDistance ?? 0,
  }

  /**
   * Direct ranking: overwrite each candidate's overall score with its
   * min-max-normalized primary metric (lower metric = higher score), plus
   * the balanced weighted score scaled down to a pure tiebreaker.
   * Non-finite metric values rank last.
   */
  private rankByMetric(
    candidates: Array<{ trip: TripResponse; score: TripScore }>,
    metric: (c: { trip: TripResponse; score: TripScore }) => number,
  ): void {
    if (candidates.length === 0) return

    const values = candidates.map(metric)
    const finite = values.filter((v) => Number.isFinite(v))
    if (finite.length === 0) return

    const min = Math.min(...finite)
    const max = Math.max(...finite)
    const range = max - min

    candidates.forEach((c, i) => {
      const v = values[i]
      const primary = !Number.isFinite(v)
        ? 0
        : range === 0
          ? 1
          : 1 - (v - min) / range
      c.score.overall = primary + this.computeOverallScore(c.score) * 0.001
    })
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
