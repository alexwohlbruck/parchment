# Parchment

## Architecture

- **Parchment server** (API): runs in Docker as `parchment-server`, port 5000. Restart with `docker compose -f docker-compose.dev.yml restart parchment-server`
- **Parchment web** (Vite): runs on port 5173. HMR handles client code changes. Do NOT start a new dev server.
- **Barrelman** (geospatial engine): separate repo at `../barrelman`, Docker container `barrelman`, port 5001. Rebuild with `cd ../barrelman && docker build -t alexwohlbruck/barrelman:latest . && docker compose up -d barrelman`
- **Parchment DB**: Docker container `parchment-db`
- **Barrelman DB**: Docker container `barrelman-db`, port 5434

## When to restart what

- **Client code changes** (`web/src/`): Vite HMR picks them up automatically
- **Server code changes** (`server/src/`): `bun --hot` in Docker picks them up automatically (source is volume-mounted from `./server` into the container). If hot reload fails: `docker compose -f docker-compose.dev.yml restart parchment-server`
- **Barrelman code changes** (`../barrelman/src/`): must rebuild and restart — `cd ../barrelman && docker build -t alexwohlbruck/barrelman:latest . && docker compose up -d barrelman`

## Important rules

- Do NOT start new dev servers. The user runs their own.
- Do NOT merge to main. Work on feature branches.
- Use `bun` over `npm` for package management.
- No uppercase tracking-wider text in UI.
- Commit messages: short (5-20 words), distinct logical commits.

## Transit system architecture

### Data flow: live vehicle positions

```
GTFS-RT feeds (agency servers, 15-30s updates)
  ↓ HTTP GET (Barrelman polls, 5s feed cache)
Barrelman /transit/vehicles, /transit/route-vehicles
  + TripUpdate enrichment (nextStopId, nextStopArrival)
  + route metadata enrichment (color, name, type)
  + trip→route resolution from GTFS ZIPs
  + subway position interpolation from TripUpdate feeds
  ↓ HTTP GET (Parchment proxy, authenticated)
Parchment server /proxy/transit/*
  ↓ HTTP poll (route-detail store, 5s)
Client route-detail store
  ↓ reactive watch
Transit vehicles layer (interpolation + animation at 60fps)
  ↓ setMarkerLngLat
Map markers (DOM elements via MapLibre)
```

### Key files

**Barrelman (../barrelman/):**
- `src/services/vehicles.service.ts` — fetches GTFS-RT VehiclePosition + TripUpdate, enriches with route metadata, resolves trip→route from GTFS ZIPs
- `src/services/subway-interpolation.service.ts` — derives train positions from TripUpdate arrival/departure predictions (NYC subway has no GPS)
- `src/services/route-detail.service.ts` — route metadata, ordered stops, shape, related trunk routes
- `src/services/shapes.service.ts` — GTFS shape geometry with cross-feed fallback
- `src/routes/transit.ts` — all transit REST endpoints

**Parchment server:**
- `server/src/controllers/proxy.controller.ts` — authenticated Barrelman proxy (`proxyBarrelman` helper). All `/proxy/transit/*` endpoints require auth.
- `server/src/services/transit/transit-poller.service.ts` — server-side WS transit poller (subscriber cap: 100, bounds validation)
- `server/src/controllers/realtime.controller.ts` — WS message handler for transit:subscribe/unsubscribe/viewport

**Parchment web:**
- `web/src/stores/route-detail.store.ts` — route detail state, vehicle polling, direction/vehicle selection, trip stop times, vehicle projection onto route shape
- `web/src/components/map/layers/transit-vehicles-layer.ts` — interpolation engine: distance-space tracking, easeOut blend transitions, dead-reckoning with speed decay, speed caps by route type, TripUpdate-informed speed
- `web/src/components/map/TransitVehicleMarker.vue` — vehicle icon marker (bus/train/tram/ferry based on routeType)
- `web/src/services/layers/features/route-isolation.service.ts` — map isolation: fades transit layers, draws highlighted route shape + station markers
- `web/src/views/transit/TransitRouteDetail.vue` — dedicated route view at `/transit/route/:feedId/:routeId`
- `web/src/components/place/pages/RouteDetailPage.vue` — route detail panel UI
- `web/src/components/place/details/PlaceTransit.vue` — compact departure widget (Apple Maps style)

### Interpolation model

Three-tier speed computation (best available wins):
1. **TripUpdate arrival prediction** — speed to reach next stop at predicted time
2. **GPS position delta** — speed from consecutive snapped positions (smoothed α=0.3-0.6)
3. **Feed-reported speed** — used as initial seed (often 0)

All speeds capped by GTFS route_type: tram 50km/h, bus 90km/h, subway 130km/h, rail 160km/h, ferry 50km/h.

Prediction: glide from previous position to GPS target (constant speed over sample interval), then coast forward via dead-reckoning with exponential speed decay. If overshot, accept GPS and glide back. GPS is ground truth.

### NYC coverage

- MTA Bus: 2000+ vehicles (unified RT feed, all boroughs)
- NYC Subway: 350+ trains (interpolated from TripUpdate, no GPS)
- LIRR: 40-50 trains
- Metro-North: 15-20 trains
- NYC Ferry: 15 vessels
- Hoboken shuttle: 4 vehicles

Feeds configured in Barrelman's `gtfs_feeds` table. RT URLs stored in `rt_urls` JSONB column.
