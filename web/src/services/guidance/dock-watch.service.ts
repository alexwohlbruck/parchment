import { api } from '@/lib/api'
import type { LngLat } from '@/types/map.types'
import type { DockNeed } from '@/lib/guidance/dock-watch'

export interface StationStatus {
  stationId: string
  name: string
  bikes: number
  docks: number
}

export interface DockAlternative {
  stationId: string
  name: string
  location: LngLat
  available: number
  fromOriginal: number
}

const STATION_RADIUS_METERS = 60

/** Dev only: stands in for the live count so filling and full stations can be forced. */
let devOverride: ((status: StationStatus) => StationStatus) | null = null
export function setDevStationOverride(override: typeof devOverride) {
  if (import.meta.env.DEV) devOverride = override
}

export async function fetchStation(location: LngLat): Promise<StationStatus | null> {
  try {
    const { data } = await api.get('/gbfs/station', {
      params: { lat: location.lat, lng: location.lng, radius: STATION_RADIUS_METERS },
    })
    if (!data?.stationId) return null
    const status: StationStatus = {
      stationId: data.stationId,
      name: data.name,
      bikes: (data.numBikesAvailable ?? 0) + (data.numEbikesAvailable ?? 0),
      docks: data.numDocksAvailable ?? 0,
    }
    return devOverride ? devOverride(status) : status
  } catch {
    return null
  }
}

export async function fetchAlternatives(location: LngLat, need: DockNeed, target: LngLat | null): Promise<DockAlternative[]> {
  try {
    const { data } = await api.get('/gbfs/station/alternatives', {
      params: { lat: location.lat, lng: location.lng, need, toLat: target?.lat, toLng: target?.lng },
    })
    return data?.alternatives ?? []
  } catch {
    return []
  }
}
