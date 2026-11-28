import { api } from '@/lib/api'
import type { Place } from '@/types/place.types'

export async function fetchArrivalPoints(id: string, mode: string): Promise<Place[]> {
  const { data } = await api.get<{ places: Place[] }>('/places/arrival-points', { params: { id, mode } })
  return data.places
}
