# Parchment Trip Planner — System Review

> **Status: historical snapshot.** This review describes the system as of June 2026,
> *before* the consolidation it recommended. Since then, on this branch:
> the legacy federated transit path (Path B, ~1,500 lines) was **deleted** — MOTIS
> intermodal is the sole transit planner; the `MOTIS_INTERMODAL_ENABLED` flag is gone;
> the rideshare `isAvailable()` typo (C1) is fixed and rideshare+transit variants are
> now derived from intermodal results; vehicle-access queries gained origin→vehicle
> walk legs, `useKnownVehicleLocations`/`maxWalkingDistance` handling, and
> `parkedVehicles` tracking. Line numbers and the two-path architecture described
> below no longer match the code — read this for the *why* behind the consolidation,
> not as a map of the current source.

A code-grounded walkthrough of the multimodal trip planner, end to end, followed by a
critical review. Every claim below is traced to a specific file and line.

Primary file under review: [`server/src/services/trip.service.ts`](../server/src/services/trip.service.ts) (4,262 lines at time of review).

> **Two findings up front that reframe everything:**
>
> 1. **`MOTIS_INTERMODAL_ENABLED` defaults to `true`** (`docker-compose.dev.yml:66` →
>    `${MOTIS_INTERMODAL_ENABLED:-true}`). The **intermodal** transit path is the *active*
>    path. The entire **federated** path — `planTransitTrips`, `composeTransitWithAccessAndEgress`,
>    `buildAccessLeg`/`buildEgressLeg`, `insertTransferWalks`, and **all three entrance-snapping
>    call sites** — is **dead code in the default configuration** (~1,500 lines).
> 2. **`rideshareService.isAvailable()` does not exist** (only `isRideshareAvailable()` does).
>    It's called at `trip.service.ts:1837` inside a `try/catch {}`, so **rideshare+transit combos
>    are silently broken in the default (intermodal) path.**

---

## 1. System Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ BROWSER (Vue 3 + Pinia)                                                            │
│                                                                                    │
│  directions.store.ts                      directions.service.ts                    │
│  • waypoints[], selectedMode              • getRequestKey() dedup                   │
│  • general + per-mode prefs   ──watch──▶  • builds POST body                        │
│  • routingPreferences (merged)            • flattenSegments() → UI shape            │
│  • sortPreference, departureTime          • normalizeMode() biking→cycling         │
└───────────────────────────────────────────────────┬──────────────────────────────┘
                                                     │ POST /directions/
                                                     ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│ PARCHMENT SERVER (Bun + Elysia, :5000)                                            │
│                                                                                    │
│  directions.controller.ts                                                          │
│  • TypeBox schema validation (TripRequestSchema)                                   │
│  • injects i18n language, requestId, timestamp                                     │
│  • multimodalTripService.planTrip(request)   ← alias of tripService (4262)         │
│                                │                                                   │
│                                ▼                                                   │
│  trip.service.ts  ── THE ORCHESTRATOR ──                                           │
│  planTrip(44): getModesToGenerate → Promise.all(mode planners) →                   │
│                parking variants → score → rank → filterQualityTrips                │
│        │                    │                      │                               │
│        │ street modes       │ transit              │ rideshare                     │
│        ▼                    ▼                      ▼                               │
│  routing.service.ts   transit-routing.service.ts   rideshare.service.ts            │
│  (ROUTING cap.)       (TRANSIT_ROUTING cap.)       (RIDESHARE_ESTIMATE cap.)        │
│        │                    │                      │                               │
│        └──────────┬─────────┴──────────────┬───────┘                               │
│                   ▼                         ▼                                       │
│        integrationManager (capability lookup, highest-priority instance)           │
│                   │                         │                                       │
│        barrelman-integration.ts             uber/lyft integration                  │
│        (ROUTING + TRANSIT_ROUTING)          (axios → provider APIs)                 │
│                   │                                                                 │
│   also: trip.service reaches PAST the capability layer and does raw fetch()        │
│   to Barrelman for GBFS (3319) and bikes-allowed (3358) using the integration's    │
│   host/apiKey pulled from integrationManager.getConfiguredIntegrations().          │
└───────────────────┬────────────────────────────────────────────────────────────┘
                    │ axios (host + Bearer apiKey)
                    ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│ BARRELMAN (geospatial engine, :5001)                                              │
│   POST /route                  → GraphHopper (street routing, edge metadata)       │
│   POST /transit/route          → MOTIS transit-only (RAPTOR)                        │
│   POST /transit/intermodal-route → MOTIS w/ OSM (walk/bike/car/rental access)       │
│   GET  /transit/nearest-entrance → PostGIS 5-tier entrance search                  │
│   GET  /transit/bikes-allowed    → GTFS bikes_allowed lookup                        │
│   GET  /gbfs/nearby-stations     → real-time shared-mobility availability           │
│   POST /search                   → OSM category search (parking, rental docks)      │
│        │                         │                                                  │
│        ▼                         ▼                                                  │
│   GraphHopper (CH)          MOTIS (RAPTOR + OSM street graph)                       │
└──────────────────────────────────────────────────────────────────────────────────┘
```

**Note on the proxy controller:** `server/src/controllers/proxy.controller.ts` (the
authenticated `/proxy/transit/*` Barrelman proxy) is **not** in the trip-planning path. It
serves the *client's* live-vehicle map layers. Trip planning calls Barrelman **server-side**
through the integration's own `axios` client.

### HTTP call chain for one `selectedMode: 'multi'` request (intermodal default, no vehicles)

```
POST /directions/                                              (1 client→server)
 ├─ walking   → routing.getRoute(pedestrian)  → Barrelman POST /route     (1)
 ├─ driving   → routing.getRoute(auto)        → Barrelman POST /route     (1)
 ├─ biking    → routing.getRoute(bicycle)     → Barrelman POST /route     (1)
 ├─ transit   → planIntermodalTransitTrips
 │     └─ Query 1 (WALK + RENTAL) → Barrelman POST /transit/intermodal-route (1)
 │     └─ planRideshareTransitCombos → THROWS on isAvailable() → swallowed  (0)
 └─ rideshare → getEstimates (per provider) + 1 /route per product for geometry
```

Floor is ~4–5 upstream calls. Add a car → +1 MOTIS query; add a bike → +1; turn on
`useKnownParkingLocations` → +2 OSM searches and up to **18** GraphHopper calls (see §10).

---

## 2. The Main Entry Point: `planTrip()` (line 44)

```
planTrip(request)                                                       [44]
  │
  ├─1 validateRequest(request)                                          [46, 4244]
  │     • ≥2 waypoints, each with numeric lat/lng (throws otherwise)
  │
  ├─2 modes = getModesToGenerate(request.selectedMode)                  [52, 178]
  │
  ├─3 useParking = prefs.useKnownParkingLocations                       [58]
  │     parkingVehicleModes = {driving,biking} if useParking else {}    [59]
  │     (vehicle modes are REPLACED by parking-aware variants, not added)
  │
  ├─4 Promise.all over modes \ parkingVehicleModes:                     [64-85]
  │     transit  → planIntermodalTransitTrips | planTransitTrips        [68-72]
  │                (chosen by MOTIS_INTERMODAL_ENABLED === 'true')
  │     rideshare → planRideshareTrips                                  [73]
  │     else     → planModeTrip(mode)  → [trip] | []                    [76]
  │     (each wrapped in try/catch → [] on failure)                    [79-82]
  │
  ├─5 if useParking: planDrivingWithParkingTrip + planBikingWithParkingTrip [93-113]
  │     (run in parallel, pushed to candidates)
  │
  ├─6 referenceTime = preferredDepartureTime || now()                   [118]
  │     scored = candidates.map(scoreTrip + computeOverallScore)        [121-131]
  │
  ├─7 sortPreference switch → rankByXxx() OVERWRITES score.overall      [136-155]
  │     (only "balanced"/default skips this and keeps weighted overall)
  │
  ├─8 sort by score.overall desc                                        [157]
  │
  ├─9 filterQualityTrips(sorted)  → assign rank = index+1               [160-161, 3649]
  │
  └─ return { request, trips, metadata{totalCandidatesGenerated,        [163-171]
              processingTime, dataSourcesUsed} }
```

Key design notes:
- **All modes run concurrently** (`Promise.all`, line 85). Parking variants run in a second
  concurrent batch (line 112) *after* the first completes — a small serialization point.
- **`dataSources` is a single shared array** mutated by every planner concurrently (passed by
  reference into each). Works only because pushes are append-only and JS is single-threaded.
- Named sort preferences don't reweight — they **replace** `overall` with a normalized primary
  metric plus `balanced * 0.001` as tiebreaker (§7).

---

## 3. Mode Generation Map

`getModesToGenerate` (line 178) maps `selectedMode` → base modes:

| selectedMode | Modes generated | Source |
|---|---|---|
| `multi` | walking, driving, biking, transit (+rideshare if configured) | 181-186 |
| `walking` | walking | 187 |
| `driving` | walking, driving | 189 |
| `biking` | walking, biking | 191 |
| `transit` | transit | 193 |
| `wheelchair` | wheelchair | 195 |
| `rideshare` | rideshare (if configured) | 197 |
| *(default)* | walking, driving, biking | 200 |

Then each base mode expands into concrete trip patterns:

| # | Pattern | Generating function | Access | Transit | Egress | Path |
|---|---|---|---|---|---|---|
| 1.0 | Direct walk | `planWalkingSegment` (393) | — | — | — | both |
| 1.1 | Direct bike | `planDirectBike` (1357) | — | — | — | both |
| 1.2 | Direct drive | `planDirectDrive` (639) | — | — | — | both |
| 1.3 | Wheelchair | `planWheelchairSegment` (458) | — | — | — | both |
| 2.0 | Walk→car→drive | `planDrivingSegment` (518) | walk | — | — | known vehicle loc |
| 2.1 | Walk→bike→ride | `planBikingSegment` (1244) | walk | — | — | known vehicle loc |
| 2.2 | Drive→park→walk | `planDrivingWithParkingTrip` (719) | (walk→)drive | — | walk | useKnownParking |
| 2.3 | Bike→park→walk | `planBikingWithParkingTrip` (978) | (walk→)bike | — | walk | useKnownParking |
| R.0 | Standalone rideshare | `planRideshareTrips` (1435) | — | — | — | rideshare avail. |
| **Intermodal (Path A — default)** ||||||
| I.1 | WALK access + WALK/RENTAL egress | `planIntermodalTransitTrips` Q1 (1592) | WALK | MOTIS | WALK/RENTAL | intermodal |
| I.2 | CAR_PARKING (park & ride) | Q2 if car (1608) | CAR_PARKING | MOTIS | WALK | intermodal |
| I.3 | BIKE access | Q3 if bike (1629) | BIKE | MOTIS | WALK | intermodal |
| I.4 | rideshare→transit→walk | `planRideshareTransitCombos` (1854) | rideshare | MOTIS | walk | **BROKEN** ⚠ |
| I.5 | walk→transit→rideshare | `planRideshareTransitCombos` (1863) | walk | MOTIS | rideshare | **BROKEN** ⚠ |
| **Federated (Path B — flag off only)** ||||||
| 3.1 | walk→transit→walk | `composeTransitItinerary` (2931) | walk | MOTIS | walk | federated |
| 3.2 | walk→transit→shared bike | `composeTransitWithAccessAndEgress` (2045) | walk | MOTIS | shared-bike | federated |
| 3.4 | bike→park→transit→walk | …WithAccessAndEgress (1982) | bike | MOTIS | walk | fed + bike loc |
| 3.5 | walk→transit→shared scooter | …WithAccessAndEgress (2059) | walk | MOTIS | shared-scooter | federated |
| 3.6 | bike→transit(carry)→bike | …WithAccessAndEgress (2002) | bike(carry) | MOTIS | bike | fed + bike loc |
| 3.7 | car→park→transit→walk | …WithAccessAndEgress (2023) | drive+park | MOTIS | walk | fed + car loc |
| 3.8 | rideshare→transit→walk | …WithAccessAndEgress (2076) | rideshare | MOTIS | walk | fed + rideshare |
| 3.9 | walk→transit→rideshare | …WithAccessAndEgress (2084) | walk | MOTIS | rideshare | fed + rideshare |
| 3.10 | rideshare→transit→rideshare | …WithAccessAndEgress (2093) | rideshare | MOTIS | rideshare | fed + rideshare |
| 3.11 | rideshare→transit→shared bike | …WithAccessAndEgress (2102) | rideshare | MOTIS | shared-bike | fed + rideshare |
| 3.12 | rideshare→transit→shared scooter | …WithAccessAndEgress (2111) | rideshare | MOTIS | shared-scooter | fed + rideshare |

**Pattern 3.3 does not exist** in the code (the comments jump 3.2 → 3.4).

⚠ **Via-waypoints are dropped for every multi-leg pattern.** Only `planModeTrip` (1.x/2.0/2.1)
iterates `request.waypoints` (loop at line 227). Transit (1561), rideshare (1439), and parking
(723, 982) read only `waypoints[0]` and `waypoints[last]`. A trip with an intermediate stop +
transit silently ignores the stop.

---

## 4. The Two Transit Code Paths

```
                    planTrip → mode === 'transit'  (line 68)
                                   │
              MOTIS_INTERMODAL_ENABLED === 'true' ?  (line 69)
                    │ YES (DEFAULT)                 │ NO / unset
                    ▼                               ▼
        ┌───────────────────────────┐   ┌──────────────────────────────────────┐
        │ PATH A: INTERMODAL        │   │ PATH B: FEDERATED                     │
        │ planIntermodalTransitTrips│   │ planTransitTrips (1877)               │
        │ (1555)                    │   │                                       │
        │                           │   │ 1 MOTIS /transit/route, 5 itineraries │
        │ skip if dist < 1500m(1568)│   │   ↓ for each itinerary:               │
        │ scale searchWindow & walk │   │ composeTransitItinerary (2931):       │
        │   radius to distance      │   │   • each MOTIS walk leg → GraphHopper │
        │                           │   │   • entrance-snap walks adjacent to   │
        │ 1–3 PARALLEL MOTIS queries│   │     stations (2987, 3013)             │
        │   Q1 WALK + RENTAL  (1592)│   │   • synthesize missing access/egress  │
        │   Q2 CAR_PARKING    (1608)│   │     walks (3126)                      │
        │   Q3 BIKE           (1629)│   │                                       │
        │                           │   │ THEN on bestItinerary[0] only:        │
        │ MOTIS returns REAL OSM    │   │ up to ~10 composeTransitWith-         │
        │ geometry for walk/bike/car│   │   AccessAndEgress() variants (1982-   │
        │   → adaptIntermodalLeg    │   │   2118): patterns 3.2,3.4-3.12        │
        │   (1730) maps directly,   │   │                                       │
        │   NO GraphHopper,         │   │ buildAccessLeg (2335) +               │
        │   NO entrance snapping    │   │ buildEgressLeg (2578) +               │
        │                           │   │ insertTransferWalks (2837)            │
        │ + planRideshareTransit-   │   │   ← entrance snapping lives here      │
        │   Combos (1827) ⚠ BROKEN  │   │                                       │
        └───────────────────────────┘   └──────────────────────────────────────┘
```

### What each path uniquely handles

| Concern | Path A (intermodal) | Path B (federated) |
|---|---|---|
| Walk/bike/car geometry | MOTIS OSM (native, accurate) | GraphHopper replacement of MOTIS straight-lines |
| Station entrance snapping | **none** | yes (3 call sites) |
| Shared bike/scooter egress | RENTAL leg from MOTIS GBFS | manual GBFS + OSM fallback (`buildEgressLeg`) |
| Park-and-ride | CAR_PARKING mode | manual OSM parking search in `buildAccessLeg` |
| Bike carry-on (`bikes_allowed` check) | **not enforced** | `checkBikesAllowed` (3358) |
| Rideshare + transit | broken (`isAvailable` typo) | 5 patterns (3.8–3.12), works |
| Transfer-feasibility rejection | trusts MOTIS | `insertTransferWalks` returns null if walk overruns |
| HTTP calls per request | ~1–3 | ~60–110 (see §10) |

**The paths are not redundant — they have a partial XOR of features.** Intermodal has accurate
native geometry but loses entrance snapping, bikes-allowed enforcement, and (currently) working
rideshare combos. Federated has all the composition features but inaccurate fallback geometry and
10× the HTTP cost. Neither is a strict superset, which is why both still exist.

---

## 5. `composeTransitWithAccessAndEgress()` Deep Dive (line 2156)

The federated workhorse. One function: entrance snapping + access leg + egress leg + parking
search + GBFS lookup + transfer walks + stats. Flow:

```
composeTransitWithAccessAndEgress(itinerary, startTime, origin, dest, access, egress, prefs, ds)
  │
  ├─1 Extract transit core                                              [2173-2191]
  │     for leg in itinerary.legs where leg.transitLeg:
  │       buildTransitSegment(leg) → transitSegments[]
  │     if carryOnTransit: mark seg.carryingVehicle = true              [2184]
  │     return null if no transit legs
  │
  ├─2 Bike carry-on gate                                                [2195-2204]
  │     if access.carryOnTransit: checkBikesAllowed(routeIds) else null
  │     (HTTP GET Barrelman /transit/bikes-allowed; allow-by-default on error)
  │
  ├─3 Entrance snapping (PARALLEL)                                      [2213-2224]
  │     Promise.all([
  │       getNearestEntrance(firstTransit.start, 300m),   ← boarding
  │       getNearestEntrance(lastTransit.end,   300m),    ← alighting
  │     ])
  │     boardingStop/alightingStop = entrance ?? centroid              [2226-2236, 2261-2271]
  │
  ├─4 buildAccessLeg(origin → boardingStop, access, …)                 [2239, 2335]
  │     walking   → [] (handled later by transfer/synthesis)
  │     rideshare → cheapest estimate, back-timed from departure
  │     bike/car  → [walk-to-vehicle?] + ride; if driving+searchParking:
  │                 searchNearbyParking + walk-from-lot; returns parkedVehicle
  │     ← back-calculates timing so user arrives buffer-min before departure
  │
  ├─5 push transit core                                                [2258]
  │
  ├─6 buildEgressLeg(alightingStop → dest, egress, …)                  [2274, 2578]
  │     walking        → planWalkingSegmentForTransit
  │     biking         → bicycle route (carried/personal)
  │     shared-bike/   → fetchGbfsNearbyStations (real-time) OR OSM
  │       -scooter        category search → walk-to-station + ride
  │     rideshare      → cheapest estimate
  │     (any failure   → walking fallback)
  │
  ├─7 insertTransferWalks(segments, prefs)                             [2287, 2837]
  │     between consecutive transit legs:
  │       entrance-snap BOTH ends (PARALLEL getNearestEntrance)        [2855]
  │       if dist > 50m: plan walk; if walkEnd > nextDeparture → null  [2888]
  │     ← whole itinerary rejected if any transfer infeasible
  │
  └─8 index segments, calculateStats, apply itinerary.fare             [2294-2319]
```

### Access × Egress mode matrix

Access modes (`buildAccessLeg`, 2335) and egress modes (`buildEgressLeg`, 2578) are
*independent* — the function accepts any pairing, but `planTransitTrips` only instantiates a
curated subset:

| Access ↓ \ Egress → | walking | shared-bike | shared-scooter | rideshare | biking |
|---|---|---|---|---|---|
| **walking** | 3.1 | 3.2 | 3.5 | 3.9 | — |
| **biking** (park) | 3.4 | — | — | — | — |
| **biking** (carry) | — | — | — | — | 3.6 |
| **driving** (park) | 3.7 | — | — | — | — |
| **rideshare** | 3.8 | 3.11 | 3.12 | 3.10 | — |

`buildAccessLeg` supports walking / rideshare / biking / driving (with optional park-and-ride);
`buildEgressLeg` supports walking / biking / shared-bike / shared-scooter / rideshare. The matrix
is sparse because only sensible pairings are enumerated, not because of code limits.

**Gap:** pattern 3.4 ("bike → park → transit") never actually parks the bike — `buildAccessLeg`
only searches parking when `access.mode === 'driving'` (2424). A bike access just rides to the
stop; the bike is not docked or tracked.

---

## 6. Station Entrance Snapping

Replaces station centroids with real entrance/access-point coordinates so walking directions go
to the actual door/stairs, not the middle of the platform.

```
OSM tags (railway=subway_entrance, entrance=yes, highway=steps/elevator, railway=crossing,
          highway=crossing) + public_transport=platform
   │  ingested by osm2pgsql into geo_places (PostGIS, GIN/GiST indexed)
   ▼
Barrelman getNearestEntrance(lat, lon, maxDistanceM=500)   [station.service.ts:137]
   │  • platform proximity pre-check (skip tiers 2/3/5 if no platform nearby)  [150]
   │  • single CTE, 5 tiers UNION ALL, WHERE tier = MIN(tier), ORDER BY distance_m LIMIT 1
   │    Tier 1: railway=subway_entrance / train_station_entrance       [161]
   │    Tier 2: entrance=yes/main within ~100m of platform             [177]
   │    Tier 3: highway=steps/elevator within ~150m of platform        [199]
   │    Tier 4: railway=crossing                                       [223]
   │    Tier 5: highway=crossing within ~40% radius of platform        [240]
   ▼  HTTP GET /transit/nearest-entrance
barrelman-integration.getNearestEntrance (898)  → StationEntrance | null (404/error → null)
   ▼  capability
transit-routing.service.getNearestEntrance (80)  → null-safe wrapper
   ▼
trip.service applies at 3 sites (FEDERATED PATH ONLY):
   • composeTransitWithAccessAndEgress  boarding+alighting  [2213]
   • insertTransferWalks                transfer endpoints  [2855]
   • composeTransitItinerary            walks touching a station  [2987, 3013]
   • buildWalkingFallbackSegment        accepts snapped waypoints [3512]
```

Coordinate replacement is a straight field swap: `{ lat: entrance.lat, lng: entrance.lon }`
(note the `lon`→`lng` rename, e.g. 2228). Label falls back `name → description → original`.

**Critical:** all snapping sites are in **Path B**. In the default intermodal config,
`adaptIntermodalLeg` (1730) maps MOTIS coordinates verbatim — **entrance snapping never runs.**
The whole subsystem (Barrelman SQL, the capability, 3 call sites) is invested in a path that's
off by default.

**No caching** anywhere (confirmed: `barrelman-integration.getNearestEntrance` does a fresh
`axios.get` each call). In federated mode the same boarding/alighting entrances are re-queried
across ~10 compositions all built on `bestItinerary[0]`.

---

## 7. Scoring System

`scoreTrip` (3799) computes 5 dimensions, each normalized to [0,1] where 1 is best.

| Dimension | Weight | Formula | Code | Examples |
|---|---|---|---|---|
| **time** | 0.45 | `600 / max(600, effective)` where `effective = max(arrivalOffset, duration)` | 3818 | 10min→1.0, 20min→0.5, 54min→0.185 |
| **cost** | 0.10 | `cost≤0 ? 1 : 10/(10+cost)` | 3837 | free→1.0, $2→0.83, $10→0.50 |
| **comfort** | 0.15 | pure walk/bike→1; else `walkScore*0.6 + transferScore*0.4` where `walkScore=500/(500+walkDist)`, `transferScore=1/(1+transfers*0.5)` | 3852 | 0 transfer/0m→1.0; 500m/1xfer→0.5·0.6+0.67·0.4 |
| **environmental** | 0.15 | `co2≤0 ? 1 : 0.25/(0.25+co2kg)` | 3875 | walk→1.0, ~1km drive(0.24kg)→0.51 |
| **safety** | 0.15 | distance-weighted Σ(edgeScore·len)/Σlen; transit=1.0; no-edge→mode default | 3896 | cycleway→0.9, motorway→0.2 |

`computeOverallScore` (4204) = Σ dimension·weight using `getScoreWeights` (4228).

**`time` weight (0.45) dominates** so a fast mode almost always wins balanced mode; the
ratio-preserving formula keeps duration ratios intact (5.4× slower → 5.4× lower time score).

### Safety edge model (3896–4020)

Per edge: baseline `0.5` + `ROAD_CLASS_SAFETY[roadClass]` (cycleway +0.4 … motorway −0.3) +
`SURFACE_SAFETY[surface]` (asphalt +0.1 … mud −0.2) + bike-infra bonus (`bikeNetwork` +0.1,
`bikePriority>0.5` +0.1, walk/bike only) + environment penalty (tunnel −0.1, ferry −0.05) +
`SMOOTHNESS_SAFETY` (non-driving only), clamped [0,1], weighted by edge length. Transit legs
score 1.0; segments without `edgeSegments` use `MODE_SAFETY_DEFAULTS` (walk 0.7, bike 0.5,
drive 0.6, transit 1.0).

### Balanced vs. direct ranking

```
sortPreference?
  (none/"balanced") → overall = weighted Σ (above)
  earliest_arrival  → rankByArrivalTime (4026)
  shortest          → rankByDuration    (4146)
  cheapest          → rankByCost        (4175)
  greenest          → rankByCo2         (4060)
  fewest_transfers  → rankByTransfers   (4088)
  least_walking     → rankByWalkingDistance (4117)
```

Every `rankByXxx` min-max normalizes its metric across candidates to `primary ∈ [0,1]`, then sets
`overall = primary + balanced * 0.001` (e.g. 4052) — so the balanced score is a **tiebreaker only**
(scaled 1000× down). Final `sort` is always by `overall` desc (157).

---

## 8. Quality Filtering — `filterQualityTrips` (3649)

```
if sorted.length ≤ 2 → return as-is                                    [3652]
shortestDuration = min(totalDuration)                                  [3654]

PRE-PASS A: transitPreferred set                                       [3661-3681]
  group transit candidates by sub-type (getTripMode → "walk+transit",
  "biking+transit", "driving+transit", or "transit"); within each sub-type
  keep the MAX_PER_MODE (2) EARLIEST-ARRIVING (by last segment endTime)

PRE-PASS B: bestPerMode set                                            [3685-3693]
  first candidate seen for each mode (sorted is already score-desc)

MAIN PASS over sorted:                                                 [3698-3731]
  1. Quality floor: skip if dur > 60min AND dur > 4×shortest AND not bestPerMode  [3706]
  2. Per-mode cap: skip if modeCount[mode] ≥ 2                         [3717]
  3. Transit gate: skip transit not in transitPreferred               [3718]
  4. Near-dup: skip if same mode & duration within ±5% of a kept trip [3721]
  keep; stop at MAX_TRIPS = 15                                         [3730]
```

`getTripMode` (3745): transit trips sub-typed by first non-walk/non-transit segment
(`"{mode}+transit"`); non-transit trips return their longest-duration mode.

**Interaction wart:** PRE-PASS A always orders transit by *earliest arrival* regardless of the
user's `sortPreference`. A user sorting by "cheapest" still has transit variants pre-filtered by
arrival time, so the cheapest transit option can be dropped before it's ever ranked.

---

## 9. Data Types & Response Shape

```
TripRequest                                              [trip.types.ts:60]
 ├ waypoints: Waypoint[]            (location, type, departAfter/arriveBy/dwellTime, place?)
 ├ selectedMode: SelectedMode       (multi|walking|driving|biking|transit|wheelchair|rideshare)
 ├ sortPreference: SortPreference   (shortest|earliest_arrival|cheapest|fewest_transfers|
 │                                   least_walking|greenest)
 ├ routingPreferences: RoutingPreferences  (range floats + booleans + transit + maxWalkingDistance…)
 ├ availableVehicles: Vehicle[]     (type, energyType, location?)
 ├ knownAccessPoints: AccessPoint[] (declared, NEVER consumed in trip.service)
 └ preferredDepartureTime / preferredArrivalTime / language

MultimodalTripResponse                                   [trip.types.ts:490]
 ├ request
 ├ trips: TripCandidate[]
 │   ├ trip: TripResponse
 │   │   ├ segments: TripSegment[]
 │   │   │   ├ mode, start/end: Waypoint, startTime/endTime
 │   │   │   ├ duration(s), distance(m), geometry, instructions[]
 │   │   │   ├ cost?, co2?(grams), vehicle?, carryingVehicle?, ownership?
 │   │   │   ├ details?: { transitDetails | rideshareDetails | vehicleDetails |
 │   │   │   │            sharedMobilityDetails | multimodalSegments }
 │   │   │   ├ edgeSegments?: RouteEdgeSegment[]   (road metadata → safety)
 │   │   │   └ totalElevationGain/Loss, max/minElevation
 │   │   ├ tripStats: { totalDuration, totalDistance, totalCost?, totalCo2?,
 │   │   │             totalWalkingDistance?, totalTransfers? }       [calculateStats, 3595]
 │   │   ├ earliestStartTime, latestEndTime, warnings?, parkedVehicles?
 │   ├ score: TripScore { overall, time, cost, comfort, environmental, safety }
 │   └ rank: number
 └ metadata: { totalCandidatesGenerated, processingTime, dataSourcesUsed }
```

Frontend (`directions.service.ts`) flattens this: `flattenSegments` (249) expands
`details.multimodalSegments`, `mapSegment` (217) + `extractTransitFields` (191) hoist transit
fields, `normalizeMode` (176) maps `biking→cycling`. UI shape diverges from server shape here.

---

## 10. Critical Review

### A. Complexity

1. **One 4,262-line class doing eight jobs.** `TripService` owns request validation, mode
   expansion, street routing, parking search, two transit pipelines, leg composition, GBFS,
   rideshare, scoring (5 dimensions + 6 rankers), and quality filtering. Natural extractions:
   `TransitComposer` (Path B), `Scorer` (3774–4239 is self-contained and pure), `QualityFilter`
   (3632–3772, pure), `ParkingPlanner` (699–1199). The scoring and filtering modules are already
   side-effect-free and could be lifted with zero behavior change and become unit-testable.

2. **Two transit paths are not sustainable — and today only one runs.** With the flag defaulting
   true, **Path B (~1,500 lines) is dead in every default deployment.** It is carrying real
   features that Path A lacks (entrance snapping, bikes-allowed, working rideshare combos), so it
   can't simply be deleted — but it's also not being exercised, so it will rot. This is the single
   biggest structural risk: a large, feature-rich, untested-in-practice code path that the team
   believes is a "fallback" but is actually the only place several features live.

3. **The 12-pattern manual enumeration is largely obsoleted by intermodal — except rideshare.**
   `planTransitTrips` enumerates 3.1–3.12 by hand. Intermodal collapses walk/bike/car/rental
   access+egress into 1–3 MOTIS queries. The *only* thing intermodal can't do is rideshare
   (not a MOTIS-routable mode). So the entire `buildAccessLeg`/`buildEgressLeg`/`composeTransit-
   WithAccessAndEgress` apparatus exists, in the default config, **solely to serve two rideshare
   patterns that are currently broken** (see C1).

4. **`composeTransitWithAccessAndEgress` has too many responsibilities** (§5): entrance snapping,
   access building, parking search, GBFS lookup, egress building, transfer insertion, fare
   application, stats. Six of these are independently testable units fused into one 170-line
   try/catch.

5. **Capability-layer bypass.** `fetchGbfsNearbyStations` (3319) and `checkBikesAllowed` (3358)
   reach into `integrationManager.getConfiguredIntegrations()`, pull the Barrelman `host`/`apiKey`,
   and issue raw `fetch()` calls — bypassing the clean `transitRouting`/`routing` capability
   delegation used everywhere else. These belong on `TransitRoutingCapability`.

### B. Performance

1. **HTTP round-trips per request are wildly path-dependent:**

   | Scenario (multi mode) | Upstream calls |
   |---|---|
   | Intermodal, no vehicles, no parking | **~4–5** |
   | Intermodal, car+bike, parking on | ~8 + up to 18 GraphHopper (parking) |
   | **Federated**, typical | **~60–110** |

   Federated breakdown: 1 MOTIS + (5 itineraries × ~3 walk legs × (1 GH + 1 entrance-snap)) +
   (~10 compositions × (2 entrance-snaps + 2–4 GH + 0–2 GBFS/OSM)). The intermodal default is the
   right call; the magnitude of the gap is the headline.

2. **No entrance-snap caching** (§6). In federated mode the same boarding/alighting coordinates
   are re-resolved ~10× per request. A per-request `Map<roundedLatLng, Promise<entrance>>` memo
   would cut a large fraction of those calls with no semantic change.

3. **Redundant rideshare geometry.** `planRideshareTrips` (1435) fetches a fresh GraphHopper
   `auto` route **per product** (1463) though every product shares the same origin→destination
   driving line. Compute once, reuse.

4. **Parallelizable sequential awaits.** `composeTransitItinerary` (2944) processes legs in a
   sequential `for` loop, awaiting each walk leg's GraphHopper call before the next; the *geometry*
   fetches are independent (only timing assembly is ordered) and could be `Promise.all`-ed, then
   assembled. Same in `buildAccessLeg`'s walk-to-vehicle → ride → park-walk chain where data
   dependencies permit.

5. **Parking fan-out is the hidden cost.** Each of `planDrivingWithParkingTrip` /
   `planBikingWithParkingTrip` evaluates up to 3 candidates × up to 3 GH calls (walk-to-vehicle +
   drive + walk-from-lot) = up to 9 each, **18 GraphHopper calls** for one request, all sequential
   within the candidate loop.

### C. Correctness

1. **Rideshare+transit is silently broken in the default path.** `planRideshareTransitCombos`
   (1837) calls `rideshareService.isAvailable()`, which **doesn't exist** (the method is
   `isRideshareAvailable()`, rideshare.service.ts:83). It throws `TypeError`, caught by the bare
   `catch {}` at 1656. Net effect: patterns I.4/I.5 never generate in intermodal mode, with no log.
   One-character class of bug, invisible because of the swallow.

2. **Via-waypoints are dropped for transit/rideshare/parking** (§3). Only `planModeTrip` honors
   `waypoints[1..n-1]`. A transit or rideshare trip with an intermediate stop silently routes
   origin→destination. Per-waypoint `departAfter`/`arriveBy`/`dwellTime` (applied only in
   `applyWaypointTimeConstraints`, 302, called only from `planModeTrip`) are likewise ignored for
   all transit/rideshare/parking trips.

3. **`energyType` is collected end-to-end and never used.** The client sends it
   (directions.service.ts:78), the controller maps it (167), the type carries it (Vehicle.energyType)
   — but `trip.service.ts` references it **zero times**. CO2 is a flat `CO2_PER_METER` constant
   (3777): an electric car scores identical emissions to a gas one. Same for cost (`FUEL_COST_PER_METER`
   is a single constant). The data plumbing for per-vehicle emissions exists; the scoring ignores it.

4. **"Nearest entrance" ≠ "best entrance."** `getNearestEntrance` ranks by `ST_Distance`
   (crow-flies) within the winning tier (station.service.ts:262). An entrance on the far side of a
   building/track can be closer in straight-line yet longer to walk to, and the result feeds the
   walk routing as ground truth. Tiering mitigates (a real subway entrance beats a crossing) but
   within a tier it's pure crow-flies.

5. **GraphHopper→`buildWalkingFallbackSegment` uses MOTIS straight-line geometry** (3512). When GH
   fails, the fallback keeps MOTIS's `leg.geometry`/`leg.duration` (often a straight line / heuristic
   time) but swaps in entrance-snapped endpoints — so geometry and endpoints can disagree, and
   distance/duration can be materially wrong. It's a graceful degrade, but silently low-fidelity.

6. **`scoreComfort` ignores elevation, shelter, weather** (3852) — only walk distance + transfers.
   The trip already carries `totalElevationGain` per segment; comfort doesn't read it. Minor: the
   `const mode = trip.segments[0]?.mode` at 3853 is computed and never used (dead local).

7. **CO2 `0.00024` magic number** is hardcoded for rideshare in four places (1494, 1521, 2389,
   2795) instead of referencing `CO2_PER_METER.driving` (which equals 0.00024). Drift risk.

8. **`SelectedModeSchema` omits `rideshare`** (controller 108–115) though the TS type and
   `getModesToGenerate` (197) support it — a client sending `selectedMode:'rideshare'` fails
   TypeBox validation. `transit` mode also returns only `['transit']`, so selecting transit yields
   no walking baseline to compare against.

9. **(Secondary, Barrelman) SQL injection surface.** `station.service.ts` builds queries with
   `sql.raw` and string interpolation. `getNearestEntrance` interpolates numerics (low risk if
   types hold), but `getStationDetail` (40) interpolates `feedId`/`stopId` strings directly
   (45–82). Not in the trip path, but worth parameterizing.

### D. Simplification Opportunities

1. **Collapse to one transit path.** If intermodal becomes the only path, delete `planTransitTrips`,
   `composeTransitWithAccessAndEgress`, `buildAccessLeg`, `buildEgressLeg`, `insertTransferWalks`,
   `composeTransitItinerary`, `buildWalkingFallbackSegment`, `checkBikesAllowed` (~1,500 lines).
   Prerequisites to not lose features:
   - **Rideshare+transit** → reimplement as a thin wrapper: take an intermodal *transit-only* core
     and prepend/append a single rideshare leg (fix C1 first). ~150 lines replaces the whole
     federated apparatus.
   - **Entrance snapping** → either push into Barrelman/MOTIS (have MOTIS route access/egress walks
     to entrance nodes), or post-process intermodal walk legs through the existing snap+GH step.
   - **bikes-allowed** → pass as a MOTIS query constraint instead of post-filtering.

2. **Make scoring pluggable / user-configurable.** `getScoreWeights` (4228) returns a hardcoded
   object; the 6 `rankByXxx` methods are near-identical min-max normalizers. A single
   `rankBy(metricFn)` plus a weights object (optionally user-supplied) would replace ~120 lines of
   duplication and unlock per-user "I care about cost 2× more" tuning that the premium-features
   brainstorm already gestures at.

3. **Quality filter may be too aggressive in one spot.** The `>4× fastest AND >60min` floor
   (3706) is well-guarded by `bestPerMode`, so a valid-but-slow transit option survives as the
   representative — that part is fine. The real over-filter is PRE-PASS A forcing earliest-arrival
   ordering on transit **regardless of `sortPreference`** (§8): under "cheapest"/"greenest", the
   cheapest/greenest transit variant can be dropped before ranking. Fix: order the transit pre-pass
   by the active sort metric, not always arrival time.

4. **Unify CO2/cost behind a vehicle-aware function** (`emissionsFor(segment, vehicle)`) so
   `energyType` finally matters and the four `0.00024` literals collapse to one source of truth.

### Priority

| Severity | Item |
|---|---|
| **High** | C1 rideshare typo (silent feature loss, default path) · structural risk of dead-but-feature-bearing Path B (A2) |
| **High** | C2 via-waypoints/time-constraints dropped for transit/rideshare (silent wrong routes) |
| **Medium** | B1/B2 federated HTTP blowup + no entrance caching · C3 energyType ignored · D1 path consolidation |
| **Low** | C6–C8 comfort/elevation, magic numbers, schema gap · D2/D3 scoring & filter polish · C9 Barrelman SQL |
```
