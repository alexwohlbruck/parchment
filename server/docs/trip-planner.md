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

`planTransitSegment()` builds a complete walk+transit+walk trip:

1. Send origin/destination to MOTIS via `TransitRoutingService.getTransitRoute()`
2. MOTIS returns itineraries with WALK and transit legs
3. For each WALK leg: re-route via GraphHopper pedestrian for accurate geometry
4. For each transit leg: build `TripSegment` with `TransitDetails` (route, stops, headsign, colors)
5. If GraphHopper fails for a walk leg, fall back to MOTIS straight-line data
6. Return composed `multimodalSegments[]`

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
| `time` | `600 / (600 + duration)` | 10 min trip = 1.0 |
| `cost` | `1 / (1 + cost)` | Free = 1.0 |
| `comfort` | 0.6 * walkScore + 0.4 * transferScore | Penalizes >500m walks, >1 transfer |
| `environmental` | `250 / (250 + totalCO2)` | Walking/biking = 1.0 |
| `safety` | 0.5 (placeholder) | Future: from GraphHopper edge data |

The `overall` score is a weighted combination based on `sortPreference`:

| Preference | time | cost | comfort | environmental | safety |
|-----------|------|------|---------|---------------|--------|
| `fastest` | 0.70 | 0.05 | 0.10 | 0.05 | 0.10 |
| `cheapest` | 0.15 | 0.55 | 0.10 | 0.10 | 0.10 |
| `fewest_transfers` | 0.15 | 0.05 | 0.60 | 0.10 | 0.10 |
| `least_walking` | 0.10 | 0.05 | 0.65 | 0.10 | 0.10 |
| `greenest` | 0.10 | 0.05 | 0.10 | 0.65 | 0.10 |
| (default) | 0.40 | 0.10 | 0.20 | 0.15 | 0.15 |

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
  --> inject transfers.txt into each feed
  --> feed processed GTFS to MOTIS
```

## CO2 Emission Factors

| Mode | g CO2 / meter |
|------|--------------|
| Walking | 0 |
| Cycling | 0 |
| Transit | 0.05 (~50g/km) |
| Driving | 0.24 (~240g/km) |

## Key Types

- `TripRequest` / `TripResponse` — request/response envelope
- `TripSegment` — one leg of a trip (walking, transit, etc.)
- `TransitDetails` — transit-specific metadata on a segment
- `TripWarning` — time constraint violations
- `TripScore` — multi-dimensional scoring (overall, time, cost, comfort, environmental, safety)
- `SortPreference` — user's preferred ranking dimension
- `TransitRouteRequest` / `TransitRouteResponse` — MOTIS request/response (via integration)

See `server/src/types/trip.types.ts` and `server/src/types/integration.types.ts`.
