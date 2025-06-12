import { IntegrationCapabilityId } from '../types/integration.types'
import { integrationManager } from './integrations'
import {
  TripsRequest,
  TripsResponse,
  TripOption,
  TimelineSegment,
  RouteRequest,
  TravelMode,
  WaypointType,
  VEHICLE_MODE_MAP,
  VehicleConfig,
  UnifiedRoute,
} from '../types/unified-routing.types'

export class TripsService {
  /**
   * Get multiple trip options for different vehicles and modes
   * @param request Trip planning request
   * @returns Multiple trip options with timeline data
   */
  async getTrips(request: TripsRequest): Promise<TripsResponse> {
    const startTime = Date.now()

    // Get configured routing integrations
    const routingIntegrations =
      integrationManager.getConfiguredIntegrationsByCapability(
        IntegrationCapabilityId.ROUTING,
      )

    if (routingIntegrations.length === 0) {
      throw new Error('No routing integrations configured')
    }

    // Determine which modes to calculate based on available vehicles
    const modesToCalculate = this.determineModesToCalculate(request)

    // Calculate routes for each mode
    const tripPromises = modesToCalculate.map(
      ({ mode, vehicleType, vehicle }) =>
        this.calculateTripForMode(
          request,
          mode,
          vehicleType,
          vehicle,
          routingIntegrations[0],
        ),
    )

    const tripResults = await Promise.allSettled(tripPromises)

    // Process results and errors
    const trips: TripOption[] = []
    const errors: Array<{
      mode: TravelMode
      vehicleType?: string
      provider: string
      message: string
    }> = []

    tripResults.forEach((result, index) => {
      const { mode, vehicleType } = modesToCalculate[index]

      if (result.status === 'fulfilled' && result.value) {
        trips.push(result.value)
      } else if (result.status === 'rejected') {
        errors.push({
          mode,
          vehicleType,
          provider: routingIntegrations[0].integrationId,
          message: result.reason?.message || 'Unknown error',
        })
      }
    })

    // Sort trips by recommended first, then by duration
    trips.sort((a, b) => {
      if (a.isRecommended && !b.isRecommended) return -1
      if (!a.isRecommended && b.isRecommended) return 1
      return a.summary.totalDuration - b.summary.totalDuration
    })

    // Assign ranks
    trips.forEach((trip, index) => {
      trip.rank = index + 1
    })

    // Calculate timeline bounds
    const { earliestStart, latestEnd } = this.calculateTimelineBounds(
      trips,
      request.departureTime,
    )

    return {
      request,
      trips,
      earliestStart,
      latestEnd,
      metadata: {
        providers: [routingIntegrations[0].integrationId],
        processingTime: Date.now() - startTime,
        requestId: request.requestId,
      },
      errors: errors.length > 0 ? errors : undefined,
    }
  }

  /**
   * Determine which modes to calculate based on available vehicles
   */
  private determineModesToCalculate(request: TripsRequest): Array<{
    mode: TravelMode
    vehicleType: 'car' | 'bike' | 'scooter' | 'motorcycle' | 'truck' | 'walking'
    vehicle?: VehicleConfig
  }> {
    const modes: Array<{
      mode: TravelMode
      vehicleType:
        | 'car'
        | 'bike'
        | 'scooter'
        | 'motorcycle'
        | 'truck'
        | 'walking'
      vehicle?: VehicleConfig
    }> = []

    // Always include walking if requested (default: true)
    if (request.includeWalking !== false) {
      modes.push({
        mode: TravelMode.WALKING,
        vehicleType: 'walking',
      })
    }

    // Process available vehicles
    if (request.availableVehicles?.length) {
      request.availableVehicles.forEach((vehicleType) => {
        const mode = VEHICLE_MODE_MAP[vehicleType]
        if (mode) {
          // Check if user has a specific vehicle of this type
          const userVehicle = request.userVehicles?.find(
            (v) => v.vehicleType === vehicleType,
          )

          modes.push({
            mode,
            vehicleType: vehicleType as
              | 'car'
              | 'bike'
              | 'scooter'
              | 'motorcycle'
              | 'truck'
              | 'walking',
            vehicle: userVehicle,
          })
        }
      })
    }

    // Remove duplicates (e.g., if both 'bike' and 'scooter' map to cycling)
    const uniqueModes = modes.filter(
      (mode, index, self) =>
        index ===
        self.findIndex(
          (m) => m.mode === mode.mode && m.vehicleType === mode.vehicleType,
        ),
    )

    return uniqueModes
  }

  /**
   * Calculate a trip for a specific mode
   */
  private async calculateTripForMode(
    request: TripsRequest,
    mode: TravelMode,
    vehicleType:
      | 'car'
      | 'bike'
      | 'scooter'
      | 'motorcycle'
      | 'truck'
      | 'walking',
    vehicle: VehicleConfig | undefined,
    routingIntegration: any,
  ): Promise<TripOption> {
    // Get the cached integration instance
    const integrationInstance =
      integrationManager.getCachedIntegrationInstance(routingIntegration)

    if (!integrationInstance?.capabilities.routing) {
      throw new Error(`Routing integration not available`)
    }

    // Build route request
    const routeRequest: RouteRequest = {
      waypoints: request.waypoints,
      mode,
      vehicle,
      preferences: request.preferences,
      includeInstructions: true,
      includeGeometry: true,
      departureTime: request.departureTime,
      requestId: request.requestId,
    }

    // Get route from integration
    const routeResult: UnifiedRoute =
      await integrationInstance.capabilities.routing.getRoute(routeRequest)

    if (!routeResult.routes.length) {
      throw new Error(`No route found for ${mode}`)
    }

    const route = routeResult.routes[0] // Use the first/best route

    // Convert to trip format
    const departureTime = request.departureTime || new Date()
    const arrivalTime = new Date(
      departureTime.getTime() + route.summary.totalDuration * 1000,
    )

    // Create timeline segments from route legs
    const segments: TimelineSegment[] = route.legs.map((leg, index) => ({
      id: `${route.id}-segment-${index}`,
      type: 'route' as const,
      mode,
      vehicleType,
      vehicleId: vehicle?.id,
      startTime:
        index === 0
          ? departureTime
          : new Date(
              departureTime.getTime() +
                this.getTimeToLeg(route.legs, index) * 1000,
            ),
      endTime: new Date(
        departureTime.getTime() +
          this.getTimeToLeg(route.legs, index + 1) * 1000,
      ),
      duration: leg.duration,
      distance: leg.distance,
      instructions: leg.instructions,
      geometry: leg.geometry,
      confidence: route.confidence,
    }))

    // Determine if this should be recommended (fastest for its mode type)
    const isRecommended = this.shouldBeRecommended(
      mode,
      vehicleType,
      route.summary.totalDuration,
    )

    const tripOption: TripOption = {
      id: `trip-${mode}-${vehicleType}-${Date.now()}`,
      mode,
      vehicleType,
      vehicleId: vehicle?.id,
      summary: route.summary,
      segments,
      startTime: departureTime,
      endTime: arrivalTime,
      isRecommended,
      rank: 0, // Will be set later
      provider: route.provider,
      cost: this.calculateTripCost(mode, vehicleType, route),
      co2Emissions: this.calculateCO2Emissions(
        mode,
        vehicleType,
        route.summary.totalDistance,
      ),
    }

    return tripOption
  }

  /**
   * Calculate cumulative time to reach a specific leg
   */
  private getTimeToLeg(legs: any[], legIndex: number): number {
    return legs
      .slice(0, legIndex)
      .reduce((total, leg) => total + leg.duration, 0)
  }

  /**
   * Determine if a trip should be marked as recommended
   */
  private shouldBeRecommended(
    mode: TravelMode,
    vehicleType:
      | 'car'
      | 'bike'
      | 'scooter'
      | 'motorcycle'
      | 'truck'
      | 'walking',
    duration: number,
  ): boolean {
    // For now, mark driving as recommended if it's available
    // In a real implementation, you'd compare durations across modes
    return mode === TravelMode.DRIVING
  }

  /**
   * Calculate trip costs
   */
  private calculateTripCost(
    mode: TravelMode,
    vehicleType:
      | 'car'
      | 'bike'
      | 'scooter'
      | 'motorcycle'
      | 'truck'
      | 'walking',
    route: any,
  ): TripOption['cost'] {
    // TODO: Make these fuel cost constants dynamic/configurable
    const GAS_PRICE_PER_GALLON = 3.05 // $3.05/gallon
    const FUEL_EFFICIENCY_MPG = 28 // 28 miles per gallon
    const TOLL_COST_PER_MILE = 0.1 // $0.10 per mile on toll roads

    const distanceMeters = route.summary.totalDistance
    const distanceMiles = distanceMeters * 0.000621371 // Convert meters to miles

    switch (mode) {
      case TravelMode.DRIVING:
        // Calculate fuel cost: (distance in miles / mpg) * price per gallon
        const gallonsNeeded = distanceMiles / FUEL_EFFICIENCY_MPG
        const fuelCost = gallonsNeeded * GAS_PRICE_PER_GALLON

        // Toll cost estimation (if route has tolls)
        const tollCost = route.summary.hasTolls
          ? distanceMiles * TOLL_COST_PER_MILE
          : 0

        return {
          fuel: { currency: 'USD', amount: Math.round(fuelCost * 100) / 100 },
          tolls: route.summary.hasTolls
            ? { currency: 'USD', amount: Math.round(tollCost * 100) / 100 }
            : undefined,
          total: {
            currency: 'USD',
            amount: Math.round((fuelCost + tollCost) * 100) / 100,
          },
        }

      case TravelMode.MOTORCYCLE:
        // TODO: Make motorcycle fuel efficiency dynamic/configurable
        const MOTORCYCLE_MPG = 45 // 45 mpg for motorcycles
        const motorcycleGallons = distanceMiles / MOTORCYCLE_MPG
        const motorcycleFuelCost = motorcycleGallons * GAS_PRICE_PER_GALLON
        const motorcycleTollCost = route.summary.hasTolls
          ? distanceMiles * TOLL_COST_PER_MILE
          : 0

        return {
          fuel: {
            currency: 'USD',
            amount: Math.round(motorcycleFuelCost * 100) / 100,
          },
          tolls: route.summary.hasTolls
            ? {
                currency: 'USD',
                amount: Math.round(motorcycleTollCost * 100) / 100,
              }
            : undefined,
          total: {
            currency: 'USD',
            amount:
              Math.round((motorcycleFuelCost + motorcycleTollCost) * 100) / 100,
          },
        }

      case TravelMode.TRUCK:
        // TODO: Make truck fuel efficiency and toll rates dynamic/configurable
        const TRUCK_MPG = 8 // 8 mpg for trucks
        const truckGallons = distanceMiles / TRUCK_MPG
        const truckFuelCost = truckGallons * GAS_PRICE_PER_GALLON
        const truckTollCost = route.summary.hasTolls ? distanceMiles * 0.25 : 0 // Higher toll rates for trucks

        return {
          fuel: {
            currency: 'USD',
            amount: Math.round(truckFuelCost * 100) / 100,
          },
          tolls: route.summary.hasTolls
            ? { currency: 'USD', amount: Math.round(truckTollCost * 100) / 100 }
            : undefined,
          total: {
            currency: 'USD',
            amount: Math.round((truckFuelCost + truckTollCost) * 100) / 100,
          },
        }

      case TravelMode.CYCLING:
      case TravelMode.WALKING:
        return {
          total: { currency: 'USD', amount: 0 },
        }

      default:
        return undefined
    }
  }

  /**
   * Calculate CO2 emissions
   */
  private calculateCO2Emissions(
    mode: TravelMode,
    vehicleType:
      | 'car'
      | 'bike'
      | 'scooter'
      | 'motorcycle'
      | 'truck'
      | 'walking',
    distanceMeters: number,
  ): number {
    const distance = distanceMeters / 1000 // Convert to km

    switch (mode) {
      case TravelMode.DRIVING:
        return distance * 0.2 // 0.2 kg CO2 per km (rough estimate)
      case TravelMode.CYCLING:
      case TravelMode.WALKING:
        return 0
      default:
        return 0
    }
  }

  /**
   * Calculate timeline bounds for UI
   */
  private calculateTimelineBounds(
    trips: TripOption[],
    departureTime?: Date,
  ): {
    earliestStart: Date
    latestEnd: Date
  } {
    if (trips.length === 0) {
      const now = departureTime || new Date()
      return {
        earliestStart: now,
        latestEnd: new Date(now.getTime() + 3600000), // +1 hour
      }
    }

    const startTimes = trips.map((t) => t.startTime)
    const endTimes = trips.map((t) => t.endTime)

    return {
      earliestStart: new Date(Math.min(...startTimes.map((t) => t.getTime()))),
      latestEnd: new Date(Math.max(...endTimes.map((t) => t.getTime()))),
    }
  }
}

export const tripsService = new TripsService()
