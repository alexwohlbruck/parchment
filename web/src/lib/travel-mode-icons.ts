import {
  FootprintsIcon,
  TrainFrontIcon,
  TramFrontIcon,
  BusFrontIcon,
  ShipIcon,
  CableCarIcon,
  CarTaxiFrontIcon,
  BikeIcon,
  CarFrontIcon,
  TruckIcon,
  AccessibilityIcon,
  TrainFrontTunnelIcon,
  type LucideIcon,
} from 'lucide-vue-next'

/**
 * Map GTFS TransitRouteType values to Lucide icons.
 * These match the `routeType` field on transit segments.
 */
const transitRouteTypeIcons: Record<string, LucideIcon> = {
  rail: TrainFrontIcon,
  subway: TrainFrontTunnelIcon,
  tram: TramFrontIcon,
  bus: BusFrontIcon,
  trolleybus: BusFrontIcon,
  ferry: ShipIcon,
  cable_tram: CableCarIcon,
  aerial_lift: CableCarIcon,
  funicular: CableCarIcon,
  monorail: TrainFrontIcon,
}

/**
 * Map travel modes to default icons.
 * For transit, use `getTransitIcon()` for route-type-specific icons.
 */
const modeIcons: Record<string, LucideIcon> = {
  walking: FootprintsIcon,
  driving: CarFrontIcon,
  cycling: BikeIcon,
  biking: BikeIcon,
  transit: TrainFrontIcon,
  motorcycle: CarFrontIcon,
  truck: TruckIcon,
  wheelchair: AccessibilityIcon,
  rideshare: CarTaxiFrontIcon,
}

/**
 * Map the vehicle types a user can own to icons.
 *
 * Distinct from `modeIcons` above, which is keyed by travel mode — a bike and
 * an e-bike are one mode and two vehicles. Lucide has no moped or scooter
 * glyph, so both borrow the bike.
 */
const vehicleTypeIcons: Record<string, LucideIcon> = {
  car: CarFrontIcon,
  truck: TruckIcon,
  moped: BikeIcon,
  bike: BikeIcon,
  'e-bike': BikeIcon,
  scooter: BikeIcon,
  'e-scooter': BikeIcon,
  wheelchair: AccessibilityIcon,
}

/**
 * Get the icon for a user's vehicle. Falls back to the car, since an unknown
 * vehicle is still a vehicle — a map pin would read as a place instead.
 */
export function getVehicleIcon(vehicleType: string): LucideIcon {
  return vehicleTypeIcons[vehicleType] ?? CarFrontIcon
}

/**
 * Get the icon for a transit segment based on its GTFS route type.
 * Falls back to the generic transit icon (train) if unknown.
 */
export function getTransitIcon(routeType?: string): LucideIcon {
  if (routeType && transitRouteTypeIcons[routeType]) {
    return transitRouteTypeIcons[routeType]
  }
  return TrainFrontIcon
}

/**
 * Get the icon for a segment, resolving transit route types dynamically.
 * For transit segments, pass the routeType for a specific icon.
 * For non-transit segments, returns the mode-level icon.
 */
export function getSegmentIcon(mode: string, routeType?: string): LucideIcon {
  if (mode === 'transit') {
    return getTransitIcon(routeType)
  }
  return modeIcons[mode] || FootprintsIcon
}

/**
 * Get the default icon for a travel mode (no route type resolution).
 */
export function getModeIcon(mode: string): LucideIcon {
  return modeIcons[mode] || FootprintsIcon
}
