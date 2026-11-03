import { api } from '@/lib/api'
import type { LngLat } from '@/types/map.types'
import type { Place } from '@/types/place.types'

export interface AheadResult {
  place: Place
  /** Metres ahead along the route. */
  alongDistance: number
  /** Extra seconds stopping there adds, when it could be routed. */
  detourSeconds: number | null
}

const SERVER_MODES: Record<string, 'walking' | 'cycling' | 'driving'> = {
  walking: 'walking',
  cycling: 'cycling',
  biking: 'cycling',
  driving: 'driving',
}

export function canSearchAhead(mode: string): boolean {
  return mode in SERVER_MODES
}

export async function searchAhead(params: {
  route: LngLat[]
  mode: string
  query?: string
  categories?: string[]
  signal?: AbortSignal
}): Promise<AheadResult[]> {
  const { data } = await api.post(
    '/search/along-route',
    {
      route: params.route.map(p => ({ lat: p.lat, lng: p.lng })),
      mode: SERVER_MODES[params.mode],
      query: params.query || undefined,
      categories: params.categories,
    },
    { signal: params.signal },
  )
  return data?.results ?? []
}
