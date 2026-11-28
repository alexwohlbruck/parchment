import { api } from '@/lib/api'
import type { Place } from '@/types/place.types'
import type { ArrivalTarget } from '@/lib/directions/arrival-points'

export interface ArrivalPoints {
  parent: Place | null
  places: Place[]
}

export async function fetchArrivalPoints(
  target: ArrivalTarget | { id: string },
  mode: string,
  signal?: AbortSignal,
): Promise<ArrivalPoints> {
  const { data } = await api.get<ArrivalPoints>('/places/arrival-points', {
    params: { ...target, mode },
    signal,
  })
  return data
}
