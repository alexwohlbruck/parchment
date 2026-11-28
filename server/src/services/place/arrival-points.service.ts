import type { Place } from '../../types/place.types'
import { searchByCategory } from '../search.service'
import {
  arrivalCategories,
  pickArrivalPoints,
  type ArrivalBounds,
} from '../../lib/place/arrival-points'

// Named children are a minority of a category's results, so fetch well past
// what gets shown.
const FETCH_LIMIT = 60

export interface ArrivalPointsQuery {
  presetId: string
  bounds: ArrivalBounds
  mode?: string
  placeId?: string
}

/** The precise places to arrive at inside a large one: an airport's terminals, a campus's parking. */
export async function getArrivalPoints(
  { presetId, bounds, mode, placeId }: ArrivalPointsQuery,
  deps = { searchByCategory },
): Promise<Place[]> {
  const lists = await Promise.all(
    arrivalCategories(presetId, mode).map(async (category) =>
      pickArrivalPoints(
        await deps.searchByCategory(category, { bounds, limit: FETCH_LIMIT }),
        bounds,
        placeId,
      ),
    ),
  )
  return lists.flat()
}
