# Trip Planner Architecture

Technical reference for the multimodal trip planning system.

## Overview

The trip planner composes routes across walking, cycling, driving, wheelchair,
and transit modes. Transit routing uses MOTIS (a C++ RAPTOR engine) for
stop-to-stop itineraries while all street routing stays in GraphHopper. The
Parchment server orchestrates access-leg + transit-core + egress-leg composition
so MOTIS never needs an OSM graph.

```
Client
  |
  POST /directions/
  |
  v
TripService.planTrip()
  |
  +---> planModeTrip("walking")  ---> RoutingService ---> GraphHopper
  +---> planModeTrip("driving")  ---> RoutingService ---> GraphHopper
  +---> planModeTrip("biking")   ---> RoutingService ---> GraphHopper
  +---> planModeTrip("transit")  ---> planTransitSegment()
  |        |
  |        +---> TransitRoutingService ---> Barrelman /transit/route ---> MOTIS
  |        +---> RoutingService (walk legs) ---> GraphHopper
  |
  +---> scoreTrip() ---> computeOverallScore(sortPreference)
  |
  v
MultimodalTripResponse  (ranked TripCandidate[])
```

## Data Flow

### 1. Request

`POST /directions/` accepts `TripRequest`:

| Field | Type | Description |
|-------|------|-------------|
| `waypoints` | `Waypoint[]` | Min 2. Each has `location`, optional `departAfter`, `arriveBy`, `dwellTime` |
| `selectedMode` | `SelectedMode` | `multi`, `walking`, `driving`, `biking`, `transit`, `wheelchair` |
| `sortPreference` | `SortPreference?` | `fastest`, `cheapest`, `fewest_transfers`, `least_walking`, `greenest` |
| `routingPreferences` | `RoutingPreferences?` | Per-mode tuning (hills, tolls, maxWalkingDistance, etc.) |
| `availableVehicles` | `Vehicle[]?` | Known vehicle locations for walk-to-vehicle trips |
| `preferredDepartureTime` | `string?` | ISO 8601 departure time |

### 2. Mode Generation

`getModesToGenerate()` maps `selectedMode` to concrete `Mode[]`:

| Selected | Generated Modes |
|----------|----------------|
| `multi` | `walking`, `driving`, `biking`, `transit` |
| `transit` | `transit` |
| `walking` | `walking` |
| `driving` | `walking`, `driving` |
| `biking` | `walking`, `biking` |
| `wheelchair` | `wheelchair` |
| (default) | `walking`, `driving`, `biking` |

### 3. Transit Composition

Transit planning uses two methods:

**`planTransitTrips()`** — multi-candidate generation (used by `planTrip()` for
`transit` / `multi` mode). Requests 5 itineraries from MOTIS, composes each into
a separate `TripResponse` for scoring. Also generates multi-access candidates
(bike+transit, car+transit) when `availableVehicles` are provided.

**`composeTransitItinerary(origin, destination)`** — shared composition logic for
a single itinerary:

1. Send origin/destination to MOTIS via `TransitRoutingService.getTransitRoute()`
2. MOTIS returns itineraries with WALK and transit legs
3. For each WALK leg: re-route via GraphHopper pedestrian for accurate geometry.
   The first walk uses the user's exact origin, and the last walk uses the exact
   destination — MOTIS may snap to nearby stop coordinates which can be off.
4. For each transit leg: build `TripSegment` with `TransitDetails` (route, stops,
   headsign, colors). Geometry is converted from GeoJSON `{type:'LineString',
   coordinates:[[lng,lat],...]}` to `Array<{lat,lng}>` to match GraphHopper format.
5. If GraphHopper fails for a walk leg, fall back to MOTIS straight-line data
6. **Synthesize missing access/egress walks**: MOTIS in transit-only mode with
   stop IDs often omits the access and egress WALK legs (the itinerary starts
   at the boarding stop and ends at the alighting stop). After processing all
   MOTIS legs, if the first segment isn't a walk, an **access walk** from the
   user's origin to the first boarding stop is added via GraphHopper. If the
   last segment isn't a walk, an **egress walk** from the last alighting stop
   to the user's destination is added.
7. Walk timing uses the **actual GraphHopper duration**, not the MOTIS estimate:
   - Access walks: back-calculate start time so the walk ends `buffer` minutes
     before transit departure. Uses `actualDuration + buffer` from the transit
     departure time. MOTIS estimates are only used for the initial GraphHopper
     query timing; the segment is then re-timed with the real duration.
   - Transfer walks: start when the previous transit arrives. If the actual walk
     duration exceeds the available transfer window (i.e. the walk would finish
     after the next transit departs), the itinerary is **infeasible** and is
     discarded (`return []`).
   - All pre-transit walks are extended to fill the gap up to transit departure
     so the timeline shows a continuous bar (wait time absorbed into walk).
   - Buffer is configurable via `transitBufferMinutes` (1-5 min, default 2).
8. Return composed `TripSegment[]`

#### Multi-Access Transit Strategies

After composing walk+transit+walk candidates, `planTransitTrips()` generates
additional candidates using bike or car access when `availableVehicles` are
provided (and `useKnownVehicleLocations` is not `false`):

**`composeTransitWithAccessMode()`** — takes the best MOTIS itinerary and
replaces the access leg with a bike or car route:

1. Extract transit segments from the itinerary (skip WALK legs)
2. Find the first boarding stop location
3. If vehicle is >200m from origin, plan walk → vehicle via GraphHopper pedestrian
4. Plan ride from vehicle (or origin) → boarding stop via GraphHopper bicycle/auto
5. Back-calculate timing: ride must finish `buffer` minutes before transit departure
6. Keep transit segments unchanged from MOTIS
7. Add egress walk from last alighting stop → destination via GraphHopper
8. Validate transfer walks between consecutive transit segments

**Trip patterns generated:**

| Pattern | Access | Transit | Egress | Condition |
|---------|--------|---------|--------|-----------|
| 3.1 | walk | transit | walk | always |
| 3.4 | bike → park | transit | walk | bike in `availableVehicles` |
| 3.7 | car → park | transit | walk | car in `availableVehicles` |

If the vehicle is >200m from the user, a walk-to-vehicle segment is prepended:
walk → vehicle → ride to stop → transit → walk.

**Quality filtering**: transit sub-types (walk+transit, bike+transit, car+transit)
are counted separately in the per-mode cap, so each strategy gets up to 2 slots.
`getTripMode()` returns `'transit'`, `'biking+transit'`, or `'driving+transit'`.

### 4. Time Constraints

`applyWaypointTimeConstraints()` processes per-waypoint timing before each leg:

- **`arriveBy`**: warn if current time exceeds the deadline (does not re-plan)
- **`dwellTime`**: add N minutes to current time (time spent at waypoint)
- **`departAfter`**: push current time forward to the specified departure

Processing order: arriveBy check -> dwellTime -> departAfter. Warnings are
collected into `TripResponse.warnings[]`.

### 5. Scoring

Each trip is scored across five dimensions (0-1, higher is better):

| Dimension | Formula | Notes |
|-----------|---------|-------|
| `time` | `600 / max(600, arrivalOffset)` | Ratio-preserving: ≤10 min → 1.0, 20 min → 0.5, 54 min → 0.185. Uses arrival offset from requested departure so transit waits are penalized. |
| `cost` | `10 / (10 + cost)` | Free = 1.0, $5 = 0.67 |
| `comfort` | 0.6 * walkScore + 0.4 * transferScore | Penalizes >500m walks, >1 transfer |
| `environmental` | `0.25 / (0.25 + totalCO2)` | Walking/biking = 1.0, CO2 in kg |
| `safety` | distance-weighted edge score | From GraphHopper edge data (road class, surface, bike infra) |

**Safety scoring detail**: each edge segment in the trip is scored 0-1 based on
a 0.5 baseline plus deltas from road class, surface, bike infrastructure, road
environment, and smoothness. Scores are distance-weighted across all edges.
Transit segments score 1.0. Segments without edge data use mode defaults
(walking 0.7, biking 0.5, driving 0.6).

| Factor | Best | Worst |
|--------|------|-------|
| Road class | cycleway/footway (+0.4) | motorway (-0.3) |
| Surface | asphalt/paved (+0.1) | mud (-0.2) |
| Bike infra | bike network + high priority (+0.2) | none (0) |
| Road environment | road (0) | tunnel (-0.1) |
| Smoothness | excellent (+0.1) | horrible (-0.2) |

The `overall` score uses balanced weights (time-dominant so faster trips win):

| time | cost | comfort | environmental | safety |
|------|------|---------|---------------|--------|
| 0.45 | 0.10 | 0.15 | 0.15 | 0.15 |

All named sort preferences use **direct ranking** — the primary metric
determines order, with the balanced score as a tiebreaker (scaled by 0.001
so it never overrides the primary sort):

**`shortest`** ranks by `totalDuration` via `rankByDuration()`.

**`cheapest`** ranks by `totalCost` via `rankByCost()`.

**`earliest_arrival`** ranks by absolute arrival time (the `endTime` of the
last segment) via `rankByArrivalTime()`.

**`greenest`** ranks by `totalCo2` (kg) via `rankByCo2()`.

**`fewest_transfers`** ranks by `totalTransfers` count via `rankByTransfers()`.

**`least_walking`** ranks by `totalWalkingDistance` (meters) via
`rankByWalkingDistance()`.

### Quality Filtering

`filterQualityTrips()` enforces three rules in order:

1. **Quality floor** — trips under 60 min are always kept; longer trips are
   dropped if they exceed 4× the shortest candidate's duration.
2. **Per-mode cap** — max 2 trips per mode for variety. Transit trips are
   capped by earliest arrival time (not score order), since scheduled
   departure times make arrival time more important than trip duration.
3. **Near-duplicate** — same-mode trips within 5% duration of an already-kept
   trip are dropped.

## Service Architecture

### TransitRoutingService (`transit-routing.service.ts`)

Bridges the integration system to the `TransitRoutingCapability`:

- `getTransitRoute(request)` — delegates to highest-priority TRANSIT_ROUTING integration
- `getNearbyStops(request)` — spatial stop lookup
- `getRoutesForStop(feedId, stopId)` — routes serving a stop
- `isTransitRoutingAvailable()` — capability check

Uses the same `integrationManager.getConfiguredIntegrationsByCapability()` pattern
as `RoutingService`.

### BarrelmanIntegration

Registers `TRANSIT_ROUTING` capability alongside existing capabilities. Three
methods proxy to Barrelman's REST API:

- `POST /transit/route` — MOTIS transit routing
- `GET /transit/stops?lat=&lng=&radius=` — nearby stops (PostGIS)
- `GET /transit/routes?feedId=&stopId=` — routes for a stop

### MOTIS (via Barrelman)

MOTIS runs in transit-only mode (`street_routing: false`). Barrelman proxies
requests to MOTIS's OTPAPI v2 endpoint (`GET /api/v1/plan`).

GTFS data pipeline:

```
Transitland API --> download GTFS ZIPs
  --> parse stops/routes into PostGIS
  --> compute walking transfers via GraphHopper point-to-point
  --> inject per-feed transfers.txt (filtered to same-feed stop pairs)
  --> feed processed GTFS to MOTIS
```

**Polyline precision**: MOTIS v2 encodes `legGeometry.points` with precision 7
(`1e7`), not the Google Maps standard precision 5. Barrelman's `decodePolyline()`
defaults to precision 7.

**Per-feed transfers**: `transfers.txt` is generated per-feed, filtering to stop
pairs where both stops belong to the same feed. This prevents cross-agency stop ID
collisions when MOTIS loads multiple feeds.

**Flex v2 incompatibility**: GTFS-Flex v2 feeds crash MOTIS and must be excluded.

## Cost & CO2 Factors

**Driving cost**: fuel-only estimate based on average US gas price (~$3.50/gal)
and average fuel efficiency (~25 MPG). `$0.000087/meter` ≈ $0.087/km ≈ $0.14/mi.

**Transit cost**: from GTFS fare data via MOTIS. MOTIS reads `fare_attributes.txt`
and `fare_rules.txt` from the GTFS feeds and returns the itinerary-level fare,
which already accounts for transfer rules (e.g. free transfers within a time
window). Agencies without fare data in their GTFS feeds show no price.

**Transit distance**: MOTIS often returns `distance: 0` for transit legs. The
server computes distance from the polyline geometry via Haversine when this
happens, so CO2 calculations are always based on real distance.

| Mode | kg CO2 / meter | Cost / meter |
|------|--------------|-------------|
| Walking | 0 | $0 |
| Cycling | 0 | $0.000031 (~$0.05/mi maintenance) |
| Transit | 0.00005 (~0.05 kg/km) | from GTFS fare data |
| Driving | 0.00024 (~0.24 kg/km) | $0.000087 (~$0.087/km) |

## Key Types

- `TripRequest` / `TripResponse` — request/response envelope
- `TripSegment` — one leg of a trip (walking, transit, etc.)
- `TransitDetails` — transit-specific metadata on a segment
- `TripWarning` — time constraint violations
- `TripScore` — multi-dimensional scoring (overall, time, cost, comfort, environmental, safety)
- `SortPreference` — user's preferred ranking dimension
- `TransitRouteRequest` / `TransitRouteResponse` — MOTIS request/response (via integration)

See `server/src/types/trip.types.ts` and `server/src/types/integration.types.ts`.
