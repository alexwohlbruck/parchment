# Realtime Transit (GTFS-RT)

Research and design document for adding GTFS-RT support to the transit
system. Covers realtime routing adjustments, live vehicle positions on
the map, and replacing the Transitland dependency.

## 1. MOTIS GTFS-RT Configuration

### Current State

MOTIS runs in transit-only mode with 78 static GTFS feeds
(`barrelman/motis/config.yml`). No `rt:` entries exist — all routing
uses static schedules only.

### Config Syntax

MOTIS v2 supports GTFS-RT natively via per-dataset `rt` blocks. Each
entry is a URL that MOTIS polls for protobuf data. There is **no
separate feed-type key** — MOTIS parses each URL for all entity types
(TripUpdates, Alerts) and extracts what it finds.

```yaml
timetable:
  first_day: TODAY
  num_days: 365
  with_shapes: true
  update_interval: 60           # RT poll interval in seconds (default 60)
  http_timeout: 30              # max seconds per feed download (default 30)
  incremental_rt_update: false  # false = clean slate each cycle (default)
  datasets:
    17:
      path: gtfs/17.zip
      rt:
        - url: https://agency.example.com/gtfs-rt/trip-updates.pb
        - url: https://agency.example.com/gtfs-rt/alerts.pb
          headers:
            Authorization: "Bearer abc123"
    74:
      path: gtfs/74.zip
      # No RT — this feed has no realtime data
```

**Config fields per RT entry** (from MOTIS `config.h`):

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `url` | yes | — | GTFS-RT protobuf feed URL |
| `headers` | no | — | HTTP headers map (for auth) |
| `protocol` | no | `gtfsrt` | One of: `gtfsrt`, `siri`, `siri_json`, `auser` |

**Top-level RT config:**

| Field | Default | Description |
|-------|---------|-------------|
| `update_interval` | `60` | Seconds between poll cycles for all feeds |
| `http_timeout` | `30` | Max seconds per HTTP request |
| `incremental_rt_update` | `false` | `false` = rebuild RT timetable from scratch each cycle. `true` = carry forward prior updates (accumulates). |

**What MOTIS extracts from GTFS-RT feeds:**

| Entity | Used for Routing | Notes |
|--------|-----------------|-------|
| TripUpdate | ✅ Yes — RAPTOR uses adjusted times | Delays, cancellations, added trips, skipped stops |
| Alert | ✅ Partial — `NO_SERVICE` alerts affect routing | Shown on API response legs and stops |
| VehiclePosition | ❌ **Ignored** | MOTIS's nigiri library has a `use_vehicle_position` flag but MOTIS hardcodes it to `false`. Must be polled separately. |

**Key behaviors:**

- MOTIS polls **all** RT feed URLs in parallel on a single timer
  (`update_interval` seconds, default 60s)
- Feeds must return standard GTFS-RT protobuf
- Per-feed failure isolation: if one feed errors or times out, it's
  logged and skipped — other feeds proceed normally. Prometheus metrics
  track `updates_requested`, `updates_successful`, `updates_error`
- On the default `incremental_rt_update: false`, each poll cycle starts
  from the static schedule and applies only the latest RT data — stale
  updates naturally age out
- RT data is ephemeral — on restart, MOTIS re-fetches from all URLs
- MOTIS exposes a `GET /gtfsrt` endpoint that re-exports the current RT
  state as a GTFS-RT protobuf FeedMessage (capped by
  `limits.gtfsrt_expose_max_trip_updates`, default 100)

### Where RT URLs Come From

Each transit agency publishes its own GTFS-RT feeds. URLs are discovered
via the Transitland Feed API:

```
GET https://transit.land/api/v2/rest/feeds?spec=gtfs-rt&bbox=-84.5,33.8,-75.4,36.6
```

Response includes per-feed RT URLs under the `urls` object:

| Field | GTFS-RT Entity |
|-------|---------------|
| `urls.realtime_trip_updates` | TripUpdate protobuf URL |
| `urls.realtime_vehicle_positions` | VehiclePosition protobuf URL |
| `urls.realtime_alerts` | ServiceAlert protobuf URL |

Not all RT feeds have all three URL types. Some only publish one.

**Linking static ↔ RT feeds**: The MOTIS config uses numeric Transitland
feed IDs (17, 74, etc.) as dataset keys. To find the RT feed for a
static feed: query the static feed → read its `associated_operators` →
follow `associated_feeds` entries with `gtfs-rt` spec. The
`associated_feeds` array links a static GTFS feed to its RT counterparts
via `feed_onestop_id`.

**Transitland RT proxy**: Transitland also offers a cached RT snapshot
endpoint (refreshed every ~60s):
```
GET /feeds/{feed_key}/download_latest_rt/trip_updates.pb
GET /feeds/{feed_key}/download_latest_rt/vehicle_positions.json
```
Returns 404 if unavailable. Useful for testing but not for production
(counts against API quota, adds latency).

**Coverage**: ~15-20% of Transitland's ~2800 feed providers have RT
data registered. Coverage skews heavily toward US and European urban
agencies. Major agencies (MTA, WMATA, BART, TriMet, SEPTA, CTA, LA
Metro, CATS) all have RT. Smaller rural agencies rarely do. Some
agencies split RT into multiple feeds (MTA has 12+ separate RT feeds).

### Authorization

Transitland exposes per-feed `authorization` metadata:

```json
{
  "authorization": {
    "type": "query_param",
    "param_name": "api_key",
    "info_url": "https://developer.example.com/register"
  }
}
```

| Auth Type | Description | Example Agency |
|-----------|-------------|---------------|
| `query_param` | Append `?{param_name}={key}` to URL | TriMet (`appID`), MTA Bus (`key`) |
| `header` | Send key as HTTP header `{param_name}` | WMATA (`api_key`) |
| `basic_auth` | HTTP Basic Authentication | — |
| `path_segment` | Key embedded in URL path via `{}` | — |
| `replace_url` | Entire URL replaced with authenticated version | 511.org |
| _(none)_ | No auth required — public URL | SEPTA, LA Metro alerts |

**Credentials are NOT stored in Transitland** — only the auth method
and a signup URL (`info_url`). The import pipeline would need to:
1. Discover RT feed URLs + auth types from Transitland
2. Prompt for or store API keys per agency
3. Inject credentials into the MOTIS config's `headers` field

## 2. GTFS-RT Feed Pipeline

### Architecture

```
Transitland Feed API
  |
  GET /feeds?spec=gtfs-rt&bbox=...
  |
  v
GTFS Import Pipeline (import-gtfs.ts)
  |
  +---> Download static GTFS ZIPs (existing)
  +---> Discover RT feed URLs from Transitland (new)
  +---> Store RT URLs + auth in gtfs_feeds table (new)
  +---> Generate motis/config.yml with rt: entries (new)
  |
  v
MOTIS (runtime)
  |
  Polls each RT URL every ~30s
  |
  v
Protobuf → internal timetable updates
  |
  RAPTOR uses adjusted times for routing
```

### Feed Consumption Details

**Protocol**: GTFS-RT uses Protocol Buffers (protobuf). The spec is
defined by Google at `gtfs.org/realtime`. Each feed URL returns a
`FeedMessage` protobuf containing `FeedEntity` items (trip updates,
vehicle positions, or alerts).

**Polling**: MOTIS handles polling internally via `run_rt_update()` in
`rt_update.cc`. It fetches **all** RT URLs in parallel using
`boost::asio` coroutines on a single timer (`update_interval` seconds).
No external cron or polling service is needed.

**Feed failures**: When a feed URL returns an error (HTTP 4xx/5xx),
times out (`http_timeout`), or returns malformed protobuf:

- MOTIS logs the error and increments `updates_error` Prometheus counter
- The affected dataset's timetable falls back to static schedule data
- The next poll cycle retries the URL
- Other feeds are unaffected (per-feed isolation — each fetch is
  independent within the parallel group)

**Staleness**: With the default `incremental_rt_update: false`, MOTIS
rebuilds the RT timetable from scratch each poll cycle via
`nigiri::rt::create_rt_timetable()`. Old updates naturally age out —
if a feed stops responding, the next cycle simply omits its data and
uses static times for that dataset.

### Database Schema Extension

The `gtfs_feeds` table needs new columns:

```sql
ALTER TABLE gtfs_feeds ADD COLUMN rt_trip_updates_url TEXT;
ALTER TABLE gtfs_feeds ADD COLUMN rt_vehicle_positions_url TEXT;
ALTER TABLE gtfs_feeds ADD COLUMN rt_alerts_url TEXT;
ALTER TABLE gtfs_feeds ADD COLUMN rt_auth_type TEXT;     -- 'header', 'query_param', 'none'
ALTER TABLE gtfs_feeds ADD COLUMN rt_auth_key TEXT;      -- header name or param name
ALTER TABLE gtfs_feeds ADD COLUMN rt_auth_value TEXT;    -- the actual credential
```

### Config Generation

The MOTIS `config.yml` is currently hand-maintained. With RT, it should
be generated from the database:

```typescript
// New: generate-motis-config.ts
function generateMotisConfig(feeds: GtfsFeed[]): string {
  const datasets = feeds.map(feed => {
    const entry: any = { path: `gtfs/${feed.feedId}.zip` }
    const rtEntries = []

    if (feed.rtTripUpdatesUrl) {
      const rt: any = { url: feed.rtTripUpdatesUrl, type: 'TRIP_UPDATES' }
      if (feed.rtAuthType === 'header') {
        rt.headers = { [feed.rtAuthKey]: feed.rtAuthValue }
      }
      rtEntries.push(rt)
    }
    // ... same for vehicle positions and alerts

    if (rtEntries.length > 0) entry.rt = rtEntries
    return { [feed.feedId]: entry }
  })

  return yaml.stringify({
    timetable: { first_day: 'TODAY', num_days: 365, datasets: Object.assign({}, ...datasets) },
    street_routing: false,
    osr_footpath: false,
  })
}
```

## 3. Realtime Routing Impact

### How RT Affects RAPTOR

When MOTIS has TripUpdate data, **RAPTOR routes on the adjusted times
directly** — this is not just annotation. The RT timetable (`rtt`) is
passed to `nigiri::routing::raptor_search()`, which reads actual (not
scheduled) times for trip scanning. When RT transports exist, MOTIS
forces RAPTOR over the Trip-Based algorithm.

- **Delayed trips**: If a bus is 5 minutes late at stop X, RAPTOR
  routes using the delayed time. This may cause it to suggest a
  different connection that wouldn't have been optimal on the static
  schedule.
- **Cancelled trips**: Trips marked cancelled are excluded from routing
  entirely. RAPTOR finds alternative itineraries.
- **Added trips**: Non-scheduled trips are included in routing results
  with `scheduled: false`.
- **Skipped stops**: Stops marked skipped are bypassed — RAPTOR won't
  board or alight there.

### What Changes in the API Response

When RT data is active, the MOTIS OTPAPI `/api/v1/plan` response
includes additional fields on transit legs. **There is no explicit
delay field** — delay must be computed as `startTime - scheduledStartTime`.

```json
{
  "legs": [{
    "mode": "BUS",
    "realTime": true,
    "scheduled": true,
    "cancelled": false,
    "startTime": 1700000600000,
    "endTime": 1700003480000,
    "scheduledStartTime": 1700000300000,
    "scheduledEndTime": 1700003300000,
    "from": {
      "departure": 1700000600000,
      "scheduledDeparture": 1700000300000
    },
    "to": {
      "arrival": 1700003480000,
      "scheduledArrival": 1700003300000
    }
  }]
}
```

Intermediate stops also get `scheduledArrival`, `scheduledDeparture`,
`track`, `scheduledTrack`, and `cancelled` fields. Alerts appear as an
`alerts` array on both Leg and Place objects.

### Parchment Server Changes

The Barrelman transit adapter (`transit.service.ts`) and Parchment
trip composition engine need updates to surface RT data:

**Barrelman `adaptLeg()`** — extract and forward RT fields:

```typescript
// New fields on TransitLeg
interface TransitLeg {
  // ... existing fields ...
  realTime?: boolean
  scheduled?: boolean         // false for added (non-scheduled) trips
  cancelled?: boolean
  scheduledStartTime?: string // static schedule time
  scheduledEndTime?: string
}

// In adaptLeg(), compute delay from actual vs scheduled:
if (leg.realTime) {
  adapted.realTime = true
  adapted.scheduled = leg.scheduled ?? true
  adapted.cancelled = leg.cancelled ?? false
  adapted.scheduledStartTime = epochToIso(leg.scheduledStartTime)
  adapted.scheduledEndTime = epochToIso(leg.scheduledEndTime)
}
```

**Parchment `composeTransitItinerary()`** — when RT data is present:

1. Use the realtime departure/arrival times (already in `startTime` /
   `endTime` from MOTIS) — no code change needed for routing
2. Forward `realTime`, delay, and scheduled times to the frontend
   via `TransitDetails` on `TripSegment`
3. Transfer feasibility checks already use actual times, so a delayed
   connection that was previously feasible may now be correctly rejected

**Key insight**: No changes to the composition engine's routing logic
are needed. MOTIS returns adjusted times, and the composition engine
already uses those times for walk timing, transfer feasibility, and
scoring. The main work is surfacing RT metadata to the frontend.

## 4. Live Vehicle Positions on Map

### Architecture

```
MOTIS (polls VehiclePositions feeds)
  |
  Not exposed via MOTIS API (routing engine, not a data API)
  |
  v
Barrelman Vehicle Position Service (new)
  |
  Polls GTFS-RT VehiclePositions feeds directly (bypass MOTIS)
  |
  Stores in memory / Redis with TTL
  |
  v
GET /transit/vehicles?bbox=...
  |
  v
Parchment frontend
  |
  Uses existing movement-interpolation.ts
  (Hermite cubic + dead reckoning)
```

### Why Not Through MOTIS

MOTIS **ignores GTFS-RT VehiclePositions entirely**. The nigiri library
has a `use_vehicle_position` parameter on `gtfsrt_update_buf()` but
MOTIS hardcodes it to `false`. VehiclePosition entities in RT feeds are
parsed but discarded. MOTIS's map visualization (railviz) interpolates
vehicle positions from the schedule instead.

Barrelman must poll VehiclePositions feeds directly and serve them via
a REST endpoint.

### Barrelman Endpoint Design

```
GET /transit/vehicles?north=36&south=35&east=-78&west=-80&routes=9,42
```

**Response:**

```json
{
  "vehicles": [
    {
      "vehicleId": "1234",
      "tripId": "trip_789",
      "routeId": "route_9",
      "feedId": "17",
      "position": { "lat": 35.2271, "lng": -80.8431 },
      "bearing": 45.0,
      "speed": 8.5,
      "timestamp": "2024-01-15T14:30:00Z",
      "routeColor": "FF0000",
      "routeShortName": "9",
      "currentStopId": "stop_a",
      "currentStopSequence": 5,
      "congestionLevel": "RUNNING_SMOOTHLY",
      "occupancyStatus": "MANY_SEATS_AVAILABLE"
    }
  ],
  "feedTimestamps": {
    "17": "2024-01-15T14:30:15Z",
    "74": "2024-01-15T14:29:45Z"
  }
}
```

**Implementation notes:**

- Barrelman polls each feed's VehiclePositions URL every 15-30s
  (matching typical agency update frequency)
- Positions stored in memory with a 2-minute TTL — stale vehicles
  drop off automatically
- The `bbox` filter avoids sending all vehicles in the system to the
  frontend — only those visible in the current map viewport
- Route metadata (`routeColor`, `routeShortName`) joined from the
  PostGIS `gtfs_routes` table to avoid extra lookups on the frontend
- `feedTimestamps` lets the frontend know feed freshness

### Frontend Integration

The existing `movement-interpolation.ts` in `web/src/lib/` is designed
for exactly this use case. It implements:

- **Hermite cubic interpolation** between position samples for smooth
  movement through curves (not just linear interpolation)
- **Dead reckoning** when samples are late — projects forward using
  speed and bearing for up to 30s (`STALENESS_CAP_SEC`)
- **Velocity synthesis** when the device doesn't report speed/heading —
  derives them from consecutive positions
- **Tween-then-dead-reckon** strategy: smooth from current rendered
  position to new sample, then extrapolate

**Adaptation required:**

The interpolation system was built for friend location tracking (10s+
update intervals, single-user samples). For transit vehicles:

1. **`Track` per vehicle**: Create a `Map<vehicleId, Track>` in a new
   `TransitVehiclesLayer` composable, similar to `FriendLocationsLayer`
2. **Update cycle**: Poll `/transit/vehicles?bbox=...` every 15-30s
   (matching RT feed frequency). On each response, call `buildTrack()`
   for each vehicle to update its interpolation state.
3. **Render**: On each `requestAnimationFrame`, call `predict(track, now)`
   for each visible vehicle to get its interpolated position.
4. **Map symbols**: Use MapLibre `GeoJSONSource` with vehicle markers.
   Rotate markers by bearing. Color by route color.

**Update interval considerations:**

| Interval | Pros | Cons |
|----------|------|------|
| 10s | Smoothest movement | High server load, RT feeds only update every 15-30s anyway |
| 15s | Matches most feed update rates | Good balance |
| 30s | Low load | Longer dead-reckoning gaps, more prediction error |
| Adaptive | Matches actual feed freshness | Complex, per-feed intervals |

**Recommended: 15s polling** with `STALENESS_CAP_SEC = 45` (1.5x the
polling interval, bridges one missed update). The dead reckoning system
handles the gap between updates smoothly.

### Scale Considerations

For the NC region (~78 feeds), expect ~500-2000 active vehicles at peak.
At 15s polling with bbox filtering, each frontend request returns
~50-200 vehicles (typical viewport). This is well within MapLibre's
rendering capacity.

For global deployment (~2800 feeds), Barrelman would need:
- Feed-level polling prioritization (only poll feeds with stops in the
  active viewport, or poll all feeds but serve lazily)
- Redis or similar shared cache if multiple Barrelman instances run
- Consider WebSocket push instead of polling for dense areas

## 5. Replacing Transitland

The Transitland integration (`transitland-integration.ts`) provides
three capabilities. Here's how each can be replaced:

### 5.1 Departure Boards

**Current**: `TransitlandIntegration.getDepartures()` calls the
Transitland REST API for next departures at a stop. Used by
`widget.service.ts` and `place.service.ts`.

**Replacement**: New Barrelman endpoint using MOTIS + PostGIS.

```
GET /transit/departures?feedId=17&stopId=stop_a&limit=10&timeRange=3600
```

**Implementation approach:**

MOTIS doesn't have a direct "departures for stop" endpoint. Two options:

**Option A — MOTIS plan query (recommended for v1):**
Query MOTIS with the stop as both origin and a nearby stop as
destination, requesting many itineraries. Extract the first leg of each
itinerary — these are effectively the next departures. Filter to unique
trip IDs.

Pros: Uses existing MOTIS infrastructure.
Cons: Indirect, returns more data than needed, may miss some departures.

**Option B — Direct GTFS stop_times query (recommended for v2):**
Parse and store `stop_times.txt` data in PostGIS during import. Query
directly for departures matching the current service day and time
window. Apply GTFS-RT TripUpdate delays on top.

```sql
SELECT
  st.trip_id, st.departure_time, st.stop_sequence,
  t.route_id, t.trip_headsign, t.direction_id,
  r.route_short_name, r.route_long_name, r.route_color,
  c.service_id, c.monday, c.tuesday, ...
FROM gtfs_stop_times st
JOIN gtfs_trips t ON t.feed_id = st.feed_id AND t.trip_id = st.trip_id
JOIN gtfs_routes r ON r.feed_id = t.feed_id AND r.route_id = t.route_id
JOIN gtfs_calendar c ON c.feed_id = t.feed_id AND c.service_id = t.service_id
WHERE st.feed_id = $1 AND st.stop_id = $2
  AND c.start_date <= CURRENT_DATE AND c.end_date >= CURRENT_DATE
  AND c.<day_column> = 1
  AND st.departure_time >= $3
ORDER BY st.departure_time
LIMIT $4
```

Pros: Complete, accurate, no routing query overhead.
Cons: Requires importing `stop_times.txt`, `trips.txt`, `calendar.txt`
into PostGIS (larger import, ~10x more rows than stops+routes).

**New DB tables needed for Option B:**

```sql
-- gtfs_trips
CREATE TABLE gtfs_trips (
  id SERIAL PRIMARY KEY,
  feed_id TEXT NOT NULL,
  trip_id TEXT NOT NULL,
  route_id TEXT NOT NULL,
  service_id TEXT NOT NULL,
  trip_headsign TEXT,
  direction_id INTEGER,
  shape_id TEXT,
  UNIQUE (feed_id, trip_id)
);

-- gtfs_stop_times (large — millions of rows per region)
CREATE TABLE gtfs_stop_times (
  id SERIAL PRIMARY KEY,
  feed_id TEXT NOT NULL,
  trip_id TEXT NOT NULL,
  stop_id TEXT NOT NULL,
  stop_sequence INTEGER NOT NULL,
  arrival_time TEXT,      -- HH:MM:SS (may exceed 24:00)
  departure_time TEXT,
  UNIQUE (feed_id, trip_id, stop_sequence)
);
CREATE INDEX ON gtfs_stop_times (feed_id, stop_id, departure_time);

-- gtfs_calendar
CREATE TABLE gtfs_calendar (
  id SERIAL PRIMARY KEY,
  feed_id TEXT NOT NULL,
  service_id TEXT NOT NULL,
  monday BOOLEAN, tuesday BOOLEAN, wednesday BOOLEAN,
  thursday BOOLEAN, friday BOOLEAN, saturday BOOLEAN, sunday BOOLEAN,
  start_date DATE, end_date DATE,
  UNIQUE (feed_id, service_id)
);

-- gtfs_calendar_dates (exceptions)
CREATE TABLE gtfs_calendar_dates (
  id SERIAL PRIMARY KEY,
  feed_id TEXT NOT NULL,
  service_id TEXT NOT NULL,
  date DATE NOT NULL,
  exception_type INTEGER  -- 1=added, 2=removed
);
```

**Recommendation**: Start with Option A (MOTIS-based, fast to implement,
no new tables). Migrate to Option B when the departure board becomes a
core feature, since direct GTFS queries are more reliable and support
RT overlay.

### 5.2 Route and Agency Info

**Current**: The Transitland `getPlaceInfo()` method returns stop
metadata. Route info comes via the departures response.

**Replacement**: Already available.

- Stop metadata → `GET /transit/stops?lat=&lng=&radius=` (Barrelman,
  from PostGIS `gtfs_stops`)
- Routes for a stop → `GET /transit/routes?feedId=&stopId=` (Barrelman,
  from PostGIS `gtfs_stop_routes` + `gtfs_routes`)
- Agency info → stored on `gtfs_routes.agency_name` in PostGIS

The existing Barrelman endpoints cover most of what
`TransitlandIntegration.getPlaceInfo()` does, except for
`onestop_id` lookup. A new column or index on `gtfs_feeds.onestop_id`
would bridge this.

### 5.3 Map Tiles (Transit Lines on Map)

**Current**: Parchment proxies Transitland's hosted MVT tiles for
route lines and stop dots:

```
GET /proxy/transitland/routes/:z/:x/:y  →  transit.land tiles API
GET /proxy/transitland/stops/:z/:x/:y   →  transit.land tiles API
```

**Replacement options:**

**Option A — Martin from PostGIS (recommended for v1):**

Martin already serves POI and boundary tiles from PostGIS. Add transit
tile sources to `martin-config.yaml`:

```yaml
postgres:
  tables:
    transit_routes:
      schema: public
      table: gtfs_route_shapes    # New table with route geometries
      srid: 4326
      geometry_column: geom
      geometry_type: LINESTRING
      minzoom: 8
      maxzoom: 16
      properties:
        feed_id: feed_id
        route_id: route_id
        route_short_name: route_short_name
        route_color: route_color
        route_type: route_type

    transit_stops:
      schema: public
      table: gtfs_stops
      srid: 4326
      geometry_column: geom
      geometry_type: POINT
      minzoom: 12
      maxzoom: 16
      properties:
        feed_id: feed_id
        stop_id: stop_id
        stop_name: stop_name
        stop_code: stop_code
```

Requires importing `shapes.txt` from GTFS feeds into a new
`gtfs_route_shapes` table (or joining `gtfs_trips` → `gtfs_shapes`
to build route-level geometries). The `with_shapes: true` config in
MOTIS means shapes are already in the GTFS ZIPs.

Pros: Self-hosted, no Transitland API dependency, customizable styling.
Cons: Needs shape import, route geometries may overlap and need
line-grouping (see Option B).

**Option B — LOOM transit map rendering (future):**

LOOM (University of Freiburg, same group as pfaedle) renders transit
maps with grouped/interlined routes — multiple bus lines sharing a
corridor are drawn as parallel colored stripes instead of overlapping
lines. This is what professional transit maps use.

LOOM consumes the same pfaedle-snapped GTFS shapes and outputs
pre-rendered tiles or GeoJSON. This is a larger project and is planned
for PAR-12/14 (transit map layer).

**Recommendation**: Start with Martin PostGIS tiles (Option A) — gets
us off Transitland tiles quickly with minimal effort. Route overlap is
acceptable at first. Migrate to LOOM when the transit map layer lands.

## Phased Implementation Plan

### Phase RT-1: MOTIS RT Config + Routing (2-3 days)

**Goal**: Realtime-adjusted routing — delayed buses are accounted for
in trip planning.

1. Extend `gtfs_feeds` schema with RT URL columns
2. Update `fetchFeedList()` to capture RT URLs from Transitland's
   `urls.realtime_*` fields
3. Add `generate-motis-config.ts` to produce `config.yml` from DB
   (replaces hand-maintained config)
4. Update Barrelman `adaptLeg()` to forward `realTime`, delay, and
   scheduled times
5. Update Parchment `TransitDetails` type to include RT fields
6. Frontend: show "Live" badge on trip legs with RT data, display
   delay ("+5 min") next to departure times

**Config for NC dev region:**
Most NC agencies with RT data:
- CATS Charlotte (feed 17) — TripUpdates + VehiclePositions
- GoTriangle (feed 74) — TripUpdates
- GoDurham (feed 86) — TripUpdates

### Phase RT-2: Live Vehicle Positions (3-4 days)

**Goal**: Show transit vehicles moving on the map in realtime.

1. New Barrelman `VehiclePositionService`:
   - Polls VehiclePositions feeds directly (not through MOTIS)
   - In-memory store with 2-min TTL per vehicle
   - Joins route metadata from PostGIS for colors/names
2. New Barrelman endpoint: `GET /transit/vehicles?bbox=...`
3. New Parchment integration: `VEHICLE_POSITIONS` capability
4. New frontend `TransitVehiclesLayer` composable:
   - Polls `/transit/vehicles` every 15s for current viewport
   - Uses `buildTrack()` / `predict()` from `movement-interpolation.ts`
   - Renders vehicles as colored circles with route short name
   - Bearing-based rotation for directional markers
5. Map UI toggle: "Show transit vehicles" in map settings

### Phase RT-3: Self-Hosted Departure Boards (2-3 days)

**Goal**: Replace Transitland `getDepartures()` with Barrelman.

1. Implement MOTIS-based departure query (Option A) as
   `GET /transit/departures`
2. New Barrelman `DepartureService` that queries MOTIS and enriches
   with route metadata from PostGIS
3. New Parchment integration: register `TRANSIT_DATA` capability on
   `BarrelmanIntegration` (alongside existing `TRANSIT_ROUTING`)
4. Update `widget.service.ts` and `place.service.ts` to prefer
   Barrelman departures over Transitland when available
5. Keep Transitland as fallback for feeds not in MOTIS

### Phase RT-4: Self-Hosted Transit Tiles (2-3 days)

**Goal**: Replace Transitland tile proxy with Martin-served tiles.

1. Import `shapes.txt` from GTFS feeds during `import-gtfs.ts`
   pipeline — new `gtfs_route_shapes` table
2. Add `transit_routes` and `transit_stops` tile sources to
   `martin-config.yaml`
3. Update Parchment tile proxy to serve from Martin instead of
   Transitland
4. Update frontend MapLibre style to use self-hosted tile URLs
5. Remove Transitland tile proxy endpoints

### Phase RT-5: Full Transitland Replacement (1-2 days)

**Goal**: Remove Transitland dependency entirely.

1. Migrate `getPlaceInfo()` for transit stops to Barrelman
2. If Option B departure boards are needed, import `stop_times.txt`,
   `trips.txt`, `calendar.txt` into PostGIS
3. Remove `transitland-integration.ts`
4. Remove Transitland API key requirement from integration setup

### Phase RT-6: Direct GTFS Departures (optional, 3-4 days)

**Goal**: More accurate departure boards via direct GTFS queries.

1. Import `stop_times.txt`, `trips.txt`, `calendar.txt`,
   `calendar_dates.txt` into PostGIS (large data — millions of rows)
2. Implement calendar service day resolution (day-of-week +
   exception dates)
3. Apply GTFS-RT TripUpdate delays on top of static times
4. Replace MOTIS-based departure query with direct SQL
5. Support `arriveBy` queries for last-mile connections

## Existing Type Infrastructure

The codebase already defines RT types in
`server/src/types/trip.types.ts`:

- `GTFSFeed.realtimeUrls` — `{ tripUpdates?, vehiclePositions?, alerts? }`
- `GTFSRealtimeUpdate` — container for all RT entity types
- `GTFSTripUpdate` — per-trip delay/cancellation with stop-time updates
- `GTFSVehiclePosition` — vehicle location with bearing, speed, occupancy
- `GTFSAlert` — service alerts with effect/cause enums
- `TransitAlertEffect` — `no_service`, `reduced_service`, `detour`, etc.
- `TransitAlertCause` — `weather`, `construction`, `strike`, etc.
- `DataSourceType` includes `'gtfs_realtime'`

These types are ready to use — they match the GTFS-RT protobuf schema
closely and just need to be wired to real data.

## Transitland API Quotas

Feed metadata lookups count against the REST API quota:

| Tier | REST API | Price |
|------|----------|-------|
| Free | 10,000/month | Free |
| Professional | 200,000/month | $200/month |

**Discovery budget**: Fetching all ~250 RT feed metadata entries requires
~3 paginated requests. Running this daily: 3 × 30 = 90 queries/month —
well within the free tier. The strategy is: use Transitland to discover
RT feed URLs once (or periodically), then poll the actual protobuf feeds
directly from agencies, bypassing Transitland entirely.

**Do NOT proxy RT data through Transitland's `download_latest_rt`** in
production — at 250 feeds × once per minute = 360,000 requests/day,
this would exceed even the Professional tier instantly.

## Cost and Scaling

### Feed Polling Load

For NC region (78 feeds, ~20 with RT data):
- MOTIS polls TripUpdates/Alerts: 20 feeds × 60s interval = 20 req/min
- Barrelman polls VehiclePositions: 20 feeds × 30s interval = 40 req/min
- Each protobuf response: 5-50 KB
- Total bandwidth: ~50-200 KB/s — negligible

For global (2800 feeds, ~400-800 with RT data):
- MOTIS: ~800 feeds at 60s = ~800 req/min
- Barrelman VehiclePositions: ~400 feeds at 30s = ~800 req/min
- Consider staggering poll times to smooth load
- May need dedicated RT polling worker process

### Memory

VehiclePositions stored in memory:
- NC: ~2000 vehicles × ~200 bytes = ~400 KB
- Global: ~200K vehicles × ~200 bytes = ~40 MB
- Redis recommended for global scale

## Open Questions

1. **Per-feed poll intervals**: Should we match each agency's actual
   update frequency (some update every 10s, others every 60s)? Or use
   a uniform interval?

2. **RT feed discovery automation**: Should the import pipeline
   automatically discover and configure RT URLs, or require manual
   curation per feed?

3. **Stale RT indication**: How should the frontend indicate when RT
   data is stale (feed hasn't updated in >5 min)? Dim the "Live" badge?

4. **VehiclePositions without TripUpdates**: Some agencies provide
   positions but not trip updates. Should we still show vehicles on
   the map even though routing isn't RT-adjusted?

5. **Alerts UI**: Service alerts need a frontend surface — banner on
   affected trip segments? Alert panel? Push notification for tracked
   trips?
