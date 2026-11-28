import { api } from '@/lib/api'
import type { Place } from '@/types/place.types'
import type { ArrivalPointsQuery } from '@/lib/directions/arrival-points'

export async function fetchArrivalPoints(params: ArrivalPointsQuery, signal: AbortSignal): Promise<Place[]> {
  const { data } = await api.get<{ places: Place[] }>('/places/arrival-points', { params, signal })
  return data.places
}
