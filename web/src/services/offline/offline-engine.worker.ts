/// <reference lib="webworker" />
import { OFFLINE_CACHE, offlineCacheKey } from '@/lib/offline/offline-cache'
import { buildPlaceIndex, searchPlaceIndex, type PlaceIndex } from '@/lib/offline/search/place-index'
import { decodeStreetGraph } from '@/lib/offline/streets/street-graph'
import { decodeTimetable } from '@/lib/offline/transit/timetable'
import { findStop, stopBoard } from '@/lib/offline/transit/stop-board'
import { planOfflineTrips, stopNodesFor, type OfflineRegionData } from '@/lib/offline/offline-trips'
import type { PlacesPackage, StreetsPackage, TimetablePackage } from '@/types/offline-package.types'
import type { EngineRegion, EngineRequest, EngineResponse } from '@/types/offline-engine.types'

interface Loaded extends OfflineRegionData {
  key: string
  places?: PlacesPackage['places']
}

let loaded = new Map<string, Loaded>()
let index: PlaceIndex | null = null

const regionKey = (r: EngineRegion) => `${r.id}@${r.savedAt}`

async function read<T>(cache: Cache, url: string | undefined): Promise<T | undefined> {
  if (!url) return undefined
  const hit = await cache.match(offlineCacheKey(url))
  return hit ? ((await hit.json()) as T) : undefined
}

async function loadRegion(cache: Cache, region: EngineRegion): Promise<Loaded> {
  const [places, timetablePkg, streets] = await Promise.all([
    read<PlacesPackage>(cache, region.urls.places),
    read<TimetablePackage>(cache, region.urls.timetable),
    read<StreetsPackage>(cache, region.urls.streets),
  ])
  const graph = streets ? decodeStreetGraph(streets) : undefined
  const timetable = timetablePkg?.trips.length ? decodeTimetable(timetablePkg) : undefined
  return {
    id: region.id,
    key: regionKey(region),
    places: places?.places,
    graph,
    timetable,
    stopNodes: graph && timetable ? stopNodesFor(graph, timetable) : undefined,
  }
}

async function sync(regions: EngineRegion[]): Promise<void> {
  const cache = await caches.open(OFFLINE_CACHE)
  const next = new Map<string, Loaded>()
  for (const region of regions) {
    const current = loaded.get(region.id)
    next.set(region.id, current?.key === regionKey(region) ? current : await loadRegion(cache, region))
  }
  const changed = next.size !== loaded.size || [...next].some(([id, r]) => loaded.get(id) !== r)
  loaded = next
  if (changed) index = null
}

function placeIndex(): PlaceIndex {
  index ??= buildPlaceIndex([...loaded.values()].flatMap(r => r.places ?? []))
  return index
}

function timetables() {
  return [...loaded.values()].flatMap(r => (r.timetable ? [r.timetable] : []))
}

async function handle(request: EngineRequest): Promise<unknown> {
  switch (request.type) {
    case 'sync':
      return sync(request.regions)
    case 'search':
      return searchPlaceIndex(placeIndex(), request.query, { near: request.near, limit: request.limit }).map(m => m.place)
    case 'place':
      return placeIndex().byId.get(request.id) ?? null
    case 'departures': {
      for (const tt of timetables()) {
        const stop = findStop(tt, request.stop)
        if (stop !== null) return stopBoard(tt, stop, Math.floor(request.after / 1000))
      }
      return null
    }
    case 'plan':
      return planOfflineTrips([...loaded.values()], request.request)
  }
}

self.onmessage = async (event: MessageEvent<{ id: number; request: EngineRequest }>) => {
  const { id, request } = event.data
  let response: EngineResponse
  try {
    response = { id, result: await handle(request) }
  } catch (error) {
    response = { id, error: error instanceof Error ? error.message : String(error) }
  }
  self.postMessage(response)
}
