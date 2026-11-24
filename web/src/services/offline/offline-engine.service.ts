/**
 * Search, departures and trip planning over saved regions, answered by a
 * worker that loads the regions' packages the first time it is asked.
 */
import type { OfflineTripRequest, OfflineTripResponse } from '@/lib/offline/offline-trips'
import type { PackagePlace } from '@/types/offline-package.types'
import type { EngineRegion, EngineRequest, EngineResponse, StopQuery } from '@/types/offline-engine.types'
import type { TransitStopInfo } from '@/types/place.types'
import { i18n } from '@/lib/i18n'
import { stepText } from '@/lib/guidance/instructions/instruction-text'

let worker: Worker | null = null
let nextId = 0
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
let regions: EngineRegion[] = []
let synced: Promise<unknown> | null = null

function ensureWorker(): Worker {
  if (worker) return worker
  worker = new Worker(new URL('./offline-engine.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (event: MessageEvent<EngineResponse>) => {
    const call = pending.get(event.data.id)
    if (!call) return
    pending.delete(event.data.id)
    if ('error' in event.data) call.reject(new Error(event.data.error))
    else call.resolve(event.data.result)
  }
  worker.onerror = () => {
    for (const call of pending.values()) call.reject(new Error('Offline engine failed'))
    pending.clear()
    worker?.terminate()
    worker = null
    synced = null
  }
  return worker
}

function send<T>(request: EngineRequest): Promise<T> {
  const id = nextId++
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
    ensureWorker().postMessage({ id, request })
  })
}

async function ask<T>(request: EngineRequest): Promise<T | null> {
  if (!regions.length) return null
  synced ??= send({ type: 'sync', regions })
  await synced
  return send<T>(request)
}

/** The ready regions the engine answers from; it reloads lazily when they change. */
export function setOfflineRegions(next: EngineRegion[]) {
  const key = (list: EngineRegion[]) => list.map(r => `${r.id}@${r.savedAt}`).join()
  if (key(next) === key(regions)) return
  regions = next
  synced = null
  if (!regions.length && worker) {
    worker.terminate()
    worker = null
  }
}

export const hasOfflineRegions = () => regions.length > 0

export const searchOffline = (query: string, near?: { lat: number; lng: number }, limit?: number) =>
  ask<PackagePlace[]>({ type: 'search', query, near, limit }).then(r => r ?? [])

export const offlinePlace = (id: string) => ask<PackagePlace>({ type: 'place', id })

export const offlineDepartures = (stop: StopQuery, after = Date.now()) =>
  ask<TransitStopInfo>({ type: 'departures', stop, after })

/** Trips planned on the device, with their instructions worded in the app's language. */
export async function planOffline(request: OfflineTripRequest): Promise<OfflineTripResponse | null> {
  const response = await ask<OfflineTripResponse>({ type: 'plan', request })
  const t = (i18n.global as unknown as { t: (key: string, named?: Record<string, unknown>) => string }).t
  for (const { trip } of response?.trips ?? []) {
    for (const segment of trip.segments) for (const step of segment.instructions) step.text = stepText(step, t)
  }
  return response
}
