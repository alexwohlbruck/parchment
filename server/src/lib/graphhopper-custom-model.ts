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
export function getSnapPreventions(mode: TravelMode): string[] | undefined {
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
 * Translates each mode's supported preference sliders/toggles into
 * priority/speed/distance_influence rules. If the user supplied a raw
 * `customModelOverride`, that takes precedence and the rest is skipped.
 *
 * Returns `undefined` when no rules would be emitted — in that case the
 * caller should omit `custom_model` entirely and let GraphHopper use the
 * profile's built-in defaults.
 *
 * @param mode   The travel mode (DRIVING, CYCLING, WALKING, WHEELCHAIR, etc.)
 * @param prefs  The routing preferences from the user
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
      const allowedKeys = new Set([
        'distance_influence',
        'priority',
        'speed',
        'areas',
      ])
      const keys = Object.keys(parsed)
      if (keys.every((k) => allowedKeys.has(k))) {
        return parsed
      }
      console.warn(
        'customModelOverride contained disallowed keys:',
        keys.filter((k) => !allowedKeys.has(k)),
      )
    } catch {
      // Fall through to auto-generation
    }
  }

  if (!prefs) return undefined

  const priority: CustomModelRule[] = []
  const speed: CustomModelRule[] = []
  let distanceInfluence: number | undefined

  // ── Shortest-route override ───────────────────────────────────
  // GraphHopper default is 70 (s/km). A very high value heavily prefers
  // shorter routes regardless of speed.
  if (prefs.shortest) {
    distanceInfluence = 10000
  }

  // ── Ferries (all modes) ───────────────────────────────────────
  // Range: 0 = avoid, 1 = don't care. Only penalize when < 0.4.
  if (prefs.ferries !== undefined && prefs.ferries < 0.4) {
    const factor = prefs.ferries / 0.4
    priority.push({
      if: 'road_environment == FERRY',
      multiply_by: +Math.max(0, factor).toFixed(2),
    })
  } else if (prefs.avoidFerries) {
    priority.push({ if: 'road_environment == FERRY', multiply_by: 0 })
  }

  // ── Driving / Truck / Motorcycle ──────────────────────────────
  if (
    mode === TravelMode.DRIVING ||
    mode === TravelMode.TRUCK ||
    mode === TravelMode.MOTORCYCLE
  ) {
    if (prefs.highways !== undefined && prefs.highways < 0.4) {
      const factor = prefs.highways / 0.4
      priority.push({
        if: 'road_class == MOTORWAY',
        multiply_by: +Math.max(0, factor).toFixed(2),
      })
    } else if (prefs.avoidHighways) {
      priority.push({ if: 'road_class == MOTORWAY', multiply_by: 0 })
    }

    if (prefs.tolls !== undefined && prefs.tolls < 0.4) {
      const factor = prefs.tolls / 0.4
      priority.push({
        if: 'toll == ALL || toll == HGV',
        multiply_by: +Math.max(0, factor).toFixed(2),
      })
    } else if (prefs.avoidTolls) {
      priority.push({ if: 'toll == ALL || toll == HGV', multiply_by: 0 })
    }
  }

  // ── Cycling preferences ───────────────────────────────────────
  if (mode === TravelMode.CYCLING) {
    // Surface quality: 0 = any surface, 1 = paved only.
    // Only apply a penalty above 0.3 so the default (0.25 / "Balanced")
    // emits no rules at all — matching upstream GraphHopper's bike profile
    // exactly. Going above Balanced is an explicit "prefer paved" signal.
    if (prefs.surfaceQuality !== undefined && prefs.surfaceQuality > 0.3) {
      const factor = 1 - prefs.surfaceQuality * 0.9
      const clamped = +Math.max(0.05, factor).toFixed(2)
      priority.push({
        if: 'surface == GRAVEL || surface == DIRT || surface == SAND',
        multiply_by: clamped,
      })
      if (prefs.surfaceQuality > 0.5) {
        priority.push({
          if: 'smoothness == BAD || smoothness == VERY_BAD || smoothness == HORRIBLE',
          multiply_by: +Math.max(0.1, factor).toFixed(2),
        })
      }
    }

    // Safety vs speed: 0 = safest, 1 = fastest. At 0.5 (Balanced) we
    // emit no rules and let GraphHopper's built-in bike profile decide.
    //
    // The bike profile already uses GraphHopper's `bike_priority` encoded
    // value as its default priority (higher = friendlier). On top of that
    // we do two things to give the slider real teeth:
    //
    // 1. Tune `distance_influence` (s/km). Lower = priority dominates →
    //    router detours onto cycleways/quiet streets. Higher = distance
    //    dominates → router picks the most direct route even through
    //    busy streets. Default 70. Safest → 0 (no distance pressure at
    //    all); Fastest → 130 (short wins unless priority is much higher).
    //
    // 2. Add explicit priority penalties on PRIMARY/SECONDARY road classes
    //    toward Safest. `bike_priority` already deranks these, but the
    //    deranking is mild when a shoulder/cycle lane is tagged. Layering
    //    a scalar multiplier on top amplifies the avoidance so busy
    //    arterials like Central Ave in Charlotte actually lose to a
    //    residential detour. Kicks in only below 0.5 and scales linearly
    //    with safety preference.
    if (prefs.safetyVsSpeed !== undefined && prefs.safetyVsSpeed < 0.5) {
      const safety = (0.5 - prefs.safetyVsSpeed) * 2 // 0 → 1 as sv goes 0.5 → 0
      distanceInfluence = Math.round(70 - safety * 70) // 70 → 0

      // Primary: strongly penalize at Safest (×0.3), mild at near-Balanced
      priority.push({
        if: 'road_class == PRIMARY',
        multiply_by: +Math.max(0.3, 1 - safety * 0.7).toFixed(2),
      })
      // Secondary: moderate penalty at Safest (×0.6)
      priority.push({
        if: 'road_class == SECONDARY',
        multiply_by: +Math.max(0.6, 1 - safety * 0.4).toFixed(2),
      })

      // Bike-network preference: OSM-tagged bike routes (greenways, rail
      // trails, signed cycle routes) set `bike_network` to LOCAL / REGIONAL
      // / NATIONAL / INTERNATIONAL. At Safest, derank edges NOT on any bike
      // network — at 1.0 safety we multiply non-network edges by 0.4 and
      // network edges stay at full bike_priority. This gives greenways a
      // ~3× priority advantage over parallel on-road shortcuts (e.g. Little
      // Sugar Creek Greenway vs the E 7th St bridge shortcut in Charlotte),
      // which is enough to pick the network route even when it's 300–500m
      // longer. Residential streets without a bike_network tag still win
      // against primary/secondary because those are deranked more heavily.
      priority.push({
        if: 'bike_network == MISSING',
        multiply_by: +Math.max(0.4, 1 - safety * 0.6).toFixed(2),
      })

      // Crossing quality: the `crossing` encoded value (GH 11+) is lifted
      // from OSM node tags (crossing=*, crossing:signals, crossing:markings,
      // railway=*) onto adjacent edges. At Safest we penalize low-quality
      // crossings so the router prefers signalized / marked crossings over
      // unmarked ones — which matters where a cycleway crosses an arterial.
      //
      //   UNMARKED     (0.3 at max Safest) — no markings, no control
      //   UNCONTROLLED (0.5) — marked but no signal, e.g. zebra
      //   RAILWAY      (0.6) — at-grade train crossing (no barrier)
      //   RAILWAY_BARRIER (0.8) — gated train crossing (safer but slow)
      //   TRAFFIC_SIGNALS / MARKED / MISSING — no penalty
      priority.push({
        if: 'crossing == UNMARKED',
        multiply_by: +Math.max(0.3, 1 - safety * 0.7).toFixed(2),
      })
      priority.push({
        if: 'crossing == UNCONTROLLED',
        multiply_by: +Math.max(0.5, 1 - safety * 0.5).toFixed(2),
      })
      priority.push({
        if: 'crossing == RAILWAY',
        multiply_by: +Math.max(0.6, 1 - safety * 0.4).toFixed(2),
      })
      priority.push({
        if: 'crossing == RAILWAY_BARRIER',
        multiply_by: +Math.max(0.8, 1 - safety * 0.2).toFixed(2),
      })
    } else if (prefs.safetyVsSpeed !== undefined && prefs.safetyVsSpeed > 0.5) {
      // Fastest: push distance_influence high enough to OVERRIDE bike_priority's
      // bias against arterials. bike_priority gives residential streets ~1.2 and
      // primary ~0.6 — a 2× difference that keeps the router off direct arterial
      // routes even at modest distance_influence. At maximum Fastest (1.0) we
      // reach 500 s/km, which for typical uptown geometry makes a 400m detour
      // savings worth ~200s of priority-adjusted time — enough to pick 7th St
      // over a residential zig-zag.
      //
      // The bike profile still forbids motorways via access rules, so "fastest"
      // never means "on the highway".
      const speedPref = (prefs.safetyVsSpeed - 0.5) * 2 // 0 → 1 as sv goes 0.5 → 1
      distanceInfluence = Math.round(70 + speedPref * 430) // 70 → 500
    }

    // Hills: 0 = avoid, 1 = don't avoid. Below 0.3 we penalize steep edges.
    // Above 0.5 we don't emit any rule — "prefer hills" used to penalize
    // flat edges (avg_slope < 2) to push the router toward hillier options,
    // but that actively derailed flat greenways along creek beds vs hillier
    // on-road shortcuts. The default bike profile already handles hills
    // reasonably, so "prefer hills" just means "no avoidance penalty".
    //
    // Thresholds raised from 4/6 → 8/10 to accommodate SRTM elevation noise
    // (~1-3m of phantom variation on flat urban terrain creates fake 3-6%
    // slopes on short edges). Only genuinely steep grades should trigger
    // avoidance.
    if (prefs.hills !== undefined && prefs.hills < 0.3) {
      const avoidance = 1 - prefs.hills / 0.3
      priority.push({
        if: 'average_slope >= 10',
        multiply_by: +Math.max(0.3, 1 - avoidance * 0.5).toFixed(2),
      })
      speed.push({
        if: 'average_slope >= 8',
        multiply_by: +Math.max(0.6, 1 - avoidance * 0.3).toFixed(2),
      })
    }

    // Bicycle type — shapes preference for surface/road mix.
    if (prefs.bicycleType) {
      switch (prefs.bicycleType) {
        case 'Road':
          priority.push({
            if: 'surface == GRAVEL || surface == DIRT || surface == SAND',
            multiply_by: 0.1,
          })
          priority.push({
            if: 'track_type == GRADE3 || track_type == GRADE4 || track_type == GRADE5',
            multiply_by: 0.05,
          })
          break
        case 'Mountain':
          priority.push({
            if: 'road_class != TRACK && surface == ASPHALT',
            multiply_by: 0.7,
          })
          break
        case 'City':
          priority.push({
            if: 'surface == GRAVEL || surface == DIRT',
            multiply_by: 0.4,
          })
          speed.push({
            if: 'average_slope >= 10',
            multiply_by: 0.6,
          })
          break
      }
    }

    // Cap average cycling speed to the user's slider value.
    if (prefs.cyclingSpeed) {
      speed.push({ if: 'true', limit_to: prefs.cyclingSpeed })
    }
  }

  // ── Walking preferences ───────────────────────────────────────
  if (mode === TravelMode.WALKING) {
    // Thresholds raised to accommodate SRTM elevation noise — only genuinely
    // steep grades should trigger avoidance on foot routes.
    if (prefs.hills !== undefined && prefs.hills < 0.3) {
      const avoidance = 1 - prefs.hills / 0.3
      priority.push({
        if: 'average_slope >= 12',
        multiply_by: +Math.max(0.3, 1 - avoidance * 0.5).toFixed(2),
      })
      speed.push({
        if: 'average_slope >= 10',
        multiply_by: +Math.max(0.6, 1 - avoidance * 0.3).toFixed(2),
      })
    }
    if (prefs.walkingSpeed) {
      speed.push({ if: 'true', limit_to: prefs.walkingSpeed })
    }
  }

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
  if (
    priority.length === 0 &&
    speed.length === 0 &&
    distanceInfluence === undefined
  ) {
    return undefined
  }

  const model: CustomModel = {}
  if (distanceInfluence !== undefined)
    model.distance_influence = distanceInfluence
  if (priority.length > 0) model.priority = priority
  if (speed.length > 0) model.speed = speed

  return model
}
