/**
 * Shared GraphHopper custom_model builder.
 *
 * Both the Barrelman integration (self-hosted proxy) and the official
 * GraphHopper integration use this to translate unified RoutingPreferences
 * into a GraphHopper custom_model object.
 *
 * Custom models adjust priority (route preference) and speed using
 * conditional rules. See: https://docs.graphhopper.com/docs/custom-models
 *
 * The weighting formula is:
 *   edge_weight = edge_distance / (speed * priority)
 *                 + edge_distance * distance_influence
 *                 + turn_penalty
 *
 * - priority multiply_by < 1 = avoid (increases weight)
 * - speed multiply_by < 1 = slower (increases weight AND travel time)
 * - distance_influence: higher = prefer shorter routes over faster ones
 *   (value of 90 means 1 extra km detour must save 90s to be worthwhile)
 *
 * Encoded values available (configured in graphhopper-config.yml):
 *   road_class, road_environment, road_access, surface, smoothness,
 *   track_type, bike_network, get_off_bike, average_slope, max_slope,
 *   average_speed, max_speed, country, roundabout, hike_rating, mtb_rating,
 *   toll
 */

import { TravelMode, RoutingPreferences } from '../types/unified-routing.types'

export interface CustomModelRule {
  if: string
  multiply_by?: number
  limit_to?: number
}

export interface CustomModel {
  distance_influence?: number
  priority?: CustomModelRule[]
  speed?: CustomModelRule[]
}

/**
 * GraphHopper snap_preventions per profile.
 *
 * snap_preventions prevents the origin/destination from snapping directly
 * onto certain road types. This is critical for car routing — without
 * "motorway" in snap_preventions, the origin can snap directly onto a
 * motorway edge, bypassing on-ramps and producing wrong routes.
 *
 * GraphHopper API default is ["tunnel", "bridge", "ferry"].
 * For car/truck we add "motorway" and "trunk" so the router joins
 * highways via proper on-ramps.
 */
export function getSnapPreventions(
  mode: TravelMode,
): string[] | undefined {
  switch (mode) {
    case TravelMode.DRIVING:
    case TravelMode.TRUCK:
    case TravelMode.MOTORCYCLE:
      return ['motorway', 'trunk', 'ferry', 'tunnel', 'bridge']
    case TravelMode.CYCLING:
      return ['motorway', 'trunk', 'ferry', 'tunnel', 'bridge']
    case TravelMode.WALKING:
    case TravelMode.WHEELCHAIR:
      return ['motorway', 'trunk', 'ferry', 'tunnel', 'bridge', 'ford']
    default:
      return undefined
  }
}

/**
 * Build a GraphHopper custom_model from unified routing preferences.
 *
 * Most modes use GraphHopper's built-in profiles without modification.
 * Custom models are only generated for:
 *   - Wheelchair routing (needs surface/slope/step avoidance)
 *   - Raw custom_model overrides (advanced/debug usage)
 *
 * @param mode      The travel mode (DRIVING, CYCLING, WALKING, WHEELCHAIR, etc.)
 * @param prefs     The routing preferences from the user
 * @returns         A custom_model object, or undefined if no rules are needed
 */
export function buildGraphHopperCustomModel(
  mode: TravelMode,
  prefs: RoutingPreferences | undefined,
): CustomModel | undefined {
  // If the user supplied a raw override, use it directly
  if (prefs?.customModelOverride) {
    try {
      const parsed = JSON.parse(prefs.customModelOverride)
      // Only allow known custom_model keys
      const allowedKeys = new Set(['distance_influence', 'priority', 'speed', 'areas'])
      const keys = Object.keys(parsed)
      if (keys.every(k => allowedKeys.has(k))) {
        return parsed
      }
      console.warn('customModelOverride contained disallowed keys:', keys.filter(k => !allowedKeys.has(k)))
    } catch {
      // Fall through to auto-generation
    }
  }

  if (!prefs) return undefined

  const priority: CustomModelRule[] = []
  const speed: CustomModelRule[] = []

  // ── Wheelchair preferences ────────────────────────────────────
  if (mode === TravelMode.WHEELCHAIR) {
    priority.push({ if: 'road_class == STEPS', multiply_by: 0 })
    priority.push({
      if: 'average_slope >= 10 || average_slope <= -10',
      multiply_by: 0.01,
    })
    priority.push({
      if: 'average_slope >= 6 || average_slope <= -6',
      multiply_by: 0.2,
    })
    speed.push({
      if: 'average_slope >= 4 || average_slope <= -4',
      multiply_by: 0.6,
    })
    priority.push({
      if: 'surface == GRAVEL || surface == DIRT || surface == SAND',
      multiply_by: 0.1,
    })
    priority.push({
      if: 'smoothness == BAD || smoothness == VERY_BAD || smoothness == HORRIBLE',
      multiply_by: 0.05,
    })
    priority.push({
      if: 'track_type == GRADE3 || track_type == GRADE4 || track_type == GRADE5',
      multiply_by: 0.05,
    })
    priority.push({ if: 'road_class == TRACK', multiply_by: 0.15 })
    speed.push({ if: 'true', limit_to: prefs.walkingSpeed || 4 })
  }

  // ── Assemble ──────────────────────────────────────────────────
  if (priority.length === 0 && speed.length === 0) {
    return undefined
  }

  const model: CustomModel = {}
  if (priority.length > 0) model.priority = priority
  if (speed.length > 0) model.speed = speed

  return model
}
